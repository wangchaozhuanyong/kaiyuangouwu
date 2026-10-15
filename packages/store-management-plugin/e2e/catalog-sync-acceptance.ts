import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    CatalogSupplySnapshot,
    CatalogSyncBinding,
    CatalogSyncRule,
    Channel,
    ChannelService,
    Collection,
    CollectionService,
    CurrencyCode,
    EventBus,
    LanguageCode,
    Order,
    OrderLine,
    Payment,
    Product,
    ProductOptionGroupService,
    ProductOptionService,
    ProductSalesAuthorization,
    ProductService,
    ProductVariant,
    ProductVariantPrice,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { In } from 'typeorm';
import { beforeAll, describe, expect, it } from 'vitest';

import { catalogSyncCollectionFilter } from '../../catalog-management-plugin/src/catalog-sync-collection-filter';
import { CatalogSyncQueueService } from '../../catalog-management-plugin/src/catalog-sync-queue.service';
import { CatalogSyncService } from '../../catalog-management-plugin/src/catalog-sync.service';
import { AutoCardService } from '../../commerce-fulfillment-plugin/src/auto-card.service';
import { DigitalProductService } from '../../commerce-fulfillment-plugin/src/digital-product.service';
import { AutoCardConfig } from '../../commerce-fulfillment-plugin/src/entities/auto-card-config.entity';
import { AutoCardDelivery } from '../../commerce-fulfillment-plugin/src/entities/auto-card-delivery.entity';
import { DigitalVariantConfig } from '../../commerce-fulfillment-plugin/src/entities/digital-product.entity';
import { CatalogSyncSourceService } from '../src/catalog-sync-source.service';
import { StorefrontDataChangedEvent } from '../src/realtime/storefront-data-changed.event';

import { registerCatalogSyncCloseoutAcceptance } from './catalog-sync-closeout-acceptance';
import { addSyntheticCollectionMembers, requireSyntheticFixture } from './catalog-sync-fixture-links';
import { registerCatalogSyncPhysicalAcceptance } from './catalog-sync-physical-acceptance';
import { registerCatalogSyncScaleAcceptance } from './catalog-sync-scale-acceptance';

interface Fixture {
    server: { app: { get<T>(token: new (...args: any[]) => T): T } };
    connection: TransactionalConnection;
    platform: RequestContext;
    a: RequestContext;
    b: RequestContext;
}

export function registerCatalogSyncAcceptance(fixture: () => Fixture) {
    describe('catalog continuous sync', () => {
        let f: Fixture;
        let sync: CatalogSyncService;
        let sources: CatalogSyncSourceService;
        let a: RequestContext;
        let b: RequestContext;
        let category: Collection;
        let child: Collection;
        let rule: CatalogSyncRule;
        let quotaLineId: string;
        const products: Array<{ id: string; variantId: string }> = [];
        const input = () => ({
            sourceChannelId: a.channelId,
            sourceCollectionId: category.id,
            targetChannelId: b.channelId,
            includeDescendants: true,
        });
        const drain = async (id = rule.id) => {
            const requested = await sync.request(f.platform, id);
            const deadline = Date.now() + 120_000;
            while (Date.now() < deadline) {
                const current = await f.connection.rawConnection
                    .getRepository(CatalogSyncRule)
                    .findOneByOrFail({ id });
                if (!current.enabled)
                    throw new Error(`Synchronization Worker failed: ${current.error ?? current.state}`);
                if (
                    ['COMPLETE', 'PARTIAL'].includes(current.state) &&
                    current.completedGeneration >= requested.generation
                )
                    return;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error('Synchronization Worker did not converge');
        };
        const makeProduct = async (suffix: string, includeInScope = true) => {
            const product = await f.server.app.get(ProductService).create(a, {
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: `Sync ${suffix}`,
                    slug: `sync-${suffix}`,
                    description: 'Synthetic local fixture',
                })),
                customFields: { fulfillmentType: 'digital' },
            });
            const [variant] = await f.server.app.get(ProductVariantService).create(a, [
                {
                    productId: product.id,
                    sku: `SYNC-${suffix}`,
                    price: 1000,
                    trackInventory: GlobalFlag.FALSE,
                    customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'manual_service' },
                    translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                        languageCode,
                        name: `Sync ${suffix}`,
                    })),
                },
            ]);
            await f.server.app.get(DigitalProductService).initialize(a, variant);
            const item = { id: String(product.id), variantId: String(variant.id) };
            if (!includeInScope) return item;
            products.push(item);
            await f.connection.rawConnection.getRepository(Collection).update(child.id, {
                filters: [
                    {
                        code: 'variant-id-filter',
                        args: [
                            { name: 'variantIds', value: JSON.stringify(products.map(p => p.variantId)) },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
            });
            await addSyntheticCollectionMembers(f.connection, child.id, [variant.id]);
            return item;
        };
        beforeAll(async () => {
            f = fixture();
            sync = f.server.app.get(CatalogSyncService);
            sources = f.server.app.get(CatalogSyncSourceService);
            const repo = f.connection.rawConnection.getRepository(Channel);
            const source = await repo.findOneByOrFail({ id: f.a.channelId });
            const target = await repo.findOneByOrFail({ id: f.b.channelId });
            source.defaultCurrencyCode = CurrencyCode.CNY;
            source.availableCurrencyCodes = [CurrencyCode.CNY, CurrencyCode.MYR];
            target.defaultCurrencyCode = CurrencyCode.MYR;
            target.availableCurrencyCodes = [CurrencyCode.CNY, CurrencyCode.MYR];
            source.availableLanguageCodes = target.availableLanguageCodes = [
                LanguageCode.en,
                LanguageCode.zh_Hans,
            ];
            source.customFields = { ...source.customFields, commerceMode: 'HYBRID', cnyToMyrRate: 0.6 };
            target.customFields = {
                ...target.customFields,
                commerceMode: 'HYBRID',
                cnyToMyrRate: 0.6,
                currencyRateMode: 'MANUAL',
                currencyRateMarkupBps: 0,
                currencyRoundingMode: 'CENT',
            };
            await repo.save([source, target]);
            a = f.a.copy({ channel: source, currencyCode: CurrencyCode.CNY });
            b = f.b.copy({ channel: target, currencyCode: CurrencyCode.MYR });
            category = await f.server.app.get(CollectionService).create(a, {
                inheritFilters: false,
                filters: [
                    {
                        code: 'variant-id-filter',
                        arguments: [
                            { name: 'variantIds', value: '[]' },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: 'Continuous source',
                    slug: 'continuous-source',
                    description: 'Synthetic source category',
                })),
            });
            child = await f.server.app.get(CollectionService).create(a, {
                parentId: category.id,
                inheritFilters: false,
                filters: [
                    {
                        code: 'variant-id-filter',
                        arguments: [
                            { name: 'variantIds', value: '[]' },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: 'Continuous child',
                    slug: 'continuous-child',
                    description: 'Synthetic child category',
                })),
            });
            for (let i = 0; i < 102; i++) await makeProduct(String(i));
        }, 120_000);

        it('saves disabled rules and requires an unchanged preview before enabling', async () => {
            rule = await sync.save(f.platform, input());
            expect(rule.enabled).toBe(false);
            await expect(sync.enable(f.platform, rule.id, rule.version, 'stale', false)).rejects.toThrow(
                '重新预览',
            );
            const preview = await sync.preview(f.platform, sync.input(rule));
            expect(preview.productCount).toBe(102);
            expect(preview.categoryCount).toBe(2);
            expect(preview.blockers).toEqual([]);
            const sourceRow = await f.connection.rawConnection
                .getRepository(Channel)
                .findOneByOrFail({ id: a.channelId });
            const targetRow = await f.connection.rawConnection
                .getRepository(Channel)
                .findOneByOrFail({ id: b.channelId });
            const priceRows = await f.connection.rawConnection
                .getRepository(ProductVariantPrice)
                .find({ where: { variant: { id: products[0].variantId } } });
            expect(
                preview.items[0].prices[0].price,
                JSON.stringify({
                    sourceCurrency: sourceRow.defaultCurrencyCode,
                    targetCurrency: targetRow.defaultCurrencyCode,
                    rate: targetRow.customFields.cnyToMyrRate,
                    prices: priceRows.map(p => ({
                        price: p.price,
                        currency: p.currencyCode,
                        channelId: p.channelId,
                    })),
                }),
            ).toBe(600);
            rule = await sync.enable(f.platform, rule.id, rule.version, preview.fingerprint, false);
        }, 120_000);

        it('processes all pages and mirrors a separate category tree without duplicating products', async () => {
            await drain();
            const bindings = await f.connection.rawConnection
                .getRepository(CatalogSyncBinding)
                .find({ where: { ruleId: rule.id } });
            expect(bindings.filter(x => x.kind === 'PRODUCT' && x.state === 'ACTIVE')).toHaveLength(102);
            const categories = bindings.filter(x => x.kind === 'COLLECTION');
            expect(categories).toHaveLength(2);
            expect(categories.every(x => String(x.sourceId) !== String(x.targetId))).toBe(true);
            const copiedChild = await f.connection.rawConnection.getRepository(Collection).findOneOrFail({
                where: {
                    id: requireSyntheticFixture(categories.find(x => String(x.sourceId) === String(child.id)))
                        .targetId,
                },
                relations: ['parent'],
            });
            expect(String(copiedChild.parent.id)).toBe(
                String(
                    requireSyntheticFixture(categories.find(x => String(x.sourceId) === String(category.id)))
                        .targetId,
                ),
            );
            expect(JSON.stringify(copiedChild.filters).length).toBeLessThan(1000);
            expect(
                await catalogSyncCollectionFilter
                    .apply(
                        f.connection.rawConnection
                            .getRepository(ProductVariant)
                            .createQueryBuilder('productVariant'),
                        copiedChild.filters[0].args,
                    )
                    .getCount(),
            ).toBe(102);
            expect(
                await f.connection.rawConnection.getRepository(ProductSalesAuthorization).count({
                    where: {
                        channelId: b.channelId,
                        sourceChannelId: a.channelId,
                        productId: In(products.map(product => product.id)),
                    },
                }),
            ).toBe(102);
            await expect(sources.assertEditable(b, products[0].id)).rejects.toThrow('来源店铺');
        }, 120_000);

        it('includes a newly added product and updates existing prices idempotently', async () => {
            const added = await makeProduct('new');
            await f.connection.rawConnection
                .getRepository(ProductVariantPrice)
                .update({ channelId: a.channelId, variant: { id: products[0].variantId } }, { price: 1234 });
            await drain();
            expect(
                await f.connection.rawConnection.getRepository(ProductSalesAuthorization).count({
                    where: {
                        channelId: b.channelId,
                        sourceChannelId: a.channelId,
                        productId: In(products.map(product => product.id)),
                    },
                }),
            ).toBe(103);
            const price = await f.connection.rawConnection.getRepository(ProductVariantPrice).findOneOrFail({
                where: {
                    channelId: b.channelId,
                    variant: { id: products[0].variantId },
                    currencyCode: CurrencyCode.MYR,
                },
            });
            expect(price.price).toBe(740);
            await drain();
            expect(
                await f.connection.rawConnection
                    .getRepository(CatalogSyncBinding)
                    .count({ where: { ruleId: rule.id, kind: 'PRODUCT', targetId: added.id } }),
            ).toBe(1);
        }, 120_000);

        it('measures committed-event delivery and repairs missed-event projection drift through the reconciliation scan', async () => {
            const prices = f.connection.rawConnection.getRepository(ProductVariantPrice);
            const waitForPrice = async (amount: number) => {
                const deadline = Date.now() + 60_000;
                while (Date.now() < deadline) {
                    const price = await prices.findOne({
                        where: {
                            channelId: b.channelId,
                            variant: { id: products[0].variantId },
                            currencyCode: CurrencyCode.MYR,
                        },
                    });
                    const current = await f.connection.rawConnection
                        .getRepository(CatalogSyncRule)
                        .findOneByOrFail({ id: rule.id });
                    if (
                        price?.price === amount &&
                        current.state === 'COMPLETE' &&
                        current.completedGeneration >= current.generation
                    )
                        return;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                throw new Error('Committed change did not synchronize within 60 seconds');
            };
            await prices.update(
                { channelId: a.channelId, variant: { id: products[0].variantId } },
                { price: 1400 },
            );
            const started = performance.now();
            await f.server.app.get(EventBus).publish(new StorefrontDataChangedEvent(a, ['catalog']));
            await waitForPrice(840);
            const eventMs = performance.now() - started;
            // Deliberately omit the source event and damage one synthetic target projection.
            await prices.update(
                { channelId: a.channelId, variant: { id: products[0].variantId } },
                { price: 1234 },
            );
            await prices.update(
                { channelId: b.channelId, variant: { id: products[0].variantId } },
                { price: 1 },
            );
            const scanStarted = performance.now();
            await f.server.app.get(CatalogSyncQueueService).scan();
            await waitForPrice(740);
            await writeFile(
                resolvePath(
                    __dirname,
                    `../../../docs/local-validation/catalog-continuous-sync-20261015/event-latency-${f.connection.rawConnection.options.type}.json`,
                ),
                JSON.stringify(
                    {
                        environment: f.connection.rawConnection.options.type,
                        synthetic: true,
                        eventMs,
                        reconciliationAfterEnqueueMs: performance.now() - scanStarted,
                        scheduledIntervalSeconds: 300,
                    },
                    null,
                    2,
                ),
            );
        }, 120_000);

        it('reserves and releases the original digital quota while keeping the selling-store reservation', async () => {
            const digital = f.server.app.get(DigitalProductService);
            const variant = await f.connection.rawConnection
                .getRepository(ProductVariant)
                .findOneOrFail({ where: { id: products[0].variantId }, relations: ['product'] });
            const config = await digital.config(a, variant.id);
            expect(config).toBeTruthy();
            await f.connection.rawConnection
                .getRepository(DigitalVariantConfig)
                .update(requireSyntheticFixture(config).id, { stockPolicy: 'limited', availableQuantity: 1 });
            const order = await f.connection.rawConnection.getRepository(Order).save(
                new Order({
                    code: 'SYNC-QUOTA',
                    state: 'AddingItems',
                    active: true,
                    couponCodes: [],
                    subTotal: 740,
                    subTotalWithTax: 740,
                    currencyCode: CurrencyCode.MYR,
                    channels: [b.channel],
                    salesChannelId: b.channelId,
                    shippingAddress: {},
                    billingAddress: {},
                }),
            );
            const line = await f.connection.rawConnection.getRepository(OrderLine).save(
                new OrderLine({
                    order,
                    productVariant: variant,
                    productVariantId: variant.id,
                    quantity: 1,
                    listPrice: 740,
                    listPriceIncludesTax: false,
                    taxLines: [],
                    adjustments: [],
                    customFields: {
                        fulfillmentTypeSnapshot: 'digital',
                        digitalDeliveryModeSnapshot: 'manual_service',
                    },
                }),
            );
            order.lines = [line];
            quotaLineId = String(line.id);
            await f.connection.withTransaction(b, async tx => {
                await sources.snapshotOrder(tx, order);
                await digital.reserveOrder(tx, order);
            });
            const reservation = await digital.reservation(b, line.id);
            expect(String(requireSyntheticFixture(reservation).configId)).toBe(
                String(requireSyntheticFixture(config).id),
            );
            expect(String(requireSyntheticFixture(reservation).channelId)).toBe(String(b.channelId));
            expect(requireSyntheticFixture(await digital.config(a, variant.id)).availableQuantity).toBe(0);
            await f.connection.withTransaction(b, tx => digital.releaseLine(tx, line.id));
            expect(requireSyntheticFixture(await digital.config(a, variant.id)).availableQuantity).toBe(1);
            expect(await sources.historicalChannelId(b.channelId, line.id)).toBe(a.channelId);
        }, 30_000);

        it('keeps missing or automatic exchange rules pending and resumes after manual configuration', async () => {
            const repo = f.connection.rawConnection.getRepository(Channel);
            const target = await repo.findOneByOrFail({ id: b.channelId });
            await repo.save(
                new Channel({
                    ...target,
                    customFields: { ...target.customFields, currencyRateMode: 'AUTO' },
                }),
            );
            await drain();
            const grant = await f.connection.rawConnection
                .getRepository(ProductSalesAuthorization)
                .findOneByOrFail({ productId: products[0].id, channelId: b.channelId });
            expect(grant.state).toBe('PENDING');
            expect((await sync.issues(f.platform, rule.id)).totalItems).toBe(103);
            await repo.save(
                new Channel({
                    ...target,
                    customFields: { ...target.customFields, currencyRateMode: 'MANUAL', cnyToMyrRate: 0.6 },
                }),
            );
            await drain();
            const restored = await f.connection.rawConnection
                .getRepository(ProductSalesAuthorization)
                .findOneByOrFail({ id: grant.id });
            const restoredChannel = await repo.findOneByOrFail({ id: b.channelId });
            expect(
                restored.state,
                JSON.stringify({
                    restored,
                    mode: restoredChannel.customFields.currencyRateMode,
                    rate: restoredChannel.customFields.cnyToMyrRate,
                    issues: (await sync.issues(f.platform, rule.id)).items.slice(0, 2),
                }),
            ).toBe('ACTIVE');
        }, 120_000);

        it('retains another rule when a product leaves one category and automatically restores a returning product', async () => {
            const another = await f.server.app.get(CollectionService).create(a, {
                inheritFilters: false,
                filters: [
                    {
                        code: 'variant-id-filter',
                        arguments: [
                            { name: 'variantIds', value: JSON.stringify([products[0].variantId]) },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: 'Overlap source',
                    slug: 'overlap-source',
                    description: 'Synthetic overlap category',
                })),
            });
            await addSyntheticCollectionMembers(f.connection, another.id, [products[0].variantId]);
            let other = await sync.save(f.platform, { ...input(), sourceCollectionId: another.id });
            const preview = await sync.preview(f.platform, sync.input(other));
            other = await sync.enable(f.platform, other.id, other.version, preview.fingerprint, false);
            await drain(other.id);
            await f.connection.rawConnection.getRepository(Collection).update(child.id, {
                filters: [
                    {
                        code: 'variant-id-filter',
                        args: [
                            {
                                name: 'variantIds',
                                value: JSON.stringify(products.slice(1).map(p => p.variantId)),
                            },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
            });
            await f.connection.rawConnection
                .createQueryBuilder()
                .relation(Collection, 'productVariants')
                .of(child.id)
                .remove(products[0].variantId);
            await drain();
            expect(
                String(
                    requireSyntheticFixture(await sources.resolve(b.copy(), products[0].variantId)).rule.id,
                ),
            ).toBe(String(other.id));
            expect(
                (
                    await f.connection.rawConnection
                        .getRepository(ProductSalesAuthorization)
                        .findOneByOrFail({ productId: products[0].id, channelId: b.channelId })
                ).state,
            ).toBe('ACTIVE');
            await sync.pause(f.platform, other.id, other.version);
            await expect(sources.resolve(b.copy(), products[0].variantId)).rejects.toThrow();
            await f.connection.rawConnection.getRepository(Collection).update(child.id, {
                filters: [
                    {
                        code: 'variant-id-filter',
                        args: [
                            { name: 'variantIds', value: JSON.stringify(products.map(p => p.variantId)) },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
            });
            await addSyntheticCollectionMembers(f.connection, child.id, [products[0].variantId]);
            await drain();
            expect(
                String(
                    requireSyntheticFixture(await sources.resolve(b.copy(), products[0].variantId)).rule.id,
                ),
            ).toBe(String(rule.id));
        }, 120_000);

        it('keeps the last source credential unique and reuses duplicate delivery receipts', async () => {
            const item = await makeProduct('card');
            const digital = f.server.app.get(DigitalProductService);
            await f.connection.withTransaction(a, tx =>
                digital.update(tx, {
                    productVariantId: item.variantId,
                    deliveryMode: 'auto_card',
                    stockPolicy: 'pool_derived',
                }),
            );
            await f.connection.rawConnection.getRepository(AutoCardConfig).save(
                new AutoCardConfig({
                    channelId: a.channelId,
                    productVariantId: item.variantId,
                    enabled: true,
                    formatName: 'Synthetic sync cards',
                    delimiter: '----',
                    fieldsJson: JSON.stringify([{ key: 'code', label: 'Code', labelEn: 'Code' }]),
                    instructions: 'Synthetic instructions',
                    instructionsZh: 'Synthetic instructions',
                    instructionsEn: 'Synthetic instructions',
                    lowStockThreshold: 0,
                }),
            );
            const cards = f.server.app.get(AutoCardService);
            await f.connection.withTransaction(a, tx =>
                cards.importPoolItems(tx, {
                    productVariantId: item.variantId,
                    rawText: 'SYNTHETIC-SYNC-ONLY-CARD',
                }),
            );
            await drain();
            const variant = await f.connection.rawConnection
                .getRepository(ProductVariant)
                .findOneOrFail({ where: { id: item.variantId }, relations: ['product'] });
            const create = async (ctx: RequestContext) => {
                const amount = ctx.channelId === a.channelId ? 1000 : 600;
                const order = await f.connection.rawConnection.getRepository(Order).save(
                    new Order({
                        code: `SYNC-CARD-${ctx.channelId}`,
                        state: 'ArrangingPayment',
                        active: true,
                        salesChannelId: ctx.channelId,
                        channels: [ctx.channel],
                        currencyCode: ctx.currencyCode,
                        couponCodes: [],
                        shippingAddress: {},
                        billingAddress: {},
                        subTotal: amount,
                        subTotalWithTax: amount,
                        customFields: { deliveryEmail: 'synthetic-sync@example.invalid' },
                    }),
                );
                const line = await f.connection.rawConnection.getRepository(OrderLine).save(
                    new OrderLine({
                        order,
                        productVariant: variant,
                        quantity: 1,
                        listPrice: amount,
                        listPriceIncludesTax: false,
                        taxLines: [],
                        adjustments: [],
                        orderPlacedQuantity: 1,
                        customFields: {
                            fulfillmentTypeSnapshot: 'digital',
                            digitalDeliveryModeSnapshot: 'auto_card',
                        },
                    }),
                );
                order.lines = [line];
                await sources.snapshotOrder(ctx, order);
                expect(await cards.availabilityError(ctx, order)).toBeUndefined();
                order.state = 'PaymentSettled';
                order.active = false;
                order.orderPlacedAt = new Date();
                await f.connection.rawConnection.getRepository(Order).update(order.id, {
                    state: order.state,
                    active: false,
                    orderPlacedAt: order.orderPlacedAt,
                });
                order.payments = [
                    await f.connection.rawConnection.getRepository(Payment).save(
                        new Payment({
                            order,
                            state: 'Settled',
                            amount,
                            method: 'catalog-sync-local-fixture',
                            transactionId: `fixture-${order.code}`,
                            metadata: {},
                            refunds: [],
                        }),
                    ),
                ];
                return order;
            };
            const orderA = await create(a);
            const orderB = await create(b);
            const work = [
                () => f.connection.withTransaction(a, tx => cards.allocateSettledOrder(tx, orderA)),
                () => f.connection.withTransaction(b, tx => cards.allocateSettledOrder(tx, orderB)),
                () => f.connection.withTransaction(b, tx => cards.allocateSettledOrder(tx, orderB)),
            ];
            const parallel = ['mysql', 'mariadb'].includes(f.connection.rawConnection.options.type);
            const receipts = parallel
                ? await Promise.all(work.map(run => run()))
                : await (async () => {
                      const values = [];
                      for (const run of work) values.push(await run());
                      return values;
                  })();
            const deliveries = await f.connection.rawConnection
                .getRepository(AutoCardDelivery)
                .find({ where: [{ orderId: orderA.id }, { orderId: orderB.id }], relations: ['poolItems'] });
            expect(deliveries).toHaveLength(2);
            expect(receipts[1][0].id).toBe(receipts[2][0].id);
            expect(deliveries.filter(delivery => delivery.state === 'ALLOCATED')).toHaveLength(1);
            expect(deliveries.filter(delivery => delivery.state === 'WAITING_STOCK')).toHaveLength(1);
            expect(deliveries.flatMap(delivery => delivery.poolItems)).toHaveLength(1);
        }, 120_000);

        it('restores pre-existing target offers after takeover exits and hides an out-of-scope managed category', async () => {
            const item = await makeProduct('independent-takeover', false);
            const channels = f.server.app.get(ChannelService);
            await channels.assignToChannels(f.platform, Product, item.id, [b.channelId]);
            await channels.assignToChannels(f.platform, ProductVariant, item.variantId, [b.channelId]);
            await f.connection.rawConnection.getRepository(ProductVariantPrice).save(
                new ProductVariantPrice({
                    variant: { id: item.variantId },
                    channelId: b.channelId,
                    currencyCode: CurrencyCode.MYR,
                    price: 9300,
                }),
            );
            const grant = await f.connection.rawConnection.getRepository(ProductSalesAuthorization).save(
                new ProductSalesAuthorization({
                    productId: item.id,
                    channelId: b.channelId,
                    sourceChannelId: a.channelId,
                    variantIds: [item.variantId],
                    pendingVariantIds: [],
                    state: 'ACTIVE',
                    version: 1,
                }),
            );
            const ownCategory = await f.server.app.get(CollectionService).create(a, {
                inheritFilters: false,
                filters: [
                    {
                        code: 'variant-id-filter',
                        arguments: [
                            { name: 'variantIds', value: JSON.stringify([item.variantId]) },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: 'Synthetic takeover scope',
                    slug: 'synthetic-takeover-scope',
                    description: 'Local takeover verification',
                })),
            });
            await addSyntheticCollectionMembers(f.connection, ownCategory.id, [item.variantId]);
            let ownRule = await sync.save(f.platform, { ...input(), sourceCollectionId: ownCategory.id });
            const preview = await sync.preview(f.platform, sync.input(ownRule));
            expect(preview.takeoverCount).toBe(1);
            await expect(
                sync.enable(f.platform, ownRule.id, ownRule.version, preview.fingerprint, false),
            ).rejects.toThrow('确认');
            ownRule = await sync.enable(f.platform, ownRule.id, ownRule.version, preview.fingerprint, true);
            await drain(ownRule.id);
            expect(
                (
                    await f.connection.rawConnection
                        .getRepository(ProductVariantPrice)
                        .findOneOrFail({ where: { variant: { id: item.variantId }, channelId: b.channelId } })
                ).price,
            ).toBe(600);
            await f.connection.rawConnection.getRepository(Collection).update(ownCategory.id, {
                filters: [
                    {
                        code: 'variant-id-filter',
                        args: [
                            { name: 'variantIds', value: '[]' },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
            });
            await f.connection.rawConnection
                .createQueryBuilder()
                .relation(Collection, 'productVariants')
                .of(ownCategory.id)
                .remove(item.variantId);
            await drain(ownRule.id);
            expect(
                (
                    await f.connection.rawConnection
                        .getRepository(ProductSalesAuthorization)
                        .findOneByOrFail({ id: grant.id })
                ).state,
            ).toBe('ACTIVE');
            expect(
                (
                    await f.connection.rawConnection
                        .getRepository(ProductVariantPrice)
                        .findOneOrFail({ where: { variant: { id: item.variantId }, channelId: b.channelId } })
                ).price,
            ).toBe(9300);
            expect(await sources.managed(b, item.id)).toHaveLength(0);
            const mapping = await f.connection.rawConnection
                .getRepository(CatalogSyncBinding)
                .findOneByOrFail({ ruleId: ownRule.id, kind: 'COLLECTION' });
            await f.connection.rawConnection
                .createQueryBuilder()
                .relation(Collection, 'channels')
                .of(ownCategory.id)
                .remove(a.channelId);
            await drain(ownRule.id);
            expect(
                (
                    await f.connection.rawConnection
                        .getRepository(Collection)
                        .findOneByOrFail({ id: mapping.targetId })
                ).isPrivate,
            ).toBe(true);
            await sync.pause(f.platform, ownRule.id, ownRule.version);
        }, 120_000);

        it('follows new variants and subcategories, renames, parent moves and source listing changes', async () => {
            const item = await makeProduct('category-evolution', false);
            const group = await f.server.app.get(ProductOptionGroupService).create(a, {
                code: 'sync-evolution-options',
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: 'Duration',
                })),
            });
            const options = [];
            for (const code of ['original', 'extra'])
                options.push(
                    await f.server.app.get(ProductOptionService).create(a, group.id, {
                        productOptionGroupId: group.id,
                        code,
                        translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                            languageCode,
                            name: code,
                        })),
                    }),
                );
            await f.connection.withTransaction(a, tx =>
                f.server.app.get(ProductService).addOptionGroupToProduct(tx, item.id, group.id),
            );
            await f.server.app
                .get(ProductVariantService)
                .update(a, [{ id: Number(item.variantId), optionIds: [options[0].id] }]);
            const [addedVariant] = await f.server.app.get(ProductVariantService).create(a, [
                {
                    productId: item.id,
                    sku: 'SYNC-CATEGORY-EXTRA',
                    price: 2000,
                    optionIds: [options[1].id],
                    trackInventory: GlobalFlag.FALSE,
                    customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'manual_service' },
                    translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                        languageCode,
                        name: 'Extra specification',
                    })),
                },
            ]);
            await f.server.app.get(DigitalProductService).initialize(a, addedVariant);
            const collections = f.server.app.get(CollectionService);
            const nested = await collections.create(a, {
                parentId: child.id,
                inheritFilters: false,
                filters: [
                    {
                        code: 'variant-id-filter',
                        arguments: [
                            {
                                name: 'variantIds',
                                value: JSON.stringify([item.variantId, String(addedVariant.id)]),
                            },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: 'New nested category',
                    slug: 'new-nested-category',
                    description: 'Synthetic category lifecycle',
                })),
            });
            await addSyntheticCollectionMembers(f.connection, nested.id, [item.variantId, addedVariant.id]);
            await drain();
            const mappings = f.connection.rawConnection.getRepository(CatalogSyncBinding);
            const mapping = await mappings.findOneByOrFail({
                ruleId: rule.id,
                kind: 'COLLECTION',
                sourceId: nested.id,
            });
            const parent = await mappings.findOneByOrFail({
                ruleId: rule.id,
                kind: 'COLLECTION',
                sourceId: child.id,
            });
            const targetCategories = f.connection.rawConnection.getRepository(Collection);
            const copied = await targetCategories.findOneOrFail({
                where: { id: mapping.targetId },
                relations: ['parent'],
            });
            expect(String(copied.parent.id)).toBe(String(parent.targetId));
            const grant = await f.connection.rawConnection
                .getRepository(ProductSalesAuthorization)
                .findOneByOrFail({ productId: item.id, channelId: b.channelId });
            expect(grant.variantIds.sort()).toEqual([item.variantId, String(addedVariant.id)].sort());
            expect((await sources.resolve(b.copy(), addedVariant.id))?.ctx.channelId).toBe(a.channelId);

            await collections.update(a, {
                id: nested.id,
                parentId: category.id,
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: 'Renamed category',
                })),
            });
            await drain();
            const renamed = await targetCategories.findOneOrFail({
                where: { id: mapping.targetId },
                relations: ['parent', 'translations'],
            });
            const root = await mappings.findOneByOrFail({
                ruleId: rule.id,
                kind: 'COLLECTION',
                sourceId: category.id,
            });
            expect(String(renamed.parent.id)).toBe(String(root.targetId));
            expect(renamed.translations.find(t => t.languageCode === LanguageCode.en)?.name).toBe(
                'Renamed category',
            );
            expect(
                await mappings.count({ where: { ruleId: rule.id, kind: 'COLLECTION', sourceId: nested.id } }),
            ).toBe(1);
            await f.server.app
                .get(ProductVariantService)
                .update(a, [{ id: addedVariant.id, enabled: false }]);
            await expect(sources.resolve(b.copy(), addedVariant.id)).rejects.toThrow('暂停');
            await drain();
            await f.server.app.get(ProductVariantService).update(a, [{ id: addedVariant.id, enabled: true }]);
            await drain();
            expect((await sources.resolve(b.copy(), addedVariant.id))?.ctx.channelId).toBe(a.channelId);
            await f.server.app.get(ProductVariantService).softDelete(a, addedVariant.id);
            await drain();
            const remaining = await f.connection.rawConnection
                .getRepository(ProductSalesAuthorization)
                .findOneByOrFail({ productId: item.id, channelId: b.channelId });
            expect(remaining.variantIds).not.toContain(String(addedVariant.id));
        }, 120_000);

        it('respects another worker lease and recovers an interrupted page without losing earlier-page changes', async () => {
            const rules = f.connection.rawConnection.getRepository(CatalogSyncRule);
            await drain();
            const deadline = Date.now() + 60_000;
            let settled = await rules.findOneByOrFail({ id: rule.id });
            while (settled.leaseToken || settled.completedGeneration < settled.generation) {
                if (Date.now() > deadline) throw new Error('Worker did not release its completed lease');
                await new Promise(resolve => setTimeout(resolve, 50));
                settled = await rules.findOneByOrFail({ id: rule.id });
            }
            const token = '11111111-1111-4111-8111-111111111111';
            await rules.update(rule.id, {
                state: 'RUNNING',
                leaseUntil: new Date(Date.now() + 60_000),
                leaseToken: token,
                cursor: Number(products[99].id),
                runGeneration: settled.generation,
                generation: settled.generation + 1,
            });
            const queue = f.server.app.get(CatalogSyncQueueService) as unknown as {
                process(id: string | number): Promise<void>;
            };
            await queue.process(rule.id);
            const protectedRule = await rules.findOneByOrFail({ id: rule.id });
            expect(protectedRule.leaseToken).toBe(token);
            expect(protectedRule.cursor).toBe(Number(products[99].id));
            await f.connection.rawConnection
                .getRepository(ProductVariantPrice)
                .update({ channelId: a.channelId, variant: { id: products[0].variantId } }, { price: 1500 });
            await rules.update(rule.id, { leaseUntil: new Date(Date.now() - 1000) });
            await queue.process(rule.id);
            await drain();
            const recoveredPrice = await f.connection.rawConnection
                .getRepository(ProductVariantPrice)
                .findOneByOrFail({
                    channelId: b.channelId,
                    variant: { id: products[0].variantId },
                    currencyCode: CurrencyCode.MYR,
                });
            expect(recoveredPrice.price).toBe(900);
            const recovered = await rules.findOneByOrFail({ id: rule.id });
            expect(recovered.completedGeneration).toBeGreaterThanOrEqual(settled.generation + 1);
            expect(recovered.cursor).toBe(0);
            const snapshot = await f.connection.rawConnection
                .getRepository(CatalogSupplySnapshot)
                .findOneByOrFail({ channelId: b.channelId, orderLineId: quotaLineId });
            expect(snapshot.configuration.price).toBe(740);
        }, 120_000);

        registerCatalogSyncPhysicalAcceptance(() => ({ ...f, a, b, rule, child, products, drain }));
        registerCatalogSyncScaleAcceptance(() => ({
            ...f,
            a,
            b,
            sync,
            collections: f.server.app.get(CollectionService),
        }));

        registerCatalogSyncCloseoutAcceptance(() => ({
            ...f,
            a,
            b,
            rule,
            sync,
            sources,
            drain,
            makeProduct,
            products,
        }));

        it('blocks new supply after pause and preserves accepted-order supplier snapshots', async () => {
            const stored = await f.connection.rawConnection
                .getRepository(CatalogSyncRule)
                .findOneByOrFail({ id: rule.id });
            await sync.pause(f.platform, stored.id, stored.version);
            await expect(sources.resolve(b, products[0].variantId)).rejects.toThrow('暂停');
            expect(
                (
                    await f.connection.rawConnection
                        .getRepository(CatalogSupplySnapshot)
                        .findOneByOrFail({ channelId: b.channelId, orderLineId: quotaLineId })
                ).sourceChannelId,
            ).toBe(a.channelId);
            await expect(sync.save(a, input())).rejects.toThrow();
        });
    });
}
