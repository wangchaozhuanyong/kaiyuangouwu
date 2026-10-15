import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    CatalogResourceOwnership,
    CatalogSupplySnapshot,
    CatalogSyncBinding,
    CatalogSyncRule,
    Channel,
    Collection,
    Order,
    Permission,
    ProductSalesAuthorization,
    ProductVariant,
    ProductVariantPrice,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { StoreProfile } from './entities/store-profile.entity';
import { convertSyncedCatalogAmount } from './store-currency-price-selection-strategy';

const legacySupplyContext = Symbol('legacy-catalog-supply-context');
type SupplyRequestContext = RequestContext & { [legacySupplyContext]?: boolean };

export interface CatalogSupplySource {
    rule: CatalogSyncRule;
    binding: CatalogSyncBinding;
    ctx: RequestContext;
}

/** Narrow, server-side authority. Never changes the buyer/order/channel identity. */
@Injectable()
export class CatalogSyncSourceService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cache: RequestContextCacheService = new RequestContextCacheService(),
    ) {}
    hasManagedProducts(ctx: RequestContext) {
        if ((ctx as SupplyRequestContext)[legacySupplyContext]) return Promise.resolve(false);
        return this.cache.get(ctx, `catalog-sync-enabled:${ctx.channelId}`, () =>
            this.connection.getRepository(ctx, CatalogSyncBinding).exists({
                where: {
                    kind: 'PRODUCT',
                    targetChannelId: ctx.channelId,
                    state: In(['PENDING', 'ACTIVE', 'ERROR']),
                },
            }),
        );
    }

    async managed(ctx: RequestContext, productId: ID) {
        return this.connection.getRepository(ctx, CatalogSyncBinding).find({
            where: {
                kind: 'PRODUCT',
                targetChannelId: ctx.channelId,
                targetId: productId,
                state: In(['PENDING', 'ACTIVE', 'ERROR']),
            },
            order: { id: 'ASC' },
        });
    }

    async resolve(ctx: RequestContext, variantId: ID): Promise<CatalogSupplySource | null> {
        if (!(await this.hasManagedProducts(ctx))) return null;
        const variant = await this.connection.getRepository(ctx, ProductVariant).findOne({
            where: { id: variantId },
            relations: ['product'],
        });
        if (!variant) return null;
        const bindings = await this.managed(ctx, variant.productId);
        if (!bindings.length) return null;
        const rules = await this.connection.getRepository(ctx, CatalogSyncRule).find({
            where: { id: In(bindings.map(b => b.ruleId)), enabled: true },
            order: { id: 'ASC' },
        });
        let rule: CatalogSyncRule | undefined;
        for (const candidate of rules) {
            if (!bindings.some(b => String(b.ruleId) === String(candidate.id) && b.state === 'ACTIVE'))
                continue;
            const actor = await this.cache.get(ctx, `catalog-sync-actor:${candidate.actorUserId}`, () =>
                this.connection.getRepository(ctx, User).findOne({
                    where: { id: candidate.actorUserId },
                    relations: ['roles', 'roles.channels'],
                }),
            );
            if (
                !actor ||
                actor.deletedAt ||
                !actor.roles.some(
                    role =>
                        role.channels.some(c => c.code === '__default_channel__') &&
                        role.permissions.some(
                            p => p === Permission.SuperAdmin || p === ('ManagePlatformCatalog' as Permission),
                        ),
                )
            )
                continue;
            if (await this.containsProduct(ctx, candidate, variant.productId)) {
                rule = candidate;
                break;
            }
        }
        if (
            !rule ||
            variant.deletedAt ||
            variant.product.deletedAt ||
            !variant.enabled ||
            !variant.product.enabled
        )
            throw new UserInputError('来源商品已暂停、移出分类或同步配置尚未就绪');
        const owner = await this.connection.getRepository(ctx, CatalogResourceOwnership).findOne({
            where: { resourceType: 'Product', resourceId: variant.productId },
        });
        if (!owner || String(owner.ownerChannelId) !== String(rule.sourceChannelId))
            throw new UserInputError('供货来源已变化，请由平台重新核对');
        const targetOffer = await this.connection.getRepository(ctx, ProductSalesAuthorization).findOne({
            where: { productId: variant.productId, channelId: ctx.channelId },
        });
        if (
            !targetOffer ||
            targetOffer.state !== 'ACTIVE' ||
            String(targetOffer.sourceChannelId) !== String(rule.sourceChannelId) ||
            !targetOffer.variantIds.includes(String(variantId)) ||
            targetOffer.pendingVariantIds?.includes(String(variantId))
        )
            throw new UserInputError('目标店铺销售授权或同步配置尚未就绪');
        const sourceOffer = await this.connection.getRepository(ctx, ProductSalesAuthorization).findOne({
            where: {
                productId: variant.productId,
                channelId: rule.sourceChannelId,
            },
        });
        if (
            sourceOffer &&
            (sourceOffer.state !== 'ACTIVE' ||
                !sourceOffer.variantIds.includes(String(variantId)) ||
                sourceOffer.pendingVariantIds?.includes(String(variantId)))
        )
            throw new UserInputError('来源店铺已暂停此规格销售');
        const source = await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: rule.sourceChannelId } });
        if (!source || source.code === '__default_channel__') throw new UserInputError('供货店铺不可用');
        const profiles = await this.cache.get(ctx, `catalog-sync-store-status:${rule.id}`, () =>
            this.connection
                .getRepository(ctx, StoreProfile)
                .find({ where: { channelId: In([rule.sourceChannelId, rule.targetChannelId]) } }),
        );
        if (profiles.length !== 2 || profiles.some(profile => profile.status !== 'ACTIVE'))
            throw new UserInputError('来源或目标店铺已停用');
        const binding = bindings.find(b => String(b.ruleId) === String(rule.id));
        if (!binding) throw new UserInputError('同步供货映射已变化，请重新核对');
        return {
            rule,
            binding,
            ctx: ctx.copy({ channel: source, currencyCode: source.defaultCurrencyCode }),
        };
    }

    private async containsProduct(ctx: RequestContext, rule: CatalogSyncRule, productId: ID) {
        const categoryIds = await this.cache.get(
            ctx,
            `catalog-sync-scope:${rule.id}:${rule.version}`,
            async () => {
                const categories = await this.connection
                    .getRepository(ctx, Collection)
                    .find({ where: { channels: { id: rule.sourceChannelId } }, relations: ['parent'] });
                const ids = [String(rule.sourceCollectionId)];
                if (rule.includeDescendants)
                    for (const categoryId of ids)
                        for (const category of categories)
                            if (
                                category.parent &&
                                String(category.parent.id) === categoryId &&
                                !ids.includes(String(category.id))
                            )
                                ids.push(String(category.id));
                return ids;
            },
        );
        return Boolean(
            await this.connection
                .getRepository(ctx, ProductVariant)
                .createQueryBuilder('scopeVariant')
                .innerJoin(
                    'scopeVariant.collections',
                    'scopeCategory',
                    'scopeCategory.id IN (:...categoryIds)',
                    { categoryIds },
                )
                .where('scopeVariant.productId = :productId', { productId })
                .andWhere('scopeVariant.deletedAt IS NULL')
                .getCount(),
        );
    }

    async context(ctx: RequestContext, variantId: ID, orderLineId?: ID, historical = false) {
        if (historical && orderLineId) {
            const snapshot = await this.connection.getRepository(ctx, CatalogSupplySnapshot).findOne({
                where: { orderLineId, channelId: ctx.channelId, productVariantId: variantId },
            });
            if (snapshot) {
                const channel = await this.connection
                    .getRepository(ctx, Channel)
                    .findOneByOrFail({ id: snapshot.sourceChannelId });
                return ctx.copy({ channel, currencyCode: channel.defaultCurrencyCode });
            }
            // Orders created before opt-in keep their original selling-store stock origin.
            return Object.assign(ctx.copy(), { [legacySupplyContext]: true });
        }
        return (await this.resolve(ctx, variantId))?.ctx ?? ctx;
    }

    async contextForDisplay(ctx: RequestContext, variantId: ID) {
        if (ctx.apiType !== 'admin' || !(await this.hasManagedProducts(ctx)))
            return this.context(ctx, variantId);
        const variant = await this.connection
            .getRepository(ctx, ProductVariant)
            .findOneByOrFail({ id: variantId });
        const bindings = await this.managed(ctx, variant.productId);
        if (!bindings.length) return ctx;
        const owner = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .findOne({ where: { resourceType: 'Product', resourceId: variant.productId } });
        if (!owner || String(owner.ownerChannelId) !== String(bindings[0].sourceChannelId))
            throw new UserInputError('供货来源已变化，请由平台核对');
        const source = await this.connection
            .getRepository(ctx, Channel)
            .findOneByOrFail({ id: bindings[0].sourceChannelId });
        return ctx.copy({ channel: source, currencyCode: source.defaultCurrencyCode });
    }

    async assertEditable(ctx: RequestContext, productId: ID) {
        if ((await this.managed(ctx, productId)).length)
            throw new UserInputError('此商品由来源店铺统一管理，请在平台调整同步关系');
    }

    async historicalChannelsForLines(channelId: ID, orderLineIds: ID[]) {
        if (!orderLineIds.length) return new Map<string, ID>();
        const snapshots = await this.connection.rawConnection.getRepository(CatalogSupplySnapshot).find({
            where: { channelId, orderLineId: In(orderLineIds) },
            select: ['orderLineId', 'sourceChannelId'],
        });
        return new Map(snapshots.map(snapshot => [String(snapshot.orderLineId), snapshot.sourceChannelId]));
    }

    async historicalChannelId(channelId: ID, orderLineId: ID): Promise<ID> {
        const snapshot = await this.connection.rawConnection
            .getRepository(CatalogSupplySnapshot)
            .findOne({ where: { channelId, orderLineId } });
        return snapshot?.sourceChannelId ?? channelId;
    }

    async price(ctx: RequestContext, stored: ProductVariantPrice) {
        if (!(await this.hasManagedProducts(ctx))) return { managed: false, price: stored };
        const row = await this.connection.getRepository(ctx, ProductVariantPrice).findOne({
            where: { id: stored.id },
            relations: ['variant'],
        });
        if (!row?.variant) return { managed: false, price: stored };
        const bindings = await this.managed(ctx, row.variant.productId);
        if (!bindings.length) return { managed: false, price: stored };
        try {
            const source = await this.resolve(ctx, row.variant.id);
            if (!source) return { managed: true, price: undefined };
            const price = await this.connection.getRepository(ctx, ProductVariantPrice).findOne({
                where: {
                    variant: { id: row.variant.id },
                    channelId: source.ctx.channelId,
                    currencyCode: source.ctx.channel.defaultCurrencyCode,
                },
            });
            if (!price) return { managed: true, price: undefined };
            const amount = convertSyncedCatalogAmount(ctx, price.price, price.currencyCode, ctx.currencyCode);
            return {
                managed: true,
                price:
                    amount == null
                        ? undefined
                        : new ProductVariantPrice({
                              ...stored,
                              price: amount,
                              currencyCode: ctx.currencyCode,
                          }),
            };
        } catch (error) {
            if (!(error instanceof UserInputError)) throw error;
            return { managed: true, price: undefined };
        }
    }

    async snapshotOrder(ctx: RequestContext, order: Order) {
        for (const line of order.lines) {
            const repo = this.connection.getRepository(ctx, CatalogSupplySnapshot);
            const previous = await repo.findOne({
                where: { orderLineId: line.id, channelId: ctx.channelId },
            });
            if (!['AddingItems', 'ArrangingPayment', 'AwaitingManualPayment', 'Draft'].includes(order.state))
                continue;
            const source = await this.resolve(ctx, line.productVariantId);
            if (!source) continue;
            if (previous && previous.sourceChannelId !== source.ctx.channelId)
                throw new UserInputError('购物车供货来源已变化，请重新添加商品');
            const sourcePrice = await this.connection.getRepository(ctx, ProductVariantPrice).findOne({
                where: {
                    channelId: source.ctx.channelId,
                    currencyCode: source.ctx.channel.defaultCurrencyCode,
                    variant: { id: line.productVariantId },
                },
            });
            const fields = ctx.channel.customFields as {
                cnyToMyrRate?: number;
                currencyRoundingMode?: string;
                currencyRateMarkupBps?: number;
            };
            await repo.save(
                new CatalogSupplySnapshot({
                    ...previous,
                    orderId: order.id,
                    orderLineId: line.id,
                    productVariantId: line.productVariantId,
                    channelId: ctx.channelId,
                    sourceChannelId: source.ctx.channelId,
                    ruleId: source.rule.id,
                    ruleVersion: source.rule.version,
                    configuration: {
                        currencyCode: order.currencyCode,
                        price: line.listPrice,
                        sourceCurrencyCode: source.ctx.channel.defaultCurrencyCode,
                        sourcePrice: sourcePrice?.price,
                        rate: fields.cnyToMyrRate,
                        roundingMode: fields.currencyRoundingMode,
                        markupBps: fields.currencyRateMarkupBps,
                        shippingMethodIds: order.shippingLines?.map(s => String(s.shippingMethodId)) ?? [],
                    },
                }),
            );
        }
    }
}
