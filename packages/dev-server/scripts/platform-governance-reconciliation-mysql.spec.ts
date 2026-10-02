import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CommerceFulfillmentPlugin } from '@vendure/commerce-fulfillment-plugin';
import { AssetType } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Asset,
    AutoIncrementIdStrategy,
    CatalogResourceOwnership,
    Channel,
    ChannelService,
    CurrencyCode,
    Facet,
    FacetValue,
    LanguageCode,
    mergeConfig,
    Order,
    Payment,
    PaymentMethod,
    Product,
    ProductOption,
    ProductOptionGroup,
    ProductService,
    ProductVariantService,
    RequestContextService,
    Tag,
    TransactionalConnection,
} from '@vendure/core';
import { GovernanceService, StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { createTestEnvironment, registerInitializer, testConfig } from '@vendure/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';

import { createCiGovernanceDatabase } from './platform-governance-ci-fixture.mjs';
import { applyReconciliation, collectReconciliationPlan } from './platform-governance-reconciliation.mjs';

describe.skipIf(process.env.PLATFORM_GOVERNANCE_CI_MYSQL !== '1')(
    'reviewed platform reconciliation on real MySQL',
    () => {
        const config = mergeConfig(testConfig, {
            apiOptions: { port: 3478 },
            entityOptions: { entityIdStrategy: new AutoIncrementIdStrategy() },
            plugins: [
                CatalogManagementPlugin,
                StorefrontContentPlugin,
                StorefrontCartPlugin,
                ContentTranslationPlugin.init({
                    provider: {
                        name: 'reconciliation-test',
                        isConfigured: () => true,
                        translate: request =>
                            Promise.resolve({
                                provider: 'reconciliation-test',
                                translations: request.segments.map(segment => ({
                                    key: segment.key,
                                    text: segment.text,
                                })),
                            }),
                    },
                }),
                StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
                CommerceFulfillmentPlugin.init({ testPaymentsEnabled: true }),
            ],
        });
        const { server } = createTestEnvironment(config);
        let raw: any;
        let connection: TransactionalConnection;
        let productA: Product;
        let productB: Product;
        let groupId: string;
        let assetId: string;
        let orphanTagId: string;
        let plan: Awaited<ReturnType<typeof collectReconciliationPlan>>;
        let platform: Channel;
        let a: Channel;
        let b: Channel;
        let legacyTestId: string;
        beforeAll(async () => {
            config.dbConnectionOptions = { ...(await createCiGovernanceDatabase()), synchronize: true };
            registerInitializer('mysql', {
                init: (_file, options) => Promise.resolve(options),
                populate: async work => work(),
                destroy: () => Promise.resolve(),
            });
            await server.init({
                initialData: { ...initialData, collections: [], paymentMethods: [] },
                customerCount: 0,
            });
            connection = server.app.get(TransactionalConnection);
            await connection.rawConnection.synchronize();
            const base = await server.app.get(RequestContextService).create({ apiType: 'admin' });
            const channels = server.app.get(ChannelService);
            platform = await channels.getDefaultChannel(base);
            for (const code of ['fixture-reconcile-a', 'fixture-reconcile-b']) {
                const channel = await channels.create(base, {
                    code,
                    token: code,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    defaultTaxZoneId: platform.defaultTaxZoneId,
                    defaultShippingZoneId: platform.defaultShippingZoneId,
                    pricesIncludeTax: false,
                });
                expect('id' in channel).toBe(true);
            }
            const stores = await connection.rawConnection
                .getRepository(Channel)
                .find({ where: [{ code: 'fixture-reconcile-a' }, { code: 'fixture-reconcile-b' }] });
            const fixtureA = stores.find(row => row.code === 'fixture-reconcile-a');
            const fixtureB = stores.find(row => row.code === 'fixture-reconcile-b');
            if (!fixtureA || !fixtureB) throw new Error('Fixture stores missing');
            a = fixtureA;
            b = fixtureB;
            const ca = base.copy({ channel: a });
            const cb = base.copy({ channel: b });
            const products = server.app.get(ProductService);
            productA = await products.create(ca, {
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: '验证 A',
                        slug: 'fixture-a-zh',
                        description: '本地验证',
                    },
                    {
                        languageCode: LanguageCode.en,
                        name: 'Fixture A',
                        slug: 'fixture-a',
                        description: 'Synthetic',
                    },
                ],
            });
            productB = await products.create(cb, {
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: '验证 B',
                        slug: 'fixture-b-zh',
                        description: '本地验证',
                    },
                    {
                        languageCode: LanguageCode.en,
                        name: 'Fixture B',
                        slug: 'fixture-b',
                        description: 'Synthetic',
                    },
                ],
            });
            const variants = server.app.get(ProductVariantService);
            const va = (
                await variants.create(ca, [
                    {
                        productId: productA.id,
                        sku: 'RECONCILE-A',
                        price: 1000,
                        translations: [
                            { languageCode: LanguageCode.zh_Hans, name: '验证 A' },
                            { languageCode: LanguageCode.en, name: 'A' },
                        ],
                    },
                ])
            )[0];
            const vb = (
                await variants.create(cb, [
                    {
                        productId: productB.id,
                        sku: 'RECONCILE-B',
                        price: 2000,
                        translations: [
                            { languageCode: LanguageCode.zh_Hans, name: '验证 B' },
                            { languageCode: LanguageCode.en, name: 'B' },
                        ],
                    },
                ])
            )[0];
            const group = await connection.rawConnection
                .getRepository(ProductOptionGroup)
                .save(new ProductOptionGroup({ code: 'shared-legacy', channels: [platform, a, b] }));
            groupId = String(group.id);
            const option = await connection.rawConnection.getRepository(ProductOption).save(
                new ProductOption({
                    code: 'legacy-choice',
                    groupId: group.id,
                    channels: [platform, a, b],
                }),
            );
            for (const p of [productA, productB])
                await connection.rawConnection
                    .createQueryBuilder()
                    .relation(Product, 'optionGroups')
                    .of(p.id)
                    .add(group.id);
            for (const v of [va, vb])
                await connection.rawConnection
                    .createQueryBuilder()
                    .relation('ProductVariant', 'options')
                    .of(v.id)
                    .add(option.id);
            const facet = await connection.rawConnection
                .getRepository(Facet)
                .save(new Facet({ code: 'shared-facet', isPrivate: true, channels: [platform, a, b] }));
            const value = await connection.rawConnection
                .getRepository(FacetValue)
                .save(new FacetValue({ code: 'shared-value', facet, channels: [platform, a, b] }));
            for (const p of [productA, productB])
                await connection.rawConnection
                    .createQueryBuilder()
                    .relation(Product, 'facetValues')
                    .of(p.id)
                    .add(value.id);
            const asset = await connection.rawConnection.getRepository(Asset).save(
                new Asset({
                    type: AssetType.IMAGE,
                    mimeType: 'image/png',
                    width: 1,
                    height: 1,
                    fileSize: 1,
                    source: 'fixture-retained-source.png',
                    preview: 'fixture-retained-preview.png',
                    channels: [platform, a, b],
                }),
            );
            assetId = String(asset.id);
            for (const p of [productA, productB])
                await connection.rawConnection.getRepository(Product).update(p.id, { featuredAsset: asset });
            const tag = await connection.rawConnection
                .getRepository(Tag)
                .save(new Tag({ value: 'shared-image-tag', ownerChannelId: null }));
            orphanTagId = String(
                (
                    await connection.rawConnection
                        .getRepository(Tag)
                        .save(new Tag({ value: 'orphan-tag-held', ownerChannelId: null }))
                ).id,
            );
            await connection.rawConnection
                .createQueryBuilder()
                .relation(Asset, 'tags')
                .of(asset.id)
                .add(tag.id);
            const referral = await connection.rawConnection
                .getRepository(PaymentMethod)
                .findOneOrFail({ where: { code: 'referral-balance' } });
            await connection.rawConnection
                .getRepository(PaymentMethod)
                .update(referral.id, { enabled: true });
            const local = await connection.rawConnection.getRepository(PaymentMethod).save(
                new PaymentMethod({
                    code: 'referral-balance',
                    enabled: true,
                    handler: referral.handler,
                    checker: referral.checker,
                    channels: [a],
                }),
            );
            expect(local.id).not.toBe(referral.id);
            const test = await connection.rawConnection.getRepository(PaymentMethod).save(
                new PaymentMethod({
                    code: `controlled-test-payment-${b.id}`,
                    enabled: true,
                    checker: { code: 'controlled-test-payment-checker', args: [] },
                    handler: {
                        code: 'controlled-test-payment-handler',
                        args: [
                            { name: 'channelId', value: JSON.stringify(String(b.id)) },
                            { name: 'qaSku', value: '"RECONCILE-B"' },
                            { name: 'qaMarker', value: '"preserved marker"' },
                        ],
                    },
                    channels: [platform, b],
                }),
            );
            legacyTestId = String(test.id);
            const order = await connection.rawConnection.getRepository(Order).save(
                new Order({
                    code: 'HISTORICAL-RECONCILIATION',
                    state: 'PaymentSettled',
                    active: false,
                    salesChannelId: b.id,
                    channels: [b],
                    currencyCode: CurrencyCode.USD,
                    couponCodes: [],
                    shippingAddress: {},
                    billingAddress: {},
                    subTotal: 2000,
                    subTotalWithTax: 2000,
                }),
            );
            await connection.rawConnection.getRepository(Payment).save(
                new Payment({
                    order,
                    method: 'referral-balance',
                    amount: 2000,
                    state: 'Settled',
                    transactionId: 'historical-fixture-payment',
                    metadata: { private: { preserved: 'synthetic' } },
                }),
            );
            expect(connection.rawConnection.options.type).toBe('mysql');
            raw = await (connection.rawConnection.driver as any).pool.promise().getConnection();
            plan = await collectReconciliationPlan(raw);
            expect(plan.blockers).toEqual([]);
        }, 120000);
        afterAll(async () => {
            raw?.release();
            await server.destroy();
        });
        it('rolls back a mid-copy failure, preserves histories, remaps private dependencies and safely replays its receipt', async () => {
            const historyBefore = JSON.stringify((await raw.query('SELECT * FROM payment ORDER BY id'))[0]);
            const before = (await raw.query('SELECT COUNT(*) AS n FROM asset'))[0][0].n;
            await expect(
                applyReconciliation(raw, plan.planSha256, {
                    phase: phase => {
                        if (phase === 'references') throw new Error('Synthetic power-loss boundary');
                        return Promise.resolve();
                    },
                }),
            ).rejects.toThrow('Synthetic');
            expect((await raw.query('SELECT COUNT(*) AS n FROM asset'))[0][0].n).toBe(before);
            expect(
                (await raw.query('SELECT featuredAssetId FROM product WHERE id = ?', [productA.id]))[0][0]
                    .featuredAssetId,
            ).toBe(Number(assetId));
            expect((await collectReconciliationPlan(raw)).planSha256).toBe(plan.planSha256);
            await expect(applyReconciliation(raw, '0'.repeat(64))).rejects.toThrow('PLAN_CHANGED');
            const result = await applyReconciliation(raw, plan.planSha256);
            expect(result.status).toBe('APPLIED');
            expect(
                result.held.some(row => row.resourceType === 'Tag' && row.resourceId === orphanTagId),
            ).toBe(true);
            const images = result.resources.filter(
                row => row.resourceType === 'Asset' && row.sourceId === assetId,
            );
            expect(images).toHaveLength(2);
            for (const image of images) {
                const saved = (
                    await raw.query('SELECT source,preview FROM asset WHERE id = ?', [image.targetId])
                )[0][0];
                expect(saved.source).toBe('fixture-retained-source.png');
                expect(saved.preview).toBe('fixture-retained-preview.png');
            }
            const ownership = await connection.rawConnection
                .getRepository(CatalogResourceOwnership)
                .findOneByOrFail({ resourceType: 'ProductOptionGroup', resourceId: Number(groupId) });
            expect(String(ownership.ownerChannelId)).toBe(String(platform.id));
            const ownVariantOptions = (
                await raw.query(
                    'SELECT pv.productId, o.groupId FROM product_variant pv ' +
                        'JOIN product_variant_options_product_option r ON r.productVariantId = pv.id ' +
                        'JOIN product_option o ON o.id = r.productOptionId WHERE pv.productId IN (?,?)',
                    [productA.id, productB.id],
                )
            )[0];
            const ownGroups = (
                await raw.query(
                    'SELECT productId,productOptionGroupId FROM product_option_groups_product_option_group WHERE productId IN (?,?)',
                    [productA.id, productB.id],
                )
            )[0];
            for (const option of ownVariantOptions)
                expect(ownGroups.find(row => row.productId === option.productId)?.productOptionGroupId).toBe(
                    option.groupId,
                );
            const global = (
                await raw.query('SELECT id,handler FROM payment_method WHERE code = ?', [
                    'controlled-test-payment-platform',
                ])
            )[0][0];
            const args = JSON.parse(global.handler).args;
            expect(args.find(arg => arg.name === 'channelId').value).toBe(
                JSON.stringify(String(platform.id)),
            );
            expect(args.find(arg => arg.name === 'qaMarker').value).toBe('"preserved marker"');
            expect(
                Number(
                    (
                        await raw.query('SELECT COUNT(*) AS n FROM payment_method WHERE id = ?', [
                            legacyTestId,
                        ])
                    )[0][0].n,
                ),
            ).toBe(1);
            const count = (await raw.query('SELECT COUNT(*) AS n FROM catalog_resource_ownership'))[0][0].n;
            expect((await applyReconciliation(raw, plan.planSha256)).status).toBe('ALREADY_APPLIED');
            expect((await raw.query('SELECT COUNT(*) AS n FROM catalog_resource_ownership'))[0][0].n).toBe(
                count,
            );
            expect(result.protectedHistoryVerified).toBe(true);
            const platformContext = await server.app.get(RequestContextService).create({
                apiType: 'admin',
                channelOrToken: platform,
            });
            expect((await server.app.get(GovernanceService).verifyAuditChain(platformContext)).valid).toBe(
                true,
            );
            expect(JSON.stringify((await raw.query('SELECT * FROM payment ORDER BY id'))[0])).toBe(
                historyBefore,
            );
        }, 60000);
    },
);
