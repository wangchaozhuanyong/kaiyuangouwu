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
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { CatalogGovernanceService, StorefrontDataChangedEvent } from '@vendure/store-management-plugin';

import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardSupplyGrant, AutoCardSupplySnapshot } from './entities/auto-card-supply-grant.entity';

@Injectable()
export class AutoCardSupplyService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly governance: CatalogGovernanceService,
        private readonly eventBus: EventBus,
    ) {}

    async supplierSummary(ctx: RequestContext, variantId: ID) {
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) throw new UserInputError('请选择供货经营店铺');
        const grants = await this.connection
            .getRepository(ctx, AutoCardSupplyGrant)
            .find({ where: { sourceChannelId: ctx.channelId, productVariantId: variantId } });
        const result = [];
        for (const grant of grants) {
            const rows = await this.connection
                .getRepository(ctx, AutoCardDelivery)
                .createQueryBuilder('delivery')
                .select('delivery.state', 'state')
                .addSelect('SUM(delivery.quantity)', 'quantity')
                .where('delivery.sourceChannelId = :source AND delivery.supplyGrantId = :grant', {
                    source: ctx.channelId,
                    grant: grant.id,
                })
                .groupBy('delivery.state')
                .getRawMany();
            result.push({
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
            });
        }
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
        const configurations = [];
        for (const variant of variants) {
            const config = await this.connection
                .getRepository(ctx, AutoCardConfig)
                .findOne({ where: { productVariantId: variant.id, channelId: owner.ownerChannelId } });
            if (config)
                configurations.push({
                    configId: String(config.id),
                    productVariantId: String(variant.id),
                    name:
                        variant.translations.find(t => t.languageCode === ctx.languageCode)?.name ??
                        variant.translations[0]?.name,
                    enabled: config.enabled,
                });
        }
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

    async resolve(ctx: RequestContext, variantId: ID) {
        const variant = await this.connection
            .getRepository(ctx, ProductVariant)
            .findOne({ where: { id: variantId, channels: { id: ctx.channelId } } });
        if (!variant) return null;
        const owner = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .findOne({ where: { resourceType: 'Product', resourceId: variant.productId } });
        const sale = await this.connection
            .getRepository(ctx, ProductSalesAuthorization)
            .findOne({ where: { productId: variant.productId, channelId: ctx.channelId } });
        if (
            sale &&
            (sale.state !== 'ACTIVE' ||
                !sale.variantIds.includes(String(variantId)) ||
                sale.pendingVariantIds?.includes(String(variantId)))
        )
            return null;
        if (!owner) {
            const product = await this.connection
                .getRepository(ctx, ProductVariant)
                .manager.getRepository(ProductVariant)
                .findOne({ where: { id: variantId }, relations: ['product', 'product.channels'] });
            const operating = product?.product.channels.filter(c => c.code !== DEFAULT_CHANNEL_CODE) ?? [];
            if (operating.length !== 1 || String(operating[0].id) !== String(ctx.channelId)) return null;
            const localConfig = await this.connection
                .getRepository(ctx, AutoCardConfig)
                .findOne({ where: { channelId: ctx.channelId, productVariantId: variantId } });
            return localConfig?.enabled ? { config: localConfig, grant: null } : null;
        }
        if (String(owner.ownerChannelId) === String(ctx.channelId)) {
            const localConfig = await this.connection
                .getRepository(ctx, AutoCardConfig)
                .findOne({ where: { channelId: ctx.channelId, productVariantId: variantId } });
            return localConfig?.enabled ? { config: localConfig, grant: null } : null;
        }
        if (!sale) return null;
        const grant = await this.connection
            .getRepository(ctx, AutoCardSupplyGrant)
            .findOne({ where: { channelId: ctx.channelId, productVariantId: variantId, enabled: true } });
        if (!grant || String(grant.sourceChannelId) !== String(owner.ownerChannelId)) return null;
        const config = await this.connection.getRepository(ctx, AutoCardConfig).findOne({
            where: { id: grant.configId, channelId: grant.sourceChannelId, productVariantId: variantId },
        });
        return config?.enabled ? { config, grant } : null;
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
            if (
                snapshot.quantity !== line.quantity ||
                String(order.salesChannelId) !== String(snapshot.channelId)
            )
                throw new UserInputError('供货快照与付款订单不一致');
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
