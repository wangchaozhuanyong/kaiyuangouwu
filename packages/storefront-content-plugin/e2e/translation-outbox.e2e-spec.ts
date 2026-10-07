import {
    ContentTranslationBackfillService,
    ContentTranslationPlugin,
    ContentTranslationRetryService,
    ContentTranslationService,
    ContentTranslationState,
    TranslationProviderError,
    TranslationProviderState,
} from '@vendure/content-translation-plugin';
import {
    AdministratorService,
    ChannelService,
    ConfigService,
    CurrencyCode,
    DefaultSearchPlugin,
    LanguageCode,
    mergeConfig,
    Permission,
    RequestContextService,
    RoleService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import {
    StorefrontActivationService,
    StorefrontPublicCacheService,
    StoreManagementPlugin,
    StoreProfile,
} from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import {
    createTestEnvironment,
    registerInitializer,
    SimpleGraphQLClient,
    SqljsInitializer,
    testConfig,
} from '@vendure/testing';
import { TwoFactorDashboardPlugin } from '@vendure/two-factor-dashboard-plugin';
import gql from 'graphql-tag';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { In, Not } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';

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
    authOptions: { requireVerification: false },
    apiOptions: { port: 3298, cors: { origin: 'http://127.0.0.1:5198', credentials: true } },
    defaultLanguageCode: LanguageCode.zh_Hans,
    plugins: [
        OperationsDashboardPlugin,
        StoreDomainPlugin,
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
                translations {
                    languageCode
                    label
                }
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
const refreshPublicCache = gql`
    mutation {
        refreshStorefrontPublicCache {
            channelId
            processId
            shared
            revisionFingerprint
        }
    }
`;

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
        const context = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const channels = server.app.get(ChannelService);
        const defaultChannel = await channels.getDefaultChannel(context);
        const channel = await channels.create(context, {
            code: 'translation-outbox-fixture',
            token: 'translation-outbox-fixture',
            defaultLanguageCode: LanguageCode.zh_Hans,
            defaultCurrencyCode: CurrencyCode.USD,
            defaultTaxZoneId: defaultChannel.defaultTaxZoneId,
            defaultShippingZoneId: defaultChannel.defaultShippingZoneId,
            pricesIncludeTax: false,
        });
        if (!('id' in channel)) throw new Error(channel.message);
        const roles = server.app.get(RoleService);
        const customerRole = await roles.getCustomerRole(context);
        await roles.assignRoleToChannel(context, customerRole.id, channel.id);
        const superAdminRole = await roles.getSuperAdminRole(context);
        await roles.assignRoleToChannel(context, superAdminRole.id, channel.id);
        const connection = server.app.get(TransactionalConnection);
        await connection.rawConnection.getRepository(StoreProfile).save(
            new StoreProfile({
                channelId: channel.id,
                status: 'ACTIVE',
                isPublished: false,
                descriptionZh: '',
                descriptionEn: '',
            }),
        );
        // Native, disposable fixture records satisfy the shared access policy; no guard is bypassed.
        await connection.rawConnection.getRepository(StoreDomain).save(
            new StoreDomain({
                channelId: channel.id,
                domain: 'translation-outbox.example.test',
                isPrimary: true,
                primaryChannelId: channel.id,
                status: 'ACTIVE',
                verificationToken: 'translation-outbox-fixture',
                verifiedAt: new Date(),
            }),
        );
        expect(await server.app.get(StorefrontActivationService).getAccessMode(context, channel.id)).toBe(
            'LIVE',
        );
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(channel.token);
        shopClient.setChannelToken(channel.token);
        for (const [code, title] of [
            ['terms', '测试使用条款'],
            ['privacy', '测试隐私政策'],
        ]) {
            await adminClient.query(create, {
                input: {
                    code,
                    internalName: title,
                    type: 'LEGAL',
                    enabled: true,
                    position: 0,
                    translations: [{ languageCode: 'zh_Hans', title, body: title }],
                    items: [],
                },
            });
        }
        await shopClient.query(gql`
            mutation {
                registerCustomerWithReferral(
                    input: {
                        emailAddress: "outbox-catalog@example.test"
                        password: "OutboxFixturePass123!"
                        firstName: "Outbox"
                        lastName: "Fixture"
                    }
                    consent: { termsAccepted: true, privacyAcknowledged: true, locale: "zh" }
                ) {
                    __typename
                }
            }
        `);
        await shopClient.asUserWithCredentials('outbox-catalog@example.test', 'OutboxFixturePass123!');
        translate.mockClear();
        // Isolate assertions from initial country/zone fixture translations.
        await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(ContentTranslationState)
            .clear();
    }, 120_000);
    it('refreshes the active store cache through the authenticated native Admin API', async () => {
        const ctx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: 'translation-outbox-fixture',
        });
        const cache = server.app.get(StorefrontPublicCacheService);
        const channelId = String(config.entityOptions.entityIdStrategy.encodeId(ctx.channelId));
        const first = (await adminClient.query(refreshPublicCache)).refreshStorefrontPublicCache;
        const second = (await adminClient.query(refreshPublicCache)).refreshStorefrontPublicCache;
        expect(first).toMatchObject({
            channelId,
            processId: process.pid,
            shared: cache.sharedVersions,
        });
        expect(second).toMatchObject({ channelId, processId: process.pid });
        expect(first.revisionFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(second.revisionFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(second.revisionFingerprint).not.toBe(first.revisionFingerprint);
    });
    it('rejects a logged-in native ReadChannel administrator without rotating the store cache', async () => {
        const connection = server.app.get(TransactionalConnection);
        const superAdmin = await connection.rawConnection.getRepository(User).findOneOrFail({
            where: { identifier: config.authOptions.superadminCredentials?.identifier ?? 'superadmin' },
            relations: { roles: { channels: true } },
        });
        const ctx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: 'translation-outbox-fixture',
            user: superAdmin,
        });
        const role = await server.app.get(RoleService).create(ctx, {
            code: 'cache-readonly-fixture',
            description: 'Native cache authorization fixture',
            permissions: [Permission.ReadChannel],
            channelIds: [ctx.channelId],
        });
        const identifier = 'cache-readonly@example.test';
        const password = 'CacheReadFixturePass123!';
        await server.app.get(AdministratorService).create(ctx, {
            emailAddress: identifier,
            password,
            firstName: 'Cache',
            lastName: 'ReadOnly',
            roleIds: [role.id],
        });
        const reader = new SimpleGraphQLClient(config, 'http://127.0.0.1:3298/admin-api');
        reader.setChannelToken('translation-outbox-fixture');
        expect((await reader.asUserWithCredentials(identifier, password)).identifier).toBe(identifier);
        const cache = server.app.get(StorefrontPublicCacheService);
        const revision = await cache.revision(ctx.channelId);
        await expect(reader.query(refreshPublicCache)).rejects.toThrow('not currently authorized');
        expect(await cache.revision(ctx.channelId)).toBe(revision);
    });
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
                    if (mode === 'rate-limit') {
                        translate.mockRejectedValue(new TranslationProviderError('RATE_LIMIT'));
                    } else {
                        translate.mockImplementation((request: any) =>
                            Promise.resolve({
                                provider: 'outbox-e2e',
                                translations: request.segments.map((item: any) => ({
                                    key: item.key,
                                    text: 'English category',
                                })),
                            }),
                        );
                    }
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
            const labels = input('test').items.map(item => item.translations[0].label);
            expect(
                saved.items.map(
                    (item: any) =>
                        item.translations.find((translation: any) => translation.languageCode === 'zh_Hans')
                            ?.label,
                ),
            ).toEqual(labels);
            expect(translate).not.toHaveBeenCalled();
            shopClient.setRequestHeader('language-code', 'zh_Hans');
            const chinese = (
                await shopClient.query(read, {}, { languageCode: 'zh_Hans' })
            ).storefrontContent.find((block: any) => block.id === saved.id);
            expect(chinese.title).toBe('精选五分类');
            // The Admin draft retains all five entries; CORE_CATEGORIES publishes the first two cards.
            expect(chinese.items.map((item: any) => item.label)).toEqual(labels.slice(0, 2));
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
        const metadata = db.entityMetadatas.find(
            (entity: any) => entity.name === 'StorefrontContentItemTranslation',
        );
        if (!metadata) throw new Error('Missing item translation metadata');
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const defaultChannel = await server.app.get(ChannelService).getDefaultChannel(ctx);
        const storeCtx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: 'translation-outbox-fixture',
        });
        const backfill = server.app.get(ContentTranslationBackfillService);
        await expect(backfill.backfill(storeCtx, 'StorefrontContentItem', 100, 0)).rejects.toThrow(
            '批量补译请切换到平台管理中心',
        );
        adminClient.setChannelToken(defaultChannel.token);
        try {
            // Bulk discovery is platform-only. Seed owned platform content instead of bypassing its guard.
            for (let index = 0; index < 3; index++) {
                await adminClient.query(create, { input: input(`platform-historical-${index}`) });
            }
            const repository = db.getRepository(metadata.target);
            const scope = { languageCode: 'en', base: { block: { channelId: ctx.channelId } } };
            const targets = await repository.find({ where: scope });
            expect(targets).toHaveLength(15);
            // Reconstruct the previous successful translation history before testing cache-only rediscovery.
            expect((await server.app.get(ContentTranslationRetryService).retryPending()).translated).toBe(15);
            await repository.update({ id: In(targets.map((target: any) => target.id)) }, { label: '' });
            await db.getRepository(ContentTranslationState).clear();
            translate.mockClear();
            const result = await backfill.backfill(ctx, 'StorefrontContentItem', 100, 0);
            expect(result.queued).toBe(15);
            expect(result.failed).toBe(0);
            expect(translate).not.toHaveBeenCalled();
            expect(await repository.countBy({ ...scope, label: '' })).toBe(15);
            const applied = await server.app.get(ContentTranslationRetryService).retryPending();
            expect(applied.translated).toBe(15);
            expect(await repository.countBy({ ...scope, label: '' })).toBe(0);
            expect(translate).not.toHaveBeenCalled();
        } finally {
            adminClient.setChannelToken('translation-outbox-fixture');
        }
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
        const entityId = String(
            server.app.get(ConfigService).entityOptions.entityIdStrategy.decodeId(created.id),
        );
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        await server.app.get(ContentTranslationService).recordState(ctx, {
            channelId: 'historical-channel',
            entityType: 'Product',
            entityId,
            fieldPath: 'name',
            sourceText: '旧商品名',
            translatedText: 'Old reviewed product',
            status: 'STALE',
            origin: 'MANUAL',
            locked: true,
        });

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
        const nameStates = states.filter(state => state.fieldPath === 'name' && state.entityId === entityId);
        expect(nameStates).toHaveLength(2);
        expect(nameStates.every(state => state.status === 'MANUAL_LOCKED' && state.locked)).toBe(true);
        expect(new Set(nameStates.map(state => state.sourceHash)).size).toBe(1);
        expect(new Set(nameStates.map(state => state.translatedHash)).size).toBe(1);
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
