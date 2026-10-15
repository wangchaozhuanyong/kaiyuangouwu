import { Injectable, OnModuleInit } from '@nestjs/common';
import { CatalogSyncDeliveryAdapter, CatalogSyncService } from '@vendure/catalog-management-plugin';
import {
    CatalogSyncBinding,
    CatalogSyncRule,
    Channel,
    Product,
    RequestContext,
    ShippingMethodService,
    StockLevel,
    StockLocation,
    TransactionalConnection,
} from '@vendure/core';
import { createHash } from 'node:crypto';
import { In, Not } from 'typeorm';

import { AutoCardSupplyService } from './auto-card-supply.service';
import { quoteShippingAmounts, shippingMoneyArguments } from './catalog-sync-shipping-money';
import { CatalogSyncShippingService } from './catalog-sync-shipping.service';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardSupplyGrant } from './entities/auto-card-supply-grant.entity';
import {
    DigitalFileVersion,
    DigitalOrderReservation,
    DigitalVariantConfig,
} from './entities/digital-product.entity';

/** Bridge: catalog owns rules; commerce owns delivery prerequisites and private resources. */
@Injectable()
export class CatalogSyncSupplyService implements OnModuleInit, CatalogSyncDeliveryAdapter {
    constructor(
        private readonly sync: CatalogSyncService,
        private readonly connection: TransactionalConnection,
        private readonly cards: AutoCardSupplyService,
        private readonly shipping: ShippingMethodService,
        private readonly syncShipping: CatalogSyncShippingService,
    ) {}
    onModuleInit() {
        this.sync.registerDeliveryAdapter(this);
    }

    async inspect(ctx: RequestContext, source: Channel, target: Channel, product: Product) {
        const blockers: string[] = [];
        const pending: string[] = [];
        const variants = product.variants.filter(v => !v.deletedAt);
        const mode = target.customFields.commerceMode;
        const type = product.customFields.fulfillmentType;
        if (
            (type === 'physical' && !['PHYSICAL_ONLY', 'HYBRID'].includes(mode ?? '')) ||
            (type === 'digital' && !['DIGITAL_ONLY', 'HYBRID'].includes(mode ?? ''))
        )
            blockers.push('目标店铺经营模式不支持此商品类型');
        const managed = await this.connection.getRepository(ctx, CatalogSyncBinding).count({
            where: {
                kind: 'PRODUCT',
                targetId: product.id,
                targetChannelId: target.id,
                state: Not('REMOVED'),
            },
        });
        const configs = variants.length
            ? await this.connection.getRepository(ctx, DigitalVariantConfig).find({
                  where: {
                      productVariantId: In(variants.map(v => v.id)),
                      channelId: In([source.id, target.id]),
                  },
                  order: { id: 'ASC' },
              })
            : [];
        const cardConfigs = variants.length
            ? await this.connection.getRepository(ctx, AutoCardConfig).find({
                  where: {
                      productVariantId: In(variants.map(v => v.id)),
                      channelId: In([source.id, target.id]),
                  },
                  order: { id: 'ASC' },
              })
            : [];
        if (!managed) {
            const local = variants.length
                ? await this.connection.getRepository(ctx, StockLevel).find({
                      where: {
                          productVariantId: In(variants.map(v => v.id)),
                          stockLocation: { channels: { id: target.id } },
                      },
                  })
                : [];
            if (local.some(s => s.stockOnHand !== 0 || s.stockAllocated !== 0))
                blockers.push('目标已有独立库存或未结占用，不能接管');
            if (
                configs.some(
                    c =>
                        String(c.channelId) === String(target.id) &&
                        (c.availableQuantity !== 0 || c.fileVersionId != null),
                ) ||
                cardConfigs.some(c => String(c.channelId) === String(target.id))
            )
                blockers.push('目标已有独立数字交付资源，不能自动接管');
            if (
                variants.length &&
                (await this.connection.getRepository(ctx, DigitalOrderReservation).exists({
                    where: {
                        channelId: target.id,
                        state: 'HELD',
                        configId: In(
                            configs.filter(c => String(c.channelId) === String(target.id)).map(c => c.id),
                        ),
                    },
                }))
            )
                blockers.push('目标有未完成数字交付占用');
        }
        for (const variant of variants) {
            if (type !== 'digital') continue;
            const config = configs.find(
                c =>
                    String(c.channelId) === String(source.id) &&
                    String(c.productVariantId) === String(variant.id),
            );
            const delivery = config?.deliveryMode ?? variant.customFields.digitalDeliveryMode;
            if (
                delivery === 'auto_card' &&
                !cardConfigs.some(
                    c =>
                        String(c.channelId) === String(source.id) &&
                        String(c.productVariantId) === String(variant.id) &&
                        c.enabled,
                )
            )
                pending.push(`规格 ${variant.id} 的来源卡池未启用`);
            if (
                delivery === 'file_download' &&
                (!config?.fileVersionId ||
                    !(await this.connection.getRepository(ctx, DigitalFileVersion).exists({
                        where: { id: config.fileVersionId, channelId: source.id },
                    })))
            )
                pending.push(`规格 ${variant.id} 需要来源店铺的版本化交付文件`);
        }
        const methods =
            type === 'physical'
                ? await this.shipping.getShippingTemplateManagement(
                      ctx.copy({ channel: source, currencyCode: source.defaultCurrencyCode }),
                  )
                : null;
        const enabledMethods = methods?.items.filter(m => m.enabled) ?? [];
        if (type === 'physical' && !enabledMethods.length) pending.push('来源配送方式待配置');
        if (
            type === 'physical' &&
            enabledMethods.length &&
            !enabledMethods.some(
                ({ method }) =>
                    method.calculator.code === 'physical-subtotal-shipping-calculator' &&
                    quoteShippingAmounts(
                        ctx.copy({ channel: target, currencyCode: target.defaultCurrencyCode }),
                        shippingMoneyArguments(method.calculator.args),
                        target.defaultCurrencyCode,
                        ctx.copy({ channel: source, currencyCode: source.defaultCurrencyCode }),
                    ),
            )
        )
            pending.push('来源配送金额的币种或固定汇率待配置');
        if (
            type === 'physical' &&
            !(await this.connection
                .getRepository(ctx, StockLocation)
                .exists({ where: { channels: { id: source.id } } }))
        )
            pending.push('来源仓库待配置');
        if (
            enabledMethods.some(
                m =>
                    m.method.calculator.code !== 'physical-subtotal-shipping-calculator' ||
                    ![
                        'store-shipping-zone-eligibility-checker',
                        'supported-destination-eligibility-checker',
                    ].includes(m.method.checker.code),
            )
        )
            blockers.push('来源包含尚不支持继承的自定义配送计算器');
        const targetMethods =
            type === 'physical'
                ? await this.shipping.getActiveShippingMethods(
                      ctx.copy({ channel: target, currencyCode: target.defaultCurrencyCode }),
                  )
                : [];
        if (
            targetMethods.some(
                m =>
                    m.calculator.code !== 'physical-subtotal-shipping-calculator' ||
                    ![
                        'store-shipping-zone-eligibility-checker',
                        'supported-destination-eligibility-checker',
                    ].includes(m.checker.code),
            )
        )
            blockers.push('目标店铺存在不能按货源分组的配送计算器，请先配置兼容的配送方式');
        return {
            blockers: [...new Set(blockers)],
            pending: [...new Set(pending)],
            fingerprint: createHash('sha256')
                .update(
                    JSON.stringify({
                        configs: configs.map(c => [
                            c.id,
                            c.updatedAt,
                            c.deliveryMode,
                            c.stockPolicy,
                            c.fileVersionId,
                        ]),
                        cards: cardConfigs.map(c => [c.id, c.updatedAt, c.enabled]),
                        methods: enabledMethods.map(m => [m.method.id, m.method.updatedAt]),
                        mode,
                    }),
                )
                .digest('hex'),
        };
    }

    async prepare(ctx: RequestContext, rule: CatalogSyncRule, product: Product) {
        if (product.customFields.fulfillmentType === 'physical') {
            await this.syncShipping.syncMethods(ctx, rule);
            return;
        }
        for (const variant of product.variants.filter(v => !v.deletedAt)) {
            const config = await this.connection.getRepository(ctx, AutoCardConfig).findOne({
                where: {
                    channelId: rule.sourceChannelId,
                    productVariantId: variant.id,
                    enabled: true,
                },
            });
            if (!config) continue;
            const grant = await this.connection
                .getRepository(ctx, AutoCardSupplyGrant)
                .findOne({ where: { channelId: rule.targetChannelId, productVariantId: variant.id } });
            if (!grant?.enabled || String(grant.configId) !== String(config.id))
                await this.cards.setGrant(ctx, {
                    channelId: rule.targetChannelId,
                    productVariantId: variant.id,
                    configId: config.id,
                    enabled: true,
                    version: grant?.version ?? 0,
                });
        }
    }
}
