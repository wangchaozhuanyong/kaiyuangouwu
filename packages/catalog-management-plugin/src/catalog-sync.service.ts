import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    CatalogResourceOwnership,
    CatalogSyncBinding,
    CatalogSyncRule,
    Channel,
    ChannelService,
    Collection,
    CollectionService,
    EventBus,
    Facet,
    FacetValue,
    Product,
    ProductChannelEvent,
    ProductOption,
    ProductOptionGroup,
    ProductSalesAuthorization,
    ProductVariant,
    ProductVariantChannelEvent,
    ProductVariantPrice,
    ProductVariantPriceEvent,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import {
    CatalogGovernanceService,
    convertSyncedCatalogAmount,
    StorefrontDataChangedEvent,
} from '@vendure/store-management-plugin';
import { createHash } from 'node:crypto';
import { In, IsNull, Not } from 'typeorm';

export interface CatalogSyncInput {
    id?: ID;
    version?: number;
    sourceChannelId: ID;
    sourceCollectionId: ID;
    targetChannelId: ID;
    includeDescendants: boolean;
}
export interface CatalogSyncDeliveryInspection {
    blockers: string[];
    pending?: string[];
    fingerprint: string;
}
export interface CatalogSyncDeliveryAdapter {
    inspect(
        ctx: RequestContext,
        source: Channel,
        target: Channel,
        product: Product,
    ): Promise<CatalogSyncDeliveryInspection>;
    prepare(ctx: RequestContext, rule: CatalogSyncRule, product: Product): Promise<void>;
}
export interface CatalogSyncPreviewItem {
    productId: string;
    name: string;
    takeover: boolean;
    blockers: string[];
    pendingReasons: string[];
    prices: Array<{ variantId: string; price: number | null; currencyCode: string }>;
}
export interface CatalogSyncPreview {
    fingerprint: string;
    productCount: number;
    categoryCount: number;
    takeoverCount: number;
    items: CatalogSyncPreviewItem[];
    blockers: string[];
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class CatalogSyncService {
    private adapter?: CatalogSyncDeliveryAdapter;
    private enqueue?: (id: ID) => Promise<void>;
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly governance: CatalogGovernanceService,
        private readonly collections: CollectionService,
        private readonly channels: ChannelService,
        private readonly events: EventBus,
    ) {}
    registerDeliveryAdapter(adapter: CatalogSyncDeliveryAdapter) {
        this.adapter = adapter;
    }
    registerEnqueuer(enqueue: (id: ID) => Promise<void>) {
        this.enqueue = enqueue;
    }

    async list(ctx: RequestContext) {
        this.governance.assertPlatform(ctx);
        return this.connection.getRepository(ctx, CatalogSyncRule).find({ order: { id: 'DESC' } });
    }

    async issues(ctx: RequestContext, ruleId: ID, skip = 0, take = 100) {
        this.governance.assertPlatform(ctx);
        if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 100)
            throw new UserInputError('分页范围无效');
        await this.connection.getRepository(ctx, CatalogSyncRule).findOneByOrFail({ id: ruleId });
        const [items, totalItems] = await this.connection
            .getRepository(ctx, CatalogSyncBinding)
            .findAndCount({
                where: { ruleId, error: Not(IsNull()) },
                order: { id: 'ASC' },
                skip,
                take,
            });
        return {
            totalItems,
            items: items.map(item => ({
                kind: item.kind,
                sourceId: item.sourceId,
                state: item.state === 'ACTIVE' ? 'PENDING' : item.state,
                error: item.error,
            })),
        };
    }

    private async scope(
        ctx: RequestContext,
        input: CatalogSyncInput,
        page?: { after: number; take: number },
    ) {
        const [source, target] = await Promise.all(
            [input.sourceChannelId, input.targetChannelId].map(id =>
                this.connection.getRepository(ctx, Channel).findOne({ where: { id } }),
            ),
        );
        if (
            !source ||
            !target ||
            source.code === '__default_channel__' ||
            target.code === '__default_channel__' ||
            String(source.id) === String(target.id)
        )
            throw new UserInputError('请选择不同的来源经营店铺和目标经营店铺');
        // Direct owner -> selling store only. A receiving store cannot become a supplier.
        const existing = await this.connection.getRepository(ctx, CatalogSyncRule).find();
        if (
            existing.some(
                r =>
                    String(r.id) !== String(input.id) &&
                    (String(r.targetChannelId) === String(source.id) ||
                        String(r.sourceChannelId) === String(target.id)),
            )
        )
            throw new UserInputError('持续同步只支持直接供货，不能建立循环或转授权链');
        const rows = await this.connection.getRepository(ctx, Collection).find({
            where: { channels: { id: source.id } },
            relations: ['parent', 'translations', 'assets', 'featuredAsset'],
        });
        const root = rows.find(c => String(c.id) === String(input.sourceCollectionId) && !c.isRoot);
        if (!root) {
            if (page)
                return {
                    source,
                    target,
                    categories: [] as Collection[],
                    products: [] as Product[],
                    variants: [] as ProductVariant[],
                    productIds: [] as string[],
                };
            throw new UserInputError('来源分类不属于来源店铺');
        }
        rows.sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id));
        const selected = [root];
        if (input.includeDescendants) {
            const ids = new Set([String(root.id)]);
            for (const selectedCategory of selected)
                for (const c of rows)
                    if (
                        c.parent &&
                        String(c.parent.id) === String(selectedCategory.id) &&
                        !ids.has(String(c.id))
                    ) {
                        ids.add(String(c.id));
                        selected.push(c);
                    }
        }
        const owners = await this.connection.getRepository(ctx, CatalogResourceOwnership).find({
            where: { resourceType: 'Collection', resourceId: In(selected.map(c => c.id)) },
        });
        if (
            selected.some(
                c =>
                    !owners.some(
                        o =>
                            String(o.resourceId) === String(c.id) &&
                            String(o.ownerChannelId) === String(source.id),
                    ),
            )
        )
            throw new UserInputError('来源分类的维护归属待核对');
        const variants = await this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .innerJoin('variant.collections', 'category', 'category.id IN (:...ids)', {
                ids: selected.map(c => c.id),
            })
            .innerJoin('variant.product', 'sourceProduct')
            .where('variant.deletedAt IS NULL')
            .andWhere('sourceProduct.deletedAt IS NULL')
            .orderBy('variant.id', 'ASC')
            .getMany();
        const productIds = [...new Set(variants.map(v => String(v.productId)))];
        const selectedIds = page
            ? productIds
                  .filter(id => Number(id) > page.after)
                  .sort((a, b) => Number(a) - Number(b))
                  .slice(0, page.take)
            : productIds;
        const products = selectedIds.length
            ? await this.connection.getRepository(ctx, Product).find({
                  where: { id: In(selectedIds), deletedAt: IsNull() },
                  relations: ['translations', 'variants', 'channels'],
                  order: { id: 'ASC' },
                  loadEagerRelations: false,
              })
            : [];
        return { source, target, categories: selected, products, variants, productIds };
    }

    async preview(ctx: RequestContext, input: CatalogSyncInput): Promise<CatalogSyncPreview> {
        this.governance.assertPlatform(ctx);
        const scope = await this.scope(ctx, input);
        const currency = scope.target.customFields as {
            cnyToMyrRate?: number;
            currencyRateMode?: string;
            currencyRoundingMode?: string;
            currencyRateMarkupBps?: number;
        };
        const items: CatalogSyncPreviewItem[] = [];
        const evidence: unknown[] = [];
        for (const product of scope.products) {
            const owner = await this.connection.getRepository(ctx, CatalogResourceOwnership).findOne({
                where: { resourceType: 'Product', resourceId: product.id },
            });
            const blockers =
                owner && String(owner.ownerChannelId) === String(scope.source.id)
                    ? []
                    : ['商品不是来源店铺直接维护，不能转授权'];
            const history = await this.connection.getRepository(ctx, CatalogSyncBinding).find({
                where: { kind: 'PRODUCT', targetId: product.id, targetChannelId: scope.target.id },
            });
            const bindings = history.filter(binding => binding.state !== 'REMOVED');
            if (bindings.some(b => String(b.sourceChannelId) !== String(scope.source.id)))
                blockers.push('目标商品已有其他供货来源');
            const delivery: CatalogSyncDeliveryInspection = this.adapter
                ? await this.adapter.inspect(ctx, scope.source, scope.target, product)
                : { blockers: ['供货与配送组件尚未就绪'], fingerprint: '' };
            blockers.push(...delivery.blockers);
            const sourcePrices = await this.connection.getRepository(ctx, ProductVariantPrice).find({
                where: {
                    variant: { productId: product.id },
                    channelId: scope.source.id,
                    currencyCode: scope.source.defaultCurrencyCode,
                },
                relations: ['variant'],
                order: { id: 'ASC' },
            });
            const targetPrices = await this.connection.getRepository(ctx, ProductVariantPrice).find({
                where: { variant: { productId: product.id }, channelId: scope.target.id },
                relations: ['variant'],
                order: { id: 'ASC' },
            });
            const targetCtx = ctx.copy({
                channel: scope.target,
                currencyCode: scope.target.defaultCurrencyCode,
            });
            const prices = product.variants
                .filter(v => !v.deletedAt)
                .map(v => {
                    const base = sourcePrices.find(p => String(p.variant.id) === String(v.id));
                    return {
                        variantId: String(v.id),
                        price: base
                            ? convertSyncedCatalogAmount(
                                  targetCtx,
                                  base.price,
                                  base.currencyCode,
                                  scope.target.defaultCurrencyCode,
                              )
                            : null,
                        currencyCode: scope.target.defaultCurrencyCode,
                    };
                });
            const grant = await this.connection.getRepository(ctx, ProductSalesAuthorization).findOne({
                where: { productId: product.id, channelId: scope.target.id },
            });
            const takeover =
                !history.some(binding => String(binding.sourceChannelId) === String(scope.source.id)) &&
                (Boolean(grant) ||
                    targetPrices.length > 0 ||
                    product.channels.some(c => String(c.id) === String(scope.target.id)));
            items.push({
                productId: String(product.id),
                name: product.translations[0]?.name ?? '未命名商品',
                takeover,
                blockers,
                pendingReasons: [
                    ...(delivery.pending ?? []),
                    ...(prices.some(p => p.price == null) ? ['来源售价或目标换算规则待配置'] : []),
                ],
                prices,
            });
            evidence.push({
                product: [product.id, product.updatedAt, product.enabled, owner?.ownerChannelId],
                variants: product.variants.map(v => [v.id, v.updatedAt, v.enabled, v.deletedAt]),
                sourcePrices: sourcePrices.map(p => [p.id, p.price, p.updatedAt]),
                targetPrices: targetPrices.map(p => [p.id, p.price, p.updatedAt]),
                grant,
                delivery: delivery.fingerprint,
            });
        }
        return {
            fingerprint: digest({
                input,
                categories: scope.categories.map(c => [c.id, c.updatedAt, c.parent?.id]),
                source: [scope.source.id, scope.source.updatedAt, scope.source.defaultCurrencyCode],
                target: [
                    scope.target.id,
                    scope.target.updatedAt,
                    scope.target.defaultCurrencyCode,
                    currency.cnyToMyrRate,
                    currency.currencyRateMode,
                    currency.currencyRoundingMode,
                    currency.currencyRateMarkupBps,
                ],
                evidence,
            }),
            productCount: items.length,
            categoryCount: scope.categories.length,
            takeoverCount: items.filter(i => i.takeover).length,
            items,
            blockers: [...new Set(items.flatMap(i => i.blockers))],
        };
    }

    async save(ctx: RequestContext, input: CatalogSyncInput) {
        this.governance.assertPlatform(ctx);
        if (!ctx.activeUserId) throw new UserInputError('需要已登录的平台管理员');
        await this.scope(ctx, input);
        const repo = this.connection.getRepository(ctx, CatalogSyncRule);
        const current = input.id ? await repo.findOne({ where: { id: input.id } }) : null;
        if (input.id && (!current || current.version !== input.version))
            throw new UserInputError('同步规则已变化，请刷新后重试');
        if (current?.enabled) throw new UserInputError('请先暂停规则再修改');
        if (
            current &&
            [
                ['sourceChannelId', input.sourceChannelId],
                ['sourceCollectionId', input.sourceCollectionId],
                ['targetChannelId', input.targetChannelId],
            ].some(([field, value]) => String(current[field as 'sourceChannelId']) !== String(value))
        )
            throw new UserInputError('来源和目标不能原地更换，请建立新的同步规则');
        const duplicate = await repo.findOne({
            where: {
                sourceChannelId: input.sourceChannelId,
                sourceCollectionId: input.sourceCollectionId,
                targetChannelId: input.targetChannelId,
            },
        });
        if (duplicate && String(duplicate.id) !== String(input.id))
            throw new UserInputError('此分类到目标店铺的规则已存在');
        const values = {
            sourceChannelId: input.sourceChannelId,
            sourceCollectionId: input.sourceCollectionId,
            targetChannelId: input.targetChannelId,
            includeDescendants: input.includeDescendants,
            actorUserId: ctx.activeUserId,
            version: (current?.version ?? 0) + 1,
            enabled: false,
            state: 'DISABLED',
            cursor: 0,
            error: null,
            takeoverConfirmed: false,
        } as const;
        if (current) {
            const result = await repo.update(
                { id: current.id, version: input.version, enabled: false },
                values,
            );
            if (result.affected !== 1) throw new UserInputError('同步规则已变化，请刷新后重试');
            return repo.findOneByOrFail({ id: current.id });
        }
        return repo.save(new CatalogSyncRule(values));
    }

    async enable(ctx: RequestContext, id: ID, version: number, fingerprint: string, takeover: boolean) {
        this.governance.assertPlatform(ctx);
        const rule = await this.connection.getRepository(ctx, CatalogSyncRule).findOneByOrFail({ id });
        if (rule.version !== version) throw new UserInputError('同步规则已变化，请重新预览');
        const preview = await this.preview(ctx, this.input(rule));
        if (preview.fingerprint !== fingerprint) throw new UserInputError('来源或目标配置已变化，请重新预览');
        if (preview.blockers.length) throw new UserInputError(preview.blockers.join('；'));
        if (preview.takeoverCount && !takeover) throw new UserInputError('请先确认预览中的已有经营配置接管');
        const actorUserId = ctx.activeUserId;
        if (actorUserId == null) throw new UserInputError('请使用平台商品管理账号启用同步');
        const result = await this.connection.getRepository(ctx, CatalogSyncRule).update(
            { id, version },
            {
                enabled: true,
                takeoverConfirmed: takeover,
                version: version + 1,
                state: 'QUEUED',
                cursor: 0,
                actorUserId,
                error: null,
            },
        );
        if (result.affected !== 1) throw new UserInputError('同步规则已变化，请刷新');
        await this.request(ctx, id);
        return this.connection.getRepository(ctx, CatalogSyncRule).findOneByOrFail({ id });
    }

    async pause(ctx: RequestContext, id: ID, version: number) {
        this.governance.assertPlatform(ctx);
        const result = await this.connection.getRepository(ctx, CatalogSyncRule).update(
            { id, version },
            {
                enabled: false,
                version: version + 1,
                state: 'DISABLED',
                leaseUntil: null,
                leaseToken: null,
            },
        );
        if (result.affected !== 1) throw new UserInputError('同步规则已变化，请刷新');
        await this.events.publish(new StorefrontDataChangedEvent(ctx, ['catalog']));
        return this.connection.getRepository(ctx, CatalogSyncRule).findOneByOrFail({ id });
    }

    input(rule: CatalogSyncRule): CatalogSyncInput {
        return {
            id: rule.id,
            version: rule.version,
            sourceChannelId: rule.sourceChannelId,
            sourceCollectionId: rule.sourceCollectionId,
            targetChannelId: rule.targetChannelId,
            includeDescendants: rule.includeDescendants,
        };
    }
    async request(ctx: RequestContext, id: ID) {
        this.governance.assertPlatform(ctx);
        const repo = this.connection.getRepository(ctx, CatalogSyncRule);
        const rule = await repo.findOneByOrFail({ id });
        if (!rule.enabled) throw new UserInputError('规则已暂停');
        await repo.increment({ id }, 'generation', 1);
        await this.enqueue?.(id);
        return repo.findOneByOrFail({ id });
    }

    async reconcile(ctx: RequestContext, ruleId: ID, leaseToken?: string): Promise<boolean> {
        this.governance.assertPlatform(ctx);
        let rule = await this.connection.getRepository(ctx, CatalogSyncRule).findOneByOrFail({ id: ruleId });
        if (!rule.enabled) return false;
        const scope = await this.scope(ctx, this.input(rule), { after: rule.cursor, take: 100 });
        // A bounded page per job. Re-read the current desired state, never replay stale payloads.
        const page = scope.products;
        // Freeze the event watermark for the whole scan, including all later pages.
        // Events received after page one require another scan from cursor zero.
        const generation = rule.cursor ? rule.runGeneration : rule.generation;
        await this.connection
            .getRepository(ctx, CatalogSyncRule)
            .update(rule.id, { state: 'RUNNING', runGeneration: generation });
        for (const product of page) {
            try {
                await this.connection.withTransaction(ctx, async tx => {
                    const channelLock = this.connection
                        .getRepository(tx, Channel)
                        .createQueryBuilder('target')
                        .where('target.id = :id', { id: rule.targetChannelId });
                    if (
                        !['sqljs', 'sqlite', 'better-sqlite3'].includes(
                            this.connection.rawConnection.options.type,
                        )
                    )
                        channelLock.setLock('pessimistic_write');
                    await channelLock.getOneOrFail();
                    const current = await this.connection
                        .getRepository(tx, CatalogSyncRule)
                        .findOneByOrFail({ id: rule.id });
                    if (
                        !current.enabled ||
                        current.version !== rule.version ||
                        (leaseToken && current.leaseToken !== leaseToken)
                    )
                        return;
                    if (leaseToken)
                        await this.connection
                            .getRepository(tx, CatalogSyncRule)
                            .update(
                                { id: current.id, leaseToken },
                                { leaseUntil: new Date(Date.now() + 60_000) },
                            );
                    await this.synchronizeProduct(tx, current, product, scope.source, scope.target);
                });
            } catch (error) {
                await this.binding(
                    ctx,
                    rule,
                    'PRODUCT',
                    product.id,
                    product.id,
                    'ERROR',
                    error instanceof UserInputError ? error.message : '同步失败，请重试并检查服务日志',
                );
            }
        }
        const cursor = page.length ? Number(page[page.length - 1].id) : rule.cursor;
        if (page.length === 100) {
            await this.connection
                .getRepository(ctx, CatalogSyncRule)
                .update(
                    { id: rule.id, version: rule.version, ...(leaseToken ? { leaseToken } : {}) },
                    { cursor },
                );
            return true;
        }
        rule = await this.connection.getRepository(ctx, CatalogSyncRule).findOneByOrFail({ id: rule.id });
        if (!rule.enabled || (leaseToken && rule.leaseToken !== leaseToken)) return false;
        let completed = false;
        let more = false;
        await this.connection.withTransaction(ctx, async tx => {
            const lock = this.connection
                .getRepository(tx, Channel)
                .createQueryBuilder('target')
                .where('target.id = :id', { id: rule.targetChannelId });
            if (!['sqljs', 'sqlite', 'better-sqlite3'].includes(this.connection.rawConnection.options.type))
                lock.setLock('pessimistic_write');
            await lock.getOneOrFail();
            const current = await this.connection
                .getRepository(tx, CatalogSyncRule)
                .findOneByOrFail({ id: rule.id });
            if (
                !current.enabled ||
                current.version !== rule.version ||
                (leaseToken && current.leaseToken !== leaseToken)
            )
                return;
            await this.synchronizeCategories(tx, current, scope);
            const existing = await this.connection
                .getRepository(tx, CatalogSyncBinding)
                .find({ where: { ruleId, kind: 'PRODUCT', state: Not('REMOVED') } });
            const desired = new Set(scope.productIds);
            for (const removed of existing.filter(b => !desired.has(String(b.sourceId))))
                await this.removeProduct(tx, current, removed);
            const errors = await this.connection
                .getRepository(tx, CatalogSyncBinding)
                .count({ where: { ruleId, error: Not(IsNull()) } });
            await this.connection.getRepository(tx, CatalogSyncRule).update(
                { id: current.id, version: current.version, ...(leaseToken ? { leaseToken } : {}) },
                {
                    cursor: 0,
                    state: errors ? 'PARTIAL' : 'COMPLETE',
                    completedGeneration: generation,
                    lastSyncedAt: new Date(),
                    error: errors ? `${errors} 项尚未完成，请查看逐项原因` : null,
                },
            );
            completed = true;
            more = current.generation !== generation;
        });
        if (completed)
            await this.events.publish(
                new StorefrontDataChangedEvent(ctx, ['catalog'], { channelIds: [rule.targetChannelId] }),
            );
        return more;
    }

    private async synchronizeProduct(
        ctx: RequestContext,
        rule: CatalogSyncRule,
        product: Product,
        source: Channel,
        target: Channel,
    ) {
        const owner = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .findOne({ where: { resourceType: 'Product', resourceId: product.id } });
        if (!owner || String(owner.ownerChannelId) !== String(source.id))
            throw new UserInputError('商品维护归属不是来源店铺');
        if (!this.adapter) throw new UserInputError('供货组件尚未就绪');
        const inspection = await this.adapter.inspect(ctx, source, target, product);
        if (inspection.blockers.length) throw new UserInputError(inspection.blockers.join('；'));
        const history = await this.connection.getRepository(ctx, CatalogSyncBinding).find({
            where: { kind: 'PRODUCT', sourceId: product.id, targetChannelId: target.id },
            order: { id: 'ASC' },
        });
        const existing = history.filter(binding => binding.state !== 'REMOVED');
        const managedBefore = history.some(binding => String(binding.sourceChannelId) === String(source.id));
        if (existing.some(b => String(b.sourceChannelId) !== String(source.id)))
            throw new UserInputError('商品已有其他供货来源');
        const grantRepo = this.connection.getRepository(ctx, ProductSalesAuthorization);
        const previous = await grantRepo.findOne({ where: { productId: product.id, channelId: target.id } });
        const baselinePrices = !managedBefore
            ? await this.connection.getRepository(ctx, ProductVariantPrice).find({
                  where: { variant: { productId: product.id }, channelId: target.id },
                  relations: ['variant'],
              })
            : [];
        if (
            !managedBefore &&
            product.channels.some(c => String(c.id) === String(target.id)) &&
            !rule.takeoverConfirmed
        )
            throw new UserInputError('新增商品在目标店铺已有独立配置，需要平台重新预览接管');
        const sourceCtx = ctx.copy({ channel: source, currencyCode: source.defaultCurrencyCode });
        const targetCtx = ctx.copy({ channel: target, currencyCode: target.defaultCurrencyCode });
        const variants = product.variants.filter(v => !v.deletedAt);
        const sourcePrices = await this.connection.getRepository(ctx, ProductVariantPrice).find({
            where: {
                variant: { productId: product.id },
                channelId: source.id,
                currencyCode: source.defaultCurrencyCode,
            },
            relations: ['variant'],
            order: { id: 'ASC' },
        });
        const sourceOffer = await grantRepo.findOne({
            where: { productId: product.id, channelId: source.id },
        });
        const fingerprint = digest({
            version: rule.version,
            product: [product.id, product.updatedAt, product.enabled],
            variants: variants.map(v => [v.id, v.updatedAt, v.enabled]),
            prices: sourcePrices.map(p => [p.variant.id, p.price]),
            offer: sourceOffer,
            converted: sourcePrices.map(p => [
                p.variant.id,
                convertSyncedCatalogAmount(targetCtx, p.price, p.currencyCode, target.defaultCurrencyCode),
            ]),
            source: [source.updatedAt, source.defaultCurrencyCode],
            target: [target.updatedAt, target.customFields],
            delivery: inspection.fingerprint,
        });
        const own = history.find(binding => String(binding.ruleId) === String(rule.id));
        if (
            own?.state === 'ACTIVE' &&
            own.fingerprint === fingerprint &&
            !own.error &&
            previous?.state === 'ACTIVE'
        ) {
            const projected = await this.connection.getRepository(ctx, ProductVariantPrice).find({
                where: {
                    variant: { productId: product.id },
                    channelId: target.id,
                    currencyCode: target.defaultCurrencyCode,
                },
                relations: ['variant'],
            });
            const assigned = await this.connection
                .getRepository(ctx, ProductVariant)
                .count({ where: { id: In(variants.map(v => v.id)), channels: { id: target.id } } });
            if (
                assigned === variants.length &&
                variants.every(variant => {
                    const base = sourcePrices.find(price => String(price.variant.id) === String(variant.id));
                    const expected = base
                        ? convertSyncedCatalogAmount(
                              targetCtx,
                              base.price,
                              base.currencyCode,
                              target.defaultCurrencyCode,
                          )
                        : null;
                    return (
                        expected != null &&
                        projected.some(
                            price =>
                                String(price.variant.id) === String(variant.id) && price.price === expected,
                        )
                    );
                })
            )
                return;
        }
        // A content edit can add assets/options without adding a new variant.
        await this.assignProduct(ctx, product.id, target.id);
        const pending: string[] = [];
        const prices = this.connection.getRepository(ctx, ProductVariantPrice);
        for (const variant of variants) {
            const base = sourcePrices.find(price => String(price.variant.id) === String(variant.id));
            const amount = base
                ? convertSyncedCatalogAmount(
                      targetCtx,
                      base.price,
                      base.currencyCode,
                      target.defaultCurrencyCode,
                  )
                : null;
            if (amount == null) {
                pending.push(String(variant.id));
                continue;
            }
            const old = await prices.findOne({
                where: {
                    variant: { id: variant.id },
                    channelId: target.id,
                    currencyCode: target.defaultCurrencyCode,
                },
            });
            if (!old || old.price !== amount) {
                const saved = await prices.save(
                    new ProductVariantPrice({
                        ...old,
                        variant: { id: variant.id },
                        channelId: target.id,
                        currencyCode: target.defaultCurrencyCode,
                        price: amount,
                    }),
                );
                await this.events.publish(
                    new ProductVariantPriceEvent(targetCtx, [saved], old ? 'updated' : 'created'),
                );
            }
        }
        if (inspection.pending?.length) pending.push(...variants.map(v => String(v.id)));
        const state =
            !product.enabled || (sourceOffer && sourceOffer.state !== 'ACTIVE')
                ? 'PAUSED'
                : pending.length
                  ? 'PENDING'
                  : 'ACTIVE';
        await grantRepo.save(
            new ProductSalesAuthorization({
                ...previous,
                productId: product.id,
                channelId: target.id,
                sourceChannelId: source.id,
                variantIds: variants.map(v => String(v.id)),
                pendingVariantIds: pending,
                state,
                version: (previous?.version ?? 0) + 1,
            }),
        );
        await this.adapter.prepare(ctx, rule, product);
        const productBinding = await this.binding(
            ctx,
            rule,
            'PRODUCT',
            product.id,
            product.id,
            'ACTIVE',
            [...(inspection.pending ?? []), ...(pending.length ? ['来源经营配置或目标汇率待补齐'] : [])].join(
                '；',
            ) || null,
        );
        productBinding.fingerprint = fingerprint;
        if (!managedBefore) {
            productBinding.baseline = {
                grant: previous
                    ? {
                          state: previous.state,
                          sourceChannelId: previous.sourceChannelId,
                          variantIds: previous.variantIds,
                          pendingVariantIds: previous.pendingVariantIds,
                      }
                    : null,
                prices: baselinePrices.map(price => ({
                    variantId: String(price.variant.id),
                    price: price.price,
                    currencyCode: price.currencyCode,
                })),
            };
        }
        await this.connection.getRepository(ctx, CatalogSyncBinding).save(productBinding);
    }

    private async assignProduct(ctx: RequestContext, productId: ID, targetChannelId: ID) {
        // Called only after platform capability, direct ownership and target scope checks.
        // Unlike the general catalog API this never seeds target stock or guesses a target price.
        const product = await this.connection.getRepository(ctx, Product).findOneOrFail({
            where: { id: productId },
            relations: [
                'assets',
                'featuredAsset',
                'optionGroups',
                'optionGroups.options',
                'facetValues',
                'facetValues.facet',
                'variants',
                'variants.assets',
                'variants.featuredAsset',
                'variants.facetValues',
                'variants.facetValues.facet',
            ],
            loadEagerRelations: false,
        });
        await this.channels.assignToChannels(ctx, Product, product.id, [targetChannelId]);
        for (const variant of product.variants.filter(v => !v.deletedAt)) {
            await this.channels.assignToChannels(ctx, ProductVariant, variant.id, [targetChannelId]);
            await this.events.publish(
                new ProductVariantChannelEvent(ctx, variant, targetChannelId, 'assigned'),
            );
        }
        const assets = new Set<ID>(
            [
                product.featuredAsset?.id,
                ...product.assets.map(a => a.assetId),
                ...product.variants.flatMap(v => [v.featuredAsset?.id, ...v.assets.map(a => a.assetId)]),
            ].filter((id): id is ID => id != null),
        );
        for (const assetId of assets)
            await this.channels.assignToChannels(ctx, Asset, assetId, [targetChannelId]);
        for (const group of product.optionGroups) {
            await this.channels.assignToChannels(ctx, ProductOptionGroup, group.id, [targetChannelId]);
            for (const option of group.options)
                await this.channels.assignToChannels(ctx, ProductOption, option.id, [targetChannelId]);
        }
        for (const value of [...product.facetValues, ...product.variants.flatMap(v => v.facetValues)]) {
            await this.channels.assignToChannels(ctx, FacetValue, value.id, [targetChannelId]);
            await this.channels.assignToChannels(ctx, Facet, value.facet.id, [targetChannelId]);
        }
        await this.events.publish(new ProductChannelEvent(ctx, product, targetChannelId, 'assigned'));
    }

    private async synchronizeCategories(
        ctx: RequestContext,
        rule: CatalogSyncRule,
        scope: Awaited<ReturnType<CatalogSyncService['scope']>>,
    ) {
        const targetCtx = ctx.copy({ channel: scope.target, currencyCode: scope.target.defaultCurrencyCode });
        const mappings = await this.connection.getRepository(ctx, CatalogSyncBinding).find({
            where: {
                kind: 'COLLECTION',
                sourceChannelId: rule.sourceChannelId,
                targetChannelId: rule.targetChannelId,
                state: Not('REMOVED'),
            },
        });
        for (const source of scope.categories) {
            let mapping = mappings.find(b => String(b.sourceId) === String(source.id));
            const parent = mappings.find(b => String(b.sourceId) === String(source.parent?.id));
            const ids = [...new Set(scope.variants.map(v => String(v.id)))];
            // Use explicit membership; never execute another store's arbitrary collection filters.
            const members = await this.connection
                .getRepository(ctx, ProductVariant)
                .createQueryBuilder('v')
                .innerJoin('v.collections', 'c', 'c.id = :id', { id: source.id })
                .where('v.deletedAt IS NULL')
                .getMany();
            const allowedProducts = await this.connection
                .getRepository(ctx, CatalogSyncBinding)
                .find({ where: { ruleId: rule.id, kind: 'PRODUCT', state: 'ACTIVE' } });
            const variantIds = members
                .filter(
                    v =>
                        ids.includes(String(v.id)) &&
                        allowedProducts.some(b => String(b.sourceId) === String(v.productId)),
                )
                .map(v => String(v.id));
            const assetIds = [
                ...new Set(
                    [source.featuredAsset?.id, ...source.assets.map(a => a.assetId)].filter(
                        (id): id is ID => id != null,
                    ),
                ),
            ];
            for (const assetId of assetIds)
                await this.channels.assignToChannels(ctx, Asset, assetId, [scope.target.id]);
            const input = {
                isPrivate: source.isPrivate,
                inheritFilters: false,
                ...(parent ? { parentId: parent.targetId } : {}),
                featuredAssetId: source.featuredAsset?.id ?? null,
                assetIds,
                translations: source.translations
                    .filter(t =>
                        (scope.target.availableLanguageCodes ?? [scope.target.defaultLanguageCode]).includes(
                            t.languageCode,
                        ),
                    )
                    .map(t => ({
                        languageCode: t.languageCode,
                        name: t.name,
                        description: t.description,
                        slug: `${t.slug.slice(0, 180)}-sync-${rule.sourceChannelId}-${source.id}`,
                    })),
                filters: [
                    {
                        code: 'catalog-sync-collection-filter',
                        arguments: [
                            { name: 'sourceCollectionId', value: String(source.id) },
                            { name: 'sourceChannelId', value: String(rule.sourceChannelId) },
                            { name: 'targetChannelId', value: String(rule.targetChannelId) },
                        ],
                    },
                ],
            };
            const fingerprint = digest({ input, members: variantIds });
            if (mapping && !parent) {
                const current = await this.connection
                    .getRepository(ctx, Collection)
                    .findOneByOrFail({ id: mapping.targetId });
                const root = await this.connection
                    .getRepository(ctx, Collection)
                    .findOneByOrFail({ isRoot: true });
                if (String(current.parentId) !== String(root.id))
                    await this.collections.move(targetCtx, {
                        collectionId: current.id,
                        parentId: root.id,
                        index: source.position,
                    });
            }
            const target = mapping
                ? mapping.fingerprint === fingerprint
                    ? { id: mapping.targetId }
                    : await this.collections.update(targetCtx, { id: mapping.targetId, ...input })
                : await this.collections.create(targetCtx, input);
            mapping = await this.binding(ctx, rule, 'COLLECTION', source.id, target.id, 'ACTIVE');
            mapping.fingerprint = fingerprint;
            await this.connection.getRepository(ctx, CatalogSyncBinding).save(mapping);
            if (!mappings.some(b => String(b.sourceId) === String(source.id))) mappings.push(mapping);
        }
        const removed = await this.connection
            .getRepository(ctx, CatalogSyncBinding)
            .find({ where: { ruleId: rule.id, kind: 'COLLECTION', state: Not('REMOVED') } });
        for (const old of removed.filter(
            b => !scope.categories.some(c => String(c.id) === String(b.sourceId)),
        )) {
            old.state = 'REMOVED';
            await this.connection.getRepository(ctx, CatalogSyncBinding).save(old);
            const refs = await this.connection.getRepository(ctx, CatalogSyncBinding).count({
                where: {
                    kind: 'COLLECTION',
                    targetId: old.targetId,
                    state: 'ACTIVE',
                    ruleId: Not(rule.id),
                },
            });
            if (!refs) await this.collections.update(targetCtx, { id: old.targetId, isPrivate: true });
        }
    }

    private async removeProduct(ctx: RequestContext, rule: CatalogSyncRule, binding: CatalogSyncBinding) {
        binding.state = 'REMOVED';
        await this.connection.getRepository(ctx, CatalogSyncBinding).save(binding);
        const refs = await this.connection.getRepository(ctx, CatalogSyncBinding).find({
            where: {
                targetId: binding.targetId,
                targetChannelId: rule.targetChannelId,
                kind: 'PRODUCT',
                state: 'ACTIVE',
            },
        });
        const enabled = refs.length
            ? await this.connection
                  .getRepository(ctx, CatalogSyncRule)
                  .count({ where: { id: In(refs.map(r => r.ruleId)), enabled: true } })
            : 0;
        if (!enabled) {
            const grant = await this.connection
                .getRepository(ctx, ProductSalesAuthorization)
                .findOne({ where: { productId: binding.targetId, channelId: rule.targetChannelId } });
            const history = await this.connection.getRepository(ctx, CatalogSyncBinding).find({
                where: {
                    kind: 'PRODUCT',
                    targetId: binding.targetId,
                    targetChannelId: rule.targetChannelId,
                },
                order: { id: 'ASC' },
            });
            const baseline = history.find(item => item.baseline)?.baseline;
            if (grant)
                await this.connection.getRepository(ctx, ProductSalesAuthorization).save(
                    new ProductSalesAuthorization({
                        ...grant,
                        ...(baseline?.grant as Partial<ProductSalesAuthorization> | undefined),
                        state: baseline?.grant
                            ? (baseline.grant as ProductSalesAuthorization).state
                            : 'REVOKED',
                        version: grant.version + 1,
                    }),
                );
            const prices = baseline?.prices as
                | Array<{ variantId: ID; price: number; currencyCode: ProductVariantPrice['currencyCode'] }>
                | undefined;
            for (const price of prices ?? []) {
                const repo = this.connection.getRepository(ctx, ProductVariantPrice);
                const previous = await repo.findOne({
                    where: {
                        channelId: rule.targetChannelId,
                        variant: { id: price.variantId },
                        currencyCode: price.currencyCode,
                    },
                });
                await repo.save(
                    new ProductVariantPrice({
                        ...previous,
                        variant: { id: price.variantId },
                        channelId: rule.targetChannelId,
                        currencyCode: price.currencyCode,
                        price: price.price,
                    }),
                );
            }
        }
    }

    private async binding(
        ctx: RequestContext,
        rule: CatalogSyncRule,
        kind: CatalogSyncBinding['kind'],
        sourceId: ID,
        targetId: ID,
        state: CatalogSyncBinding['state'],
        error: string | null = null,
    ) {
        const repo = this.connection.getRepository(ctx, CatalogSyncBinding);
        const previous = await repo.findOne({ where: { ruleId: rule.id, kind, sourceId } });
        return repo.save(
            new CatalogSyncBinding({
                ...previous,
                ruleId: rule.id,
                sourceChannelId: rule.sourceChannelId,
                targetChannelId: rule.targetChannelId,
                kind,
                sourceId,
                targetId,
                state,
                error,
            }),
        );
    }
}
