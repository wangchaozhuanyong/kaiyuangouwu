import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import {
    CatalogResourceOwnership,
    EventBus,
    Order,
    OrderLine,
    ProductSalesAuthorization,
    ProductVariant,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { CatalogGovernanceService, StorefrontDataChangedEvent } from '@vendure/store-management-plugin';
import { In } from 'typeorm';

import { digitalDeliverableQuantity } from './digital-order-entitlement';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardSupplyGrant, AutoCardSupplySnapshot } from './entities/auto-card-supply-grant.entity';

@Injectable()
export class AutoCardSupplyService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly governance: CatalogGovernanceService,
        private readonly eventBus: EventBus,
        private readonly requestCache: RequestContextCacheService = new RequestContextCacheService(),
    ) {}

    async supplierSummary(ctx: RequestContext, variantId: ID) {
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) throw new UserInputError('请选择供货经营店铺');
        const grants = await this.connection
            .getRepository(ctx, AutoCardSupplyGrant)
            .find({ where: { sourceChannelId: ctx.channelId, productVariantId: variantId } });
        const totals = grants.length
            ? await this.connection
                  .getRepository(ctx, AutoCardDelivery)
                  .createQueryBuilder('delivery')
                  .select('delivery.supplyGrantId', 'grantId')
                  .addSelect('delivery.state', 'state')
                  .addSelect('SUM(delivery.quantity)', 'quantity')
                  .where('delivery.sourceChannelId = :source AND delivery.supplyGrantId IN (:...grantIds)', {
                      source: ctx.channelId,
                      grantIds: grants.map(grant => grant.id),
                  })
                  .groupBy('delivery.supplyGrantId')
                  .addGroupBy('delivery.state')
                  .getRawMany<{ grantId: ID; state: string; quantity: string | number }>()
            : [];
        const result = grants.map(grant => {
            const rows = totals.filter(row => String(row.grantId) === String(grant.id));
            return {
                grantId: String(grant.id),
                channelId: String(grant.channelId),
                enabled: grant.enabled,
                deliveredQuantity: rows
                    .filter(r => r.state === 'SENT')
                    .reduce((n, r) => n + Number(r.quantity), 0),
                waitingQuantity: rows
                    .filter(r => r.state === 'WAITING_STOCK')
                    .reduce((n, r) => n + Number(r.quantity), 0),
                allocatedQuantity: rows
                    .filter(r => ['ALLOCATED', 'RETRYING', 'MANUAL_REVIEW'].includes(r.state))
                    .reduce((n, r) => n + Number(r.quantity), 0),
            };
        });
        // Source-store receipts contain quantities only: no buyer, order code, selling price or credentials.
        return result;
    }

    async catalog(ctx: RequestContext, productId: ID) {
        this.governance.assertPlatform(ctx);
        const owner = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .findOne({ where: { resourceType: 'Product', resourceId: productId } });
        if (!owner) throw new UserInputError('商品归属待核对');
        const variants = await this.connection
            .getRepository(ctx, ProductVariant)
            .find({ where: { productId }, relations: ['translations'] });
        const ids = variants.map(v => v.id);
        const configs = ids.length
            ? await this.connection.getRepository(ctx, AutoCardConfig).find({
                  where: { productVariantId: In(ids), channelId: owner.ownerChannelId },
              })
            : [];
        const configByVariant = new Map(configs.map(config => [String(config.productVariantId), config]));
        const configurations = variants.flatMap(variant => {
            const config = configByVariant.get(String(variant.id));
            return config
                ? [
                      {
                          configId: String(config.id),
                          productVariantId: String(variant.id),
                          name:
                              variant.translations.find(t => t.languageCode === ctx.languageCode)?.name ??
                              variant.translations[0]?.name,
                          enabled: config.enabled,
                      },
                  ]
                : [];
        });
        const grants = ids.length
            ? await this.connection
                  .getRepository(ctx, AutoCardSupplyGrant)
                  .createQueryBuilder('grant')
                  .where('grant.productVariantId IN (:...ids)', { ids })
                  .getMany()
            : [];
        return {
            configurations,
            grants: grants.map(g => ({
                channelId: String(g.channelId),
                productVariantId: String(g.productVariantId),
                enabled: g.enabled,
                version: g.version,
            })),
        };
    }

    async setGrant(
        ctx: RequestContext,
        input: { channelId: ID; productVariantId: ID; configId: ID; enabled: boolean; version: number },
    ) {
        this.governance.assertPlatform(ctx);
        const lock = this.connection.getRepository(ctx, ProductVariant).createQueryBuilder('variant');
        if (!['sqljs', 'sqlite', 'better-sqlite3'].includes(this.connection.rawConnection.options.type))
            lock.setLock('pessimistic_write');
        await lock.where('variant.id = :id', { id: input.productVariantId }).getOneOrFail();
        const config = await this.connection
            .getRepository(ctx, AutoCardConfig)
            .findOne({ where: { id: input.configId } });
        const variant = await this.connection
            .getRepository(ctx, ProductVariant)
            .findOne({ where: { id: input.productVariantId, channels: { id: input.channelId } } });
        const owner =
            variant &&
            (await this.connection
                .getRepository(ctx, CatalogResourceOwnership)
                .findOne({ where: { resourceType: 'Product', resourceId: variant.productId } }));
        const sale =
            variant &&
            (await this.connection
                .getRepository(ctx, ProductSalesAuthorization)
                .findOne({ where: { productId: variant.productId, channelId: input.channelId } }));
        if (
            !config ||
            !variant ||
            !owner ||
            !sale ||
            sale.state === 'REVOKED' ||
            !sale.variantIds.includes(String(variant.id)) ||
            String(config.productVariantId) !== String(variant.id) ||
            String(config.channelId) !== String(owner.ownerChannelId) ||
            String(config.channelId) === String(input.channelId)
        ) {
            throw new UserInputError('供货须直接绑定商品维护店的原始卡池，并先授予目标规格销售权限');
        }
        const repository = this.connection.getRepository(ctx, AutoCardSupplyGrant);
        const existing = await repository.findOne({
            where: { channelId: input.channelId, productVariantId: input.productVariantId },
        });
        if ((existing?.version ?? 0) !== input.version) throw new UserInputError('供货授权已变化，请刷新');
        const saved = await repository.save(
            new AutoCardSupplyGrant({
                ...existing,
                channelId: input.channelId,
                productVariantId: input.productVariantId,
                configId: config.id,
                sourceChannelId: config.channelId,
                enabled: input.enabled,
                version: input.version + 1,
            }),
        );
        await this.eventBus.publish(
            new StorefrontDataChangedEvent(ctx, ['catalog'], {
                channelIds: [saved.channelId],
                entityType: 'ProductVariant',
                entityIds: [saved.productVariantId],
            }),
        );
        return {
            id: String(saved.id),
            channelId: String(saved.channelId),
            productVariantId: String(saved.productVariantId),
            sourceChannelId: String(saved.sourceChannelId),
            enabled: saved.enabled,
            version: saved.version,
        };
    }

    /** Display-only batch; checkout and delivery always resolve fresh data. */
    resolveForDisplay(ctx: RequestContext, variantId: ID) {
        return this.requestCache.load(ctx, `auto-card-supply:${ctx.channelId}`, variantId, ids =>
            this.resolveSources(ctx, ids),
        );
    }

    async resolve(ctx: RequestContext, variantId: ID) {
        const [source] = await this.resolveSources(ctx, [String(variantId)]);
        return source;
    }

    private async resolveSources(ctx: RequestContext, ids: readonly string[]) {
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In([...ids]), channels: { id: ctx.channelId } },
            loadEagerRelations: false,
        });
        if (!variants.length) return ids.map(() => null);
        const productIds = [...new Set(variants.map(variant => variant.productId))];
        const [owners, sales] = await Promise.all([
            this.connection.getRepository(ctx, CatalogResourceOwnership).find({
                where: { resourceType: 'Product', resourceId: In(productIds) },
            }),
            this.connection.getRepository(ctx, ProductSalesAuthorization).find({
                where: { productId: In(productIds), channelId: ctx.channelId },
            }),
        ]);
        const ownerByProduct = new Map(owners.map(owner => [String(owner.resourceId), owner]));
        const saleByProduct = new Map(sales.map(sale => [String(sale.productId), sale]));
        const eligible = variants.filter(variant => {
            const sale = saleByProduct.get(String(variant.productId));
            return (
                !sale ||
                (sale.state === 'ACTIVE' &&
                    sale.variantIds.includes(String(variant.id)) &&
                    !sale.pendingVariantIds?.includes(String(variant.id)))
            );
        });
        const legacyIds = eligible
            .filter(variant => !ownerByProduct.has(String(variant.productId)))
            .map(variant => variant.id);
        const legacy = legacyIds.length
            ? // The parent IDs were authorized above. Keep the legacy cardinality
              // check on the transaction manager so scoped relation filters cannot
              // make a product shared by two operating stores appear single-store.
              await this.connection
                  .getRepository(ctx, ProductVariant)
                  .manager.getRepository(ProductVariant)
                  .find({
                      where: { id: In(legacyIds) },
                      relations: ['product', 'product.channels'],
                      loadEagerRelations: false,
                  })
            : [];
        const legacyLocal = new Set(
            legacy
                .filter(variant => {
                    const operating = variant.product.channels.filter(
                        channel => channel.code !== DEFAULT_CHANNEL_CODE,
                    );
                    return operating.length === 1 && String(operating[0].id) === String(ctx.channelId);
                })
                .map(variant => String(variant.id)),
        );
        const localIds = eligible
            .filter(variant => {
                const owner = ownerByProduct.get(String(variant.productId));
                return owner
                    ? String(owner.ownerChannelId) === String(ctx.channelId)
                    : legacyLocal.has(String(variant.id));
            })
            .map(variant => variant.id);
        const foreign = eligible.filter(variant => {
            const owner = ownerByProduct.get(String(variant.productId));
            return (
                owner &&
                String(owner.ownerChannelId) !== String(ctx.channelId) &&
                saleByProduct.has(String(variant.productId))
            );
        });
        const grants = foreign.length
            ? await this.connection.getRepository(ctx, AutoCardSupplyGrant).find({
                  where: {
                      channelId: ctx.channelId,
                      productVariantId: In(foreign.map(variant => variant.id)),
                      enabled: true,
                  },
              })
            : [];
        const where = [
            ...(localIds.length
                ? [{ channelId: ctx.channelId, productVariantId: In(localIds), enabled: true }]
                : []),
            ...(grants.length ? [{ id: In(grants.map(grant => grant.configId)), enabled: true }] : []),
        ];
        const configs = where.length
            ? await this.connection.getRepository(ctx, AutoCardConfig).find({ where })
            : [];
        const local = new Set(localIds.map(String));
        const variantById = new Map(eligible.map(variant => [String(variant.id), variant]));
        const grantByVariant = new Map(grants.map(grant => [String(grant.productVariantId), grant]));
        return ids.map(id => {
            const variant = variantById.get(id);
            if (!variant) return null;
            if (local.has(id)) {
                const localConfig = configs.find(
                    item =>
                        String(item.productVariantId) === id &&
                        String(item.channelId) === String(ctx.channelId),
                );
                return localConfig ? { config: localConfig, grant: null } : null;
            }
            const owner = ownerByProduct.get(String(variant.productId));
            const grant = grantByVariant.get(id);
            if (!owner || !grant || String(grant.sourceChannelId) !== String(owner.ownerChannelId))
                return null;
            const config = configs.find(
                item =>
                    String(item.id) === String(grant.configId) &&
                    String(item.channelId) === String(grant.sourceChannelId) &&
                    String(item.productVariantId) === id,
            );
            return config ? { config, grant } : null;
        });
    }

    async snapshotForPayment(ctx: RequestContext, order: Order, line: OrderLine) {
        const source = await this.resolve(ctx, line.productVariantId);
        if (!source || String(order.salesChannelId) !== String(ctx.channelId)) return null;
        const repository = this.connection.getRepository(ctx, AutoCardSupplySnapshot);
        const previous = await repository.findOne({ where: { orderLineId: line.id } });
        const snapshot = await repository.save(
            new AutoCardSupplySnapshot({
                ...previous,
                orderLineId: line.id,
                orderId: order.id,
                channelId: ctx.channelId,
                sourceChannelId: source.config.channelId,
                configId: source.config.id,
                grantId: source.grant?.id ?? null,
                grantVersion: source.grant?.version ?? null,
                quantity: line.quantity,
                configSnapshot: {
                    delimiter: source.config.delimiter,
                    fieldsJson: source.config.fieldsJson,
                    instructions: source.config.instructions,
                    instructionsZh: source.config.instructionsZh,
                    instructionsEn: source.config.instructionsEn,
                },
            }),
        );
        return { ...source, snapshot };
    }

    async forPaidLine(ctx: RequestContext, order: Order, line: OrderLine) {
        const snapshot = await this.connection
            .getRepository(ctx, AutoCardSupplySnapshot)
            .findOne({ where: { orderLineId: line.id, orderId: order.id, channelId: ctx.channelId } });
        if (snapshot) {
            if (String(order.salesChannelId) !== String(snapshot.channelId))
                throw new UserInputError('供货快照与付款订单不一致');
            if (snapshot.quantity < line.quantity) {
                // An explicitly paid increase can extend the original supply, but cannot
                // silently switch supplier/grant or allocate quantities awaiting payment.
                const current = await this.resolve(ctx, line.productVariantId);
                if (
                    digitalDeliverableQuantity(order, line) < line.quantity ||
                    !current ||
                    String(current.config.id) !== String(snapshot.configId) ||
                    String(current.config.channelId) !== String(snapshot.sourceChannelId) ||
                    String(current.grant?.id ?? '') !== String(snapshot.grantId ?? '') ||
                    (current.grant?.version ?? null) !== snapshot.grantVersion
                )
                    throw new UserInputError('新增卡密份数的付款或原始供货授权待核验');
                snapshot.quantity = line.quantity;
                await this.connection.getRepository(ctx, AutoCardSupplySnapshot).save(snapshot);
            }
            const originalConfig = await this.connection.getRepository(ctx, AutoCardConfig).findOne({
                where: {
                    id: snapshot.configId,
                    channelId: snapshot.sourceChannelId,
                    productVariantId: line.productVariantId,
                },
            });
            if (!originalConfig) throw new UserInputError('原始供货配置不存在，请人工核查');
            return { config: Object.assign(originalConfig, snapshot.configSnapshot), snapshot };
        }
        // Preserve historical same-store orders. Cross-store orders always require a payment snapshot.
        const config = await this.connection
            .getRepository(ctx, AutoCardConfig)
            .findOne({ where: { channelId: ctx.channelId, productVariantId: line.productVariantId } });
        return config ? { config, snapshot: null } : null;
    }
}
