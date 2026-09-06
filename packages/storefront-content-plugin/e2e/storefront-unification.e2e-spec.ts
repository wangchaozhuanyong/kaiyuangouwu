import { expect as browserExpect, chromium } from '@playwright/test';
import { AssetType, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { Asset, AutoIncrementIdStrategy, mergeConfig, TransactionalConnection } from '@vendure/core';
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
import { StorefrontContentPlugin } from '../src/storefront-content.plugin';

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
    plugins: [ContentTranslationPlugin, StorefrontContentPlugin],
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
            server: { host: '127.0.0.1', port: 5300, strictPort: true },
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
                                        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
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
});
