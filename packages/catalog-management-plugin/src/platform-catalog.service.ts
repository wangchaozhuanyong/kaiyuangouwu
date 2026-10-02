import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    CatalogResourceOwnership,
    Channel,
    ChannelService,
    Collection,
    CollectionService,
    EventBus,
    Product,
    ProductSalesAuthorization,
    ProductVariant,
    ProductVariantPrice,
    ProductVariantPriceEvent,
    RequestContext,
    StockLevel,
    StockLocation,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { CatalogGovernanceService, StorefrontDataChangedEvent } from '@vendure/store-management-plugin';
import { createHash } from 'node:crypto';
import { In, IsNull } from 'typeorm';

import { CatalogDistributionBatch } from './entities/catalog-distribution-batch.entity';

export interface DistributionInput {
    idempotencyKey: string;
    action: 'GRANT' | 'REVOKE';
    productIds?: string[];
    variantIds?: string[];
    collectionId?: string;
    includeDescendants?: boolean;
    targets: Array<{
        channelId: string;
        collectionId?: string;
        prices?: Array<{ variantId: string; price: number }>;
    }>;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const label = (
    entity: { translations?: Array<{ languageCode: RequestContext['languageCode']; name: string }> },
    ctx: RequestContext,
) =>
    entity.translations?.find(t => t.languageCode === ctx.languageCode)?.name ??
    entity.translations?.[0]?.name ??
    '未命名';

@Injectable()
export class PlatformCatalogService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly governance: CatalogGovernanceService,
        private readonly channels: ChannelService,
        private readonly collections: CollectionService,
        private readonly eventBus: EventBus,
    ) {}

    async catalog(ctx: RequestContext, skip = 0, take = 50, term = '') {
        this.governance.assertPlatform(ctx);
        if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 100)
            throw new UserInputError('分页范围无效');
        const products = await this.connection.getRepository(ctx, Product).find({
            where: { deletedAt: IsNull() },
            relations: ['translations', 'channels', 'variants', 'variants.translations'],
            order: { id: 'ASC' },
        });
        const owners = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .find({ where: { resourceType: 'Product' } });
        const grants = await this.connection.getRepository(ctx, ProductSalesAuthorization).find();
        const channels = (
            await this.connection.getRepository(ctx, Channel).find({ loadEagerRelations: false })
        ).filter(c => c.code !== DEFAULT_CHANNEL_CODE);
        const categories = await this.connection
            .getRepository(ctx, Collection)
            .find({ relations: ['translations', 'channels', 'parent'] });
        const all = products.map(p => {
            const owner = owners.find(o => String(o.resourceId) === String(p.id));
            const sales = grants.filter(g => String(g.productId) === String(p.id));
            return {
                id: String(p.id),
                name: label(p, ctx),
                enabled: p.enabled,
                variants: p.variants
                    .filter(v => !v.deletedAt)
                    .map(v => ({ id: String(v.id), name: label(v, ctx) })),
                ownerChannelId: owner ? String(owner.ownerChannelId) : null,
                channelIds: p.channels
                    .filter(
                        c =>
                            c.code !== DEFAULT_CHANNEL_CODE &&
                            (String(c.id) === String(owner?.ownerChannelId) ||
                                sales.some(
                                    g => String(g.channelId) === String(c.id) && g.state !== 'REVOKED',
                                )),
                    )
                    .map(c => String(c.id)),
                unreviewedChannelIds: p.channels
                    .filter(
                        c =>
                            c.code !== DEFAULT_CHANNEL_CODE &&
                            String(c.id) !== String(owner?.ownerChannelId) &&
                            !sales.some(g => String(g.channelId) === String(c.id)),
                    )
                    .map(c => String(c.id)),
                grants: sales.map(g => ({
                    channelId: String(g.channelId),
                    state: g.state,
                    variantIds: g.variantIds,
                    pendingVariantIds: g.pendingVariantIds ?? [],
                    version: g.version,
                })),
            };
        });
        const filtered = all.filter(
            p => !term.trim() || p.name.toLowerCase().includes(term.trim().toLowerCase()),
        );
        const eligible = all.filter(
            p => p.ownerChannelId && channels.some(c => String(c.id) === p.ownerChannelId),
        );
        return {
            totalItems: filtered.length,
            items: filtered.slice(skip, skip + take),
            categories: categories
                .filter(c => !c.isRoot)
                .map(c => ({
                    id: String(c.id),
                    name: label(c, ctx),
                    parentId: c.parent ? String(c.parent.id) : null,
                    channelIds: c.channels
                        .filter(ch => ch.code !== DEFAULT_CHANNEL_CODE)
                        .map(ch => String(ch.id)),
                })),
            channels: channels.map(c => ({
                id: String(c.id),
                code: c.code,
                currencyCode: c.defaultCurrencyCode,
                displayName:
                    (c.customFields as any)?.[
                        String(ctx.languageCode).startsWith('zh') ? 'storefrontNameZh' : 'storefrontNameEn'
                    ] || '店铺名称未填写',
                assignedCount: eligible.filter(p => p.channelIds.includes(String(c.id))).length,
                coverageDenominator: eligible.length,
            })),
            unassignedCount: eligible.filter(p => !p.channelIds.length).length,
            ownershipReviewCount: all.filter(p => !p.ownerChannelId).length,
        };
    }

    async preview(ctx: RequestContext, input: DistributionInput) {
        this.governance.assertPlatform(ctx);
        if (
            !/^[A-Za-z0-9_-]{8,100}$/.test(input.idempotencyKey) ||
            !['GRANT', 'REVOKE'].includes(input.action) ||
            !input.targets?.length
        )
            throw new UserInputError('分配参数无效');
        if (new Set(input.targets.map(t => t.channelId)).size !== input.targets.length)
            throw new UserInputError('目标店铺不能重复');
        const repository = this.connection.getRepository(ctx, CatalogDistributionBatch);
        const prior = await repository.findOne({ where: { idempotencyKey: input.idempotencyKey } });
        if (prior) {
            if (prior.inputHash !== hash(input)) throw new UserInputError('幂等标识已用于其他操作');
            return this.receipt(prior);
        }
        const actorUserId = ctx.activeUserId;
        if (actorUserId == null) throw new UserInputError('分配操作需要已登录管理员');
        const ids = new Set(input.productIds ?? []);
        if (input.collectionId) {
            const categories = await this.connection
                .getRepository(ctx, Collection)
                .find({ relations: ['parent'] });
            if (!categories.some(c => String(c.id) === input.collectionId))
                throw new UserInputError('分类不存在');
            const selected = new Set([input.collectionId]);
            if (input.includeDescendants) {
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const c of categories)
                        if (c.parent && selected.has(String(c.parent.id)) && !selected.has(String(c.id))) {
                            selected.add(String(c.id));
                            changed = true;
                        }
                }
            }
            const variants = await this.connection
                .getRepository(ctx, ProductVariant)
                .createQueryBuilder('variant')
                .innerJoin('variant.collections', 'category', 'category.id IN (:...categoryIds)', {
                    categoryIds: [...selected],
                })
                .where('variant.deletedAt IS NULL')
                .getMany();
            for (const v of variants) ids.add(String(v.productId));
        }
        if (!ids.size || ids.size * input.targets.length > 10000)
            throw new UserInputError('请选择商品，单批最多 10000 个商品与目标店铺组合');
        const items: Array<Record<string, any>> = [];
        for (const productId of [...ids].sort())
            for (const target of input.targets) {
                try {
                    const snapshot = await this.snapshot(ctx, productId, target, input.variantIds);
                    items.push({
                        productId,
                        channelId: target.channelId,
                        fingerprint: hash(snapshot),
                        ...snapshot,
                    });
                } catch (error) {
                    if (!(error instanceof UserInputError)) throw error;
                    items.push({ productId, channelId: target.channelId, conflict: error.message });
                }
            }
        const batch = await repository.save(
            new CatalogDistributionBatch({
                idempotencyKey: input.idempotencyKey,
                inputHash: hash(input),
                actorUserId,
                state: 'PREVIEW',
                input: { ...input },
                items,
                results: [],
            }),
        );
        return this.receipt(batch);
    }

    async execute(ctx: RequestContext, batchId: ID) {
        this.governance.assertPlatform(ctx);
        // Each item and its receipt commit together. A retry skips committed successes.
        const initial = await this.batch(ctx, batchId);
        for (let index = 0; index < initial.items.length; index++) {
            await this.connection
                .withTransaction(ctx, async tx => {
                    const repository = this.connection.getRepository(tx, CatalogDistributionBatch);
                    const batch = await this.lock(repository.createQueryBuilder('batch'))
                        .where('batch.id = :batchId', { batchId })
                        .getOne();
                    if (!batch) throw new UserInputError('分配预览不存在');
                    if (batch.results.some(r => r.index === index && r.success)) return;
                    const item = batch.items[index];
                    const input = batch.input as unknown as DistributionInput;
                    const target = input.targets.find(t => t.channelId === item.channelId);
                    if (!target) throw new UserInputError('分配目标不存在，请重新预览');
                    if (item.conflict) throw new UserInputError(item.conflict);
                    await this.lock(this.connection.getRepository(tx, Product).createQueryBuilder('product'))
                        .where('product.id = :productId', { productId: item.productId })
                        .getOneOrFail();
                    if (target.collectionId)
                        await this.lock(
                            this.connection.getRepository(tx, Collection).createQueryBuilder('category'),
                        )
                            .where('category.id = :id', { id: target.collectionId })
                            .getOneOrFail();
                    const snapshot = await this.snapshot(tx, item.productId, target, input.variantIds);
                    if (hash(snapshot) !== item.fingerprint)
                        throw new UserInputError('数据已变化，请重新预览');
                    await this.apply(tx, input.action, item, target);
                    await this.eventBus.publish(
                        new StorefrontDataChangedEvent(tx, ['catalog'], {
                            channelIds: [item.channelId],
                            entityType: 'Product',
                            entityIds: [item.productId],
                        }),
                    );
                    const verified = await this.snapshot(tx, item.productId, target, input.variantIds);
                    // Only rebase the exact category change made by this item. Preserve conflicts
                    // from concurrent product, price or authorization changes in later items.
                    if (target.collectionId)
                        for (let otherIndex = index + 1; otherIndex < batch.items.length; otherIndex++) {
                            const other = batch.items[otherIndex];
                            const otherTarget = input.targets.find(t => t.channelId === other.channelId);
                            if (!otherTarget) throw new UserInputError('分配目标不存在，请重新预览');
                            if (other.conflict || otherTarget.collectionId !== target.collectionId) continue;
                            const refreshed = await this.snapshot(
                                tx,
                                other.productId,
                                otherTarget,
                                input.variantIds,
                            );
                            const { fingerprint, productId, channelId, categoryFilters, ...oldRest } = other;
                            const { categoryFilters: newFilters, ...newRest } = refreshed;
                            if (
                                hash(oldRest) === hash(newRest) &&
                                hash(categoryFilters) === hash(snapshot.categoryFilters)
                            ) {
                                batch.items[otherIndex] = {
                                    productId,
                                    channelId,
                                    fingerprint: hash(refreshed),
                                    ...refreshed,
                                };
                            }
                        }
                    batch.results = batch.results
                        .filter(r => r.index !== index)
                        .concat({
                            index,
                            success: true,
                            productId: item.productId,
                            channelId: item.channelId,
                            readback: verified.grant,
                            prices: verified.targetPrices,
                        });
                    batch.state =
                        batch.results.filter(r => r.success).length === batch.items.length
                            ? 'COMPLETE'
                            : 'PARTIAL';
                    await repository.save(batch);
                })
                .catch(async error => {
                    // Save only a safe message, never driver SQL, tokens or card data.
                    await this.connection.withTransaction(ctx, async tx => {
                        const repository = this.connection.getRepository(tx, CatalogDistributionBatch);
                        const batch = await this.lock(repository.createQueryBuilder('batch'))
                            .where('batch.id = :batchId', { batchId })
                            .getOne();
                        if (!batch || batch.results.some(r => r.index === index && r.success)) return;
                        batch.results = batch.results
                            .filter(r => r.index !== index)
                            .concat({
                                index,
                                success: false,
                                message:
                                    error instanceof UserInputError
                                        ? error.message
                                        : '执行失败，请检查配置后续做',
                            });
                        batch.state = 'PARTIAL';
                        await repository.save(batch);
                    });
                });
        }
        return this.receipt(await this.batch(ctx, batchId));
    }

    async myOffer(ctx: RequestContext, productId: ID) {
        const { product, owner, grant } = await this.governance.myOffer(ctx, productId);
        const variants = (
            await this.connection.getRepository(ctx, ProductVariant).find({
                where: { productId, channels: { id: ctx.channelId }, deletedAt: IsNull() },
                relations: ['translations'],
            })
        ).filter(v => !grant || grant.variantIds.includes(String(v.id)));
        const prices = variants.length
            ? await this.connection.getRepository(ctx, ProductVariantPrice).find({
                  where: {
                      variant: { id: In(variants.map(v => v.id)) },
                      channelId: ctx.channelId,
                      currencyCode: ctx.channel.defaultCurrencyCode,
                  },
                  relations: ['variant'],
              })
            : [];
        return {
            productId: String(product.id),
            ownerChannelId: String(owner.ownerChannelId),
            state: grant?.state ?? 'ACTIVE',
            version: grant?.version ?? 0,
            pendingVariantIds: grant?.pendingVariantIds ?? [],
            variants: variants.map(v => ({
                id: String(v.id),
                name: label(v, ctx),
                price: prices.find(p => String(p.variant.id) === String(v.id))?.price ?? null,
                currencyCode: ctx.channel.defaultCurrencyCode,
            })),
        };
    }

    async updateMyOffer(
        ctx: RequestContext,
        input: {
            productId: ID;
            version: number;
            state: 'ACTIVE' | 'PAUSED';
            prices: Array<{ variantId: ID; price: number }>;
        },
    ) {
        await this.lock(this.connection.getRepository(ctx, Product).createQueryBuilder('product'))
            .where('product.id = :productId', { productId: input.productId })
            .getOneOrFail();
        const { product, owner, grant } = await this.governance.myOffer(ctx, input.productId);
        if ((grant?.version ?? 0) !== input.version || grant?.state === 'REVOKED')
            throw new UserInputError('授权已变化，请刷新');
        if (!['ACTIVE', 'PAUSED'].includes(input.state)) throw new UserInputError('经营状态无效');
        const variants = (
            await this.connection.getRepository(ctx, ProductVariant).find({
                where: { productId: product.id, channels: { id: ctx.channelId }, deletedAt: IsNull() },
            })
        ).filter(v => !grant || grant.variantIds.includes(String(v.id)));
        if (!variants.length) throw new UserInputError('没有有效授权规格');
        for (const price of input.prices) {
            if (
                !variants.some(v => String(v.id) === String(price.variantId)) ||
                !Number.isSafeInteger(price.price) ||
                price.price < 0
            )
                throw new UserInputError('规格或售价无效');
            const repo = this.connection.getRepository(ctx, ProductVariantPrice);
            const existing = await repo.findOne({
                where: {
                    variant: { id: price.variantId },
                    channelId: ctx.channelId,
                    currencyCode: ctx.channel.defaultCurrencyCode,
                },
            });
            const savedPrice = await repo.save(
                existing
                    ? { ...existing, price: price.price }
                    : new ProductVariantPrice({
                          variant: { id: price.variantId },
                          channelId: ctx.channelId,
                          currencyCode: ctx.channel.defaultCurrencyCode,
                          price: price.price,
                      }),
            );
            await this.eventBus.publish(
                new ProductVariantPriceEvent(ctx, [savedPrice], existing ? 'updated' : 'created'),
            );
        }
        for (const variant of variants)
            if (
                !(await this.connection.getRepository(ctx, ProductVariantPrice).findOne({
                    where: {
                        variant: { id: variant.id },
                        channelId: ctx.channelId,
                        currencyCode: ctx.channel.defaultCurrencyCode,
                    },
                }))
            )
                throw new UserInputError('请先填写全部授权规格的本店售价');
        await this.connection.getRepository(ctx, ProductSalesAuthorization).save(
            new ProductSalesAuthorization({
                ...grant,
                productId: product.id,
                channelId: ctx.channelId,
                sourceChannelId: owner.ownerChannelId,
                state: input.state,
                variantIds: variants.map(v => String(v.id)),
                pendingVariantIds: [],
                version: (grant?.version ?? 0) + 1,
            }),
        );
        await this.eventBus.publish(
            new StorefrontDataChangedEvent(ctx, ['catalog'], {
                entityType: 'Product',
                entityIds: [product.id],
            }),
        );
        return this.myOffer(ctx, product.id);
    }

    private async snapshot(
        ctx: RequestContext,
        productId: ID,
        target: DistributionInput['targets'][number],
        selectedVariants?: string[],
    ) {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: productId, deletedAt: IsNull() },
            relations: ['translations', 'channels', 'variants'],
        });
        const owner = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .findOne({ where: { resourceType: 'Product', resourceId: productId } });
        const targetChannel = await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: target.channelId }, loadEagerRelations: false });
        const sourceChannel = owner
            ? await this.connection
                  .getRepository(ctx, Channel)
                  .findOne({ where: { id: owner.ownerChannelId }, loadEagerRelations: false })
            : null;
        if (
            !product ||
            !owner ||
            !sourceChannel ||
            sourceChannel.code === DEFAULT_CHANNEL_CODE ||
            !targetChannel ||
            targetChannel.code === DEFAULT_CHANNEL_CODE
        )
            throw new UserInputError('商品归属待核对或目标不是经营店铺');
        const variants = product.variants
            .filter(
                v => !v.deletedAt && (!selectedVariants?.length || selectedVariants.includes(String(v.id))),
            )
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (!variants.length) throw new UserInputError('没有可授权规格');
        const allPrices = await this.connection.getRepository(ctx, ProductVariantPrice).find({
            where: { variant: { id: In(variants.map(v => v.id)) } },
            relations: ['variant'],
            order: { id: 'ASC' },
        });
        const sourcePrices = allPrices
            .filter(
                p =>
                    String(p.channelId) === String(sourceChannel.id) &&
                    p.currencyCode === sourceChannel.defaultCurrencyCode,
            )
            .map(p => ({ variantId: String(p.variant.id), price: p.price }));
        const targetPrices = allPrices
            .filter(
                p =>
                    String(p.channelId) === target.channelId &&
                    p.currencyCode === targetChannel.defaultCurrencyCode,
            )
            .map(p => ({ variantId: String(p.variant.id), price: p.price }));
        if (
            target.prices?.some(
                p =>
                    !variants.some(v => String(v.id) === p.variantId) ||
                    !Number.isSafeInteger(p.price) ||
                    p.price < 0,
            )
        )
            throw new UserInputError('目标售价无效');
        const plannedPrices = variants.map(v => ({
            variantId: String(v.id),
            price:
                targetPrices.find(p => p.variantId === String(v.id))?.price ??
                target.prices?.find(p => p.variantId === String(v.id))?.price ??
                (sourceChannel.defaultCurrencyCode === targetChannel.defaultCurrencyCode &&
                sourceChannel.pricesIncludeTax === targetChannel.pricesIncludeTax
                    ? sourcePrices.find(p => p.variantId === String(v.id))?.price
                    : undefined) ??
                null,
        }));
        const grant = await this.connection
            .getRepository(ctx, ProductSalesAuthorization)
            .findOne({ where: { productId, channelId: target.channelId } });
        const category = target.collectionId
            ? await this.connection
                  .getRepository(ctx, Collection)
                  .findOne({ where: { id: target.collectionId, channels: { id: target.channelId } } })
            : null;
        if (target.collectionId && (!category || category.isRoot))
            throw new UserInputError('目标分类不属于目标店铺');
        return {
            name: label(product, ctx),
            productUpdatedAt: product.updatedAt.toISOString(),
            sourceChannelId: String(sourceChannel.id),
            targetCurrencyCode: targetChannel.defaultCurrencyCode,
            variantIds: variants.map(v => String(v.id)),
            sourcePrices,
            targetPrices,
            plannedPrices,
            missingPriceCount: plannedPrices.filter(p => p.price == null).length,
            alreadyAssigned: product.channels.some(c => String(c.id) === target.channelId),
            grant: grant
                ? {
                      id: String(grant.id),
                      state: grant.state,
                      version: grant.version,
                      variantIds: grant.variantIds,
                      pendingVariantIds: grant.pendingVariantIds ?? [],
                  }
                : null,
            categoryFilters: category?.filters ?? null,
        };
    }

    private async apply(
        ctx: RequestContext,
        action: DistributionInput['action'],
        item: Record<string, any>,
        target: DistributionInput['targets'][number],
    ) {
        const repository = this.connection.getRepository(ctx, ProductSalesAuthorization);
        const existing = await repository.findOne({
            where: { productId: item.productId, channelId: item.channelId },
        });
        if (action === 'REVOKE') {
            if (!existing) throw new UserInputError('目标店铺没有可撤销的销售授权');
            const remaining = existing.variantIds.filter(id => !item.variantIds.includes(id));
            await repository.save(
                new ProductSalesAuthorization({
                    ...existing,
                    state: remaining.length ? existing.state : 'REVOKED',
                    variantIds: remaining,
                    pendingVariantIds: (existing.pendingVariantIds ?? []).filter(id =>
                        remaining.includes(id),
                    ),
                    version: existing.version + 1,
                }),
            );
            return; // Preserve native associations for historical orders; sales guards block new purchases.
        }
        await this.channels.assignToChannels(ctx, Product, item.productId, [item.channelId]);
        for (const variantId of item.variantIds) {
            await this.channels.assignToChannels(ctx, ProductVariant, variantId, [item.channelId]);
            const price = item.plannedPrices.find((p: any) => p.variantId === variantId)?.price;
            if (
                price != null &&
                !(await this.connection.getRepository(ctx, ProductVariantPrice).findOne({
                    where: {
                        variant: { id: variantId },
                        channelId: item.channelId,
                        currencyCode: item.targetCurrencyCode,
                    },
                }))
            ) {
                const savedPrice = await this.connection.getRepository(ctx, ProductVariantPrice).save(
                    new ProductVariantPrice({
                        variant: { id: variantId },
                        channelId: item.channelId,
                        currencyCode: item.targetCurrencyCode,
                        price,
                    }),
                );
                const targetChannel = await this.connection
                    .getRepository(ctx, Channel)
                    .findOneOrFail({ where: { id: item.channelId }, loadEagerRelations: false });
                await this.eventBus.publish(
                    new ProductVariantPriceEvent(
                        ctx.copy({ channel: targetChannel, currencyCode: targetChannel.defaultCurrencyCode }),
                        [savedPrice],
                        'created',
                    ),
                );
            }
            const locations = await this.connection
                .getRepository(ctx, StockLocation)
                .find({ where: { channels: { id: item.channelId } } });
            for (const location of locations)
                if (
                    !(await this.connection
                        .getRepository(ctx, StockLevel)
                        .findOne({ where: { productVariantId: variantId, stockLocationId: location.id } }))
                )
                    await this.connection.getRepository(ctx, StockLevel).save(
                        new StockLevel({
                            productVariantId: variantId,
                            stockLocationId: location.id,
                            stockOnHand: 0,
                            stockAllocated: 0,
                        }),
                    );
        }
        const product = await this.connection.getRepository(ctx, Product).findOneOrFail({
            where: { id: item.productId },
            relations: ['assets', 'featuredAsset', 'variants', 'variants.assets', 'variants.featuredAsset'],
        });
        for (const assetId of new Set(
            [
                product.featuredAsset?.id,
                ...product.assets.map(a => a.assetId),
                ...product.variants
                    .filter(v => item.variantIds.includes(String(v.id)))
                    .flatMap(v => [v.featuredAsset?.id, ...v.assets.map(a => a.assetId)]),
            ].filter((id): id is ID => id != null),
        ))
            await this.channels.assignToChannels(ctx, Asset, assetId, [item.channelId]);
        if (target.collectionId) {
            const category = await this.connection
                .getRepository(ctx, Collection)
                .findOneOrFail({ where: { id: target.collectionId } });
            const filters = category.filters
                .filter(f => f.code !== 'variant-id-filter')
                .map(f => ({ code: f.code, arguments: f.args }));
            const old = category.filters
                .find(f => f.code === 'variant-id-filter')
                ?.args.find(a => a.name === 'variantIds')?.value;
            const ids = [...new Set<string>([...(old ? JSON.parse(old) : []), ...item.variantIds])];
            const targetChannel = await this.connection
                .getRepository(ctx, Channel)
                .findOneOrFail({ where: { id: item.channelId }, loadEagerRelations: false });
            await this.collections.update(
                ctx.copy({ channel: targetChannel, currencyCode: targetChannel.defaultCurrencyCode }),
                {
                    id: category.id,
                    filters: [
                        ...filters,
                        {
                            code: 'variant-id-filter',
                            arguments: [
                                { name: 'variantIds', value: JSON.stringify(ids) },
                                { name: 'combineWithAnd', value: filters.length ? 'false' : 'true' },
                            ],
                        },
                    ],
                },
            );
        }
        await repository.save(
            new ProductSalesAuthorization({
                ...existing,
                productId: item.productId,
                channelId: item.channelId,
                sourceChannelId: item.sourceChannelId,
                // Repeated grants preserve an existing merchant's paused/pending state and variant scope.
                state:
                    existing && existing.state !== 'REVOKED'
                        ? existing.state
                        : item.missingPriceCount
                          ? 'PENDING'
                          : 'ACTIVE',
                variantIds: [
                    ...new Set([
                        ...(existing?.state === 'REVOKED' ? [] : (existing?.variantIds ?? [])),
                        ...item.variantIds,
                    ]),
                ],
                pendingVariantIds: [
                    ...new Set([
                        ...(existing?.state === 'REVOKED' ? [] : (existing?.pendingVariantIds ?? [])).filter(
                            id => !item.plannedPrices.some((p: any) => p.variantId === id && p.price != null),
                        ),
                        ...item.plannedPrices
                            .filter((p: any) => p.price == null)
                            .map((p: any) => p.variantId),
                    ]),
                ],
                version: (existing?.version ?? 0) + 1,
            }),
        );
    }
    private lock<T extends { setLock(mode: 'pessimistic_write'): unknown }>(query: T): T {
        if (!['sqljs', 'sqlite', 'better-sqlite3'].includes(this.connection.rawConnection.options.type))
            query.setLock('pessimistic_write');
        return query;
    }
    private async batch(ctx: RequestContext, id: ID) {
        const batch = await this.connection
            .getRepository(ctx, CatalogDistributionBatch)
            .findOne({ where: { id } });
        if (!batch) throw new UserInputError('分配预览不存在');
        return batch;
    }
    private receipt(batch: CatalogDistributionBatch) {
        return { id: String(batch.id), state: batch.state, items: batch.items, results: batch.results };
    }
}
