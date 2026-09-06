import { expect as browserExpect, chromium } from '@playwright/test';
import { AssetType, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Asset,
    AutoIncrementIdStrategy,
    DefaultSearchPlugin,
    mergeConfig,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdtempSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';
import { createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { StoreProfile } from '../../store-management-plugin/src/entities/store-profile.entity';
import { StorefrontContentPlugin } from '../src/storefront-content.plugin';

import { BrandingFixturePlugin } from './branding-fixture.plugin';

// A new in-memory SQL.js database and a loopback API. No existing configuration or account is used.
const config = mergeConfig(testConfig, {
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

beforeAll(async () => {
    registerInitializer(
        'sqljs',
        new SqljsInitializer(mkdtempSync(join(tmpdir(), 'vendure-unified-content-'))),
    );
    await server.init({
        initialData: { ...initialData, collections: [], paymentMethods: [] },
        customerCount: 0,
    });
    await adminClient.asSuperAdmin();
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
        const output = process.env.STOREFRONT_TEST_OUTPUT ?? join(tmpdir(), 'vendure-unified-browser');
        await mkdir(output, { recursive: true });
        try {
            await vite.listen();
            for (const width of [390, 1440]) {
                const page = await browser.newPage({ viewport: { width, height: 844 } });
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
                        await browserExpect(page.locator('.quick-grid button')).toHaveCount(8);
                        await browserExpect(page.locator('.quick-grid')).toContainText(`店${index}入口7`);
                        await browserExpect(page.locator('.hero')).toHaveCount(index === 1 ? 1 : 0);
                        await browserExpect(page.locator('.homepage-modules')).not.toContainText('分享海报');
                        await page.locator('.language-button').click();
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
    it('renders identical auth capabilities for MOYAO, Damatong and a blank store without cropping', async () => {
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
        const output = process.env.STOREFRONT_TEST_OUTPUT ?? join(tmpdir(), 'vendure-unified-browser');
        await mkdir(output, { recursive: true });
        try {
            await vite.listen();
            for (const width of [390, 1024, 1440, 1920]) {
                const page = await browser.newPage({ viewport: { width, height: 1000 } });
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
                                .locator('.auth-page-clear')
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
                                await browserExpect(page.locator('.store-auth-copy h2')).toHaveText(
                                    language === 'zh'
                                        ? `${index === 0 ? 'MOYAO' : '大马通'}主标题`
                                        : `${name} title`,
                                );
                                const imageLocator = page.locator('.store-auth-image img');
                                await browserExpect
                                    .poll(() =>
                                        imageLocator.evaluate(
                                            (img: HTMLImageElement) =>
                                                img.complete && img.naturalWidth > 0 && img.clientHeight > 0,
                                        ),
                                    )
                                    .toBe(true);
                                const metrics = await imageLocator.evaluate((img: HTMLImageElement) => ({
                                    width: img.clientWidth,
                                    height: img.clientHeight,
                                    ratio: img.naturalWidth / img.naturalHeight,
                                    filter: getComputedStyle(img).filter,
                                    fit: getComputedStyle(img).objectFit,
                                }));
                                expect(Math.abs(metrics.width / metrics.height - metrics.ratio)).toBeLessThan(
                                    0.02,
                                );
                                expect(metrics.filter).toBe('none');
                                expect(metrics.fit).toBe('contain');
                                const copyBox = await page.locator('.store-auth-copy').boundingBox();
                                const imageBox = await imageLocator.boundingBox();
                                if (!copyBox || !imageBox) throw new Error('Missing rendered image or copy');
                                expect(copyBox.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height - 1);
                            } else {
                                await browserExpect(page.locator('.store-auth-image')).toHaveCount(0);
                                await browserExpect(page.locator('.auth-page-clear')).not.toContainText(
                                    'MOYAO',
                                );
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
        const output = process.env.STOREFRONT_TEST_OUTPUT ?? join(tmpdir(), 'vendure-unified-browser');
        await mkdir(output, { recursive: true });
        try {
            await vite.listen();
            for (const width of [390, 1024, 1440, 1920]) {
                const page = await browser.newPage({ viewport: { width, height: 1000 } });
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
                        if (language === 'en')
                            await (
                                width >= 1024
                                    ? page.getByRole('button', { name: '切换为英文' })
                                    : page.locator('.language-button')
                            ).click();
                        await browserExpect(page.locator('.desktop-catalog-main')).toHaveCount(
                            width >= 1024 ? 1 : 0,
                        );
                        if (index < 2) await browserExpect(page.locator('.quick-grid button')).toHaveCount(8);
                        await browserExpect(page.locator('details.desktop-store-highlights')).toHaveCount(0);
                        expect(
                            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                        ).toBe(true);
                        await page.screenshot({
                            path: join(output, `catalog-${name}-${language}-${width}.png`),
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
            server: { host: '127.0.0.1', port: 5301, strictPort: true },
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
        const output = process.env.STOREFRONT_TEST_OUTPUT ?? join(tmpdir(), 'vendure-unified-browser');
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
            await browserExpect(stale.locator('input[name="desktopLayout"][value="catalog"]')).toBeChecked();
            await first.locator('input[name="presetId"][value="classic"]').check();
            await first.getByRole('button', { name: '保存到当前店铺' }).click();
            await browserExpect(first.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
            await stale.locator('input[name="desktopLayout"][value="classic"]').check();
            await stale.getByRole('button', { name: '保存到当前店铺' }).click();
            await browserExpect(stale.getByRole('alert')).toContainText('其他管理员');
            await stale.getByRole('button', { name: '重新读取' }).click();
            await browserExpect(stale.locator('input[name="presetId"][value="classic"]')).toBeChecked();
            await stale.locator('input[name="desktopLayout"][value="classic"]').check();
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
            await browserExpect(stale.locator('input[name="desktopLayout"][value="classic"]')).toBeChecked();
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
            await browserExpect(stale.locator('input[name="desktopLayout"][value="catalog"]')).toBeChecked();
            await browserExpect(stale.getByRole('status')).toHaveCount(0);
            shopClient.setChannelToken(stores[1].token);
            expect((await shopClient.query(READ_VISUAL)).storefrontVisualPreset).toMatchObject({
                presetId: 'modern-oriental',
                desktopLayout: 'catalog',
            });
            for (const [index, store] of stores.entries()) {
                await stale.getByRole('combobox', { name: '测试店铺' }).selectOption(store.token);
                await browserExpect(stale.locator('input[type="radio"]:disabled')).toHaveCount(0);
                await browserExpect(stale.locator('input[type="radio"]')).toHaveCount(4);
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
    it('matches the real admin auth preview and applies block then brand then skin color inheritance', async () => {
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
            server: { host: '127.0.0.1', port: 5301, strictPort: true },
        });
        const browser = await chromium.launch({ headless: true });
        const output = process.env.STOREFRONT_TEST_OUTPUT ?? join(tmpdir(), 'vendure-unified-browser');
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
            const page = await context.newPage();
            const preview = await context.newPage();
            const pageUrl = `http://127.0.0.1:5300/e2e/unification/index.html?channel=${stores[0].token}&name=MOYAO&page=login`;
            const previewUrl = `http://127.0.0.1:5301/e2e/storefront-visual/index.html?stores=${stores.map(store => store.token).join(',')}&preview=auth`;
            for (const [state, background, accent] of [
                ['explicit', 'rgb(32, 51, 70)', 'rgb(166, 61, 50)'],
                ['inherited', 'rgb(238, 232, 224)', 'rgb(21, 128, 61)'],
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
                await page.goto(pageUrl);
                await preview.goto(previewUrl);
                await preview.evaluate(() => document.documentElement.classList.add('dark'));
                await browserExpect(preview.locator('.store-auth-visual + div')).toHaveCSS(
                    'background-color',
                    'rgb(255, 255, 255)',
                );
                await browserExpect(preview.locator('.store-auth-visual + div')).toHaveCSS(
                    'color',
                    'rgb(23, 32, 51)',
                );
                await browserExpect(page.locator('html')).toHaveAttribute(
                    'data-storefront-preset',
                    'modern-oriental',
                );
                await browserExpect(page.locator('.store-auth-visual')).toHaveCSS(
                    'background-color',
                    background,
                );
                await browserExpect(page.locator('.wide-action')).toHaveCSS('background-color', accent);
                await browserExpect(preview.locator('.store-auth-visual')).toHaveCSS(
                    'background-color',
                    background,
                );
                for (const viewport of ['手机', '电脑']) {
                    await preview.setViewportSize({ width: viewport === '手机' ? 390 : 1440, height: 1000 });
                    await preview.getByRole('button', { name: viewport, exact: true }).click();
                    const img = preview.locator('.store-auth-image img');
                    await browserExpect
                        .poll(() =>
                            img.evaluate(
                                (value: HTMLImageElement) => value.naturalWidth > 0 && value.clientHeight > 0,
                            ),
                        )
                        .toBe(true);
                    await browserExpect
                        .poll(() =>
                            preview.locator('[data-auth-preview-viewport]').evaluate(host => {
                                const canvas = host.querySelector('.store-auth-visual')?.parentElement;
                                if (!canvas) return false;
                                const bounds = host.getBoundingClientRect();
                                const content = canvas.getBoundingClientRect();
                                return (
                                    content.left >= bounds.left - 1 &&
                                    content.right <= bounds.right + 1 &&
                                    content.bottom <= bounds.bottom + 1
                                );
                            }),
                        )
                        .toBe(true);
                    expect(
                        await img.evaluate((value: HTMLImageElement) =>
                            Math.abs(
                                value.clientWidth / value.clientHeight -
                                    value.naturalWidth / value.naturalHeight,
                            ),
                        ),
                    ).toBeLessThan(0.02);
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
            await browserExpect(page.locator('.store-auth-visual')).toHaveCSS(
                'background-color',
                'rgb(246, 242, 234)',
            );
            await browserExpect(page.locator('.wide-action')).toHaveCSS(
                'background-color',
                'rgb(166, 61, 50)',
            );
            await browserExpect(page.locator('.store-auth-copy h2')).toHaveCount(0);
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
});
