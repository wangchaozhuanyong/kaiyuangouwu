import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { CatalogOperationsService } from '@vendure/catalog-management-plugin';
import { GlobalFlag, ModifyOrderInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Channel,
    effectiveRefundLines,
    FulfillmentLine,
    Order,
    OrderLine,
    OrderService,
    Product,
    ProductVariant,
    RequestContext,
    RequestContextCacheService,
    StockLevel,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { GovernanceService } from '@vendure/store-management-plugin';
import { randomUUID } from 'node:crypto';
import { In, ObjectLiteral, ObjectType, Repository } from 'typeorm';

import { autoCardDisplayStock } from './auto-card-display-stock';
import { DigitalDeliveryMode } from './auto-card.constants';
import {
    digitalStockPolicy,
    releasableDigitalQuantity,
    validateDigitalQuantity,
} from './digital-product.policy';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import {
    DigitalFileVersion,
    DigitalOrderReservation,
    DigitalQuotaMovement,
    DigitalVariantConfig,
} from './entities/digital-product.entity';
import { getOrderLineFulfillmentType } from './fulfillment-classification';
import { DigitalStockPolicy } from './types';

export interface UpdateDigitalVariantInput {
    productVariantId: ID;
    deliveryMode: DigitalDeliveryMode;
    stockPolicy?: DigitalStockPolicy;
    availableQuantity?: number;
    expectedAvailableQuantity?: number;
    fileVersionId?: ID | null;
}

export interface DigitalInventoryLegacyStockLevel {
    id: ID;
    stockLocationId: ID;
    stockOnHand: number;
    stockAllocated: number;
}

export interface DigitalInventoryOwnershipConfirmation {
    stockLevels: DigitalInventoryLegacyStockLevel[];
    reason: string;
}

/** Digital availability never writes warehouse quantities or packaging information. */
@Injectable()
export class DigitalProductService implements OnApplicationBootstrap {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orders: OrderService,
        private readonly catalog: CatalogOperationsService,
        private readonly requestCache: RequestContextCacheService = new RequestContextCacheService(),
        private readonly audit?: GovernanceService,
    ) {}

    onApplicationBootstrap(): void {
        this.orders.registerOrderModificationValidator(
            'commerce-digital-refunded-unit-increase',
            (_ctx, order, input) => Promise.resolve(this.validateModification(order, input)),
        );
    }

    validateModification(order: Order, input: ModifyOrderInput): void {
        if (!order.orderPlacedAt) return;
        for (const line of order.lines.filter(item => getOrderLineFulfillmentType(item) === 'digital')) {
            const increases =
                (input.adjustOrderLines ?? []).some(
                    item => String(item.orderLineId) === String(line.id) && item.quantity > line.quantity,
                ) ||
                (input.addItems ?? []).some(
                    item =>
                        String(item.productVariantId) === String(line.productVariantId) && item.quantity > 0,
                );
            if (!increases) continue;
            const hasItemRefund = effectiveRefundLines(
                (order.payments ?? []).flatMap(payment => payment.refunds ?? []),
            ).some(item => String(item.orderLineId) === String(line.id) && item.quantity > 0);
            if (hasItemRefund)
                throw new UserInputError(
                    '该数字商品已有按份退款，不能在原订单增加数量；请新建订单购买，避免恢复已暂停或撤销的交付内容',
                );
        }
    }

    async requireVariant(ctx: RequestContext, id: ID) {
        if (ctx.channel.code === '__default_channel__')
            throw new UserInputError('请选择具体店铺后管理数字商品');
        const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, id, {
            channelId: ctx.channelId,
        });
        const product = await this.connection.getEntityOrThrow(ctx, Product, variant.productId);
        if (product.customFields.fulfillmentType !== 'digital')
            throw new UserInputError('该操作仅适用于数字商品');
        return variant;
    }

    config(ctx: RequestContext, variantId: ID) {
        return this.connection.getRepository(ctx, DigitalVariantConfig).findOne({
            where: { channelId: ctx.channelId, productVariantId: variantId, migrationState: 'ACTIVE' },
        });
    }

    configForDisplay(ctx: RequestContext, variantId: ID) {
        return this.requestCache.load(
            ctx,
            `digital-variant-config:${ctx.channelId}`,
            variantId,
            async ids => {
                const configurations = await this.connection.getRepository(ctx, DigitalVariantConfig).find({
                    where: {
                        channelId: ctx.channelId,
                        productVariantId: In([...ids]),
                        migrationState: 'ACTIVE',
                    },
                });
                const byVariant = new Map(
                    configurations.map(config => [String(config.productVariantId), config]),
                );
                return ids.map(id => byVariant.get(id) ?? null);
            },
        );
    }

    async initialize(ctx: RequestContext, variant: ProductVariant) {
        if (await this.config(ctx, variant.id)) return;
        const prepared = await this.connection.getRepository(ctx, DigitalVariantConfig).findOne({
            where: { channelId: ctx.channelId, productVariantId: variant.id, migrationState: 'PREPARED' },
        });
        const mode = variant.customFields.digitalDeliveryMode ?? 'manual_service';
        await this.connection.getRepository(ctx, DigitalVariantConfig).save(
            new DigitalVariantConfig({
                ...prepared,
                channelId: ctx.channelId,
                productVariantId: variant.id,
                deliveryMode: mode,
                stockPolicy: digitalStockPolicy(mode, variant.customFields.digitalStockPolicy),
                availableQuantity: 0,
                fileVersionId: null,
                migrationState: 'ACTIVE',
            }),
        );
    }

    async workspace(ctx: RequestContext, productId: ID) {
        const product = await this.connection.getEntityOrThrow(ctx, Product, productId, {
            channelId: ctx.channelId,
            relations: ['variants'],
        });
        if (product.customFields.fulfillmentType !== 'digital')
            throw new UserInputError('该商品使用实物经营资料');
        const variants = await Promise.all(
            product.variants
                .filter(v => !v.deletedAt)
                .map(async variant => {
                    const config = await this.config(ctx, variant.id);
                    const file = config?.fileVersionId
                        ? await this.connection.getRepository(ctx, DigitalFileVersion).findOne({
                              where: { id: config.fileVersionId, channelId: ctx.channelId },
                          })
                        : null;
                    const cost = await this.catalog.latestCost(ctx, variant.id, ctx.currencyCode);
                    const supplier = await this.catalog.variantSupplier(ctx, variant.id);
                    return {
                        id: variant.id,
                        sku: variant.sku,
                        supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
                        deliveryMode:
                            config?.deliveryMode ??
                            variant.customFields.digitalDeliveryMode ??
                            'manual_service',
                        stockPolicy:
                            config?.stockPolicy ?? variant.customFields.digitalStockPolicy ?? 'unlimited',
                        availableQuantity: config?.availableQuantity ?? null,
                        migrationRequired: !config,
                        fileVersion: file,
                        purchaseCostMicrounits: cost ? Number(cost.costMicrounits) : null,
                    };
                }),
        );
        return { productId, variants };
    }

    async update(ctx: RequestContext, input: UpdateDigitalVariantInput) {
        const variant = await this.requireVariant(ctx, input.productVariantId);
        if (!['auto_card', 'manual_service', 'file_download'].includes(input.deliveryMode))
            throw new UserInputError('数字交付方式无效');
        let config = await this.config(ctx, variant.id);
        if (!config) throw new UserInputError('请先核对并迁移该商品的旧数字库存');
        const repository = this.connection.getRepository(ctx, DigitalVariantConfig);
        config = await this.lock(ctx, DigitalVariantConfig, config.id);
        if (input.stockPolicy && !['limited', 'unlimited', 'pool_derived'].includes(input.stockPolicy)) {
            throw new UserInputError('数字份数策略无效');
        }
        const policy = digitalStockPolicy(input.deliveryMode, input.stockPolicy ?? config.stockPolicy);
        const holds = await this.connection.getRepository(ctx, DigitalOrderReservation).count({
            where: { configId: config.id, state: 'HELD' },
        });
        if (holds && (config.deliveryMode !== input.deliveryMode || config.stockPolicy !== policy)) {
            throw new UserInputError('该规格有未完成交付占用，请先处理后再修改交付方式或份数限制');
        }
        if (
            input.fileVersionId != null &&
            !(await this.connection.getRepository(ctx, DigitalFileVersion).exists({
                where: { id: input.fileVersionId, channelId: ctx.channelId },
            }))
        )
            throw new UserInputError('交付文件不存在或不属于当前店铺');
        const previous = config.availableQuantity;
        if (input.availableQuantity !== undefined) {
            if (
                input.expectedAvailableQuantity === undefined ||
                input.expectedAvailableQuantity !== config.availableQuantity
            ) {
                throw new UserInputError('可售份数已变化，请刷新后重新填写');
            }
            if (policy !== 'limited') throw new UserInputError('仅限量数字商品可以设置可售份数');
            try {
                config.availableQuantity = validateDigitalQuantity(input.availableQuantity);
            } catch (error) {
                throw new UserInputError((error as Error).message);
            }
        }
        config.deliveryMode = input.deliveryMode;
        config.stockPolicy = policy;
        if (input.fileVersionId !== undefined) config.fileVersionId = input.fileVersionId;
        await repository.save(config);
        if (previous !== config.availableQuantity)
            await this.movement(ctx, config, 'ADJUST', config.availableQuantity - previous);
        // Business configuration is channel scoped. Other stores may still need legacy tracking.
        if (await this.allStoresMigrated(ctx, variant.id)) {
            await this.connection
                .getRepository(ctx, ProductVariant)
                .update(variant.id, { trackInventory: GlobalFlag.FALSE });
        }
        return config;
    }

    async allStoresMigrated(ctx: RequestContext, variantId: ID): Promise<boolean> {
        const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, variantId, {
            relations: ['channels'],
        });
        const storeIds = variant.channels
            .filter(channel => channel.code !== '__default_channel__')
            .map(channel => channel.id);
        if (!storeIds.length) return false;
        return (
            (await this.connection.getRepository(ctx, DigitalVariantConfig).count({
                where: { productVariantId: variantId, channelId: In(storeIds), migrationState: 'ACTIVE' },
            })) === storeIds.length
        );
    }

    async available(ctx: RequestContext, variant: ProductVariant): Promise<number | null | undefined> {
        return this.availableQuantity(ctx, variant, false);
    }

    async availableForDisplay(
        ctx: RequestContext,
        variant: ProductVariant,
    ): Promise<number | null | undefined> {
        return this.availableQuantity(ctx, variant, true);
    }

    private async availableQuantity(
        ctx: RequestContext,
        variant: ProductVariant,
        forDisplay: boolean,
    ): Promise<number | null | undefined> {
        if (variant.customFields.fulfillmentType !== 'digital') return undefined;
        const config = await (forDisplay
            ? this.configForDisplay(ctx, variant.id)
            : this.config(ctx, variant.id));
        if (!config) return undefined; // Explicit compatibility path until migration is activated.
        if (config.stockPolicy === 'pool_derived') {
            const cards = forDisplay
                ? await this.requestCache.load(
                      ctx,
                      `digital-local-card-config:${ctx.channelId}`,
                      variant.id,
                      async ids => {
                          const configs = await this.connection.getRepository(ctx, AutoCardConfig).find({
                              where: {
                                  channelId: ctx.channelId,
                                  productVariantId: In([...ids]),
                                  enabled: true,
                              },
                          });
                          const byVariant = new Map(
                              configs.map(item => [String(item.productVariantId), item]),
                          );
                          return ids.map(id => byVariant.get(id) ?? null);
                      },
                  )
                : await this.connection.getRepository(ctx, AutoCardConfig).findOne({
                      where: { channelId: ctx.channelId, productVariantId: variant.id, enabled: true },
                  });
            return cards
                ? forDisplay
                    ? autoCardDisplayStock(ctx, cards.id, this.connection, this.requestCache)
                    : this.connection.getRepository(ctx, AutoCardPoolItem).count({
                          where: { configId: cards.id, state: 'AVAILABLE' },
                      })
                : 0;
        }
        return config.stockPolicy === 'unlimited' ? null : config.availableQuantity;
    }

    async reserveOrder(ctx: RequestContext, order: Order, expiresAt = new Date(Date.now() + 15 * 60_000)) {
        await this.lock(ctx, Order, order.id);
        const lines = order.lines
            .filter(line => getOrderLineFulfillmentType(line) === 'digital')
            .sort((a, b) => String(a.productVariantId).localeCompare(String(b.productVariantId)));
        for (const line of lines) {
            let config = await this.config(ctx, line.productVariantId);
            if (!config) continue; // Legacy stores keep their old path until explicitly migrated.
            config = await this.lock(ctx, DigitalVariantConfig, config.id);
            validateDigitalQuantity(line.quantity);
            if (!line.quantity) throw new UserInputError('购买数量必须大于零');
            let reservation = await this.connection
                .getRepository(ctx, DigitalOrderReservation)
                .findOne({ where: { orderLineId: line.id } });
            const extendingReservation = reservation && reservation.state !== 'RELEASED' ? reservation : null;
            const extending = Boolean(extendingReservation);
            const targetQuantity = extendingReservation
                ? Math.max(extendingReservation.quantity, line.quantity, line.orderPlacedQuantity || 0)
                : line.quantity;
            const quantity = extendingReservation
                ? targetQuantity - extendingReservation.quantity
                : targetQuantity;
            if (!quantity) continue;
            if (
                extending &&
                effectiveRefundLines((order.payments ?? []).flatMap(payment => payment.refunds ?? [])).some(
                    item => String(item.orderLineId) === String(line.id) && item.quantity > 0,
                )
            )
                throw new UserInputError(
                    '该数字订单行已有按份退款，请新建订单购买，避免恢复已撤销的交付内容',
                );
            if (extendingReservation)
                config = {
                    ...config,
                    deliveryMode: extendingReservation.deliveryMode,
                    stockPolicy: extendingReservation.stockPolicy,
                    fileVersionId: extendingReservation.fileVersionId,
                };
            if (
                config.deliveryMode === 'file_download' &&
                (!config.fileVersionId ||
                    !(await this.connection.getRepository(ctx, DigitalFileVersion).exists({
                        where: { id: config.fileVersionId, channelId: ctx.channelId },
                    })))
            )
                throw new UserInputError(`数字商品“${line.productVariant.name}”尚未配置交付文件`);
            const poolIds: ID[] = extendingReservation
                ? JSON.parse(extendingReservation.poolItemIdsJson)
                : [];
            if (config.stockPolicy === 'pool_derived') {
                const cards = await this.connection.getRepository(ctx, AutoCardConfig).findOne({
                    where: {
                        channelId: ctx.channelId,
                        productVariantId: line.productVariantId,
                        enabled: true,
                    },
                });
                if (!cards) throw new UserInputError('该规格尚未启用自动发卡');
                const items = await this.connection.getRepository(ctx, AutoCardPoolItem).find({
                    where: { configId: cards.id, state: 'AVAILABLE' },
                    order: { sequence: 'ASC' },
                    take: quantity,
                });
                if (items.length !== quantity) throw new UserInputError('可用卡密不足，请调整购买数量');
                const changed = await this.connection
                    .getRepository(ctx, AutoCardPoolItem)
                    .createQueryBuilder()
                    .update()
                    .set({ state: 'RESERVED' })
                    .where('id IN (:...ids)', { ids: items.map(item => item.id) })
                    .andWhere('state = :state', { state: 'AVAILABLE' })
                    .execute();
                if (changed.affected !== quantity) throw new UserInputError('卡密被其他订单占用，请重新结算');
                poolIds.push(...items.map(item => item.id));
            } else if (config.stockPolicy === 'limited') {
                const changed = await this.connection
                    .getRepository(ctx, DigitalVariantConfig)
                    .createQueryBuilder()
                    .update()
                    .set({ availableQuantity: () => 'availableQuantity - :quantity' })
                    .where('id = :id AND availableQuantity >= :quantity', { id: config.id, quantity })
                    .execute();
                if (changed.affected !== 1) throw new UserInputError('可售份数不足，请调整购买数量');
                const current = await this.connection.getEntityOrThrow(ctx, DigitalVariantConfig, config.id);
                await this.movement(ctx, current, 'HOLD', -quantity);
            }
            reservation = new DigitalOrderReservation({
                ...reservation,
                channelId: ctx.channelId,
                orderId: order.id,
                orderLineId: line.id,
                configId: config.id,
                deliveryMode: config.deliveryMode,
                stockPolicy: config.stockPolicy,
                quantity: targetQuantity,
                releasedQuantity: extendingReservation?.releasedQuantity ?? 0,
                consumedQuantity: extendingReservation?.consumedQuantity ?? 0,
                expiresAt,
                state: 'HELD',
                fileVersionId: config.fileVersionId,
                poolItemIdsJson: JSON.stringify(poolIds),
            });
            await this.connection.getRepository(ctx, DigitalOrderReservation).save(reservation);
            const parent = await this.connection.getEntityOrThrow(
                ctx,
                Product,
                line.productVariant.productId,
            );
            line.customFields = {
                ...line.customFields,
                digitalDeliveryModeSnapshot: config.deliveryMode,
                ...(!extending
                    ? {
                          fulfillmentTypeSnapshot: 'digital',
                          refundPolicySnapshot: parent.customFields.refundPolicy,
                          manualDeliverySlaMinutesSnapshot: parent.customFields.manualDeliverySlaMinutes,
                      }
                    : {}),
            };
            await this.connection.getRepository(ctx, OrderLine).save(line, { reload: false });
        }
    }

    async releaseLine(ctx: RequestContext, lineId: ID, requested = Number.MAX_SAFE_INTEGER) {
        const repository = this.connection.getRepository(ctx, DigitalOrderReservation);
        const existing = await repository.findOne({
            where: { orderLineId: lineId, channelId: ctx.channelId },
        });
        if (!existing) return;
        await this.lock(ctx, DigitalVariantConfig, existing.configId);
        const reservation = await this.lock(ctx, DigitalOrderReservation, existing.id);
        const quantity = releasableDigitalQuantity(reservation, requested);
        if (!quantity) return;
        if (reservation.stockPolicy === 'limited') {
            await this.connection
                .getRepository(ctx, DigitalVariantConfig)
                .increment({ id: reservation.configId }, 'availableQuantity', quantity);
            const config = await this.connection.getEntityOrThrow(
                ctx,
                DigitalVariantConfig,
                reservation.configId,
            );
            await this.movement(ctx, config, 'RELEASE', quantity);
        } else if (reservation.stockPolicy === 'pool_derived') {
            const ids = JSON.parse(reservation.poolItemIdsJson) as ID[];
            const releasing = ids.slice(
                reservation.consumedQuantity + reservation.releasedQuantity,
                reservation.consumedQuantity + reservation.releasedQuantity + quantity,
            );
            if (releasing.length)
                await this.connection
                    .getRepository(ctx, AutoCardPoolItem)
                    .update({ id: In(releasing), state: 'RESERVED' }, { state: 'AVAILABLE' });
        }
        reservation.releasedQuantity += quantity;
        if (reservation.releasedQuantity + reservation.consumedQuantity === reservation.quantity) {
            reservation.state = reservation.consumedQuantity ? 'CONSUMED' : 'RELEASED';
        }
        await repository.save(reservation);
    }

    async consumeLine(ctx: RequestContext, lineId: ID, requested = Number.MAX_SAFE_INTEGER) {
        const repository = this.connection.getRepository(ctx, DigitalOrderReservation);
        const found = await repository.findOne({ where: { orderLineId: lineId, channelId: ctx.channelId } });
        if (!found) return;
        await this.lock(ctx, DigitalVariantConfig, found.configId);
        const reservation = await this.lock(ctx, DigitalOrderReservation, found.id);
        if (reservation.state !== 'HELD') return;
        const quantity = Math.min(
            requested,
            reservation.quantity - reservation.releasedQuantity - reservation.consumedQuantity,
        );
        if (quantity <= 0) return;
        reservation.consumedQuantity += quantity;
        if (reservation.consumedQuantity + reservation.releasedQuantity === reservation.quantity)
            reservation.state = 'CONSUMED';
        await repository.save(reservation);
    }

    async reservation(ctx: RequestContext, lineId: ID) {
        return this.connection
            .getRepository(ctx, DigitalOrderReservation)
            .findOne({ where: { channelId: ctx.channelId, orderLineId: lineId } });
    }

    async migrationPreview(
        ctx: RequestContext,
        variantId: ID,
        lockedStocks?: StockLevel[],
        ownershipConfirmation?: DigitalInventoryOwnershipConfirmation,
    ) {
        const variant = await this.requireVariant(ctx, variantId);
        const stocks = await this.connection.getRepository(ctx, StockLevel).find({
            where: { productVariantId: variantId },
            relations: ['stockLocation', 'stockLocation.channels'],
        });
        if (
            lockedStocks &&
            (stocks.length !== lockedStocks.length ||
                stocks.some(stock => !lockedStocks.some(row => String(row.id) === String(stock.id))))
        )
            throw new UserInputError('旧库存记录集合已变化，请重新核对');
        if (lockedStocks)
            for (const stock of stocks) {
                const fresh = lockedStocks.find(row => String(row.id) === String(stock.id));
                if (fresh) {
                    if (String(stock.stockLocationId) !== String(fresh.stockLocationId))
                        throw new UserInputError('旧库存仓库关联已变化，请重新核对');
                    stock.stockOnHand = fresh.stockOnHand;
                    stock.stockAllocated = fresh.stockAllocated;
                }
            }
        for (const stock of stocks)
            if (!Number.isSafeInteger(stock.stockOnHand) || !Number.isSafeInteger(stock.stockAllocated))
                throw new UserInputError('旧库存数量无效，请核对后迁移');
        const unowned = stocks.filter(
            stock =>
                (stock.stockOnHand || stock.stockAllocated) &&
                !stock.stockLocation?.channels.some(channel => channel.code !== '__default_channel__'),
        );
        const alreadyMigrated = Boolean(await this.config(ctx, variantId));
        const confirmableStockLevels =
            unowned.length && !alreadyMigrated
                ? await this.confirmableLegacyStocks(ctx, variant, stocks, unowned)
                : [];
        const confirmation = ownershipConfirmation
            ? this.validateOwnershipConfirmation(ownershipConfirmation, confirmableStockLevels)
            : undefined;
        const confirmedIds = new Set(confirmation?.stockLevels.map(stock => String(stock.id)));
        // Explicitly confirmed rows join this store's migration projection, never its warehouse membership.
        const relevant = stocks.filter(
            stock =>
                stock.stockLocation?.channels.some(channel => String(channel.id) === String(ctx.channelId)) ||
                confirmedIds.has(String(stock.id)),
        );
        const unknownStockOwner = unowned.some(stock => !confirmedIds.has(String(stock.id)));
        const ambiguous = relevant.some(
            stock =>
                stock.stockLocation?.channels.filter(channel => channel.code !== '__default_channel__')
                    .length > 1,
        );
        const orders = await this.connection.getRepository(ctx, OrderLine).find({
            where: { productVariantId: variantId },
            relations: ['order'],
        });
        const open = orders.filter(
            line =>
                String(line.order.salesChannelId) === String(ctx.channelId) &&
                !['Cancelled', 'Delivered'].includes(line.order.state) &&
                !line.order.active,
        );
        const allocated = this.migrationTotal(relevant, stock => stock.stockAllocated);
        const fulfilled = open.length
            ? await this.connection.getRepository(ctx, FulfillmentLine).find({
                  where: { orderLine: { id: In(open.map(line => line.id)) } },
                  relations: ['fulfillment'],
              })
            : [];
        const limited =
            variant.customFields.digitalDeliveryMode !== 'auto_card' &&
            variant.customFields.digitalStockPolicy === 'limited';
        const pending = limited
            ? open
                  .map(line => ({
                      line,
                      quantity: Math.max(
                          0,
                          line.quantity -
                              fulfilled
                                  .filter(
                                      item =>
                                          String(item.orderLineId) === String(line.id) &&
                                          item.fulfillment.state === 'Delivered',
                                  )
                                  .reduce((sum, item) => sum + item.quantity, 0),
                      ),
                  }))
                  .filter(item => item.quantity > 0)
            : [];
        const conflict =
            ambiguous || (limited && pending.reduce((sum, item) => sum + item.quantity, 0) !== allocated);
        const available = Math.max(
            0,
            this.migrationTotal(relevant, stock => stock.stockOnHand - stock.stockAllocated),
        );
        if (!Number.isSafeInteger(allocated) || !Number.isSafeInteger(available))
            throw new UserInputError('旧库存汇总数量无效，请核对后迁移');
        try {
            validateDigitalQuantity(available);
        } catch (error) {
            throw new UserInputError((error as Error).message);
        }
        const conflicts = conflict ? ['仓库共享归属或未完成订单占用数量不一致，需要核对后迁移'] : [];
        if (
            unknownStockOwner ||
            orders.some(
                line =>
                    !line.order.salesChannelId &&
                    !line.order.active &&
                    !['Cancelled', 'Delivered'].includes(line.order.state),
            )
        )
            conflicts.push('旧库存或未完成订单缺少店铺归属，请先核对，不能自动迁移');
        if (
            orders.some(
                line =>
                    String(line.order.salesChannelId) === String(ctx.channelId) &&
                    ['ArrangingPayment', 'ArrangingAdditionalPayment', 'Modifying'].includes(
                        line.order.state,
                    ),
            )
        )
            conflicts.push('该商品有结算或修改中的订单，请先确认付款与占用结果');
        if (
            variant.customFields.digitalDeliveryMode === 'file_download' &&
            orders.some(
                line =>
                    String(line.order.salesChannelId) === String(ctx.channelId) &&
                    !line.order.active &&
                    line.order.state !== 'Cancelled',
            )
        )
            conflicts.push('旧文件订单未记录成交文件版本，请先核对历史文件，不能自动绑定当前文件');
        if (variant.customFields.digitalDeliveryMode === 'auto_card' && open.length)
            conflicts.push('旧自动发卡订单尚未完成，请先核对并处理卡密分配后迁移');
        return {
            productVariantId: variantId,
            availableQuantity: available,
            reservedQuantity: allocated,
            conflicts,
            alreadyMigrated,
            confirmableStockLevels,
            variant,
            pending,
            confirmation,
            warehouseRows: stocks.map(stock => ({
                ...this.legacyStockView(stock),
                channelIds: stock.stockLocation?.channels.map(channel => String(channel.id)).sort() ?? [],
            })),
        };
    }

    private legacyStockView(stock: StockLevel): DigitalInventoryLegacyStockLevel {
        return {
            id: stock.id,
            stockLocationId: stock.stockLocationId,
            stockOnHand: stock.stockOnHand,
            stockAllocated: stock.stockAllocated,
        };
    }

    private migrationTotal(stocks: StockLevel[], quantity: (stock: StockLevel) => number): number {
        return stocks.reduce((total, stock) => {
            const delta = quantity(stock);
            if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(total + delta))
                throw new UserInputError('旧库存汇总数量无效，请核对后迁移');
            return total + delta;
        }, 0);
    }

    private async confirmableLegacyStocks(
        ctx: RequestContext,
        variant: ProductVariant,
        stocks: StockLevel[],
        unowned: StockLevel[],
    ): Promise<DigitalInventoryLegacyStockLevel[]> {
        if (!ctx.activeUserId || !this.audit || unowned.length > 50) return [];
        const [product, ownedVariant, configurations, migrations] = await Promise.all([
            this.connection.getEntityOrThrow(ctx, Product, variant.productId, { relations: ['channels'] }),
            this.connection.getEntityOrThrow(ctx, ProductVariant, variant.id, { relations: ['channels'] }),
            this.connection.getRepository(ctx, DigitalVariantConfig).find({
                where: { productVariantId: variant.id },
            }),
            this.connection.getRepository(ctx, DigitalQuotaMovement).find({
                where: { productVariantId: variant.id, type: 'MIGRATE' },
            }),
        ]);
        const soleOwner = (channels: Channel[]) => {
            const owners = new Set(
                channels
                    .filter(channel => channel.code !== '__default_channel__')
                    .map(channel => String(channel.id)),
            );
            return owners.size === 1 && owners.has(String(ctx.channelId));
        };
        if (
            !soleOwner(product.channels) ||
            !soleOwner(ownedVariant.channels) ||
            configurations.some(config => String(config.channelId) !== String(ctx.channelId)) ||
            migrations.length ||
            unowned.some(stock => !stock.stockLocation || stock.stockAllocated !== 0) ||
            stocks.some(stock => {
                if (!stock.stockOnHand && !stock.stockAllocated) return false;
                const owners = stock.stockLocation?.channels.filter(
                    channel => channel.code !== '__default_channel__',
                );
                return owners?.length && !soleOwner(owners);
            })
        )
            return [];
        return unowned.map(stock => this.legacyStockView(stock));
    }

    private validateOwnershipConfirmation(
        input: DigitalInventoryOwnershipConfirmation,
        actual: DigitalInventoryLegacyStockLevel[],
    ): DigitalInventoryOwnershipConfirmation {
        const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
        if (!reason || reason.length > 500) throw new UserInputError('请填写1到500字的旧库存归属核对原因');
        const rows = input.stockLevels;
        if (
            !Array.isArray(rows) ||
            !rows.length ||
            !actual.length ||
            rows.length !== actual.length ||
            new Set(rows.map(row => String(row?.id))).size !== rows.length ||
            rows.some(row => {
                const current = actual.find(stock => String(stock.id) === String(row?.id));
                return (
                    !current ||
                    String(row.stockLocationId) !== String(current.stockLocationId) ||
                    !Number.isSafeInteger(row.stockOnHand) ||
                    !Number.isSafeInteger(row.stockAllocated) ||
                    row.stockOnHand !== current.stockOnHand ||
                    row.stockAllocated !== current.stockAllocated ||
                    row.stockAllocated !== 0
                );
            })
        )
            throw new UserInputError('旧库存归属或数量已变化，不能确认，请重新核对完整库存记录');
        return { stockLevels: actual, reason };
    }

    async migrate(
        ctx: RequestContext,
        variantId: ID,
        expectedAvailable: number,
        expectedReserved: number,
        ownershipConfirmation?: DigitalInventoryOwnershipConfirmation,
    ) {
        if (!Number.isSafeInteger(expectedAvailable) || !Number.isSafeInteger(expectedReserved))
            throw new UserInputError('迁移核对数量必须为有效整数');
        if (ctx.channel.code === '__default_channel__')
            throw new UserInputError('请选择具体店铺后管理数字商品');
        if (
            ownershipConfirmation &&
            !this.connection.getRepository(ctx, ProductVariant).manager.queryRunner?.isTransactionActive
        )
            throw new UserInputError('旧库存归属确认必须通过事务迁移入口执行');
        // Acquire locks before the first consistent read, including a concurrent migration's ACTIVE state.
        const lockedVariant = await this.lock(ctx, ProductVariant, variantId, true);
        const lockedProduct = await this.lock(ctx, Product, lockedVariant.productId);
        if (lockedProduct.customFields.fulfillmentType !== 'digital')
            throw new UserInputError('该操作仅适用于数字商品');
        const stocksRepository = this.connection.getRepository(ctx, StockLevel);
        const stockQuery = stocksRepository
            .createQueryBuilder('lockedRow')
            .where('lockedRow.productVariantId = :variantId', { variantId })
            .orderBy('lockedRow.id', 'ASC');
        if (this.canLock(stocksRepository)) stockQuery.setLock('pessimistic_write');
        const lockedStocks = await stockQuery.getMany();
        await this.requireVariant(ctx, variantId);
        if (await this.config(ctx, variantId)) return this.config(ctx, variantId);
        const current = await this.migrationPreview(ctx, variantId, lockedStocks, ownershipConfirmation);
        if (current.alreadyMigrated) return this.config(ctx, variantId);
        if (
            current.conflicts.length ||
            current.availableQuantity !== expectedAvailable ||
            current.reservedQuantity !== expectedReserved
        )
            throw new UserInputError('迁移核对结果已变化');
        const variant = current.variant;
        const prepared = await this.connection.getRepository(ctx, DigitalVariantConfig).findOne({
            where: { channelId: ctx.channelId, productVariantId: variantId, migrationState: 'PREPARED' },
        });
        const config = await this.connection.getRepository(ctx, DigitalVariantConfig).save(
            new DigitalVariantConfig({
                ...prepared,
                channelId: ctx.channelId,
                productVariantId: variantId,
                deliveryMode: variant.customFields.digitalDeliveryMode,
                stockPolicy: digitalStockPolicy(
                    variant.customFields.digitalDeliveryMode,
                    variant.customFields.digitalStockPolicy,
                ),
                availableQuantity: current.availableQuantity,
                fileVersionId: null,
                migrationState: 'ACTIVE',
            }),
        );
        for (const { line, quantity } of current.pending) {
            await this.connection.getRepository(ctx, DigitalOrderReservation).save(
                new DigitalOrderReservation({
                    channelId: ctx.channelId,
                    orderId: line.order.id,
                    orderLineId: line.id,
                    configId: config.id,
                    deliveryMode: config.deliveryMode,
                    stockPolicy: config.stockPolicy,
                    quantity: line.quantity,
                    releasedQuantity: 0,
                    consumedQuantity: line.quantity - quantity,
                    expiresAt: new Date(),
                    fileVersionId: null,
                    poolItemIdsJson: '[]',
                    state: 'HELD',
                }),
            );
        }
        await this.movement(ctx, config, 'MIGRATE', current.availableQuantity);
        if (current.confirmation) {
            if (!this.audit) throw new UserInputError('旧库存归属审计暂不可用，不能迁移');
            await this.audit.appendAudit(ctx, {
                eventType: 'DIGITAL_LEGACY_STOCK_OWNERSHIP_CONFIRMED',
                resourceType: 'DigitalVariantConfig',
                resourceId: String(config.id),
                actorType: 'ADMIN',
                actorUserId: String(ctx.activeUserId),
                actorLabel: String(ctx.activeUserId),
                reason: current.confirmation.reason,
                payload: {
                    productId: String(variant.productId),
                    productVariantId: String(variantId),
                    channelId: String(ctx.channelId),
                    productOperatingChannelIds: [String(ctx.channelId)],
                    variantOperatingChannelIds: [String(ctx.channelId)],
                    confirmedStockLevels: current.confirmation.stockLevels,
                    warehouseRows: current.warehouseRows,
                    deliveryMode: config.deliveryMode,
                    stockPolicy: config.stockPolicy,
                    availableQuantity: current.availableQuantity,
                    reservedQuantity: current.reservedQuantity,
                    warehouseRowsPreserved: true,
                },
                idempotencyKey: `digital-legacy-stock-owner:${variantId}`,
            });
        }
        // Keep warehouse rows untouched as read-only historical evidence.
        const channels = await this.connection
            .getRepository(ctx, Channel)
            .find({ where: { productVariants: { id: variantId } } });
        const salesChannels = channels.filter(channel => channel.code !== '__default_channel__');
        const active = await this.connection
            .getRepository(ctx, DigitalVariantConfig)
            .count({ where: { productVariantId: variantId, migrationState: 'ACTIVE' } });
        if (active >= salesChannels.length)
            await this.connection
                .getRepository(ctx, ProductVariant)
                .update(variantId, { trackInventory: GlobalFlag.FALSE });
        return config;
    }

    private canLock<T extends ObjectLiteral>(repository: Repository<T>): boolean {
        return Boolean(
            repository.manager.queryRunner?.isTransactionActive &&
            !['sqlite', 'better-sqlite3', 'sqljs'].includes(repository.manager.connection.options.type),
        );
    }

    async lock<T extends ObjectLiteral>(
        ctx: RequestContext,
        entity: ObjectType<T>,
        id: ID,
        channelScoped = false,
    ): Promise<T> {
        // Resource expiry and recovery must use the same cart -> order locking as payment.
        if (entity === Order) await this.orders.lockOrderForRefund(ctx, id);
        const repository = this.connection.getRepository(ctx, entity);
        const query = repository.createQueryBuilder('lockedRow').where('lockedRow.id = :id', { id });
        if (channelScoped)
            query.innerJoin('lockedRow.channels', 'migrationChannel', 'migrationChannel.id = :channelId', {
                channelId: ctx.channelId,
            });
        if (this.canLock(repository)) query.setLock('pessimistic_write');
        const record = await query.getOne();
        if (!record) throw new UserInputError('业务记录已变化，请刷新后重试');
        return record;
    }

    private async movement(
        ctx: RequestContext,
        config: DigitalVariantConfig,
        type: DigitalQuotaMovement['type'],
        quantity: number,
    ) {
        await this.connection.getRepository(ctx, DigitalQuotaMovement).save(
            new DigitalQuotaMovement({
                channelId: ctx.channelId,
                productVariantId: config.productVariantId,
                type,
                quantity,
                availableAfter: config.availableQuantity,
                eventKey: `${type}:${randomUUID()}`,
                actorId: ctx.activeUserId ? String(ctx.activeUserId) : null,
            }),
        );
    }
}
