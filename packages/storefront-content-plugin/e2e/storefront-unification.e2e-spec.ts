import { expect as browserExpect, chromium } from '@playwright/test';
import { AssetType, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Asset,
    AssetTranslation,
    AutoIncrementIdStrategy,
    Customer,
    DefaultSearchPlugin,
    mergeConfig,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdtempSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';
import { createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { StoreProfile } from '../../store-management-plugin/src/entities/store-profile.entity';
import { StorefrontContentPlugin } from '../src/storefront-content.plugin';
import { storefrontVisualPresets } from '../src/visual-presets';

import { BrandingFixturePlugin } from './branding-fixture.plugin';

// A new in-memory SQL.js database and a loopback API. No existing configuration or account is used.
const config = mergeConfig(testConfig, {
    authOptions: { requireVerification: false, tokenMethod: ['cookie', 'bearer'] },
    apiOptions: {
        port: 5299,
        hostname: '127.0.0.1',
        middleware: [
            {
                route: '/assets',
                beforeListen: true,
                handler: (request, response) => {
                    const isSecondStore = request.url.includes('store-1.svg');
                    response.type('image/svg+xml').send(
                        `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
                            <rect width="1200" height="600" fill="${isSecondStore ? '#314b65' : '#675744'}"/>
                            <circle cx="950" cy="300" r="180" fill="${isSecondStore ? '#a2c6df' : '#ddc2a1'}"/>
                            <text x="60" y="480" fill="white" font-size="42">Saved image for store ${isSecondStore ? 1 : 0}</text></svg>`,
                    );
                },
            },
        ],
    },
    entityOptions: { entityIdStrategy: new AutoIncrementIdStrategy() },
    customFields: {
        Channel: [
            {
                name: 'storefrontNameZh',
                type: 'string',
                nullable: false,
                defaultValue: '测试店铺',
                public: true,
            },
            {
                name: 'storefrontNameEn',
                type: 'string',
                nullable: false,
                defaultValue: 'Test store',
                public: true,
            },
        ],
    },
    plugins: [
        ContentTranslationPlugin,
        StorefrontContentPlugin,
        BrandingFixturePlugin,
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
const FIELDS = `id code type enabled position imageUrl title subtitle body ctaLabel settings items { id label description }`;
const READ = gql`query ReadStoreContent {
    storefrontContentBlocks { ${FIELDS} }
    storefrontContentSettings { heroAutoplayIntervalSeconds configuredBlockTypes }
}`;
const SHOP_READ = gql`query ReadPublishedStoreContent {
    storefrontContentBlocks: storefrontContent { ${FIELDS} }
    storefrontContentSettings { heroAutoplayIntervalSeconds configuredBlockTypes }
}`;
const CREATE = gql`
    mutation CreateStoreContent($input: CreateStorefrontContentBlockInput!) {
        createStorefrontContentBlock(input: $input) {
            id
            updatedAt
        }
    }
`;
const UPDATE = gql`
    mutation UpdateStoreContent($input: UpdateStorefrontContentBlockInput!) {
        updateStorefrontContentBlock(input: $input) {
            id
            updatedAt
        }
    }
`;
const REORDER = gql`
    mutation ReorderStoreContent($ids: [ID!]!) {
        reorderStorefrontContentBlocks(ids: $ids) {
            id
            position
            updatedAt
        }
    }
`;
const SETTINGS = gql`
    mutation StoreContentInterval($input: UpdateStorefrontContentSettingsInput!) {
        updateStorefrontContentSettings(input: $input) {
            heroAutoplayIntervalSeconds
        }
    }
`;
const stores: Array<{ id: string; token: string }> = [];
const heroes: Array<{ id: string; updatedAt: string }> = [];
const copy = (title: string, english: string) => [
    { languageCode: LanguageCode.zh_Hans, title, subtitle: '', body: '', ctaLabel: '' },
    { languageCode: LanguageCode.en, title: english, subtitle: '', body: '', ctaLabel: '' },
];
const testOutput =
    process.env.STOREFRONT_TEST_OUTPUT ??
    fileURLToPath(new URL('../../storefront/artifacts/content-sync-audit/integration/', import.meta.url));

beforeAll(async () => {
    await mkdir(testOutput, { recursive: true });
    registerInitializer('sqljs', new SqljsInitializer(mkdtempSync(join(testOutput, 'database-'))));
    await server.init({
        initialData: { ...initialData, collections: [], paymentMethods: [] },
        customerCount: 0,
    });
    await adminClient.asSuperAdmin();
    await shopClient.query(gql`
        mutation {
            registerCustomerAccount(
                input: {
                    emailAddress: "unified-catalog@example.test"
                    password: "UnifiedFixturePass123!"
                    firstName: "Unified"
                    lastName: "Fixture"
                }
            ) {
                __typename
            }
        }
    `);
    await shopClient.asUserWithCredentials('unified-catalog@example.test', 'UnifiedFixturePass123!');
    const { activeChannel, zones } = await adminClient.query(gql`
        query {
            activeChannel {
                id
                token
                defaultTaxZone {
                    id
                }
                defaultShippingZone {
                    id
                }
            }
            zones {
                items {
                    id
                }
            }
        }
    `);
    await adminClient.query(
        gql`
            mutation UpdateDefaultStoreLanguages($input: UpdateChannelInput!) {
                updateChannel(input: $input) {
                    ... on Channel {
                        id
                    }
                }
            }
        `,
        { input: { id: activeChannel.id, availableLanguageCodes: [LanguageCode.en, LanguageCode.zh_Hans] } },
    );
    if (!zones.items.length) {
        const { createZone } = await adminClient.query(gql`
            mutation {
                createZone(input: { name: "Unification test zone" }) {
                    id
                }
            }
        `);
        zones.items.push(createZone);
    }
    stores.push(activeChannel);
    for (const code of ['unified-store-b', 'unified-new-store']) {
        const { createChannel } = await adminClient.query(
            gql`
                mutation CreateChannelForIsolation($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        ... on Channel {
                            id
                            token
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
                    defaultLanguageCode: LanguageCode.en,
                    availableLanguageCodes: [LanguageCode.en, LanguageCode.zh_Hans],
                    defaultCurrencyCode: 'USD',
                    pricesIncludeTax: false,
                    defaultTaxZoneId: activeChannel.defaultTaxZone?.id ?? zones.items[0].id,
                    defaultShippingZoneId: activeChannel.defaultShippingZone?.id ?? zones.items[0].id,
                },
            },
        );
        expect(createChannel.id).toBeTruthy();
        stores.push(createChannel);
    }
    const connection = server.app.get(TransactionalConnection);
    const fixtureCustomer = await connection.rawConnection.getRepository(Customer).findOneByOrFail({
        emailAddress: 'unified-catalog@example.test',
    });
    await connection.rawConnection
        .createQueryBuilder()
        .relation(Customer, 'channels')
        .of(fixtureCustomer.id)
        .add(stores.slice(1).map(store => store.id));
    for (const [index, store] of stores.slice(0, 2).entries()) {
        await connection.rawConnection.getRepository(StoreProfile).save(
            new StoreProfile({
                channelId: Number(store.id),
                descriptionZh: '',
                descriptionEn: '',
                brandBackgroundColor: index === 0 ? '#eee8e0' : '#edf5fb',
                brandPrimaryColor: index === 0 ? '#15803d' : '#7c3aed',
            }),
        );
        const asset = await connection.rawConnection.getRepository(Asset).save(
            new Asset({
                name: `store-${index}.svg`,
                type: AssetType.IMAGE,
                fileSize: 400,
                mimeType: 'image/svg+xml',
                width: 1200,
                height: 600,
                source: `store-${index}.svg`,
                preview: `store-${index}.svg`,
                channels: [{ id: Number(store.id) }],
            }),
        );
        adminClient.setChannelToken(store.token);
        const { createStorefrontContentBlock } = await adminClient.query(CREATE, {
            input: {
                code: 'shared-hero-code',
                type: 'HERO',
                enabled: true,
                position: 1,
                imageAssetId: String(asset.id),
                settings: { themePreset: 'bright' },
                translations: copy(`店铺${index}轮播`, `Store ${index} carousel`),
                items: [],
            },
        });
        heroes.push(createStorefrontContentBlock);
        await adminClient.query(CREATE, {
            input: {
                code: 'shared-links-code',
                type: 'QUICK_LINKS',
                enabled: true,
                position: 2,
                translations: copy('入口', 'Links'),
                items: Array.from({ length: 8 }, (_, position) => ({
                    enabled: true,
                    position,
                    targetType: 'NONE',
                    translations: [
                        {
                            languageCode: LanguageCode.zh_Hans,
                            label: `店${index}入口${position}`,
                            description: '',
                        },
                        {
                            languageCode: LanguageCode.en,
                            label: `Store ${index} link ${position}`,
                            description: '',
                        },
                    ],
                })),
            },
        });
        await adminClient.query(CREATE, {
            input: {
                code: 'share-only',
                type: 'CUSTOM',
                enabled: true,
                position: 3,
                settings: { purpose: 'referral-system-poster' },
                translations: copy('分享海报', 'Sharing poster'),
                items: [],
            },
        });
    }
}, 90_000);
afterAll(async () => {
    await server.destroy();
});

describe('unified storefront Admin API to Shop API', () => {
    it('shows configured dual cards in the actual homepage and follows Admin enable state and floor order', async () => {
        const cores = [] as Array<{ id: string; updatedAt: string }>;
        const originalOrders: string[][] = [];
        for (const [index, store] of stores.slice(0, 2).entries()) {
            adminClient.setChannelToken(store.token);
            originalOrders.push(
                (await adminClient.query(READ)).storefrontContentBlocks.map(
                    (block: { id: string }) => block.id,
                ),
            );
            cores.push(
                (
                    await adminClient.query(CREATE, {
                        input: {
                            code: 'configured-core',
                            internalName: '后台双卡片验收',
                            type: 'CORE_CATEGORIES',
                            enabled: true,
                            position: 0,
                            translations: copy('配置双卡片', 'Configured dual cards'),
                            items: [3, 0, 2, 1].map(position => ({
                                enabled: position !== 0,
                                position,
                                targetType: 'PAGE',
                                targetValue: 'category',
                                translations: [
                                    {
                                        languageCode: LanguageCode.zh_Hans,
                                        label: `店${index}卡片${position}`,
                                        description: '',
                                    },
                                    {
                                        languageCode: LanguageCode.en,
                                        label: `Store ${index} card ${position}`,
                                        description: '',
                                    },
                                ],
                            })),
                        },
                    })
                ).createStorefrontContentBlock,
            );
            shopClient.setChannelToken(store.token);
            const admin = (await adminClient.query(READ)).storefrontContentBlocks.find(
                (block: { id: string }) => block.id === cores[index].id,
            );
            expect(admin.items).toHaveLength(4);
            const shop = (await shopClient.query(SHOP_READ)).storefrontContentBlocks.find(
                (block: { id: string }) => block.id === cores[index].id,
            );
            expect(shop.items.map((item: { label: string }) => item.label)).toEqual([
                `Store ${index} card 1`,
                `Store ${index} card 2`,
            ]);
        }
        const adminVite = await createServer({
            root: fileURLToPath(new URL('../../next-admin', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5301,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299', '/assets': 'http://127.0.0.1:5299' },
            },
        });
        const shopVite = await createServer({
            root: fileURLToPath(new URL('../../storefront', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5300,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299' },
            },
        });
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
            ({ auth, channel }) => {
                if (window !== window.top) return;
                sessionStorage.setItem('local-test-admin-token', auth);
                localStorage.setItem('vendure-active-channel-token', channel);
            },
            { auth: adminClient.getAuthToken(), channel: stores[0].token },
        );
        const errors: string[] = [];
        try {
            await adminVite.listen();
            await shopVite.listen();
            const admin = await context.newPage();
            admin.on('pageerror', error => errors.push(error.message));
            await admin.goto(
                `http://127.0.0.1:5301/e2e/storefront-visual/index.html?panel=decoration&stores=${stores
                    .slice(0, 2)
                    .map(store => store.token)
                    .join(',')}`,
            );
            const row = admin.getByRole('article', { name: '后台双卡片验收', exact: true });
            await browserExpect(row).toContainText('已发布');
            const structure = admin
                .frameLocator('iframe[title="客户端装修效果"]')
                .locator('.home-dual-showcase');
            await browserExpect(structure).toContainText('店0卡片1');
            await browserExpect(structure).toContainText('店0卡片2');
            await browserExpect(structure).not.toContainText('店0卡片0');
            await browserExpect(structure).not.toContainText('店0卡片3');
            const shops = [] as Array<{
                page: Awaited<ReturnType<typeof browser.newPage>>;
                index: number;
                width: number;
            }>;
            for (const [index, store] of stores.slice(0, 2).entries()) {
                for (const width of [390, 1440]) {
                    const page = await browser.newPage({ viewport: { width, height: 1000 } });
                    page.on('pageerror', error => errors.push(error.message));
                    const login = await page.request.post('http://127.0.0.1:5299/shop-api', {
                        data: {
                            query: 'mutation { login(username: "unified-catalog@example.test", password: "UnifiedFixturePass123!") { __typename } }',
                        },
                    });
                    expect((await login.json()).data.login.__typename).toBe('CurrentUser');
                    await page.goto(
                        `http://127.0.0.1:5300/e2e/unification/index.html?channel=${store.token}&name=Store-${index}`,
                    );
                    await browserExpect(page.locator('.home-dual-showcase button')).toHaveCount(2);
                    await browserExpect(page.locator('.home-dual-showcase h3')).toHaveText([
                        `店${index}卡片1`,
                        `店${index}卡片2`,
                    ]);
                    await browserExpect(page.locator('.home-dual-showcase button').first()).toBeEnabled();
                    await page.screenshot({
                        path: join(testOutput, `core-store-${index}-${width}.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                    shops.push({ page, index, width });
                }
            }
            const first = shops[0].page;
            const order = () =>
                first.locator('.home-dual-showcase').evaluate(element => {
                    const parent = element.parentElement;
                    if (!parent) throw new Error('Core cards have no floor container');
                    return getComputedStyle(parent).order;
                });
            const before = await order();
            await row.getByRole('button', { name: '下移', exact: true }).click();
            await browserExpect(admin.getByRole('status').filter({ hasText: '已重新读取核对' })).toBeVisible();
            await first.reload();
            await browserExpect(first.locator('.home-dual-showcase')).toBeVisible();
            expect(Number(await order())).toBeGreaterThan(Number(before));
            await row.getByRole('button', { name: '停用楼层', exact: true }).click();
            await browserExpect(row).toContainText('已停用');
            for (const { page, index } of shops) {
                await page.reload();
                await browserExpect(page.locator('.home-page')).toBeVisible();
                await browserExpect(page.locator('.home-dual-showcase button')).toHaveCount(
                    index === 0 ? 0 : 2,
                );
            }
            await row.getByRole('button', { name: '启用楼层', exact: true }).click();
            await browserExpect(row).toContainText('已发布');
            for (const { page, index, width } of shops) {
                await page.reload();
                await browserExpect(page.locator('.home-dual-showcase h3')).toHaveText([
                    `店${index}卡片1`,
                    `店${index}卡片2`,
                ]);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
                    true,
                );
                await page.screenshot({
                    path: join(testOutput, `core-restored-${index}-${width}.png`),
                    fullPage: true,
                    animations: 'disabled',
                });
            }
            expect(errors).toEqual([]);
        } finally {
            await browser.close();
            await shopVite.close();
            await adminVite.close();
            for (const [index, store] of stores.slice(0, 2).entries()) {
                adminClient.setChannelToken(store.token);
                const deleted = await adminClient.query(
                    gql`
                        mutation DeleteTestCore($id: ID!) {
                            deleteStorefrontContentBlock(id: $id) {
                                result
                            }
                        }
                    `,
                    { id: cores[index].id },
                );
                expect(deleted.deleteStorefrontContentBlock.result).toBe('DELETED');
                const restored = await adminClient.query(REORDER, { ids: originalOrders[index] });
                heroes[index] = restored.reorderStorefrontContentBlocks.find(
                    (block: { id: string }) => block.id === heroes[index].id,
                );
            }
        }
    }, 180_000);
    it('preserves each store image, translation, empty fields and all eight links with the same content codes', async () => {
        for (const [index, store] of stores.slice(0, 2).entries()) {
            adminClient.setChannelToken(store.token);
            shopClient.setChannelToken(store.token);
            const admin = await adminClient.query(READ);
            expect(admin.storefrontContentBlocks.map((b: { code: string }) => b.code)).toContain(
                'share-only',
            );
            for (const locale of [LanguageCode.en, LanguageCode.zh_Hans]) {
                shopClient.setRequestHeader('language-code', locale);
                const result = await shopClient.query(SHOP_READ, {}, { languageCode: locale });
                const blocks = result.storefrontContentBlocks;
                expect(blocks.map((b: { code: string }) => b.code)).toEqual([
                    'shared-hero-code',
                    'shared-links-code',
                ]);
                expect(blocks[0].imageUrl).toBe(`/assets/store-${index}.svg`);
                expect(blocks[0].title).toBe(
                    locale === LanguageCode.en ? `Store ${index} carousel` : `店铺${index}轮播`,
                );
                expect([blocks[0].subtitle, blocks[0].body, blocks[0].ctaLabel]).toEqual(['', '', '']);
                expect(blocks[1].items).toHaveLength(8);
            }
        }
    });
    it('isolates updates, disabled blocks, ordering, interval settings and rejects cross-store IDs', async () => {
        adminClient.setChannelToken(stores[0].token);
        const first = await adminClient.query(READ);
        const reordered = await adminClient.query(REORDER, {
            ids: [
                first.storefrontContentBlocks[1].id,
                first.storefrontContentBlocks[0].id,
                first.storefrontContentBlocks[2].id,
            ],
        });
        heroes[0] = reordered.reorderStorefrontContentBlocks.find(
            (block: { id: string }) => block.id === heroes[0].id,
        );
        shopClient.setChannelToken(stores[0].token);
        expect(
            (await shopClient.query(SHOP_READ)).storefrontContentBlocks.map(
                (block: { code: string }) => block.code,
            ),
        ).toEqual(['shared-links-code', 'shared-hero-code']);
        const updated = await adminClient.query(UPDATE, {
            input: { id: heroes[0].id, expectedUpdatedAt: heroes[0].updatedAt, enabled: false },
        });
        expect(updated.updateStorefrontContentBlock.id).toBe(heroes[0].id);
        await adminClient.query(SETTINGS, { input: { heroAutoplayIntervalSeconds: 11 } });
        shopClient.setChannelToken(stores[0].token);
        const disabled = await shopClient.query(SHOP_READ);
        expect(disabled.storefrontContentBlocks.map((b: { type: string }) => b.type)).toEqual([
            'QUICK_LINKS',
        ]);
        expect(disabled.storefrontContentSettings.heroAutoplayIntervalSeconds).toBe(11);
        adminClient.setChannelToken(stores[1].token);
        await expect(
            adminClient.query(UPDATE, {
                input: {
                    id: heroes[0].id,
                    expectedUpdatedAt: updated.updateStorefrontContentBlock.updatedAt,
                    enabled: true,
                },
            }),
        ).rejects.toThrow();
        shopClient.setChannelToken(stores[1].token);
        const second = await shopClient.query(SHOP_READ);
        expect(second.storefrontContentBlocks[0].id).toBe(heroes[1].id);
        expect(second.storefrontContentSettings.heroAutoplayIntervalSeconds).toBe(5);
    });
    it('starts a third store with empty saved content and identical settings defaults', async () => {
        adminClient.setChannelToken(stores[2].token);
        shopClient.setChannelToken(stores[2].token);
        const admin = await adminClient.query(READ);
        const shop = await shopClient.query(SHOP_READ);
        expect(admin.storefrontContentBlocks).toEqual([]);
        expect(shop.storefrontContentBlocks).toEqual([]);
        expect(shop.storefrontContentSettings).toEqual({
            heroAutoplayIntervalSeconds: 5,
            configuredBlockTypes: [],
        });
    });
    it('renders the saved Shop API data in the real homepage at mobile and desktop widths', async () => {
        const root = fileURLToPath(new URL('../../storefront', import.meta.url));
        const vite = await createServer({
            root,
            server: {
                host: '127.0.0.1',
                port: 5300,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299' },
            },
        });
        const browser = await chromium.launch({ headless: true });
        const output = testOutput;
        await mkdir(output, { recursive: true });
        try {
            await vite.listen();
            for (const width of [390, 1440]) {
                const page = await browser.newPage({ viewport: { width, height: 844 } });
                const signedIn = await page.request.post('http://127.0.0.1:5299/shop-api', {
                    data: {
                        query: 'mutation { login(username: "unified-catalog@example.test", password: "UnifiedFixturePass123!") { __typename } }',
                    },
                });
                expect((await signedIn.json()).data.login.__typename).toBe('CurrentUser');
                const errors: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('console', message => {
                    if (message.type() === 'error' && message.text().includes('React'))
                        errors.push(message.text());
                });
                for (const [index, store] of stores.entries()) {
                    await page.goto(
                        `http://127.0.0.1:5300/e2e/unification/index.html?channel=${store.token}&name=Store-${index}`,
                    );
                    if (index < 2) {
                        await browserExpect(page.locator('.quick-grid > button')).toHaveCount(
                            width >= 1024 ? 5 : 8,
                        );
                        if (width >= 1024) await page.getByRole('button', { name: '下一组快捷入口' }).click();
                        await browserExpect(page.locator('.quick-grid')).toContainText(`店${index}入口7`);
                        await browserExpect(page.locator('.hero')).toHaveCount(index === 1 ? 1 : 0);
                        await browserExpect(page.locator('.homepage-modules')).not.toContainText('分享海报');
                        await page.locator('.locale-preferences-trigger:visible').click();
                        await page.getByRole('radio', { name: 'English' }).click();
                        await page.getByRole('button', { name: '保存设置' }).click();
                        await browserExpect(page.locator('.quick-grid')).toContainText(
                            `Store ${index} link 7`,
                        );
                        if (index === 1) {
                            await browserExpect(page.locator('.hero-rich-title')).toHaveText(
                                'Store 1 carousel',
                            );
                            const savedImage = page.locator('.hero img.safe-image');
                            await browserExpect(savedImage).toHaveAttribute('src', /store-1\.svg/);
                            await browserExpect
                                .poll(() =>
                                    savedImage.evaluate(
                                        (img: HTMLImageElement) =>
                                            img.complete && img.naturalWidth > 0 && img.clientHeight > 0,
                                    ),
                                )
                                .toBe(true);
                            await browserExpect(
                                page.locator(
                                    '.hero-rich-pill, .hero-rich-desc, .hero-rich-stats-row, .hero-rich-cta-btn',
                                ),
                            ).toHaveCount(0);
                        }
                    } else {
                        await browserExpect(page.locator('.homepage-modules')).toBeVisible();
                        await browserExpect(page.locator('.hero, .quick-grid, .home-trust-bar')).toHaveCount(
                            0,
                        );
                    }
                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                    ).toBe(true);
                    await page.screenshot({
                        path: join(output, `shop-${index}-${width}.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                }
                expect(errors).toEqual([]);
                await page.close();
            }
        } finally {
            await browser.close();
            await vite.close();
        }
    }, 60_000);
    it('renders configured auth visuals in the responsive login and registration layouts', async () => {
        for (const [index, store] of stores.slice(0, 2).entries()) {
            adminClient.setChannelToken(store.token);
            const asset = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(Asset)
                .findOneByOrFail({ source: `store-${index}.svg` });
            for (const type of ['AUTH_LOGIN', 'AUTH_REGISTER']) {
                await adminClient.query(CREATE, {
                    input: {
                        code: type === 'AUTH_LOGIN' ? 'auth-login-visual' : 'auth-register-visual',
                        type,
                        layoutVariant: 'HERO_OVERLAY',
                        targetType: 'NONE',
                        position: type === 'AUTH_LOGIN' ? 1000 : 1010,
                        enabled: true,
                        imageAssetId: String(asset.id),
                        backgroundColor: index === 0 ? '#203346' : '#f6f2ea',
                        textColor: index === 0 ? '#ffffff' : '#203346',
                        settings: { accentColor: index === 0 ? '#a63d32' : '#2f6feb' },
                        translations: copy(
                            `${index === 0 ? 'MOYAO' : '大马通'}主标题`,
                            `${index === 0 ? 'MOYAO' : 'Damatong'} title`,
                        ),
                        items: [],
                    },
                });
            }
            const admin = await adminClient.query(READ);
            shopClient.setChannelToken(store.token);
            const shop = await shopClient.query(SHOP_READ);
            expect(
                shop.storefrontContentBlocks.filter((block: { type: string }) =>
                    block.type.startsWith('AUTH_'),
                ),
            ).toEqual(
                admin.storefrontContentBlocks.filter((block: { type: string }) =>
                    block.type.startsWith('AUTH_'),
                ),
            );
        }
        const vite = await createServer({
            root: fileURLToPath(new URL('../../storefront', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5300,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299' },
            },
        });
        const browser = await chromium.launch({ headless: true });
        const output = testOutput;
        await mkdir(output, { recursive: true });
        try {
            await vite.listen();
            for (const width of [390, 1024, 1440, 1920]) {
                const page = await browser.newPage({ viewport: { width, height: 1000 } });
                const signedIn = await page.request.post('http://127.0.0.1:5299/shop-api', {
                    data: {
                        query: 'mutation { login(username: "unified-catalog@example.test", password: "UnifiedFixturePass123!") { __typename } }',
                    },
                });
                expect((await signedIn.json()).data.login.__typename).toBe('CurrentUser');
                const errors: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('console', message => {
                    if (message.type() === 'error' && message.text().includes('React'))
                        errors.push(message.text());
                });
                for (const [index, store] of stores.entries())
                    for (const route of ['login', 'register']) {
                        const name = ['MOYAO', 'Damatong', 'Store'][index];
                        await page.goto(
                            `http://127.0.0.1:5300/e2e/unification/index.html?channel=${store.token}&name=${name}&page=${route}`,
                        );
                        for (const language of ['zh', 'en']) {
                            if (language === 'en') await page.locator('.language-button').click();
                            await page
                                .locator('.auth-page')
                                .waitFor({ state: 'visible', timeout: 5000 })
                                .catch(async () => {
                                    throw new Error(
                                        JSON.stringify({
                                            errors,
                                            body: await page.locator('body').innerText(),
                                        }),
                                    );
                                });
                            if (index < 2) {
                                await browserExpect(page.locator('.auth-hero-copy h2')).toHaveText(
                                    language === 'zh'
                                        ? `${index === 0 ? 'MOYAO' : '大马通'}主标题`
                                        : `${name} title`,
                                );
                                const imageLocator = page.locator('.auth-hero img');
                                if (width >= 1024) {
                                    await browserExpect(imageLocator).toHaveAttribute(
                                        'src',
                                        new RegExp(`store-${index}\\.svg`),
                                    );
                                    await browserExpect
                                        .poll(() =>
                                            imageLocator.evaluate(
                                                (img: HTMLImageElement) =>
                                                    img.complete &&
                                                    img.naturalWidth > 0 &&
                                                    img.clientHeight > 0,
                                            ),
                                        )
                                        .toBe(true);
                                    await browserExpect(imageLocator).toHaveCSS('object-fit', 'contain');
                                    await browserExpect(imageLocator).toHaveCSS('filter', 'none');
                                    await browserExpect(page.locator('.auth-hero-copy')).toHaveCSS(
                                        'background-color',
                                        'rgba(0, 0, 0, 0)',
                                    );
                                    await browserExpect(page.locator('.auth-hero-copy')).toHaveCSS(
                                        'box-shadow',
                                        'none',
                                    );
                                } else {
                                    // The mobile form does not download a hero hidden by the layout.
                                    await browserExpect(imageLocator).toHaveCount(0);
                                }
                                const overlay = await page.locator('.auth-hero').evaluate(hero => ({
                                    background: getComputedStyle(hero, '::after').backgroundImage,
                                    display: getComputedStyle(hero, '::after').display,
                                    color: getComputedStyle(hero)
                                        .getPropertyValue('--auth-hero-overlay-color')
                                        .trim(),
                                }));
                                expect(['none', '']).toContain(overlay.background);
                                expect(overlay.display).toBe('none');
                                expect(overlay.color.toLowerCase()).toBe(index === 0 ? '#203346' : '#f6f2ea');
                                if (width < 1024) {
                                    await browserExpect(page.locator('.auth-hero')).toBeHidden();
                                    await browserExpect(
                                        page.locator('.auth-mobile-back-button'),
                                    ).toBeVisible();
                                    await browserExpect(page.locator('.auth-form-heading')).toBeVisible();
                                } else {
                                    await browserExpect(page.locator('.auth-hero')).toBeVisible();
                                    await browserExpect(
                                        page.locator('.auth-mobile-back-button'),
                                    ).toBeHidden();
                                    const heroBox = await page.locator('.auth-hero').boundingBox();
                                    const copyBox = await page.locator('.auth-hero-copy').boundingBox();
                                    const formBox = await page.locator('.login-content').boundingBox();
                                    if (!heroBox || !copyBox || !formBox)
                                        throw new Error('Missing rendered hero, copy or form');
                                    expect(copyBox.x).toBeGreaterThanOrEqual(heroBox.x);
                                    expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(
                                        heroBox.x + heroBox.width + 1,
                                    );
                                    expect(copyBox.y).toBeGreaterThanOrEqual(heroBox.y);
                                    expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(
                                        heroBox.y + heroBox.height + 1,
                                    );
                                    expect(formBox.x).toBeGreaterThanOrEqual(heroBox.x + heroBox.width - 1);
                                    expect(formBox.y).toBeCloseTo(heroBox.y, 0);
                                    const assuranceRail = page.locator('.auth-assurance-rail');
                                    const railBox = await assuranceRail.boundingBox();
                                    if (!railBox) throw new Error('Missing desktop assurance rail');
                                    expect(railBox.height).toBeLessThan(140);
                                    const itemTops = await assuranceRail
                                        .locator('.auth-assurance-item')
                                        .evaluateAll(items =>
                                            items.map(item => item.getBoundingClientRect().top),
                                        );
                                    expect(itemTops).toHaveLength(4);
                                    expect(Math.max(...itemTops) - Math.min(...itemTops)).toBeLessThan(2);
                                }
                            } else {
                                if (width < 1024) {
                                    await browserExpect(page.locator('.auth-hero img')).toHaveCount(0);
                                    await browserExpect(page.locator('.auth-hero')).toBeHidden();
                                } else {
                                    await browserExpect(page.locator('.auth-hero img')).toHaveAttribute(
                                        'src',
                                        new RegExp(`auth-${route}-ai-campaign-v2`),
                                    );
                                    await browserExpect(page.locator('.auth-hero')).toBeVisible();
                                }
                                await browserExpect(page.locator('.auth-page')).not.toContainText('MOYAO');
                            }
                            expect(
                                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                            ).toBe(true);
                            await page.screenshot({
                                path: join(output, `auth-${name}-${route}-${language}-${width}.png`),
                                fullPage: true,
                                animations: 'disabled',
                            });
                        }
                    }
                expect(errors).toEqual([]);
                await page.close();
            }
        } finally {
            await browser.close();
            await vite.close();
        }
    }, 180_000);
    it('round-trips partial skin/layout updates, isolates channels and rejects stale editors', async () => {
        const READ_VISUAL = gql`
            query {
                storefrontVisualPreset {
                    channelId
                    presetId
                    desktopLayout
                    revision
                }
            }
        `;
        const SAVE_VISUAL = gql`
            mutation ($input: UpdateStorefrontVisualPresetInput!) {
                updateStorefrontVisualPreset(input: $input) {
                    channelId
                    presetId
                    desktopLayout
                    revision
                }
            }
        `;
        for (const store of stores) {
            adminClient.setChannelToken(store.token);
            shopClient.setChannelToken(store.token);
            const initial = (await adminClient.query(READ_VISUAL)).storefrontVisualPreset;
            expect(initial).toEqual({
                channelId: store.id,
                presetId: 'classic',
                desktopLayout: 'classic',
                revision: 'default',
            });
            const before = await adminClient.query(READ);
            const skin = (
                await adminClient.query(SAVE_VISUAL, {
                    input: {
                        channelId: store.id,
                        presetId: 'modern-oriental',
                        expectedRevision: initial.revision,
                    },
                })
            ).updateStorefrontVisualPreset;
            const layout = (
                await adminClient.query(SAVE_VISUAL, {
                    input: { channelId: store.id, desktopLayout: 'catalog', expectedRevision: skin.revision },
                })
            ).updateStorefrontVisualPreset;
            expect(layout).toMatchObject({ presetId: 'modern-oriental', desktopLayout: 'catalog' });
            expect((await shopClient.query(READ_VISUAL)).storefrontVisualPreset).toEqual(layout);
            expect(await adminClient.query(READ)).toEqual(before);
            await expect(
                adminClient.query(SAVE_VISUAL, {
                    input: { channelId: store.id, presetId: 'classic', expectedRevision: skin.revision },
                }),
            ).rejects.toThrow(/其他管理员/);
            await expect(
                adminClient.query(CREATE, {
                    input: {
                        code: 'storefront-visual-preset',
                        type: 'CUSTOM',
                        enabled: false,
                        position: 0,
                        translations: copy('覆盖', 'Overwrite'),
                    },
                }),
            ).rejects.toThrow(/请通过店铺皮肤设置/);
        }
        adminClient.setChannelToken(stores[0].token);
        await expect(
            adminClient.query(SAVE_VISUAL, {
                input: { channelId: stores[1].id, desktopLayout: 'classic', expectedRevision: 'default' },
            }),
        ).rejects.toThrow(/店铺已切换/);
        const vite = await createServer({
            root: fileURLToPath(new URL('../../storefront', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5300,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299' },
            },
        });
        const browser = await chromium.launch({ headless: true });
        const output = testOutput;
        await mkdir(output, { recursive: true });
        try {
            await vite.listen();
            for (const width of [390, 1024, 1440, 1920]) {
                const page = await browser.newPage({ viewport: { width, height: 1000 } });
                const signedIn = await page.request.post('http://127.0.0.1:5299/shop-api', {
                    data: {
                        query: 'mutation { login(username: "unified-catalog@example.test", password: "UnifiedFixturePass123!") { __typename } }',
                    },
                });
                expect((await signedIn.json()).data.login.__typename).toBe('CurrentUser');
                for (const [index, store] of stores.entries()) {
                    const name = ['MOYAO', 'Damatong', 'Store'][index];
                    await page.goto(
                        `http://127.0.0.1:5300/e2e/unification/index.html?channel=${store.token}&name=${name}`,
                    );
                    await browserExpect(page.locator('html')).toHaveAttribute(
                        'data-storefront-preset',
                        'modern-oriental',
                    );
                    for (const language of ['zh', 'en']) {
                        if (language === 'en') {
                            await page.locator('.locale-preferences-trigger:visible').click();
                            await page.getByRole('radio', { name: 'English' }).click();
                            await page.getByRole('button', { name: '保存设置' }).click();
                        }
                        // Even legacy catalog settings use the sole responsive storefront.
                        await browserExpect(
                            page.locator('.desktop-catalog-main, .desktop-header'),
                        ).toHaveCount(0);
                        await browserExpect(page.locator('.home-page')).toHaveCount(1);
                        await browserExpect(page.locator('.is-desktop-grouped')).toHaveCount(0);
                        if (index < 2)
                            await browserExpect(page.locator('.quick-grid > button')).toHaveCount(
                                width >= 1024 ? 5 : 8,
                            );
                        await browserExpect(page.locator('details.desktop-store-highlights')).toHaveCount(0);
                        expect(
                            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                        ).toBe(true);
                        await page.screenshot({
                            path: join(output, `fixed-layout-${name}-${language}-${width}.png`),
                            fullPage: true,
                            animations: 'disabled',
                        });
                    }
                }
                await page.close();
            }
        } finally {
            await browser.close();
            await vite.close();
        }
    }, 180_000);
    it('saves from the real admin panel, retains failed edits and ignores late responses after channel switching', async () => {
        const vite = await createServer({
            root: fileURLToPath(new URL('../../next-admin', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5301,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299', '/assets': 'http://127.0.0.1:5299' },
            },
        });
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
            ({ auth, channel }) => {
                sessionStorage.setItem('local-test-admin-token', auth);
                localStorage.setItem('vendure-active-channel-token', channel);
            },
            { auth: adminClient.getAuthToken(), channel: stores[0].token },
        );
        const uri = `http://127.0.0.1:5301/e2e/storefront-visual/index.html?stores=${stores.map(store => store.token).join(',')}`;
        const output = testOutput;
        const READ_VISUAL = gql`
            query {
                storefrontVisualPreset {
                    channelId
                    presetId
                    desktopLayout
                    revision
                }
            }
        `;
        try {
            await vite.listen();
            const first = await context.newPage();
            const stale = await context.newPage();
            await first.goto(uri);
            await stale.goto(uri);
            await browserExpect(first.locator('input[name="presetId"][value="modern-oriental"]'))
                .toBeChecked()
                .catch(async () => {
                    throw new Error(await first.locator('body').innerText());
                });
            await browserExpect(stale.locator('input[name="desktopLayout"]')).toHaveCount(0);
            await first.locator('input[name="presetId"][value="classic"]').check();
            await first.getByRole('button', { name: '保存到当前店铺' }).click();
            await browserExpect(first.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
            await stale.locator('input[name="presetId"][value="classic"]').check();
            await stale.getByRole('button', { name: '保存到当前店铺' }).click();
            await browserExpect(stale.getByRole('alert')).toContainText('其他管理员');
            await stale.getByRole('button', { name: '重新读取' }).click();
            await browserExpect(stale.locator('input[name="presetId"][value="classic"]')).toBeChecked();
            await stale.locator('input[name="presetId"][value="modern-oriental"]').check();
            await stale.route('**/admin-api', async route => {
                if (route.request().postData()?.includes('NextAdminUpdateStorefrontVisualPreset'))
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ errors: [{ message: 'Local test save failure' }] }),
                    });
                else await route.continue();
            });
            await stale.getByRole('button', { name: '保存到当前店铺' }).click();
            await browserExpect(stale.getByRole('alert')).toBeVisible();
            await browserExpect(
                stale.locator('input[name="presetId"][value="modern-oriental"]'),
            ).toBeChecked();
            await stale.unroute('**/admin-api');
            let releaseResponse = () => undefined;
            let markRequested = () => undefined;
            const hold = new Promise<void>(resolve => {
                releaseResponse = resolve;
            });
            const requested = new Promise<void>(resolve => {
                markRequested = resolve;
            });
            await stale.route('**/admin-api', async route => {
                if (route.request().postData()?.includes('NextAdminUpdateStorefrontVisualPreset')) {
                    const response = await route.fetch();
                    markRequested();
                    await hold;
                    await route.fulfill({ response });
                } else await route.continue();
            });
            await stale.getByRole('button', { name: '保存到当前店铺' }).click();
            await requested;
            await stale.getByRole('combobox', { name: '测试店铺' }).selectOption(stores[1].token);
            await browserExpect(
                stale.locator('input[name="presetId"][value="modern-oriental"]'),
            ).toBeChecked();
            releaseResponse();
            await browserExpect(stale.getByRole('button', { name: '保存到当前店铺' })).toBeDisabled();
            await browserExpect(stale.locator('input[name="desktopLayout"]')).toHaveCount(0);
            await browserExpect(
                stale.getByRole('status').filter({ hasText: '已保存到当前店铺' }),
            ).toHaveCount(0);
            shopClient.setChannelToken(stores[1].token);
            expect((await shopClient.query(READ_VISUAL)).storefrontVisualPreset).toMatchObject({
                presetId: 'modern-oriental',
                desktopLayout: 'catalog',
            });
            for (const [index, store] of stores.entries()) {
                await stale.getByRole('combobox', { name: '测试店铺' }).selectOption(store.token);
                await browserExpect(stale.locator('input[type="radio"]:disabled')).toHaveCount(0);
                await browserExpect(stale.locator('input[type="radio"]')).toHaveCount(
                    storefrontVisualPresets.length,
                );
                await stale.screenshot({
                    path: join(output, `admin-appearance-store-${index}.png`),
                    fullPage: true,
                });
            }
        } finally {
            await browser.close();
            await vite.close();
        }
    }, 90000);
    it('publishes deliberately cleared auth copy without restoring defaults or changing other stores', async () => {
        adminClient.setChannelToken(stores[0].token);
        const before = await adminClient.query(READ);
        adminClient.setChannelToken(stores[2].token);
        shopClient.setChannelToken(stores[2].token);
        const input = {
            code: 'auth-login-visual',
            type: 'AUTH_LOGIN',
            layoutVariant: 'HERO_OVERLAY',
            enabled: true,
            position: 1000,
            targetType: 'NONE',
            backgroundColor: null,
            textColor: null,
            settings: { accentColor: '' },
            translations: copy('', ''),
            items: [
                {
                    enabled: true,
                    position: 0,
                    targetType: 'NONE',
                    translations: [
                        { languageCode: LanguageCode.zh_Hans, label: '', description: '' },
                        { languageCode: LanguageCode.en, label: '', description: '' },
                    ],
                },
            ],
        };
        await adminClient.query(CREATE, { input });
        const admin = (await adminClient.query(READ)).storefrontContentBlocks.find(
            (block: { code: string }) => block.code === input.code,
        );
        const shop = (await shopClient.query(SHOP_READ)).storefrontContentBlocks.find(
            (block: { code: string }) => block.code === input.code,
        );
        expect(shop).toEqual(admin);
        expect(shop).toMatchObject({
            title: '',
            subtitle: '',
            ctaLabel: '',
            settings: { accentColor: '' },
            items: [{ label: '' }],
        });
        adminClient.setChannelToken(stores[0].token);
        expect(await adminClient.query(READ)).toEqual(before);
    });
    it('enforces decoration read and update permissions within the assigned channel', async () => {
        adminClient.setChannelToken(stores[0].token);
        const { createRole } = await adminClient.query(
            gql`
                mutation ($input: CreateRoleInput!) {
                    createRole(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    code: 'local-decoration-reader',
                    description: 'Local test only',
                    permissions: ['ReadStorefrontContent'],
                    channelIds: [stores[1].id],
                },
            },
        );
        await adminClient.query(
            gql`
                mutation ($input: CreateAdministratorInput!) {
                    createAdministrator(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    firstName: 'Local',
                    lastName: 'Reader',
                    emailAddress: 'decoration-reader@example.test',
                    password: 'LocalTestOnly123!',
                    roleIds: [createRole.id],
                },
            },
        );
        try {
            await adminClient.asUserWithCredentials('decoration-reader@example.test', 'LocalTestOnly123!');
            adminClient.setChannelToken(stores[1].token);
            const read = gql`
                query {
                    storefrontVisualPreset {
                        channelId
                        revision
                    }
                }
            `;
            const savedConfig = (await adminClient.query(read)).storefrontVisualPreset;
            expect(savedConfig.channelId).toBe(stores[1].id);
            await expect(
                adminClient.query(
                    gql`
                        mutation ($input: UpdateStorefrontVisualPresetInput!) {
                            updateStorefrontVisualPreset(input: $input) {
                                revision
                            }
                        }
                    `,
                    {
                        input: {
                            channelId: stores[1].id,
                            expectedRevision: savedConfig.revision,
                            presetId: 'classic',
                        },
                    },
                ),
            ).rejects.toThrow(/authoriz|permission|Forbidden/i);
            adminClient.setChannelToken(stores[2].token);
            await expect(adminClient.query(read)).rejects.toThrow(/authoriz|permission|Forbidden/i);
        } finally {
            adminClient.setChannelToken(stores[0].token);
            await adminClient.asSuperAdmin();
        }
    });
    it('matches the real admin auth preview with explicit block colors, skin colors and classic brand inheritance', async () => {
        const readVisual = gql`
            query {
                storefrontVisualPreset {
                    revision
                }
            }
        `;
        const saveVisual = gql`
            mutation ($input: UpdateStorefrontVisualPresetInput!) {
                updateStorefrontVisualPreset(input: $input) {
                    revision
                }
            }
        `;
        for (const store of stores) {
            adminClient.setChannelToken(store.token);
            const current = (await adminClient.query(readVisual)).storefrontVisualPreset;
            await adminClient.query(saveVisual, {
                input: {
                    channelId: store.id,
                    expectedRevision: current.revision,
                    presetId: 'modern-oriental',
                },
            });
        }
        adminClient.setChannelToken(stores[0].token);
        const readAuth = gql`
            query {
                storefrontContentBlocks {
                    id
                    type
                    updatedAt
                    backgroundColor
                    textColor
                    settings
                }
            }
        `;
        const original = (await adminClient.query(readAuth)).storefrontContentBlocks.find(
            (block: { type: string }) => block.type === 'AUTH_LOGIN',
        );
        const frontend = await createServer({
            root: fileURLToPath(new URL('../../storefront', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5300,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299' },
            },
        });
        const backend = await createServer({
            root: fileURLToPath(new URL('../../next-admin', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5301,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299', '/assets': 'http://127.0.0.1:5299' },
            },
        });
        const browser = await chromium.launch({ headless: true });
        const output = testOutput;
        await mkdir(output, { recursive: true });
        try {
            await frontend.listen();
            await backend.listen();
            const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            await context.addInitScript(
                ({ auth, channel }) => {
                    sessionStorage.setItem('local-test-admin-token', auth);
                    localStorage.setItem('vendure-active-channel-token', channel);
                },
                { auth: adminClient.getAuthToken(), channel: stores[0].token },
            );
            const signedIn = await context.request.post('http://127.0.0.1:5299/shop-api', {
                data: {
                    query: 'mutation { login(username: "unified-catalog@example.test", password: "UnifiedFixturePass123!") { __typename } }',
                },
            });
            expect((await signedIn.json()).data.login.__typename).toBe('CurrentUser');
            const page = await context.newPage();
            const preview = await context.newPage();
            const pageUrl = `http://127.0.0.1:5300/e2e/unification/index.html?channel=${stores[0].token}&name=MOYAO&page=login`;
            const previewUrl = `http://127.0.0.1:5301/e2e/storefront-visual/index.html?stores=${stores.map(store => store.token).join(',')}&preview=auth`;
            for (const [state, background, accent] of [
                ['explicit', 'rgb(32, 51, 70)', 'rgb(179, 68, 49)'],
                ['inherited', 'rgb(255, 255, 255)', 'rgb(179, 68, 49)'],
                ['classic', 'rgb(255, 255, 255)', 'rgb(21, 128, 61)'],
            ]) {
                if (state === 'inherited')
                    await adminClient.query(UPDATE, {
                        input: {
                            id: original.id,
                            expectedUpdatedAt: original.updatedAt,
                            backgroundColor: null,
                            textColor: null,
                            settings: { ...original.settings, accentColor: '' },
                        },
                    });
                if (state === 'classic') {
                    const current = (await adminClient.query(readVisual)).storefrontVisualPreset;
                    await adminClient.query(saveVisual, {
                        input: {
                            channelId: stores[0].id,
                            expectedRevision: current.revision,
                            presetId: 'classic',
                        },
                    });
                }
                await page.goto(pageUrl);
                await preview.goto(previewUrl);
                await preview.evaluate(() => document.documentElement.classList.add('dark'));
                const clientFrame = preview.frameLocator('iframe[title="客户端装修效果"]');
                await browserExpect(clientFrame.locator('.auth-page')).toBeVisible({ timeout: 15000 });
                await browserExpect(clientFrame.locator('.login-content')).toHaveCSS(
                    'background-color',
                    'rgb(255, 255, 255)',
                );
                await browserExpect(clientFrame.locator('.login-content')).toHaveCSS(
                    'color',
                    state === 'classic' ? 'rgb(15, 23, 42)' : 'rgb(32, 52, 50)',
                );
                await browserExpect(page.locator('html')).toHaveAttribute(
                    'data-storefront-preset',
                    state === 'classic' ? 'classic' : 'modern-oriental',
                );
                await browserExpect(page.locator('.auth-hero')).toHaveCSS('background-color', background);
                await browserExpect(page.locator('.wide-action')).toHaveCSS('background-color', accent);
                if (state === 'explicit')
                    expect(
                        await page
                            .locator('.auth-page')
                            .evaluate(element =>
                                getComputedStyle(element).getPropertyValue('--auth-visual-accent').trim(),
                            ),
                    ).toBe('#a63d32');
                await browserExpect(clientFrame.locator('.auth-hero')).toHaveCSS(
                    'background-color',
                    background,
                );
                for (const viewport of ['手机', '电脑']) {
                    await preview.setViewportSize({ width: viewport === '手机' ? 390 : 1440, height: 1000 });
                    await preview.getByRole('button', { name: viewport, exact: true }).click();
                    const img = clientFrame.locator('.auth-hero img.safe-image');
                    if (viewport === '电脑') {
                        await browserExpect(clientFrame.locator('.auth-hero')).toBeVisible();
                        await browserExpect(img).toHaveCSS('object-fit', 'contain');
                        await browserExpect
                            .poll(() =>
                                img.evaluate(
                                    (value: HTMLImageElement) =>
                                        value.naturalWidth > 0 && value.clientHeight > 0,
                                ),
                            )
                            .toBe(true);
                    } else {
                        // The actual mobile auth route intentionally shows only the form.
                        await browserExpect(clientFrame.locator('.auth-hero')).toBeHidden();
                    }
                    await browserExpect
                        .poll(() =>
                            preview.locator('iframe[title="客户端装修效果"]').evaluate(canvas => {
                                const parent = canvas.parentElement;
                                if (!parent) return false;
                                const bounds = parent.getBoundingClientRect();
                                const content = canvas.getBoundingClientRect();
                                return (
                                    content.left >= bounds.left - 1 &&
                                    content.right <= bounds.right + 1 &&
                                    content.bottom <= bounds.bottom + 1
                                );
                            }),
                        )
                        .toBe(true);
                    await browserExpect(clientFrame.locator('html')).toHaveAttribute(
                        'data-storefront-preset',
                        state === 'classic' ? 'classic' : 'modern-oriental',
                    );
                    await preview.screenshot({
                        path: join(
                            output,
                            `admin-auth-${state}-${viewport === '手机' ? 'mobile' : 'desktop'}.png`,
                        ),
                        fullPage: true,
                    });
                }
                await page.screenshot({ path: join(output, `auth-priority-${state}.png`), fullPage: true });
            }
            await page.goto(
                `http://127.0.0.1:5300/e2e/unification/index.html?channel=${stores[2].token}&name=Store&page=login`,
            );
            await browserExpect(page.locator('html')).toHaveAttribute(
                'data-storefront-preset',
                'modern-oriental',
            );
            await browserExpect(page.locator('.auth-hero')).toHaveCSS(
                'background-color',
                'rgb(243, 244, 240)',
            );
            await browserExpect(page.locator('.wide-action')).toHaveCSS(
                'background-color',
                'rgb(179, 68, 49)',
            );
            await browserExpect(page.locator('.auth-hero-copy h2')).toHaveCount(0);
            await browserExpect(page.locator('.auth-page')).not.toContainText('MOYAO');
            await page.screenshot({ path: join(output, 'auth-priority-unbranded.png'), fullPage: true });
        } finally {
            const current = (await adminClient.query(readAuth)).storefrontContentBlocks.find(
                (block: { id: string }) => block.id === original.id,
            );
            await adminClient.query(UPDATE, {
                input: {
                    id: original.id,
                    expectedUpdatedAt: current.updatedAt,
                    backgroundColor: original.backgroundColor,
                    textColor: original.textColor,
                    settings: original.settings,
                },
            });
            await browser.close();
            await frontend.close();
            await backend.close();
        }
    }, 90000);
    it('publishes page banners from the current Admin to Shop, preserves mobile layouts and store isolation', async () => {
        adminClient.setChannelToken(stores[0].token);
        shopClient.setChannelToken(stores[0].token);
        const asset = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Asset)
            .save(
                new Asset({
                    name: 'page-banner.svg',
                    type: AssetType.IMAGE,
                    fileSize: 400,
                    mimeType: 'image/svg+xml',
                    width: 1200,
                    height: 600,
                    source: 'http://127.0.0.1:5299/assets/page-banner.svg',
                    preview: 'http://127.0.0.1:5299/assets/page-banner.svg',
                    channels: [{ id: Number(stores[0].id) }],
                }),
            );
        await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(AssetTranslation)
            .save(
                ['en', 'zh_Hans'].map(
                    languageCode =>
                        new AssetTranslation({
                            base: asset,
                            languageCode: languageCode as LanguageCode,
                            name: 'page-banner.svg',
                        }),
                ),
            );
        const categoryMutation = gql`
            mutation ($input: CreateCollectionInput!) {
                createCollection(input: $input) {
                    id
                }
            }
        `;
        const parent = (
            await adminClient.query(categoryMutation, {
                input: {
                    filters: [],
                    translations: [
                        { languageCode: 'en', name: 'Banner parent', slug: 'banner-parent', description: '' },
                        {
                            languageCode: 'zh_Hans',
                            name: '横幅父分类',
                            slug: 'banner-parent',
                            description: '',
                        },
                    ],
                },
            })
        ).createCollection;
        const child = (
            await adminClient.query(categoryMutation, {
                input: {
                    filters: [],
                    parentId: parent.id,
                    translations: [
                        { languageCode: 'en', name: 'Banner child', slug: 'banner-child', description: '' },
                        {
                            languageCode: 'zh_Hans',
                            name: '横幅子分类',
                            slug: 'banner-child',
                            description: '',
                        },
                    ],
                },
            })
        ).createCollection;
        await adminClient.query(CREATE, {
            input: {
                code: 'storefront-client-plugins',
                position: 30,
                type: 'CLIENT_PLUGINS',
                enabled: true,
                translations: copy('测试商业服务', 'Test services').map(value => ({
                    ...value,
                    body: value.languageCode === LanguageCode.en ? 'Test service details' : '测试服务说明',
                })),
                settings: { businessServicesCopyVersion: 1 },
                items: [],
            },
        });
        await adminClient.query(CREATE, {
            input: {
                code: 'support-banner-test',
                position: 31,
                type: 'SUPPORT',
                enabled: true,
                internalName: '客服配图验收',
                translations: copy('测试客户支持', 'Test support'),
                settings: {},
                items: [
                    {
                        enabled: true,
                        position: 0,
                        targetType: 'URL',
                        targetValue: 'https://t.me/banner_test_support',
                        settings: { supportChannel: 'TELEGRAM', supportAccount: 'banner_test_support' },
                        translations: [
                            { languageCode: 'zh_Hans', label: '测试客服', description: '' },
                            { languageCode: 'en', label: 'Test support', description: '' },
                        ],
                    },
                ],
            },
        });
        const before = await adminClient.query(READ);
        const servicesBefore = before.storefrontContentBlocks.find(
            (block: any) => block.type === 'CLIENT_PLUGINS',
        );
        const frontend = await createServer({
            root: fileURLToPath(new URL('../../storefront', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5300,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299' },
            },
        });
        const backend = await createServer({
            root: fileURLToPath(new URL('../../next-admin', import.meta.url)),
            server: {
                host: '127.0.0.1',
                port: 5301,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:5299', '/assets': 'http://127.0.0.1:5299' },
            },
        });
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
            ({ auth, channel }) => {
                sessionStorage.setItem('local-test-admin-token', auth);
                localStorage.setItem('vendure-active-channel-token', channel);
            },
            { auth: adminClient.getAuthToken(), channel: stores[0].token },
        );
        const uri = `http://127.0.0.1:5301/e2e/storefront-visual/index.html?stores=${stores.map(store => store.token).join(',')}`;
        const output = testOutput;
        await mkdir(output, { recursive: true });
        try {
            await Promise.all([frontend.listen(), backend.listen()]);
            const page = await context.newPage();
            const openBanner = async (target: typeof page) => {
                await target.goto(uri + '&panel=decoration');
                await target.getByRole('button', { name: '装修设置', exact: true }).click();
                await browserExpect(
                    target.getByRole('region', { name: '电脑端分类横幅' }).getByLabel('横幅展示方式'),
                ).toBeEnabled();
            };
            const chooseImage = async (target: typeof page, scope: ReturnType<typeof page.locator>) => {
                await scope.getByRole('button', { name: '从素材库选择', exact: true }).click();
                await target
                    .getByRole('dialog', { name: '选择图片素材' })
                    .getByRole('button', { name: 'page-banner.svg' })
                    .click({ timeout: 6000 })
                    .catch(async () => {
                        throw new Error(
                            await target.getByRole('dialog', { name: '选择图片素材' }).innerText(),
                        );
                    });
            };
            await openBanner(page);
            const panel = page.getByRole('region', { name: '电脑端分类横幅' });
            await panel.getByLabel('横幅展示方式').selectOption('image');
            await chooseImage(page, panel);
            await panel.getByRole('button', { name: '保存分类横幅' }).click();
            await browserExpect(panel.getByRole('status')).toContainText('已保存');
            const stale = await context.newPage();
            await openBanner(stale);
            await panel.getByLabel('图片焦点').selectOption('right');
            await panel.getByRole('button', { name: '保存分类横幅' }).click();
            await browserExpect(panel.getByRole('status')).toContainText('已保存');
            const stalePanel = stale.getByRole('region', { name: '电脑端分类横幅' });
            await stalePanel.getByLabel('图片焦点').selectOption('left');
            await stalePanel.getByRole('button', { name: '保存分类横幅' }).click();
            await browserExpect(stalePanel.getByRole('alert')).toContainText(/刷新|其他管理员|更新/);
            await browserExpect(stalePanel.getByLabel('图片焦点')).toHaveValue('left');
            await stalePanel.getByRole('button', { name: '重新读取并放弃修改' }).click();
            await browserExpect(stalePanel.getByLabel('图片焦点')).toHaveValue('right');
            await stale.close();
            await panel.getByLabel('横幅设置范围').selectOption(parent.id);
            await panel.getByLabel('横幅展示方式').selectOption('image');
            await chooseImage(page, panel);
            await panel.getByLabel('图片版式').selectOption('background');
            await panel.getByRole('button', { name: '保存分类横幅' }).click();
            await browserExpect(panel.getByRole('status')).toContainText('已保存');
            await panel.getByLabel('横幅设置范围').selectOption(child.id);
            await panel.getByLabel('横幅展示方式').selectOption('text');
            await panel.getByRole('button', { name: '保存分类横幅' }).click();
            await browserExpect(panel.getByRole('status')).toContainText('已保存');
            await page.screenshot({ path: join(output, 'admin-category-banner.png'), fullPage: true });
            const shop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
            await shop.emulateMedia({ reducedMotion: 'reduce' });
            const categoryUrl = `http://127.0.0.1:5300/e2e/unification/index.html?channel=${stores[0].token}&page=category&category=${parent.id}&child=${child.id}`;
            await shop.goto(categoryUrl);
            await browserExpect(shop.locator('.desktop-catalog-hero')).toContainText('横幅子分类');
            await browserExpect(shop.locator('.desktop-catalog-hero img')).toHaveCount(0);
            await panel.getByLabel('横幅展示方式').selectOption('inherit');
            await panel.getByRole('button', { name: '保存分类横幅' }).click();
            await browserExpect(panel.getByRole('status')).toContainText('已保存');
            await shop.reload();
            await browserExpect(shop.locator('.desktop-catalog-hero')).toHaveClass(/is-background/);
            await browserExpect(shop.locator('.desktop-catalog-hero img')).toHaveAttribute(
                'src',
                /page-banner.svg/,
            );
            await page.getByRole('button', { name: '关闭装修设置' }).click();
            await page.getByLabel('测试店铺').selectOption(stores[1].token);
            await page.getByRole('button', { name: '装修设置', exact: true }).click();
            await browserExpect(panel.getByLabel('横幅展示方式')).toHaveValue('inherit');
            await browserExpect(panel.getByRole('img', { name: '分类横幅图片预览' })).toHaveCount(0);
            await page.goto(uri + '&panel=services');
            await browserExpect(page.getByRole('heading', { name: /商业服务页文案/ })).toBeVisible();
            const serviceImage = page.locator('fieldset').filter({ hasText: '电脑端商业服务页首配图' });
            await chooseImage(page, serviceImage);
            await page.getByRole('button', { name: '保存并发布', exact: true }).click();
            await browserExpect(page.getByRole('status')).toContainText('已保存');
            await page.goto(uri + '&panel=content');
            await page
                .locator('article')
                .filter({ hasText: '客服配图验收' })
                .getByRole('button', { name: '编辑内容' })
                .click();
            const supportImage = page
                .locator('div')
                .filter({ has: page.locator('div', { hasText: /^电脑端客服页首配图$/ }) })
                .filter({ has: page.getByRole('button', { name: '从素材库选择' }) })
                .last();
            await chooseImage(page, supportImage);
            await page.getByRole('button', { name: '保存并核对', exact: true }).click();
            await browserExpect(page.getByRole('status'))
                .toContainText('已保存')
                .catch(async () => {
                    throw new Error('Support save: ' + (await page.locator('body').innerText()));
                });
            const saved = (await shopClient.query(SHOP_READ)).storefrontContentBlocks;
            const savedServices = saved.find((block: any) => block.type === 'CLIENT_PLUGINS');
            expect(savedServices.settings).toEqual(servicesBefore.settings);
            expect(savedServices.items).toEqual(servicesBefore.items);
            expect(savedServices.imageUrl).toContain('page-banner.svg');
            expect(saved.find((block: any) => block.type === 'SUPPORT').imageUrl).toContain(
                'page-banner.svg',
            );
            for (const width of [1440, 390]) {
                await shop.setViewportSize({ width, height: 1000 });
                for (const route of ['category', 'services', 'support']) {
                    await shop.goto(
                        route === 'category'
                            ? categoryUrl
                            : `http://127.0.0.1:5300/e2e/unification/index.html?channel=${stores[0].token}&page=${route}`,
                    );
                    const selector =
                        route === 'category'
                            ? '.desktop-catalog-hero'
                            : route === 'services'
                              ? '.business-services-heading'
                              : '.support-desktop-hero';
                    await browserExpect(
                        shop.locator(
                            route === 'category'
                                ? width >= 1024
                                    ? '.desktop-catalog-main'
                                    : '.category-page'
                                : route === 'services'
                                  ? '.business-services-page'
                                  : '.support-center-content',
                        ),
                    ).toBeVisible();
                    if (width >= 1024 && route === 'category') {
                        const hero = await shop.locator('.desktop-catalog-hero').boundingBox();
                        const side = await shop.locator('.desktop-catalog-sidebar').boundingBox();
                        const frame = await shop
                            .locator('.desktop-catalog-hero .safe-image-frame')
                            .boundingBox();
                        if (!hero || !side || !frame)
                            throw new Error('Desktop category banner geometry is missing');
                        expect(hero.height).toBeGreaterThanOrEqual(136);
                        expect(hero.x).toBeGreaterThan(side.x + side.width);
                        // Background mode preserves the whole image above its separate copy.
                        // Its height follows the selected asset ratio, so a 2:1 fixture is taller
                        // than the recommended 1600 × 480 banner without being clipped.
                        expect(frame.height).toBeGreaterThan(130);
                        expect(hero.height).toBeGreaterThanOrEqual(frame.height);
                        expect(hero.height - frame.height).toBeLessThan(160);
                        expect(frame.width).toBeGreaterThanOrEqual(hero.width - 1);
                    }
                    if (width >= 1024) {
                        await browserExpect(shop.locator(selector + ' img')).toHaveAttribute(
                            'src',
                            /page-banner.svg/,
                        );
                        await browserExpect
                            .poll(() =>
                                shop
                                    .locator(selector + ' img')
                                    .evaluate(
                                        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
                                    ),
                            )
                            .toBe(true);
                    } else {
                        await browserExpect(shop.locator(selector + ' img')).not.toBeVisible();
                    }
                    expect(
                        await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                    ).toBe(true);
                    await shop.screenshot({
                        path: join(output, `page-banner-${route}-${width}.png`),
                        fullPage: true,
                        animations: 'disabled',
                    });
                }
            }
            shopClient.setChannelToken(stores[1].token);
            expect(
                (await shopClient.query(SHOP_READ)).storefrontContentBlocks.some((block: any) =>
                    block.imageUrl?.includes('page-banner.svg'),
                ),
            ).toBe(false);
            await shop.close();
        } finally {
            await browser.close();
            await Promise.all([frontend.close(), backend.close()]);
            adminClient.setChannelToken(stores[0].token);
            shopClient.setChannelToken(stores[0].token);
        }
    }, 90_000);
});
