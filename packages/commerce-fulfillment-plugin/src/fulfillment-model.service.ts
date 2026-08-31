import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    Channel,
    ChannelEvent,
    EventBus,
    OrderLine,
    OrderLineEvent,
    Product,
    ProductEvent,
    ProductVariant,
    ProductVariantEvent,
    TransactionalConnection,
} from '@vendure/core';

import { CommerceModeService } from './commerce-mode.service';
import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { DigitalStockPolicy, FulfillmentType, StoreCommerceMode } from './types';

@Injectable()
export class FulfillmentModelService implements OnApplicationBootstrap {
    private readonly channelModeCache = new Map<string, StoreCommerceMode>();

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly commerceModeService: CommerceModeService,
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
            event.orderLine.productVariant.customFields?.digitalDeliveryMode ?? 'manual_service';
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
            const deliveryMode = variant.customFields?.digitalDeliveryMode ?? 'manual_service';
            let stockPolicy: DigitalStockPolicy = variant.customFields?.digitalStockPolicy ?? 'limited';
            let trackInventory = variant.trackInventory;
            if (fulfillmentType === 'physical') {
                stockPolicy = 'limited';
            } else if (deliveryMode === 'auto_card') {
                stockPolicy = 'pool_derived';
                trackInventory = GlobalFlag.FALSE;
            } else if (deliveryMode === 'manual_service') {
                stockPolicy = 'limited';
                trackInventory = GlobalFlag.TRUE;
            } else if (stockPolicy === 'unlimited') {
                trackInventory = GlobalFlag.FALSE;
            } else {
                stockPolicy = 'limited';
                trackInventory = GlobalFlag.TRUE;
            }
            const changed =
                variant.customFields?.fulfillmentType !== fulfillmentType ||
                variant.customFields?.digitalStockPolicy !== stockPolicy ||
                variant.trackInventory !== trackInventory;
            if (!changed) {
                continue;
            }
            variant.customFields = {
                ...variant.customFields,
                fulfillmentType,
                digitalStockPolicy: stockPolicy,
            };
            variant.trackInventory = trackInventory;
            await this.connection.getRepository(ctx, ProductVariant).save(variant, { reload: false });
        }
    }
}
