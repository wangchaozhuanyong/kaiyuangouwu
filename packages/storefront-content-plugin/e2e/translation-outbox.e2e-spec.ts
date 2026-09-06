import {
    ContentTranslationBackfillService,
    ContentTranslationPlugin,
    ContentTranslationRetryService,
    ContentTranslationState,
    TranslationProviderError,
    TranslationProviderState,
} from '@vendure/content-translation-plugin';
import {
    DefaultSearchPlugin,
    LanguageCode,
    mergeConfig,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import { TwoFactorDashboardPlugin } from '@vendure/two-factor-dashboard-plugin';
import gql from 'graphql-tag';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { In, Not } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { StorefrontContentPlugin } from '../src/storefront-content.plugin';

// Use the same CJS token as Vendure; Vite direct deep imports create a second class identity.
const { SearchIndexService } = createRequire(__filename)(
    '@vendure/core/dist/plugin/default-search-plugin/indexer/search-index.service',
);
const directory = mkdtempSync(path.join(tmpdir(), 'vendure-translation-outbox-e2e-'));
registerInitializer('sqljs', new SqljsInitializer(directory));
const translate = vi.fn((request: any) =>
    Promise.resolve({
        provider: 'outbox-e2e',
        translations: request.segments.map((item: any) => ({ key: item.key, text: 'English category' })),
    }),
);
const config = mergeConfig(testConfig, {
    apiOptions: { port: 3298, cors: { origin: 'http://127.0.0.1:5198', credentials: true } },
    defaultLanguageCode: LanguageCode.zh_Hans,
    plugins: [
        ContentTranslationPlugin.init({
            provider: { name: 'outbox-e2e', isConfigured: () => true, translate },
        }),
        StorefrontContentPlugin,
        TwoFactorDashboardPlugin,
        StorefrontCartPlugin,
        StoreManagementPlugin,
        DefaultSearchPlugin.init({ bufferUpdates: false }),
    ],
});
// mergeConfig cannot replace a boolean with an object; set CORS explicitly for the isolated browser fixture.
config.apiOptions.cors = {
    origin: 'http://127.0.0.1:5198',
    credentials: true,
    exposedHeaders: ['vendure-auth-token'],
};
const { server, adminClient, shopClient } = createTestEnvironment(config);
const create = gql`
    mutation ($input: CreateStorefrontContentBlockInput!) {
        createStorefrontContentBlock(input: $input) {
            id
            updatedAt
            translations {
                languageCode
                title
            }
            items {
                id
            }
        }
    }
`;
const read = gql`
    query {
        storefrontContent {
            id
            title
            items {
                id
                label
            }
        }
    }
`;
const input = (code: string) => ({
    code,
    internalName: '五分类保存验收',
    type: 'CORE_CATEGORIES',
    enabled: true,
    position: 0,
    translations: [{ languageCode: 'zh_Hans', title: '精选五分类' }],
    items: ['正品烟草', '精品白酒', '正厂槟榔', '精选好物', '在线客服'].map((label, position) => ({
        position,
        targetType: 'NONE',
        translations: [{ languageCode: 'zh_Hans', label }],
    })),
});

describe('real Admin API saves and Shop API publication with the translation outbox', () => {
    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                defaultLanguage: LanguageCode.zh_Hans,
                collections: [],
                paymentMethods: [],
            },
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
        translate.mockClear();
        // Isolate assertions from initial country/zone fixture translations.
        await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(ContentTranslationState)
            .clear();
    }, 120_000);
    afterAll(async () => {
        if (server.app && process.env.TRANSLATION_BROWSER_ACCEPTANCE === '1') {
            const control = path.join(directory, 'browser-control');
            const evidence = path.join(directory, 'browser-evidence.json');
            const blocks = (
                await adminClient.query(gql`
                    query {
                        storefrontContentBlocks {
                            id
                        }
                    }
                `)
            ).storefrontContentBlocks;
            for (const block of blocks)
                await adminClient.query(
                    gql`
                        mutation ($id: ID!) {
                            deleteStorefrontContentBlock(id: $id) {
                                result
                            }
                        }
                    `,
                    { id: block.id },
                );
            await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(ContentTranslationState)
                .clear();
            translate.mockClear();
            const browserBlock = (
                await adminClient.query(create, { input: input('browser-five-categories') })
            ).createStorefrontContentBlock;
            writeFileSync(control, 'paused');
            // eslint-disable-next-line no-console -- Local fixture discovery for browser acceptance.
            console.info(
                `BROWSER_API_READY http://127.0.0.1:3298/admin-api CONTROL=${control} EVIDENCE=${evidence}`,
            );
            let conflicted = false;
            while (readFileSync(control, 'utf8').trim() !== 'stop') {
                const mode = readFileSync(control, 'utf8').trim();
                if (mode === 'conflict' && !conflicted) {
                    const block = (
                        await adminClient.query(
                            gql`
                                query ($id: ID!) {
                                    storefrontContentBlock(id: $id) {
                                        id
                                        updatedAt
                                        title
                                    }
                                }
                            `,
                            { id: browserBlock.id },
                        )
                    ).storefrontContentBlock;
                    await adminClient.query(
                        gql`
                            mutation ($input: UpdateStorefrontContentBlockInput!) {
                                updateStorefrontContentBlock(input: $input) {
                                    id
                                }
                            }
                        `,
                        {
                            input: {
                                id: block.id,
                                expectedUpdatedAt: block.updatedAt,
                                internalName: '其他管理员更新了名称',
                            },
                        },
                    );
                    conflicted = true;
                }
                if (mode === 'rate-limit' || mode === 'recover') {
                    translate.mockImplementation((request: any) => {
                        if (mode === 'rate-limit')
                            return Promise.reject(new TranslationProviderError('RATE_LIMIT'));
                        return Promise.resolve({
                            provider: 'outbox-e2e',
                            translations: request.segments.map((item: any) => ({
                                key: item.key,
                                text: 'English category',
                            })),
                        });
                    });
                    await server.app.get(ContentTranslationRetryService).retryPending();
                }
                const audit = await server.app
                    .get(TransactionalConnection)
                    .rawConnection.getRepository(ContentTranslationState)
                    .find();
                const zh = await shopClient.query(read, {}, { languageCode: 'zh_Hans' });
                const en = await shopClient.query(read, {}, { languageCode: 'en' });
                writeFileSync(
                    evidence,
                    JSON.stringify(
                        { mode, providerCalls: translate.mock.calls.length, audit, zh, en },
                        null,
                        2,
                    ),
                );
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        await server.destroy();
        rmSync(directory, { recursive: true, force: true });
    }, 3_600_000);

    it.each(['RATE_LIMIT', 'UNAVAILABLE', 'CONFIGURATION'] as const)(
        'commits five Chinese items with zero provider calls during %s',
        async failure => {
            translate.mockRejectedValue(new TranslationProviderError(failure));
            const saved = (
                await adminClient.query(create, {
                    input: input(`categories-${failure.toLowerCase().replaceAll('_', '-')}`),
                })
            ).createStorefrontContentBlock;
            expect(saved.items).toHaveLength(5);
            expect(translate).not.toHaveBeenCalled();
            shopClient.setRequestHeader('language-code', 'zh_Hans');
            const chinese = (
                await shopClient.query(read, {}, { languageCode: 'zh_Hans' })
            ).storefrontContent.find((block: any) => block.id === saved.id);
            expect(chinese.title).toBe('精选五分类');
            expect(chinese.items.map((item: any) => item.label)).toEqual(
                input('test').items.map(item => item.translations[0].label),
            );
            shopClient.setRequestHeader('language-code', 'en');
            expect(
                (await shopClient.query(read, {}, { languageCode: 'en' })).storefrontContent.some(
                    (block: any) => block.id === saved.id,
                ),
            ).toBe(false);
        },
    );

    it('resumes queued work and publishes English from the persisted translation', async () => {
        translate.mockResolvedValue({ provider: 'outbox-e2e', translations: [] });
        translate.mockImplementation((request: any) =>
            Promise.resolve({
                provider: 'outbox-e2e',
                translations: request.segments.map((item: any) => ({
                    key: item.key,
                    text: 'English category',
                })),
            }),
        );
        const result = await server.app.get(ContentTranslationRetryService).retryPending();
        expect(result.translated).toBeGreaterThan(0);
        shopClient.setRequestHeader('language-code', 'en');
        expect((await shopClient.query(read, {}, { languageCode: 'en' })).storefrontContent).toHaveLength(3);
        const calls = translate.mock.calls.length;
        await server.app.get(ContentTranslationRetryService).retryPending();
        expect(translate.mock.calls.length).toBe(calls);
    });

    it('registers historical custom child translations without fetching from the provider', async () => {
        const db = server.app.get(TransactionalConnection).rawConnection;
        await db.getRepository(ContentTranslationState).clear();
        const metadata = db.entityMetadatas.find(
            (entity: any) => entity.name === 'StorefrontContentItemTranslation',
        );
        if (!metadata) throw new Error('Missing item translation metadata');
        await db.getRepository(metadata.target).update({ languageCode: 'en' }, { label: '' });
        translate.mockClear();
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const result = await server.app
            .get(ContentTranslationBackfillService)
            .backfill(ctx, 'StorefrontContentItem', 100, 0);
        expect(result.queued).toBe(15);
        expect(result.failed).toBe(0);
        expect(translate).not.toHaveBeenCalled();
    });

    it('rolls back the content and outbox on an invalid child in a real save transaction', async () => {
        const db = server.app.get(TransactionalConnection).rawConnection;
        const before = await db.getRepository(ContentTranslationState).count();
        const invalid = input('invalid-rollback');
        invalid.items[4].translations[0].label = '';
        await expect(adminClient.query(create, { input: invalid })).rejects.toThrow();
        expect(await db.getRepository(ContentTranslationState).count()).toBe(before);
        const blocks = await adminClient.query(gql`
            query {
                storefrontContentBlocks {
                    code
                }
            }
        `);
        expect(blocks.storefrontContentBlocks.some((block: any) => block.code === 'invalid-rollback')).toBe(
            false,
        );
    });
    it('updates metadata while English is pending without invoking translation', async () => {
        translate.mockClear();
        const created = (await adminClient.query(create, { input: input('metadata-pending') }))
            .createStorefrontContentBlock;
        const result = await adminClient.query(
            gql`
                mutation ($input: UpdateStorefrontContentBlockInput!) {
                    updateStorefrontContentBlock(input: $input) {
                        id
                        internalName
                    }
                }
            `,
            { input: { id: created.id, expectedUpdatedAt: created.updatedAt, internalName: '中文已保存' } },
        );
        expect(result.updateStorefrontContentBlock.internalName).toBe('中文已保存');
        expect(translate).not.toHaveBeenCalled();
    });

    it('persists real product source and explicit English review without a provider request', async () => {
        translate.mockClear();
        const created = (
            await adminClient.query(
                gql`
                    mutation ($input: CreateProductInput!) {
                        createProduct(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        translations: [
                            {
                                languageCode: 'zh_Hans',
                                name: '异步翻译商品',
                                slug: 'outbox-product',
                                description: '中文商品说明',
                            },
                        ],
                    },
                },
            )
        ).createProduct;
        await adminClient.query(
            gql`
                mutation ($input: UpdateProductInput!) {
                    updateProduct(input: $input) {
                        id
                    }
                }
            `,
            { input: { id: created.id, translations: [{ languageCode: 'en', name: 'Reviewed product' }] } },
        );
        const states = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(ContentTranslationState)
            .find({ where: { entityType: 'Product' } });
        expect(states).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ fieldPath: 'name', origin: 'MANUAL', locked: true }),
            ]),
        );
        expect(translate).not.toHaveBeenCalled();
    });
    it('retries an actual search queue enqueue without requesting another translation', async () => {
        const db = server.app.get(TransactionalConnection).rawConnection;
        const states = db.getRepository(ContentTranslationState);
        await states.update(
            { entityType: Not('Product') },
            { nextAttemptAt: new Date(Date.now() + 600_000) },
        );
        await db
            .getRepository(TranslationProviderState)
            .update({ provider: 'outbox-e2e' }, { nextAttemptAt: new Date(0) });
        const search = server.app.get(SearchIndexService);
        const enqueue = vi
            .spyOn(search, 'updateProduct')
            .mockRejectedValueOnce(new Error('search queue temporarily unavailable'));
        await server.app.get(ContentTranslationRetryService).retryPending();
        expect(enqueue.mock.calls.length).toBeGreaterThan(0);
        expect(
            (await states.find({ where: { entityType: 'Product' } })).map(state => ({
                field: state.fieldPath,
                status: state.status,
                error: state.lastErrorCode,
            })),
        ).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'NOTIFY_PENDING' })]));
        const calls = translate.mock.calls.length;
        await states.update(
            { entityType: 'Product', status: 'NOTIFY_PENDING' },
            { nextAttemptAt: new Date(0) },
        );
        await server.app.get(ContentTranslationRetryService).retryPending();
        expect(translate.mock.calls.length).toBe(calls);
        expect(
            await states.count({
                where: { entityType: 'Product', status: In(['NOTIFY_PENDING', 'FAILED']) },
            }),
        ).toBe(0);
        expect(enqueue).toHaveBeenCalled();
        enqueue.mockRestore();
    });
});
