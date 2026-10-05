import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    Channel,
    ChannelEvent,
    EventBus,
    ID,
    OrderLine,
    OrderLineEvent,
    Product,
    ProductEvent,
    ProductVariant,
    ProductVariantEvent,
    RequestContext,
    StockLevel,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { CommerceModeService } from './commerce-mode.service';
import { physicalVariantFields } from './digital-product.policy';
import { DigitalProductService } from './digital-product.service';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { DigitalVariantConfig } from './entities/digital-product.entity';
import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { DigitalStockPolicy, FulfillmentType, StoreCommerceMode } from './types';

@Injectable()
export class FulfillmentModelService implements OnApplicationBootstrap {
    private readonly channelModeCache = new Map<string, StoreCommerceMode>();

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly commerceModeService: CommerceModeService,
        private readonly digitalProducts: DigitalProductService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const channels = await this.connection.rawConnection.getRepository(Channel).find();
        for (const channel of channels) {
            this.channelModeCache.set(String(channel.id), this.commerceModeService.modeForChannel(channel));
        }
        this.eventBus.registerBlockingEventHandler({
            event: ProductEvent,
            id: 'commerce-fulfillment-validate-product-policy',
            handler: event => this.validateAndSyncProduct(event),
        });
        this.eventBus.registerBlockingEventHandler({
            event: ChannelEvent,
            id: 'commerce-fulfillment-validate-channel-mode',
            handler: event => this.validateChannelModeChange(event),
        });
        this.eventBus.registerBlockingEventHandler({
            event: ProductVariantEvent,
            id: 'commerce-fulfillment-sync-variant-policy',
            handler: event => this.syncVariantPolicy(event),
        });
        this.eventBus.registerBlockingEventHandler({
            event: OrderLineEvent,
            id: 'commerce-fulfillment-snapshot-order-line-type',
            handler: event => this.snapshotOrderLineType(event),
        });
    }

    private async validateChannelModeChange(event: ChannelEvent): Promise<void> {
        const channelId = String(event.entity.id);
        if (event.type === 'deleted') {
            this.channelModeCache.delete(channelId);
            return;
        }
        const targetMode = this.commerceModeService.modeForChannel(event.entity);
        if (event.type === 'created') {
            this.channelModeCache.set(channelId, targetMode);
            return;
        }
        if (event.type !== 'updated') {
            return;
        }
        const previousMode = this.channelModeCache.get(channelId);
        if (previousMode === targetMode || !this.includesCommerceMode(event.input)) {
            this.channelModeCache.set(channelId, targetMode);
            return;
        }
        const conflicts = await this.commerceModeService.conflicts(event.ctx, event.entity.id, targetMode);
        if (conflicts.length) {
            const details = conflicts
                .slice(0, 10)
                .map(item => item.message)
                .join('；');
            throw new Error(`经营模式切换被阻止，共发现 ${conflicts.length} 个冲突：${details}`);
        }
        this.channelModeCache.set(channelId, targetMode);
    }

    private includesCommerceMode(input: ChannelEvent['input']): boolean {
        if (!input || typeof input !== 'object' || !('customFields' in input)) {
            return false;
        }
        const customFields = input.customFields;
        return Boolean(
            customFields &&
            typeof customFields === 'object' &&
            Object.prototype.hasOwnProperty.call(customFields, 'commerceMode'),
        );
    }

    async canChangeProductType(ctx: RequestContext, productId: ID) {
        const product = await this.connection.getEntityOrThrow(ctx, Product, productId, {
            channelId: ctx.channelId,
            relations: ['variants'],
        });
        const ids = product.variants.map(variant => variant.id);
        if (!ids.length) return true;
        const [orders, stocks, pool, resources, packaging] = await Promise.all([
            this.connection.getRepository(ctx, OrderLine).count({ where: { productVariantId: In(ids) } }),
            this.connection.getRepository(ctx, StockLevel).find({ where: { productVariantId: In(ids) } }),
            this.connection
                .getRepository(ctx, AutoCardPoolItem)
                .count({ where: { config: { productVariantId: In(ids) } } }),
            this.connection
                .getRepository(ctx, DigitalVariantConfig)
                .find({ where: { productVariantId: In(ids) } }),
            this.connection.getRepository(ctx, ProductPackagingRule).count({ where: { productId } }),
        ]);
        const lotMetadata = this.connection.rawConnection.entityMetadatas.find(
            item => item.name === 'InventoryLot',
        );
        const lots = lotMetadata
            ? await this.connection
                  .getRepository(ctx, lotMetadata.target)
                  .count({ where: { variantId: In(ids) } })
            : 0;
        return !(
            orders ||
            pool ||
            packaging ||
            lots ||
            stocks.some(row => row.stockOnHand || row.stockAllocated) ||
            resources.some(row => row.fileVersionId || row.availableQuantity)
        );
    }

    private async validateAndSyncProduct(event: ProductEvent): Promise<void> {
        if (event.type === 'deleted') {
            return;
        }
        const product = await this.connection.getRepository(event.ctx, Product).findOne({
            where: { id: event.entity.id },
            relations: { channels: true, variants: true },
        });
        if (!product) {
            return;
        }
        let fulfillmentType = this.productFulfillmentType(product);
        if (
            event.type === 'updated' &&
            product.variants.some(
                variant =>
                    variant.customFields.fulfillmentType &&
                    variant.customFields.fulfillmentType !== fulfillmentType,
            )
        ) {
            if (!(await this.canChangeProductType(event.ctx, product.id))) {
                throw new UserInputError(
                    '商品已有订单、库存或交付资源，不能转换类型；请复制基础资料创建另一类商品',
                );
            }
        }
        if (event.type === 'created') {
            const fixedTypes = new Set(
                product.channels.flatMap(channel => {
                    const mode = this.commerceModeService.modeForChannel(channel);
                    return mode === 'DIGITAL_ONLY'
                        ? ['digital' as const]
                        : mode === 'PHYSICAL_ONLY'
                          ? ['physical' as const]
                          : [];
                }),
            );
            if (fixedTypes.size > 1) {
                throw new Error('商品同时分配到了经营模式冲突的店铺，不能创建');
            }
            const [fixedType] = fixedTypes;
            if (fixedType && fixedType !== fulfillmentType) {
                fulfillmentType = fixedType;
                product.customFields = { ...product.customFields, fulfillmentType: fixedType };
                await this.connection.getRepository(event.ctx, Product).save(product, { reload: false });
            }
        }
        for (const channel of product.channels) {
            this.commerceModeService.assertProductTypeAllowed(
                this.commerceModeService.modeForChannel(channel),
                fulfillmentType,
            );
        }
        if (fulfillmentType === 'digital') {
            const enabledPackaging = await this.connection
                .getRepository(event.ctx, ProductPackagingRule)
                .findOne({
                    where: { productId: product.id, enabled: true },
                });
            if (enabledPackaging) {
                throw new Error('虚拟商品不能启用整箱、散件或自动拆箱配置，请先停用包装配置');
            }
        }
        await this.applyProductPolicy(event.ctx, product, product.variants);
    }

    private async syncVariantPolicy(event: ProductVariantEvent): Promise<void> {
        if (event.type === 'deleted') {
            return;
        }
        const byProduct = new Map<string, ProductVariant[]>();
        for (const variant of event.entity) {
            const productId = String(variant.productId);
            byProduct.set(productId, [...(byProduct.get(productId) ?? []), variant]);
        }
        for (const [productId, variants] of byProduct) {
            const product = await this.connection.getRepository(event.ctx, Product).findOne({
                where: { id: productId },
                relations: { channels: true },
            });
            if (!product) {
                continue;
            }
            const fulfillmentType = this.productFulfillmentType(product);
            const inputs = Array.isArray(event.input)
                ? event.input.filter(input => typeof input === 'object')
                : [];
            if (fulfillmentType === 'digital') {
                for (const input of inputs) {
                    const fields = (input as { customFields?: Record<string, unknown> }).customFields;
                    const incompatible = physicalVariantFields.find(
                        field => fields?.[field] !== undefined && fields[field] !== null,
                    );
                    if (incompatible) throw new UserInputError(`数字商品不支持实物字段 ${incompatible}`);
                    if (
                        (input as { stockOnHand?: unknown }).stockOnHand !== undefined ||
                        (input as { stockLevels?: unknown }).stockLevels !== undefined
                    )
                        throw new UserInputError('数字商品不支持仓库库存，请使用数字份数配置');
                    const id = (input as { id?: string }).id;
                    if (id && (fields?.digitalDeliveryMode || fields?.digitalStockPolicy)) {
                        throw new UserInputError('请使用当前店铺的数字商品配置接口更新交付方式和份数策略');
                    }
                }
                if (event.type === 'created') {
                    for (const variant of variants) {
                        variant.customFields = {
                            ...variant.customFields,
                            ...Object.fromEntries(physicalVariantFields.map(field => [field, null])),
                        };
                        await this.connection
                            .getRepository(event.ctx, ProductVariant)
                            .save(variant, { reload: false });
                        for (const channel of product.channels.filter(
                            salesChannel => salesChannel.code !== '__default_channel__',
                        )) {
                            await this.digitalProducts.initialize(event.ctx.copy({ channel }), variant);
                        }
                    }
                }
            }
            if (fulfillmentType === 'physical') {
                for (const input of inputs) {
                    const fields = (input as { customFields?: Record<string, unknown> }).customFields;
                    if (fields?.digitalDeliveryMode != null || fields?.digitalStockPolicy != null)
                        throw new UserInputError('实物商品不支持数字交付或份数配置');
                }
            }
            for (const channel of product.channels) {
                this.commerceModeService.assertProductTypeAllowed(
                    this.commerceModeService.modeForChannel(channel),
                    fulfillmentType,
                );
            }
            await this.applyProductPolicy(event.ctx, product, variants);
        }
    }

    private async snapshotOrderLineType(event: OrderLineEvent): Promise<void> {
        if (event.type !== 'created') {
            return;
        }
        const product = await this.connection.getRepository(event.ctx, Product).findOne({
            where: { id: event.orderLine.productVariant.productId },
        });
        const fulfillmentType = product ? this.productFulfillmentType(product) : 'digital';
        const digitalDeliveryMode =
            (await this.digitalProducts.config(event.ctx, event.orderLine.productVariantId))?.deliveryMode ??
            event.orderLine.productVariant.customFields?.digitalDeliveryMode ??
            'manual_service';
        event.orderLine.customFields = {
            ...event.orderLine.customFields,
            fulfillmentTypeSnapshot: fulfillmentType,
            digitalDeliveryModeSnapshot: digitalDeliveryMode,
            refundPolicySnapshot: product?.customFields?.refundPolicy ?? 'MERCHANT_REVIEW',
            manualDeliverySlaMinutesSnapshot: product?.customFields?.manualDeliverySlaMinutes ?? 1440,
        };
        await this.connection.getRepository(event.ctx, OrderLine).save(event.orderLine, { reload: false });
    }

    private productFulfillmentType(product: Product): FulfillmentType {
        return product.customFields?.fulfillmentType === 'physical' ? 'physical' : 'digital';
    }

    private async applyProductPolicy(
        ctx: ProductEvent['ctx'],
        product: Product,
        variants: ProductVariant[],
    ): Promise<void> {
        const fulfillmentType = this.productFulfillmentType(product);
        for (const variant of variants) {
            let digitalConfig =
                fulfillmentType === 'digital' ? await this.digitalProducts.config(ctx, variant.id) : null;
            const converting =
                variant.customFields?.fulfillmentType &&
                variant.customFields.fulfillmentType !== fulfillmentType;
            if (fulfillmentType === 'digital' && converting) {
                variant.customFields = {
                    ...variant.customFields,
                    ...Object.fromEntries(physicalVariantFields.map(field => [field, null])),
                    digitalDeliveryMode: 'manual_service',
                    digitalStockPolicy: 'unlimited',
                };
                for (const channel of product.channels.filter(
                    salesChannel => salesChannel.code !== '__default_channel__',
                )) {
                    await this.digitalProducts.initialize(ctx.copy({ channel }), variant);
                }
                digitalConfig = await this.digitalProducts.config(ctx, variant.id);
            }
            if (fulfillmentType === 'physical' && converting) {
                await this.connection
                    .getRepository(ctx, DigitalVariantConfig)
                    .update({ productVariantId: variant.id }, { migrationState: 'PREPARED' });
            }
            const deliveryMode = variant.customFields?.digitalDeliveryMode ?? 'manual_service';
            let stockPolicy: DigitalStockPolicy = variant.customFields?.digitalStockPolicy ?? 'limited';
            let trackInventory = variant.trackInventory;
            if (fulfillmentType === 'physical') {
                stockPolicy = 'limited';
                if (converting) trackInventory = GlobalFlag.INHERIT;
            } else if (deliveryMode === 'auto_card') {
                stockPolicy = 'pool_derived';
                trackInventory = GlobalFlag.FALSE;
            } else if (digitalConfig) {
                if (await this.digitalProducts.allStoresMigrated(ctx, variant.id))
                    trackInventory = GlobalFlag.FALSE;
            } else if (stockPolicy === 'unlimited') {
                trackInventory = GlobalFlag.FALSE;
            } else {
                stockPolicy = 'limited';
                trackInventory = GlobalFlag.TRUE;
            }
            const changed =
                variant.customFields?.fulfillmentType !== fulfillmentType ||
                variant.customFields?.digitalStockPolicy !== stockPolicy ||
                variant.trackInventory !== trackInventory ||
                Boolean(converting) ||
                (fulfillmentType === 'physical' && variant.customFields.packageQuantity == null);
            if (!changed) {
                continue;
            }
            variant.customFields = {
                ...variant.customFields,
                fulfillmentType,
                ...(fulfillmentType === 'physical' && variant.customFields.packageQuantity == null
                    ? { packageQuantity: 1 }
                    : {}),
                digitalStockPolicy: stockPolicy,
            };
            variant.trackInventory = trackInventory;
            await this.connection.getRepository(ctx, ProductVariant).save(variant, { reload: false });
        }
    }
}
