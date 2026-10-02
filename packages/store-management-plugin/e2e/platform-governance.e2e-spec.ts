import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { AssetType, GlobalFlag } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Asset,
    AssetService,
    AssetTranslation,
    AutoIncrementIdStrategy,
    CatalogResourceOwnership,
    Channel,
    ChannelService,
    Collection,
    CollectionService,
    CurrencyCode,
    dummyPaymentHandler,
    FacetService,
    LanguageCode,
    mergeConfig,
    Order,
    OrderLine,
    Permission,
    Product,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariantPrice,
    ProductVariantService,
    RequestContext,
    RequestContextService,
    TagService,
    TransactionalConnection,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Duplex } from 'node:stream';
// @ts-ignore Project-owned fixture lab verifies the Docker endpoint and container.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { CatalogChannelAssignmentsService } from '../../catalog-management-plugin/src/catalog-channel-assignments.service';
import { CatalogTemplateLibraryService } from '../../catalog-management-plugin/src/catalog-template-library.service';
import { PlatformCatalogService } from '../../catalog-management-plugin/src/platform-catalog.service';
import { AutoCardCipherService } from '../../commerce-fulfillment-plugin/src/auto-card-cipher.service';
import { AutoCardSupplyService } from '../../commerce-fulfillment-plugin/src/auto-card-supply.service';
import { AutoCardService } from '../../commerce-fulfillment-plugin/src/auto-card.service';
import { CommerceFulfillmentPlugin } from '../../commerce-fulfillment-plugin/src/commerce-fulfillment.plugin';
import { AutoCardConfig } from '../../commerce-fulfillment-plugin/src/entities/auto-card-config.entity';
import { AutoCardDelivery } from '../../commerce-fulfillment-plugin/src/entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from '../../commerce-fulfillment-plugin/src/entities/auto-card-pool-item.entity';
import { StoreCatalogStatusService } from '../../commerce-fulfillment-plugin/src/store-catalog-status.service';
// @ts-ignore Fixed CI fixture connection is validated before any database is created.
import { createCiGovernanceDatabase } from '../../dev-server/scripts/platform-governance-ci-fixture.mjs';
import { collectPlatformPaymentDataPlan } from '../../dev-server/scripts/platform-payment-data-plan.mjs';
import {
    connectCase,
    createCase,
    createLab,
    stopLab,
    verifyLab,
} from '../../dev-server/scripts/store-isolation-mysql-lab.mjs';
import { CatalogGovernanceService } from '../src/catalog-governance.service';
import { GovernanceAuditEntry } from '../src/entities/governance-audit-entry.entity';
import { StoreManagementPlugin } from '../src/store-management.plugin';

import { registerCardConcurrencyAcceptance } from './card-concurrency-acceptance';
import { registerPaymentCustomerAcceptance } from './payment-customer-acceptance';
const serverConfig = mergeConfig(testConfig, {
    apiOptions: { port: 3477 },
    entityOptions: { entityIdStrategy: new AutoIncrementIdStrategy() },
    authOptions: { requireVerification: false },
    paymentOptions: { paymentMethodHandlers: [dummyPaymentHandler] },
    plugins: [
        CatalogManagementPlugin,
        StorefrontCartPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'governance-test',
                isConfigured: () => true,
                translate: r =>
                    Promise.resolve({
                        provider: 'governance-test',
                        translations: r.segments.map(s => ({ key: s.key, text: s.text })),
                    }),
            },
        }),
        StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
        CommerceFulfillmentPlugin.init({ testPaymentsEnabled: true }),
    ],
});
let mysqlLab: string | undefined;
const { server, adminClient } = createTestEnvironment(serverConfig);
let connection: TransactionalConnection;
let platform: RequestContext;
let a: RequestContext;
let b: RequestContext;
let catalog: PlatformCatalogService;
let productId: number;
let variantIds: string[];
let categoryId: string;
describe('platform governance real database and API boundaries', () => {
    beforeAll(async () => {
        await mkdir(new URL('../../../artifacts/platform-governance/', import.meta.url), { recursive: true });
        if (process.env.PLATFORM_GOVERNANCE_MYSQL === '1') {
            mysqlLab = await createLab({ subnet: 'synthetic-auto' });
            const caseFile = await createCase(mysqlLab);
            const opened = await connectCase(caseFile);
            const descriptor = await verifyLab(mysqlLab);
            const database = `service_${descriptor.runId}`;
            await opened.connection.query(`CREATE DATABASE \`${database}\``);
            await opened.connection.end();
            const stream = () => {
                const child = spawn(
                    'docker',
                    [
                        '--host',
                        descriptor.endpoint,
                        'exec',
                        '-i',
                        descriptor.containerId,
                        'bash',
                        '-c',
                        'exec 3<>/dev/tcp/127.0.0.1/3306 || exit 1; cat <&3 & reader=$!; cat >&3; kill "$reader" 2>/dev/null; wait',
                    ],
                    { stdio: ['pipe', 'pipe', 'ignore'] },
                );
                const duplex = Duplex.from({ readable: child.stdout, writable: child.stdin });
                child.once('error', e => duplex.destroy(e));
                duplex.once('close', () => child.kill());
                return duplex;
            };
            serverConfig.dbConnectionOptions = {
                type: 'mysql',
                connectorPackage: 'mysql2',
                database,
                username: 'root',
                password: '',
                synchronize: true,
                logging: false,
                extra: { stream, connectionLimit: 6 },
            };
            registerInitializer('mysql', {
                init: (_file, databaseOptions) => Promise.resolve(databaseOptions),
                populate: work => work(),
                destroy: () => Promise.resolve(),
            });
            await writeFile(
                fileURLToPath(
                    new URL(
                        '../../../artifacts/platform-governance/mysql-service-rehearsal.json',
                        import.meta.url,
                    ),
                ),
                JSON.stringify({ lab: mysqlLab, database, productionReady: false }, null, 2),
                { mode: 0o600 },
            );
        } else if (process.env.PLATFORM_GOVERNANCE_CI_MYSQL === '1') {
            serverConfig.dbConnectionOptions = {
                ...(await createCiGovernanceDatabase()),
                type: 'mysql',
                connectorPackage: 'mysql2',
                synchronize: true,
            };
            registerInitializer('mysql', {
                init: (_file, databaseOptions) => Promise.resolve(databaseOptions),
                populate: work => work(),
                destroy: () => Promise.resolve(),
            });
        } else {
            registerInitializer(
                'sqljs',
                new SqljsInitializer(
                    fileURLToPath(
                        new URL(
                            `../../../artifacts/platform-governance/sqljs-${randomUUID()}/`,
                            import.meta.url,
                        ),
                    ),
                ),
            );
        }
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 0,
        });
        connection = server.app.get(TransactionalConnection);
        await connection.rawConnection.synchronize();
        await adminClient.asSuperAdmin();
        const base = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const defaultChannel = await server.app.get(ChannelService).getDefaultChannel(base);
        platform = new RequestContext({
            apiType: 'admin',
            channel: defaultChannel,
            languageCode: LanguageCode.en,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
            session: {
                user: {
                    id: 1,
                    channelPermissions: [{ id: defaultChannel.id, permissions: [Permission.SuperAdmin] }],
                },
            } as any,
        });
        const zones = (
            await adminClient.query(gql`
                query {
                    zones {
                        items {
                            id
                        }
                    }
                }
            `)
        ).zones.items;
        if (!zones.length)
            zones.push(
                (
                    await adminClient.query(gql`
                        mutation {
                            createZone(input: { name: "Governance zone" }) {
                                id
                            }
                        }
                    `)
                ).createZone,
            );
        for (const code of ['governance-a', 'governance-b'])
            await adminClient.query(
                gql`
                    mutation ($input: CreateChannelInput!) {
                        createChannel(input: $input) {
                            ... on Channel {
                                id
                            }
                            ... on ErrorResult {
                                message
                            }
                        }
                    }
                `,
                {
                    input: {
                        code,
                        token: code,
                        defaultLanguageCode: 'en',
                        currencyCode: 'USD',
                        defaultTaxZoneId: zones[0].id,
                        defaultShippingZoneId: zones[0].id,
                        pricesIncludeTax: false,
                    },
                },
            );
        const shops = await connection.rawConnection
            .getRepository(Channel)
            .find({ where: [{ code: 'governance-a' }, { code: 'governance-b' }], loadEagerRelations: false });
        const shopA = shops.find(s => s.code === 'governance-a');
        const shopB = shops.find(s => s.code === 'governance-b');
        if (!shopA || !shopB) throw new Error('Synthetic test shops missing');
        a = platform.copy({
            channel: shopA,
            currencyCode: CurrencyCode.USD,
        });
        b = platform.copy({
            channel: shopB,
            currencyCode: CurrencyCode.USD,
        });
        // SuperAdmin remains scoped by active store even with all-channel permissions.
        (a as any)._session = (b as any)._session = {
            user: {
                id: 1,
                channelPermissions: [platform.channel, a.channel, b.channel].map(c => ({
                    id: c.id,
                    permissions: [Permission.SuperAdmin],
                })),
            },
        };
        catalog = server.app.get(PlatformCatalogService);
        const product = await server.app.get(ProductService).create(a, {
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: 'Source digital product',
                    slug: 'source-digital',
                    description: 'Synthetic local acceptance fixture content',
                },
                {
                    languageCode: LanguageCode.en,
                    name: 'Source digital product',
                    slug: 'source-digital',
                    description: 'Synthetic local acceptance fixture content',
                },
            ],
        });
        productId = Number(product.id);
        const duration = await server.app.get(ProductOptionGroupService).create(a, {
            code: 'duration',
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: 'Duration' },
                { languageCode: LanguageCode.en, name: 'Duration' },
            ],
        });
        const options = [];
        for (const name of ['One month', 'Two months'])
            options.push(
                await server.app.get(ProductOptionService).create(a, duration.id, {
                    productOptionGroupId: duration.id,
                    code: name.replace(/ /g, '-'),
                    translations: [
                        { languageCode: LanguageCode.zh_Hans, name },
                        { languageCode: LanguageCode.en, name },
                    ],
                }),
            );
        await connection.withTransaction(a, tx =>
            server.app.get(ProductService).addOptionGroupToProduct(tx, productId, duration.id),
        );
        const variants = await server.app.get(ProductVariantService).create(a, [
            {
                productId,
                trackInventory: GlobalFlag.FALSE,
                customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
                sku: 'SOURCE-1',
                optionIds: [options[0].id],
                price: 1200,
                translations: [
                    { languageCode: LanguageCode.zh_Hans, name: 'One month' },
                    { languageCode: LanguageCode.en, name: 'One month' },
                ],
            },
            {
                productId,
                trackInventory: GlobalFlag.FALSE,
                customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
                sku: 'SOURCE-2',
                optionIds: [options[1].id],
                price: 2400,
                translations: [
                    { languageCode: LanguageCode.zh_Hans, name: 'Two months' },
                    { languageCode: LanguageCode.en, name: 'Two months' },
                ],
            },
        ]);
        variantIds = variants.map(v => String(v.id));
        const category = await server.app.get(CollectionService).create(a, {
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: 'Source category',
                    slug: 'source-category',
                    description: 'Synthetic local acceptance fixture content',
                },
                {
                    languageCode: LanguageCode.en,
                    name: 'Source category',
                    slug: 'source-category',
                    description: 'Synthetic local acceptance fixture content',
                },
            ],
            inheritFilters: false,
            filters: [
                {
                    code: 'variant-id-filter',
                    arguments: [
                        { name: 'variantIds', value: JSON.stringify(variantIds) },
                        { name: 'combineWithAnd', value: 'false' },
                    ],
                },
            ],
        });
        categoryId = String(category.id);
        await connection.rawConnection
            .createQueryBuilder()
            .relation(Collection, 'productVariants')
            .of(category.id)
            .add(variants.map(v => v.id));
    }, 120000);
    afterAll(async () => {
        try {
            await server.destroy();
        } finally {
            if (mysqlLab) await stopLab(mysqlLab);
        }
    });
    registerPaymentCustomerAcceptance(() => ({ server, connection, platform, a, b }));
    it('keeps the management-center catalog private from Shop API while preserving admin access', async () => {
        const product = await connection.rawConnection
            .getRepository(Product)
            .findOneOrFail({ where: { id: productId }, relations: ['channels'] });
        if (!product.channels.some(c => String(c.id) === String(platform.channelId))) {
            await connection.rawConnection
                .createQueryBuilder()
                .relation(Product, 'channels')
                .of(productId)
                .add(platform.channelId);
        }
        const shop = new RequestContext({
            apiType: 'shop',
            channel: platform.channel,
            languageCode: platform.languageCode,
            isAuthorized: false,
            authorizedAsOwnerOnly: false,
        });
        const products = server.app.get(ProductService);
        expect((await products.findAll(shop)).totalItems).toBe(0);
        expect(await products.findOne(shop, productId)).toBeUndefined();
        expect((await catalog.catalog(platform)).items.some(p => p.id === String(productId))).toBe(true);
    });

    it('records maintenance ownership at creation and excludes the default channel from sales statistics', async () => {
        const owner = await connection.rawConnection
            .getRepository(CatalogResourceOwnership)
            .findOneBy({ resourceType: 'Product', resourceId: productId });
        expect(String(owner?.ownerChannelId)).toBe(String(a.channelId));
        const result = await catalog.catalog(platform);
        expect(result.channels.map(c => c.id)).not.toContain(String(platform.channelId));
        expect(result.items.find(p => p.id === String(productId))?.ownerChannelId).toBe(String(a.channelId));
        await expect(catalog.catalog(b)).rejects.toThrow();
    });
    it('isolates templates and facets at list, detail, write and public-template-copy paths', async () => {
        const groups = server.app.get(ProductOptionGroupService);
        const facets = server.app.get(FacetService);
        const group = await groups.create(a, {
            code: 'private-group',
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: 'Private A template' },
                { languageCode: LanguageCode.en, name: 'Private A template' },
            ],
        });
        await server.app.get(ProductOptionService).create(a, group.id, {
            productOptionGroupId: group.id,
            code: 'private-option',
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: 'Secret option label' },
                { languageCode: LanguageCode.en, name: 'Secret option label' },
            ],
        });
        const facet = await facets.create(a, {
            code: 'same-code',
            isPrivate: true,
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: 'Private A tag' },
                { languageCode: LanguageCode.en, name: 'Private A tag' },
            ],
        });
        expect(await groups.findOne(b, group.id)).toBeUndefined();
        expect((await groups.findAll(b)).items.some(g => g.id === group.id)).toBe(false);
        expect(await facets.findByCode(b, 'same-code', LanguageCode.en)).toBeUndefined();
        await expect(
            server.app.get(CatalogGovernanceService).assertOwned(b, 'Facet', facet.id),
        ).rejects.toThrow();
        const same = await facets.create(b, {
            code: 'same-code',
            isPrivate: true,
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: 'Private B tag' },
                { languageCode: LanguageCode.en, name: 'Private B tag' },
            ],
        });
        expect(same.id).not.toBe(facet.id);
        const library = server.app.get(CatalogTemplateLibraryService);
        const published = await library.publish(platform, 'ProductOptionGroup', group.id);
        const claimed = await library.claim(b, 'ProductOptionGroup', published.resourceId);
        expect(claimed.resourceId).not.toBe(group.id);
        expect((await groups.findOne(b, claimed.resourceId))?.options).toHaveLength(1);
        expect(await groups.findOne(b, group.id)).toBeUndefined();
        const tags = server.app.get(TagService);
        const tag = await tags.create(a, { value: 'Private orphan asset tag' });
        expect((await tags.findAll(b)).items.some(t => t.id === tag.id)).toBe(false);
        await expect(
            server.app.get(CatalogGovernanceService).assertOwned(b, 'Tag', tag.id),
        ).rejects.toThrow();
    });
    it('previews a category, executes, reads actual prices, remains idempotent and preserves local prices', async () => {
        const input = {
            idempotencyKey: randomUUID(),
            action: 'GRANT' as const,
            collectionId: categoryId,
            includeDescendants: true,
            targets: [{ channelId: String(b.channelId) }],
        };
        const preview = await catalog.preview(platform, input);
        if (mysqlLab)
            await writeFile(
                fileURLToPath(
                    new URL(
                        '../../../artifacts/platform-governance/mysql-preview-debug.json',
                        import.meta.url,
                    ),
                ),
                JSON.stringify(preview, null, 2),
            );
        expect(preview.items).toHaveLength(1);
        const result = await catalog.execute(platform, preview.id);
        expect(result.state, JSON.stringify(result.results)).toBe('COMPLETE');
        const repeated = await catalog.execute(platform, preview.id);
        expect(repeated.results).toEqual(result.results);
        let offer = await catalog.myOffer(b, productId);
        expect(offer.variants.map(v => v.price)).toEqual([1200, 2400]);
        await connection.withTransaction(b, async tx =>
            catalog.updateMyOffer(tx, {
                productId,
                version: offer.version,
                state: 'PAUSED',
                prices: [{ variantId: variantIds[0], price: 3300 }],
            }),
        );
        const again = await catalog.preview(platform, { ...input, idempotencyKey: randomUUID() });
        expect((await catalog.execute(platform, again.id)).state).toBe('COMPLETE');
        offer = await catalog.myOffer(b, productId);
        expect(offer.state).toBe('PAUSED');
        expect(offer.variants[0].price).toBe(3300);
        expect((await catalog.myOffer(a, productId)).variants[0].price).toBe(1200);
        expect(
            (await connection.rawConnection.getRepository(Product).findOneByOrFail({ id: productId }))
                .enabled,
        ).toBe(true);
        const scoped = await server.app.get(CatalogChannelAssignmentsService).list(b);
        expect(scoped.channels.map(c => String(c.id))).toEqual([String(b.channelId)]);
        expect(scoped.items[0].channels.map(c => String(c.id))).toEqual([String(b.channelId)]);
    });
    it('keeps authorized product images readable while refusing source asset listing and mutation', async () => {
        const assets = server.app.get(AssetService);
        const image = await connection.rawConnection.getRepository(Asset).save(
            new Asset({
                type: AssetType.IMAGE,
                mimeType: 'image/png',
                width: 1,
                height: 1,
                fileSize: 1,
                source: 'governance-source.png',
                preview: 'governance-preview.png',
                channels: [a.channel],
                translations: [new AssetTranslation({ languageCode: LanguageCode.en, name: 'Source image' })],
            }),
        );
        await connection.rawConnection.getRepository(AssetTranslation).save(
            new AssetTranslation({
                base: image,
                languageCode: LanguageCode.en,
                name: 'Source image',
            }),
        );
        await connection.withTransaction(a, tx =>
            server.app.get(ProductService).update(tx, {
                id: productId,
                assetIds: [image.id],
                featuredAssetId: image.id,
            }),
        );
        const preview = await catalog.preview(platform, {
            idempotencyKey: randomUUID(),
            action: 'GRANT',
            productIds: [String(productId)],
            targets: [{ channelId: String(b.channelId) }],
        });
        expect((await catalog.execute(platform, preview.id)).state).toBe('COMPLETE');
        const offered = await server.app.get(ProductService).findOne(b, productId);
        expect(offered).toBeDefined();
        if (!offered) throw new Error('The authorized product must be visible in the selling store');
        expect((await assets.getFeaturedAsset(b, offered))?.id).toBe(image.id);
        expect((await assets.getEntityAssets(b, offered))?.map(asset => asset.id)).toContain(image.id);
        expect(await assets.findOne(b, image.id)).toBeUndefined();
        expect((await assets.findAll(b)).items.some(asset => asset.id === image.id)).toBe(false);
        await expect(assets.update(b, { id: image.id, name: 'Unauthorized overwrite' })).rejects.toThrow();
        await assets.delete(b, [image.id], true, true);
        expect(await assets.findOne(a, image.id)).toBeDefined();
        expect((await assets.findOne(a, image.id))?.name).toBe('Source image');
    });
    it('rejects stale previews, supports variant revocation and preserves remaining scopes', async () => {
        const input = {
            idempotencyKey: randomUUID(),
            action: 'GRANT' as const,
            productIds: [String(productId)],
            targets: [{ channelId: String(b.channelId) }],
        };
        const preview = await catalog.preview(platform, input);
        await connection.rawConnection
            .getRepository(ProductVariantPrice)
            .update({ channelId: a.channelId, variant: { id: variantIds[0] } }, { price: 1500 });
        expect((await catalog.execute(platform, preview.id)).results[0]).toMatchObject({
            success: false,
            message: '数据已变化，请重新预览',
        });
        const revoke = await catalog.preview(platform, {
            ...input,
            idempotencyKey: randomUUID(),
            action: 'REVOKE',
            variantIds: [variantIds[0]],
        });
        const revokeResult = await catalog.execute(platform, revoke.id);
        expect(revokeResult.state, JSON.stringify(revokeResult.results)).toBe('COMPLETE');
        const offer = await catalog.myOffer(b, productId);
        expect(offer.variants.map(v => v.id)).toEqual([variantIds[1]]);
        await expect(
            connection.withTransaction(b, tx =>
                catalog.updateMyOffer(tx, {
                    productId,
                    version: offer.version,
                    state: 'ACTIVE',
                    prices: [{ variantId: variantIds[0], price: 3 }],
                }),
            ),
        ).rejects.toThrow();
    });
    it('honors payment supply snapshots after revocation, reuses assigned cards for duplicate payment and retries, and conceals the source pool', async () => {
        const auto = server.app.get(AutoCardService);
        const supply = server.app.get(AutoCardSupplyService);
        const offer = await catalog.myOffer(b, productId);
        await connection.withTransaction(b, tx =>
            catalog.updateMyOffer(tx, { productId, version: offer.version, state: 'ACTIVE', prices: [] }),
        );
        const variant = await server.app.get(ProductVariantService).findOne(a, variantIds[1]);
        expect(variant).toBeTruthy();
        if (!variant) throw new Error('Synthetic test variant missing');
        const config = await connection.rawConnection.getRepository(AutoCardConfig).save(
            new AutoCardConfig({
                channelId: a.channelId,
                productVariantId: variant.id,
                enabled: true,
                formatName: 'Synthetic cards',
                delimiter: '----',
                fieldsJson: JSON.stringify([{ key: 'code', label: 'Code', labelEn: 'Code' }]),
                instructions: 'Synthetic instructions',
                instructionsZh: 'Synthetic instructions',
                instructionsEn: 'Synthetic instructions',
                lowStockThreshold: 0,
            }),
        );
        await connection.withTransaction(platform, tx =>
            supply.setGrant(tx, {
                channelId: b.channelId,
                productVariantId: variant.id,
                configId: config.id,
                enabled: true,
                version: 0,
            }),
        );
        const cipher = server.app.get(AutoCardCipherService);
        for (let sequence = 1; sequence <= 2; sequence++)
            await connection.rawConnection.getRepository(AutoCardPoolItem).save(
                new AutoCardPoolItem({
                    configId: config.id,
                    sequence,
                    state: 'AVAILABLE',
                    encryptedPayload: cipher.encrypt({ code: `SYNTHETIC-CARD-${sequence}` }),
                    fingerprint: cipher.fingerprint(config.id, { code: `SYNTHETIC-CARD-${sequence}` }),
                }),
            );
        const order = await connection.rawConnection.getRepository(Order).save(
            new Order({
                code: `GOV-${randomUUID()}`,
                state: 'ArrangingPayment',
                salesChannelId: b.channelId,
                channels: [b.channel],
                currencyCode: CurrencyCode.USD,
                couponCodes: [],
                shippingAddress: {},
                billingAddress: {},
                subTotal: 4800,
                subTotalWithTax: 4800,
                customFields: { deliveryEmail: 'synthetic-buyer@example.invalid' },
            }),
        );
        const line = await connection.rawConnection.getRepository(OrderLine).save(
            new OrderLine({
                order,
                productVariant: variant,
                quantity: 2,
                listPrice: 2400,
                listPriceIncludesTax: false,
                adjustments: [],
                taxLines: [],
                customFields: {
                    fulfillmentTypeSnapshot: 'digital',
                    digitalDeliveryModeSnapshot: 'auto_card',
                },
            }),
        );
        line.productVariant = variant;
        order.lines = [line];
        expect(await auto.availabilityError(b, order)).toBeUndefined();
        await connection.withTransaction(platform, tx =>
            supply.setGrant(tx, {
                channelId: b.channelId,
                productVariantId: variant.id,
                configId: config.id,
                enabled: false,
                version: 1,
            }),
        );
        expect(await supply.resolve(b, variant.id)).toBeNull();
        order.state = 'PaymentSettled';
        await connection.rawConnection.getRepository(Order).update(order.id, { state: 'PaymentSettled' });
        const allocated = await connection.withTransaction(b, tx => auto.allocateSettledOrder(tx, order));
        expect(allocated[0].channelId).toBe(b.channelId);
        expect(allocated[0].sourceChannelId).toBe(a.channelId);
        expect(allocated[0].poolItems).toHaveLength(2);
        const repeated = await connection.withTransaction(b, tx => auto.allocateSettledOrder(tx, order));
        expect(repeated[0].id).toBe(allocated[0].id);
        expect(
            await connection.rawConnection
                .getRepository(AutoCardPoolItem)
                .count({ where: { configId: config.id, state: 'ASSIGNED' } }),
        ).toBe(2);
        const payload = await auto.emailPayload(b, allocated[0].id);
        expect(payload.recipientEmail).toBe('synthetic-buyer@example.invalid');
        expect(payload.orderCode).toBe(order.code);
        expect(payload.credentials).toHaveLength(2);
        await expect(auto.emailPayload(a, allocated[0].id)).rejects.toThrow();
        expect((await auto.poolItems(b, variant.id)).totalItems).toBe(0);
        const ordinaryEditor = b.copy();
        (ordinaryEditor as any)._session = {
            user: {
                id: 2,
                channelPermissions: [
                    { id: b.channelId, permissions: [Permission.ReadProduct, Permission.UpdateProduct] },
                ],
            },
        };
        await expect(auto.revealSoldCards(ordinaryEditor, allocated[0].id)).rejects.toThrow('专用权限');
        await connection.withTransaction(b, tx =>
            auto.recordEmailResult(tx, allocated[0].id, false, new Error('synthetic delivery failure')),
        );
        const afterFailure = await connection.rawConnection
            .getRepository(AutoCardDelivery)
            .findOneByOrFail({ id: allocated[0].id });
        expect(afterFailure.state).not.toBe('SENT');
        const retried = await connection.withTransaction(b, tx => auto.allocateSettledOrder(tx, order));
        expect(retried[0].id).toBe(allocated[0].id);
        expect((await auto.emailPayload(b, allocated[0].id)).credentials.map(c => c.fields[0].value)).toEqual(
            payload.credentials.map(c => c.fields[0].value),
        );
        await connection.withTransaction(b, tx => auto.recordEmailResult(tx, allocated[0].id, true));
        const sent = await connection.rawConnection
            .getRepository(AutoCardDelivery)
            .findOneByOrFail({ id: allocated[0].id });
        expect(sent.state).toBe('SENT');
        expect(sent.fulfillmentId).toBeTruthy();
        expect(
            await connection.rawConnection
                .getRepository(AutoCardPoolItem)
                .count({ where: { configId: config.id, state: 'ASSIGNED' } }),
        ).toBe(2);
        const privileged = b.copy();
        (privileged as any)._session = {
            user: { id: 1, channelPermissions: [{ id: b.channelId, permissions: ['ReadSoldAutoCards'] }] },
        };
        expect(await auto.revealSoldCards(privileged, allocated[0].id)).toHaveLength(2);
        const audit = await connection.rawConnection
            .getRepository(GovernanceAuditEntry)
            .find({ where: { channelId: b.channelId } });
        expect(audit.some(entry => entry.eventType === 'AUTO_CARD_SOLD_SECRET_REVEALED')).toBe(true);
        expect(JSON.stringify(audit)).not.toContain('SYNTHETIC-CARD-');
        expect((await supply.supplierSummary(a, variant.id))[0]).toMatchObject({
            channelId: String(b.channelId),
            deliveredQuantity: 2,
        });
        expect(JSON.stringify(await supply.supplierSummary(a, variant.id))).not.toContain('synthetic-buyer');
        expect(await supply.supplierSummary(b, variant.id)).toEqual([]);
    });

    it('separates configured listing and out-of-stock counts within the active store', async () => {
        const status = server.app.get(StoreCatalogStatusService);
        const summary = await status.summary(b);
        expect(summary.channelId).toBe(String(b.channelId));
        expect(summary.authorized).toBe(1);
        expect(summary.pending).toBe(1); // Revoked supply cannot accept new sales.
        expect(summary.listed).toBe(0);
        expect(summary.outOfStock).toBe(0);
        await expect(status.summary(platform)).rejects.toThrow();
    });
    it('keeps working specs active when a new spec lacks a target price, and requires prices for foreign currencies', async () => {
        const groups = await server.app
            .get(ProductOptionGroupService)
            .getOptionGroupsByProductId(a, productId);
        const group = groups[0];
        const option = await server.app.get(ProductOptionService).create(a, group.id, {
            productOptionGroupId: group.id,
            code: 'pending-spec',
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: 'Pending spec' },
                { languageCode: LanguageCode.en, name: 'Pending spec' },
            ],
        });
        const [variant] = await server.app.get(ProductVariantService).create(a, [
            {
                productId,
                sku: 'PENDING-SPEC',
                optionIds: [option.id],
                price: 10,
                trackInventory: GlobalFlag.FALSE,
                customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
                translations: [
                    { languageCode: LanguageCode.zh_Hans, name: 'Pending spec' },
                    { languageCode: LanguageCode.en, name: 'Pending spec' },
                ],
            },
        ]);
        await connection.rawConnection
            .getRepository(ProductVariantPrice)
            .delete({ variant: { id: variant.id } });
        const preview = await catalog.preview(platform, {
            idempotencyKey: randomUUID(),
            action: 'GRANT',
            productIds: [String(productId)],
            variantIds: [String(variant.id)],
            targets: [{ channelId: String(b.channelId) }],
        });
        expect(preview.items[0].missingPriceCount).toBe(1);
        expect((await catalog.execute(platform, preview.id)).state).toBe('COMPLETE');
        const offer = await catalog.myOffer(b, productId);
        expect(offer.state).toBe('ACTIVE');
        expect(offer.pendingVariantIds).toContain(String(variant.id));
        expect(offer.pendingVariantIds).not.toContain(variantIds[1]);
        // A distinct persisted store avoids changing B's configured currency.
        const other = await connection.rawConnection.getRepository(Channel).save(
            new Channel({
                ...b.channel,
                id: undefined,
                code: 'foreign-currency',
                token: 'foreign-currency',
                defaultCurrencyCode: CurrencyCode.MYR,
            }),
        );
        const batch = await catalog.preview(platform, {
            idempotencyKey: randomUUID(),
            action: 'GRANT',
            productIds: [String(productId)],
            variantIds: [variantIds[1]],
            targets: [{ channelId: String(other.id) }],
        });
        expect(batch.items[0].plannedPrices[0].price).toBeNull();
        expect((await catalog.execute(platform, batch.id)).state).toBe('COMPLETE');
        expect(
            (
                await catalog.myOffer(
                    platform.copy({ channel: other, currencyCode: CurrencyCode.MYR }),
                    productId,
                )
            ).state,
        ).toBe('PENDING');
    });
    it('deduplicates category descendants across more than 100 products without page truncation', async () => {
        const child = await server.app.get(CollectionService).create(a, {
            parentId: categoryId,
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: 'Child category',
                    slug: 'child-category',
                    description: 'Synthetic local acceptance fixture content',
                },
                {
                    languageCode: LanguageCode.en,
                    name: 'Child category',
                    slug: 'child-category',
                    description: 'Synthetic local acceptance fixture content',
                },
            ],
            inheritFilters: false,
            filters: [],
        });
        const childVariantIds: string[] = [];
        for (let index = 0; index < 100; index++) {
            const product = await server.app.get(ProductService).create(a, {
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: `Synthetic product ${index}`,
                        slug: `synthetic-product-${index}`,
                        description: 'Synthetic local acceptance fixture content',
                    },
                    {
                        languageCode: LanguageCode.en,
                        name: `Synthetic product ${index}`,
                        slug: `synthetic-product-${index}`,
                        description: 'Synthetic local acceptance fixture content',
                    },
                ],
            });
            const [variant] = await server.app.get(ProductVariantService).create(a, [
                {
                    productId: product.id,
                    sku: `SYNTHETIC-${index}`,
                    price: 100,
                    trackInventory: GlobalFlag.FALSE,
                    translations: [
                        { languageCode: LanguageCode.zh_Hans, name: `Synthetic variant ${index}` },
                        { languageCode: LanguageCode.en, name: `Synthetic variant ${index}` },
                    ],
                },
            ]);
            childVariantIds.push(String(variant.id));
            await connection.rawConnection
                .createQueryBuilder()
                .relation(Collection, 'productVariants')
                .of(child.id)
                .add(variant.id);
        }
        await connection.rawConnection
            .createQueryBuilder()
            .relation(Collection, 'productVariants')
            .of(child.id)
            .add(variantIds);
        await server.app.get(CollectionService).update(a, {
            id: child.id,
            inheritFilters: false,
            filters: [
                {
                    code: 'variant-id-filter',
                    arguments: [
                        { name: 'variantIds', value: JSON.stringify(childVariantIds) },
                        { name: 'combineWithAnd', value: 'false' },
                    ],
                },
            ],
        });
        await connection.rawConnection
            .createQueryBuilder()
            .insert()
            .into('collection_product_variants_product_variant')
            .values(childVariantIds.map(id => ({ collectionId: child.id, productVariantId: id })))
            .orIgnore()
            .execute();
        const preview = await catalog.preview(platform, {
            idempotencyKey: randomUUID(),
            action: 'GRANT',
            collectionId: categoryId,
            includeDescendants: true,
            targets: [{ channelId: String(b.channelId) }],
        });
        expect(preview.items).toHaveLength(101);
        expect(new Set(preview.items.map(i => i.productId)).size).toBe(101);
    });

    it('generates an ID-based read-only history manifest from the local database without changing native relations', async () => {
        const { collectPlatformCatalogDataPlan } =
            await import('../../dev-server/scripts/platform-catalog-data-plan.mjs');
        const runner = connection.rawConnection.createQueryRunner();
        const before = await connection.rawConnection
            .getRepository(Product)
            .findOne({ where: { id: productId }, relations: ['channels'] });
        try {
            const plan = await collectPlatformCatalogDataPlan({
                tableExists: (table: string) => runner.hasTable(table),
                columnExists: (table: string, column: string) => runner.hasColumn(table, column),
                query: (sql: string) => {
                    if (!/^SELECT /i.test(sql)) throw new Error('Read-only acceptance adapter');
                    return runner.query(sql);
                },
            });
            const paymentPlan = await collectPlatformPaymentDataPlan({
                query: (sql: string) => {
                    if (!/^SELECT /i.test(sql)) throw new Error('Read-only acceptance adapter');
                    return runner.query(sql);
                },
                tableExists: (name: string) => runner.hasTable(name),
            });
            expect(paymentPlan.mutatesData).toBe(false);
            expect(
                paymentPlan.entries.some(
                    (m: any) =>
                        m.code === 'controlled-test-payment-platform' && m.scope === 'PLATFORM_CONFIGURATION',
                ),
            ).toBe(true);
            await writeFile(
                fileURLToPath(
                    new URL(
                        `../../../artifacts/platform-governance/payment-data-plan-${connection.rawConnection.options.type === 'mysql' ? 'mysql' : 'sqljs'}.json`,
                        import.meta.url,
                    ),
                ),
                JSON.stringify(paymentPlan, null, 2),
                { mode: 0o600 },
            );
            expect(
                plan.resources.find(
                    (r: any) => r.resourceType === 'Product' && r.resourceId === String(productId),
                )?.status,
            ).toBe('REGISTERED_AUTHORIZED_SALES');
            expect(plan.productionApply).toBe(false);
            expect(JSON.stringify(plan)).not.toContain('SYNTHETIC-CARD-');
            await writeFile(
                fileURLToPath(
                    new URL(
                        `../../../artifacts/platform-governance/local-data-plan-${randomUUID()}.json`,
                        import.meta.url,
                    ),
                ),
                JSON.stringify(plan, null, 2),
                { flag: 'wx', mode: 0o600 },
            );
            const after = await connection.rawConnection
                .getRepository(Product)
                .findOne({ where: { id: productId }, relations: ['channels'] });
            expect(after?.channels.map(c => c.id)).toEqual(before?.channels.map(c => c.id));
        } finally {
            await runner.release();
        }
    });

    it('enforces the same scope through GraphQL, including native reference changes and direct platform APIs', async () => {
        adminClient.setChannelToken(b.channel.token);
        try {
            await expect(
                adminClient.query(gql`
                    query {
                        platformCatalogProducts
                    }
                `),
            ).rejects.toThrow();
            const scoped = await adminClient.query(gql`
                query {
                    catalogProductChannelAssignments {
                        channels {
                            id
                        }
                        items {
                            id
                            channels {
                                id
                            }
                        }
                    }
                }
            `);
            expect(scoped.catalogProductChannelAssignments.channels.map((c: any) => c.id)).toEqual([
                String(b.channelId),
            ]);
            await expect(
                adminClient.query(gql`
                    query {
                        jobs {
                            totalItems
                        }
                    }
                `),
            ).rejects.toThrow('平台管理中心');
            await expect(
                adminClient.query(gql`
                    query {
                        systemAnnouncements {
                            id
                        }
                    }
                `),
            ).rejects.toThrow('平台管理中心');
            await expect(
                adminClient.query(gql`
                    mutation {
                        updatePaymentMethod(input: { id: "0", enabled: false }) {
                            id
                        }
                    }
                `),
            ).rejects.toThrow('支付系统配置');
            await expect(
                adminClient.query(
                    gql`
                        mutation ($id: ID!) {
                            updateProduct(input: { id: $id, enabled: false }) {
                                id
                            }
                        }
                    `,
                    { id: String(productId) },
                ),
            ).rejects.toThrow();
            await expect(
                adminClient.query(
                    gql`
                        mutation ($id: ID!) {
                            deleteProductVariant(id: $id) {
                                result
                            }
                        }
                    `,
                    { id: variantIds[1] },
                ),
            ).rejects.toThrow();
        } finally {
            adminClient.setChannelToken(platform.channel.token);
        }
    });
    registerCardConcurrencyAcceptance(() => ({ server, connection, platform, a, b, variantIds }));
});
