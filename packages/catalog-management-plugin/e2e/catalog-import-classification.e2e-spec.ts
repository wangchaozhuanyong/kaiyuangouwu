import { expect as browserExpect, chromium } from '@playwright/test';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    ChannelService,
    Collection,
    CollectionService,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    LanguageCode,
    mergeConfig,
    PluginCommonModule,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    RequestContextService,
    RoleService,
    StockLocationService,
    TransactionalConnection,
    User,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { CommerceModeService } from '../../commerce-fulfillment-plugin/src/commerce-mode.service';
import { PackagingUnpackEvent } from '../../commerce-fulfillment-plugin/src/entities/packaging-unpack-event.entity';
import { ProductPackagingRule } from '../../commerce-fulfillment-plugin/src/entities/product-packaging-rule.entity';
import { FulfillmentModelService } from '../../commerce-fulfillment-plugin/src/fulfillment-model.service';
import { awaitRunningJobs } from '../../core/e2e/utils/await-running-jobs';
import { CatalogImportService } from '../src/catalog-import.service';
import { CatalogManagementPlugin } from '../src/catalog-management.plugin';
import { CatalogOperationsService } from '../src/catalog-operations.service';
import { buildCatalogExport } from '../src/dashboard/catalog-export-workbook';
import { catalogImportTemplateCsv } from '../src/dashboard/catalog-import-template';
import { parseCatalogArrayBuffer, rowsForCatalogTransport } from '../src/dashboard/catalog-local-file';
import { type CatalogExportRowRecord } from '../src/dashboard/catalog-management.graphql';

// Reuse the actual fulfillment event handlers with only the fields/entities needed by import tests.
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [CommerceModeService, FulfillmentModelService],
    entities: [ProductPackagingRule, PackagingUnpackEvent],
})
class ImportFulfillmentTestPlugin {}

const config = mergeConfig(testConfig, {
    apiOptions: { port: 3297 },
    customFields: {
        Channel: [{ name: 'commerceMode', type: 'string', defaultValue: 'HYBRID' }],
        Product: [{ name: 'fulfillmentType', type: 'string', defaultValue: 'digital' }],
        ProductVariant: [
            { name: 'fulfillmentType', type: 'string', defaultValue: 'digital' },
            { name: 'digitalStockPolicy', type: 'string', defaultValue: 'limited' },
            { name: 'digitalDeliveryMode', type: 'string', defaultValue: 'manual_service' },
        ],
    },
    plugins: [
        CatalogManagementPlugin,
        DefaultJobQueuePlugin,
        ImportFulfillmentTestPlugin,
        DefaultSearchPlugin.init({ bufferUpdates: true }),
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
let ctx: RequestContext;
let imports: CatalogImportService;
let connection: TransactionalConnection;
let physicalId: string;

async function importCsv(csv: string, importContext = ctx, previewOnly = false) {
    const parsed = await parseCatalogArrayBuffer(new TextEncoder().encode(csv).buffer, 'integration.csv');
    expect(parsed.errors).toEqual([]);
    const [stockLocation] = await server.app.get(CatalogOperationsService).stockLocations(importContext);
    const job = await imports.beginImport(importContext, {
        context: {
            channelId: importContext.channelId,
            stockLocationId: stockLocation.id,
            currencyCode: importContext.currencyCode,
        },
        source: {
            filename: parsed.filename,
            byteSize: parsed.byteSize,
            mimetype: 'text/csv',
            fileHash: parsed.fileHash,
            sheetName: parsed.sheetName,
            detectedHeaders: parsed.headers,
            fieldMapping: parsed.fieldMapping,
            parserVersion: 'catalog-browser-v3',
        },
        totalRows: parsed.rows.length,
    });
    await imports.appendRows(importContext, { jobId: job.id, rows: rowsForCatalogTransport(parsed.rows) });
    await imports.finalizePreview(importContext, job.id);
    if (previewOnly) return imports.findJob(importContext, job.id);
    const rows = await imports.findRows(importContext, job.id);
    const risks = rows.filter(row => row.action === 'WARNING');
    if (risks.length)
        await imports.resolveRows(importContext, { rowIds: risks.map(row => row.id), resolution: 'APPLY' });
    await imports.queueExecution(importContext, job.id);
    await imports.executeJob(importContext, job.id, () => undefined);
    const finished = await imports.findJob(importContext, job.id);
    expect(
        (await imports.findRows(importContext, job.id)).map(row => ({
            action: row.action,
            message: row.message,
        })),
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ action: 'ERROR' })]));
    expect(finished.state).toBe('COMPLETED');
    return finished;
}

async function recomputeCategories() {
    const service = server.app.get(CollectionService);
    const collections = await connection.rawConnection.getRepository(Collection).find();
    for (const collection of collections) {
        await Reflect.get(service, 'applyCollectionFiltersInternal').call(service, collection, false);
    }
}

describe('catalog import persisted type, hierarchy and rollback', () => {
    beforeAll(async () => {
        registerInitializer(
            'sqljs',
            new SqljsInitializer(mkdtempSync(join(tmpdir(), 'vendure-import-classification-'))),
        );
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
        ctx = await server.app
            .get(RequestContextService)
            .create({ apiType: 'admin', languageCode: LanguageCode.en });
        connection = server.app.get(TransactionalConnection);
        imports = server.app.get(CatalogImportService);
        imports.registerEnqueuer(() => Promise.resolve());
    }, 120000);
    afterAll(async () => {
        await server.destroy();
    });

    it('persists both types on Product and SKU, then exposes the correct hierarchy to Shop API', async () => {
        await importCsv(catalogImportTemplateCsv(ctx.channel.code));
        const products = await connection.rawConnection
            .getRepository(Product)
            .find({ relations: ['variants'] });
        const physical = products.find(product =>
            product.variants.some(variant => variant.sku === 'EXAMPLE-PHYSICAL-001'),
        );
        if (!physical) throw new Error('Missing physical product');
        physicalId = String(physical.id);
        expect(physical.customFields.fulfillmentType).toBe('physical');
        expect(physical.variants[0].customFields.fulfillmentType).toBe('physical');
        const digital = products.find(product =>
            product.variants.some(variant => variant.sku === 'EXAMPLE-DIGITAL-001'),
        );
        if (!digital) throw new Error('Missing digital product');
        expect(digital.customFields.fulfillmentType).toBe('digital');
        expect(digital.variants[0].customFields.fulfillmentType).toBe('digital');
        await recomputeCategories();
        const result = await shopClient.query(gql`
            query {
                collections {
                    items {
                        name
                        parent {
                            name
                        }
                        productVariants {
                            items {
                                sku
                            }
                        }
                    }
                }
            }
        `);
        const child = result.collections.items.find((item: { name: string }) => item.name === '饮料');
        expect(child.parent.name).toBe('食品饮料');
        expect(child.productVariants.items).toEqual(
            expect.arrayContaining([expect.objectContaining({ sku: 'EXAMPLE-PHYSICAL-001' })]),
        );
        expect(result.collections.items.map((item: { name: string }) => item.name)).not.toContain('');
    });

    it('round-trips export data without duplicate products or SKU writes', async () => {
        const exported = await adminClient.query(gql`
            query {
                catalogExportRows {
                    items {
                        productId
                        variantId
                        productName
                        description
                        fulfillmentType
                        channelCode
                        importCategory
                        categories
                        brand
                        tags
                        productEnabled
                        variantEnabled
                        systemCreatedAt
                        sourceCreatedAt
                        supplierName
                        sku
                        barcode
                        specification
                        saleUnit
                        purchaseUnit
                        packageQuantity
                        shelfLifeDays
                        sellingPrice
                        purchaseCostMicrounits
                        currencyCode
                        margin
                        stockLevels {
                            stockLocationId
                            stockLocationName
                            stockOnHand
                            stockAllocated
                            stockAvailable
                            minimumStock
                            maximumStock
                        }
                        lots {
                            id
                            lotCode
                            stockLocationId
                            stockLocationName
                            manufacturedAt
                            expiresAt
                            quantityOnHand
                            purchaseCostMicrounits
                            currencyCode
                            state
                        }
                    }
                }
            }
        `);
        const rows = exported.catalogExportRows.items as CatalogExportRowRecord[];
        expect(rows.find(row => row.sku === 'EXAMPLE-PHYSICAL-001')?.importCategory).toBe('食品饮料 > 饮料');
        const job = await importCsv(new TextDecoder().decode(buildCatalogExport(rows, 'csv').buffer));
        expect(job.skippedCount).toBe(2);
        expect(await connection.rawConnection.getRepository(ProductVariant).count()).toBe(2);
    });

    it('clears the child, corrects type, and restores both on safe rollback', async () => {
        const job = await importCsv(
            `名称,商品类型,一级分类,二级分类,SKU,进货价,销售价,导入商店\n示例实物商品,虚拟货品,食品饮料,,EXAMPLE-PHYSICAL-001,3.125,5,${ctx.channel.code}`,
        );
        await recomputeCategories();
        const product = await connection.rawConnection
            .getRepository(Product)
            .findOneOrFail({ where: { id: physicalId }, relations: ['variants', 'variants.collections'] });
        expect(product.customFields.fulfillmentType).toBe('digital');
        expect(product.variants[0].customFields.fulfillmentType).toBe('digital');
        expect(
            product.variants[0].collections.some(item =>
                item.translations.some(translation => translation.name === '饮料'),
            ),
        ).toBe(false);
        await imports.rollback(ctx, job.id);
        await recomputeCategories();
        const restored = await connection.rawConnection
            .getRepository(Product)
            .findOneOrFail({ where: { id: physicalId }, relations: ['variants', 'variants.collections'] });
        expect(restored.customFields.fulfillmentType).toBe('physical');
        expect(restored.variants[0].customFields.fulfillmentType).toBe('physical');
        expect(
            restored.variants[0].collections.some(item =>
                item.translations.some(translation => translation.name === '饮料'),
            ),
        ).toBe(true);
    });
    it('isolates ordinary stores and rejects a mismatched import without any catalog writes', async () => {
        const channels = server.app.get(ChannelService);
        const a = await channels.create(ctx, {
            code: 'import-store-a',
            token: 'import-store-a-test',
            defaultLanguageCode: ctx.languageCode,
            defaultCurrencyCode: ctx.currencyCode,
            defaultTaxZoneId: ctx.channel.defaultTaxZone.id,
            defaultShippingZoneId: ctx.channel.defaultShippingZone.id,
            pricesIncludeTax: ctx.channel.pricesIncludeTax,
        });
        const b = await channels.create(ctx, {
            code: 'import-store-b',
            token: 'import-store-b-test',
            defaultLanguageCode: ctx.languageCode,
            defaultCurrencyCode: ctx.currencyCode,
            defaultTaxZoneId: ctx.channel.defaultTaxZone.id,
            defaultShippingZoneId: ctx.channel.defaultShippingZone.id,
            pricesIncludeTax: ctx.channel.pricesIncludeTax,
        });
        if (!('id' in a) || !('id' in b)) throw new Error('Failed to create test stores');
        // Match the channel resolver's standard role assignments for these test channels.
        const roles = server.app.get(RoleService);
        for (const role of [await roles.getSuperAdminRole(ctx), await roles.getCustomerRole(ctx)]) {
            for (const channel of [a, b]) await roles.assignRoleToChannel(ctx, role.id, channel.id);
        }
        const aCtx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: a,
            languageCode: ctx.languageCode,
        });
        await server.app.get(StockLocationService).create(aCtx, { name: 'Store A warehouse' });
        const csv = `导入商店,名称,商品类型,一级分类,二级分类,SKU,进货价,销售价\n${a.code},A 店商品,实物,食品,饮料,STORE-A-001,1,2`;
        const before = await connection.rawConnection.getRepository(Product).count();
        const rejected = await importCsv(csv.replace(a.code, b.code), aCtx, true);
        const rows = await imports.findRows(aCtx, rejected.id);
        expect(rows[0].action).toBe('ERROR');
        expect(rows[0].message).toContain('导入商店');
        await expect(
            imports.resolveRows(aCtx, { rowIds: [rows[0].id], resolution: 'APPLY' }),
        ).rejects.toThrow();
        expect(await connection.rawConnection.getRepository(Product).count()).toBe(before);
        await importCsv(csv, aCtx);
        expect(await connection.rawConnection.getRepository(Product).count()).toBe(before + 1);
        await adminClient.asSuperAdmin();
        const query = gql`
            query {
                products {
                    items {
                        id
                        name
                    }
                    totalItems
                }
            }
        `;
        try {
            for (const client of [adminClient, shopClient]) {
                client.setChannelToken(a.token);
                expect(
                    (await client.query(query)).products.items.map((item: { name: string }) => item.name),
                ).toContain('A 店商品');
                client.setChannelToken(b.token);
                expect((await client.query(query)).products.totalItems).toBe(0);
                // The owner retains the aggregate catalog; a storefront only sees explicit sales assignments.
                client.setChannelToken(ctx.channel.token);
                expect((await client.query(query)).products.totalItems).toBe(
                    client === adminClient ? before + 1 : before,
                );
            }
        } finally {
            adminClient.setChannelToken(ctx.channel.token);
            shopClient.setChannelToken(ctx.channel.token);
        }
    });

    it('requires explicit default-store sharing and preserves the final store with or without SKUs', async () => {
        const products = server.app.get(ProductService);
        const variants = server.app.get(ProductVariantService);
        const credentials = config.authOptions.superadminCredentials;
        if (!credentials) throw new Error('Missing test administrator configuration');
        const user = await connection.rawConnection
            .getRepository(User)
            .findOneOrFail({ where: { identifier: credentials.identifier } });
        const aCtx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            user,
            channelOrToken: 'import-store-a-test',
            languageCode: ctx.languageCode,
        });
        const product = await connection.rawConnection.getRepository(Product).findOneOrFail({
            where: { translations: { name: 'A 店商品' } },
            relations: ['channels', 'variants', 'variants.channels'],
        });
        const variant = product.variants[0];
        await variants.update(aCtx, [{ id: variant.id, trackInventory: GlobalFlag.FALSE }]);
        expect(product.channels.map(channel => channel.id)).toEqual([aCtx.channelId]);
        expect(variant.channels.map(channel => channel.id)).toEqual([aCtx.channelId]);
        const reindex = async (context: RequestContext) => {
            adminClient.setChannelToken(context.channel.token);
            await adminClient.query(gql`
                mutation {
                    reindex {
                        id
                    }
                }
            `);
            await awaitRunningJobs(adminClient, 10000);
            adminClient.setChannelToken(ctx.channel.token);
        };
        const shop = async (listed: boolean) => {
            shopClient.setChannelToken(ctx.channel.token);
            const result = await shopClient.query(
                gql`
                    query ($id: ID!) {
                        product(id: $id) {
                            id
                            variants {
                                id
                            }
                        }
                        search(input: { term: "A 店商品", groupByProduct: true }) {
                            items {
                                productId
                            }
                        }
                    }
                `,
                { id: `T_${product.id}` },
            );
            expect(Boolean(result.product)).toBe(listed);
            expect(
                result.search.items.some(
                    (item: { productId: string }) => item.productId === `T_${product.id}`,
                ),
            ).toBe(listed);
            if (!listed) {
                await expect(
                    shopClient.query(
                        gql`
                            mutation ($id: ID!) {
                                addItemToOrder(productVariantId: $id, quantity: 1) {
                                    __typename
                                }
                            }
                        `,
                        { id: `T_${variant.id}` },
                    ),
                ).rejects.toThrow();
            }
        };
        try {
            await reindex(aCtx);
            await reindex(ctx);
            await shop(false);
            await adminClient.asSuperAdmin();
            const aggregate = await adminClient.query(
                gql`
                    query ($id: ID!) {
                        product(id: $id) {
                            id
                            channels {
                                id
                            }
                            variants {
                                id
                                channels {
                                    id
                                }
                            }
                        }
                    }
                `,
                { id: `T_${product.id}` },
            );
            expect(aggregate.product.id).toBe(`T_${product.id}`);
            expect(aggregate.product.channels.map((channel: { id: string }) => channel.id)).toEqual([
                `T_${aCtx.channelId}`,
            ]);
            expect(aggregate.product.variants).toHaveLength(1);
            await products.assignProductsToChannel(aCtx, {
                productIds: [product.id],
                channelId: ctx.channelId,
            });
            await reindex(ctx);
            await shop(true);
            const cart = await shopClient.query(
                gql`
                    mutation ($id: ID!) {
                        addItemToOrder(productVariantId: $id, quantity: 1) {
                            __typename
                        }
                    }
                `,
                { id: `T_${variant.id}` },
            );
            expect(cart.addItemToOrder.__typename).toBe('Order');
            await products.removeProductsFromChannel(aCtx, {
                productIds: [product.id],
                channelId: ctx.channelId,
            });
            await reindex(ctx);
            await shop(false);
            const checkout = await shopClient.query(gql`
                mutation {
                    transitionOrderToState(state: "ArrangingPayment") {
                        __typename
                        ... on OrderStateTransitionError {
                            transitionError
                        }
                    }
                }
            `);
            expect(checkout.transitionOrderToState.__typename).toBe('OrderStateTransitionError');
            expect(checkout.transitionOrderToState.transitionError).toContain('no longer available');
            await expect(
                products.removeProductsFromChannel(aCtx, {
                    productIds: [product.id],
                    channelId: aCtx.channelId,
                }),
            ).rejects.toThrow('至少保留一个销售店铺');
            await expect(
                variants.removeProductVariantsFromChannel(aCtx, {
                    productVariantIds: [variant.id],
                    channelId: aCtx.channelId,
                }),
            ).rejects.toThrow('至少保留一个销售店铺');
            await expect(
                server.app
                    .get(ChannelService)
                    .removeFromChannels(aCtx, ProductVariant, variant.id, [
                        aCtx.channelId,
                        String(aCtx.channelId),
                    ]),
            ).rejects.toThrow('至少保留一个销售店铺');
            const bare = await products.create(aCtx, {
                translations: [
                    { languageCode: ctx.languageCode, name: 'No SKU', slug: 'no-sku', description: '' },
                ],
            });
            await expect(
                products.removeProductsFromChannel(aCtx, {
                    productIds: [bare.id],
                    channelId: aCtx.channelId,
                }),
            ).rejects.toThrow('至少保留一个销售店铺');
            // A failure late in a batch must restore the previously removed shared product.
            await products.assignProductsToChannel(aCtx, {
                productIds: [product.id],
                channelId: ctx.channelId,
            });
            await expect(
                products.removeProductsFromChannel(aCtx, {
                    productIds: [product.id, bare.id],
                    channelId: aCtx.channelId,
                }),
            ).rejects.toThrow('至少保留一个销售店铺');
            const restored = await connection.rawConnection
                .getRepository(ProductVariant)
                .findOneOrFail({ where: { id: variant.id }, relations: ['channels'] });
            expect(restored.channels.map(channel => String(channel.id)).sort()).toEqual(
                [String(aCtx.channelId), String(ctx.channelId)].sort(),
            );
            await products.removeProductsFromChannel(aCtx, {
                productIds: [product.id],
                channelId: ctx.channelId,
            });
            await products.softDelete(aCtx, bare.id);
        } finally {
            shopClient.setChannelToken(ctx.channel.token);
            adminClient.setChannelToken(ctx.channel.token);
        }
    });

    it('downloads and previews the real template in desktop and mobile browsers', async () => {
        const root = join(process.cwd(), 'packages/next-admin');
        const entry = '.catalog-import-test.tsx';
        const html = '.catalog-import-test.html';
        const screenshotDir = join(process.cwd(), '../../reports/catalog-explicit-store-assignment-20260906');
        mkdirSync(screenshotDir, { recursive: true });
        writeFileSync(
            join(root, html),
            '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/' +
                entry +
                '"></script></body></html>',
        );
        writeFileSync(
            join(root, entry),
            `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
            import { ApolloProvider } from '@apollo/client/react';
            import { MemoryRouter } from 'react-router-dom';
            import { CatalogImportDialog } from './src/pages/Catalog/import/CatalogImportDialog';
            import { CatalogBulkChannelAction } from './src/pages/Catalog/CatalogBulkChannelAction';
            import { AdminPermissionsContext } from './src/hooks/use-admin-permissions';
            import { ConfirmDialogContext } from './src/components/confirm-dialog-context';
            import { FeatureHelpProvider } from './src/components/FeatureHelp';
            import './src/index.css';
            const client = new ApolloClient({
                cache: new InMemoryCache(),
                link: new HttpLink({ uri: '/admin-api', headers: {
                    'vendure-token': new URLSearchParams(location.search).get('channel') || '',
                } }),
            });
            function App() {
                const [importOpen, setImportOpen] = React.useState(true);
                return <><CatalogBulkChannelAction /><CatalogImportDialog open={importOpen} onClose={() => setImportOpen(false)} /></>;
            }
            createRoot(document.getElementById('root')!).render(
                <ApolloProvider client={client}><MemoryRouter><FeatureHelpProvider>
                <AdminPermissionsContext.Provider value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}>
                <ConfirmDialogContext.Provider value={async () => false}>
                <App />
                </ConfirmDialogContext.Provider></AdminPermissionsContext.Provider>
                </FeatureHelpProvider></MemoryRouter></ApolloProvider>);
        `,
        );
        const vite = await createServer({
            root,
            configFile: join(root, 'vite.config.ts'),
            envDir: false,
            logLevel: 'error',
            resolve: { dedupe: ['react', 'react-dom'] },
            server: {
                host: '127.0.0.1',
                port: 5198,
                strictPort: true,
                proxy: {
                    '/admin-api': {
                        target: 'http://127.0.0.1:3297',
                        headers: { authorization: `Bearer ${adminClient.getAuthToken()}` },
                    },
                },
            },
        });
        const browser = await chromium.launch({ headless: true });
        try {
            await vite.listen();
            const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('http://127.0.0.1:5198/' + html);
            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: '下载标准模板', exact: true }).click();
            const download = await downloadPromise;
            await download.saveAs(join(screenshotDir, '商品导入标准模板.csv'));
            const downloaded = readFileSync(join(screenshotDir, '商品导入标准模板.csv'));
            const parsedDownload = await parseCatalogArrayBuffer(
                Uint8Array.from(downloaded).buffer,
                'download.csv',
            );
            expect(parsedDownload.rows.map(row => row.channelCode)).toEqual([
                ctx.channel.code,
                ctx.channel.code,
            ]);
            await page.locator('input[type=file]').setInputFiles(join(screenshotDir, '商品导入标准模板.csv'));
            await page.getByRole('button', { name: '浏览器本地预检', exact: true }).click();
            await page.getByRole('button', { name: '生成数据库差异预览', exact: true }).click();
            await browserExpect(
                page.getByRole('columnheader', { name: '导入商店', exact: true }),
            ).toBeVisible();
            await browserExpect(
                page.getByRole('columnheader', { name: '商品类型', exact: true }),
            ).toBeVisible();
            await browserExpect(page.getByRole('cell', { name: '实物', exact: true })).toBeVisible();
            await browserExpect(page.getByRole('cell', { name: '虚拟货品', exact: true })).toBeVisible();
            await browserExpect(page.getByText('无二级分类', { exact: true })).toBeVisible();
            await page.screenshot({ path: join(screenshotDir, 'import-desktop.png'), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.getByRole('columnheader', { name: '商品类型', exact: true }).scrollIntoViewIfNeeded();
            await page.screenshot({ path: join(screenshotDir, 'import-mobile.png'), fullPage: true });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
                true,
            );
            expect(errors).toEqual([]);
            // The owner can inspect and change a shared product while operating from store A.
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.goto(`http://127.0.0.1:5198/${html}?channel=import-store-a-test`);
            await page.getByRole('button', { name: '关闭商品导入工作区' }).click();
            await page.getByRole('button', { name: '批量店铺', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: '商品批量店铺操作' });
            const aRow = dialog
                .locator('label')
                .filter({ has: page.getByRole('checkbox', { name: '选择商品：A 店商品', exact: true }) });
            await browserExpect(aRow.getByText('import-store-a', { exact: true })).toBeVisible();
            await browserExpect(aRow.getByText('默认店铺', { exact: true })).toHaveCount(0);
            await dialog.getByLabel('目标店铺', { exact: true }).selectOption({ label: 'import-store-b' });
            await browserExpect(aRow.getByText('未在目标店铺', { exact: true })).toBeVisible();
            await dialog.getByLabel('价格系数', { exact: true }).fill('2');
            await dialog.getByRole('checkbox', { name: '选择商品：A 店商品', exact: true }).check();
            await dialog.getByRole('button', { name: '确认分配', exact: true }).click();
            await browserExpect(dialog.getByRole('status')).toContainText('1 个商品');
            await browserExpect(aRow.getByText('import-store-b', { exact: true })).toBeVisible();
            await browserExpect(aRow.getByText('已在目标店铺', { exact: true })).toBeVisible();
            await browserExpect(
                dialog.getByRole('checkbox', { name: '选择商品：A 店商品', exact: true }),
            ).toBeDisabled();
            await browserExpect(dialog.getByRole('button', { name: '确认分配', exact: true })).toBeDisabled();
            shopClient.setChannelToken('import-store-b-test');
            const shared = await shopClient.query(gql`
                query {
                    products {
                        items {
                            id
                            variants {
                                id
                                price
                            }
                        }
                    }
                }
            `);
            expect(shared.products.items).toHaveLength(1);
            expect(shared.products.items[0].variants[0].price).toBe(400);
            await page.screenshot({
                path: join(screenshotDir, 'channel-assignments-desktop.png'),
                fullPage: true,
            });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.screenshot({
                path: join(screenshotDir, 'channel-assignments-mobile.png'),
                fullPage: true,
            });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
                true,
            );
            await dialog.getByLabel('操作', { exact: true }).selectOption('remove');
            await dialog.getByRole('checkbox', { name: '选择商品：A 店商品', exact: true }).check();
            await dialog.getByRole('button', { name: '确认移除', exact: true }).click();
            await browserExpect(dialog.getByRole('status')).toContainText('移除 1 个商品');
            await browserExpect(aRow.getByText('未在目标店铺', { exact: true })).toBeVisible();
            await browserExpect(aRow.getByText('import-store-a', { exact: true })).toBeVisible();
            await browserExpect(
                dialog.getByRole('checkbox', { name: '选择商品：A 店商品', exact: true }),
            ).toBeDisabled();
            expect(
                (
                    await shopClient.query(gql`
                        query {
                            products {
                                totalItems
                            }
                        }
                    `)
                ).products.totalItems,
            ).toBe(0);
            shopClient.setChannelToken('import-store-a-test');
            expect(
                (
                    await shopClient.query(gql`
                        query {
                            products {
                                totalItems
                            }
                        }
                    `)
                ).products.totalItems,
            ).toBe(1);
            shopClient.setChannelToken(ctx.channel.token);
            await dialog.getByLabel('目标店铺', { exact: true }).selectOption({ label: '默认店铺' });
            await browserExpect(dialog.getByRole('button', { name: '确认移除', exact: true })).toBeDisabled();
            await dialog.getByLabel('操作', { exact: true }).selectOption('assign');
            await dialog.getByRole('checkbox', { name: '选择商品：A 店商品', exact: true }).check();
            await dialog.getByRole('button', { name: '确认分配', exact: true }).click();
            await browserExpect(aRow.getByText('默认店铺', { exact: true })).toBeVisible();
            await dialog.getByLabel('操作', { exact: true }).selectOption('remove');
            await dialog.getByRole('checkbox', { name: '选择商品：A 店商品', exact: true }).check();
            await dialog.getByRole('button', { name: '确认移除', exact: true }).click();
            await browserExpect(aRow.getByText('默认店铺', { exact: true })).toHaveCount(0);
            await dialog.getByLabel('目标店铺', { exact: true }).selectOption({ label: 'import-store-a' });
            await browserExpect(
                dialog.getByRole('checkbox', { name: '选择商品：A 店商品', exact: true }),
            ).toBeDisabled();
            expect(errors).toEqual([]);
        } finally {
            await browser.close();
            await vite.close();
            unlinkSync(join(root, entry));
            unlinkSync(join(root, html));
        }
    }, 120000);
});
