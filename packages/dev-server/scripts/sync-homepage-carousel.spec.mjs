import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildHomepageCarouselPlan,
    homepageCarouselManifest,
    homepageCarouselMediaKeys,
    parseCliArguments,
    resolveCarouselBlocks,
    shopApiPathForLanguage,
    syncHomepageCarousel,
} from './sync-homepage-carousel.mjs';

function translation(languageCode, title = 'Old title') {
    return { languageCode, title, subtitle: 'Old subtitle', body: 'Old body', ctaLabel: 'Old CTA' };
}

function item(id, position) {
    return {
        id,
        enabled: true,
        position,
        imageUrl: null,
        imageAsset: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [
            { languageCode: 'zh_Hans', label: `旧${String(position)}`, description: '旧说明' },
            { languageCode: 'en', label: `Old ${String(position)}`, description: 'Old detail' },
        ],
    };
}

function block(overrides = {}) {
    return {
        id: overrides.id ?? 'block-1',
        updatedAt: overrides.updatedAt ?? '2026-09-05T00:00:00.000Z',
        code: overrides.code ?? 'home-fixed-notice',
        internalName: overrides.internalName ?? 'Existing block',
        type: overrides.type ?? 'NOTICE',
        layoutVariant: overrides.layoutVariant ?? 'AUTO',
        enabled: overrides.enabled ?? true,
        position: overrides.position ?? 0,
        startsAt: null,
        endsAt: null,
        imageUrl: overrides.imageUrl ?? null,
        imageAsset: overrides.imageAsset ?? null,
        backgroundColor: overrides.backgroundColor ?? null,
        textColor: overrides.textColor ?? null,
        targetType: overrides.targetType ?? 'NONE',
        targetValue: overrides.targetValue ?? null,
        settings: overrides.settings ?? null,
        translations: overrides.translations ?? [translation('zh_Hans'), translation('en')],
        items: overrides.items ?? [],
    };
}

const assetIds = new Map([
    ['home-hero-token-topup-v1', 'asset-token'],
    ['home-hero-codex-tiers-v1', 'asset-codex'],
    ['home-hero-account-services-v1', 'asset-accounts'],
]);

const collectionIds = new Map([
    ['中专站充值', 'collection-token'],
    ['gpt订阅', 'collection-gpt'],
]);

function initialBlocks() {
    return [
        block(),
        block({
            id: 'legacy-hero',
            code: 'home-block-mt9wegax-0',
            type: 'HERO',
            layoutVariant: 'HERO_OVERLAY',
            position: 1,
            imageUrl: '/assets/old-hero.jpg',
            imageAsset: { id: 'asset-old' },
            backgroundColor: '#070B14',
            textColor: '#FFFFFF',
            settings: { fallbackImage: 'cloudbridge-ai-hub' },
            items: [item('old-item-1', 0), item('old-item-2', 1), item('old-item-3', 2)],
        }),
        block({ id: 'trust', code: 'home-fixed-trust-bar', type: 'TRUST_BAR', position: 2 }),
    ];
}

function adminBlockFromInput(input, fallbackId) {
    return {
        ...input,
        id: input.id ?? fallbackId,
        updatedAt: '2026-09-05T01:00:00.000Z',
        imageUrl: `/assets/${String(input.imageAssetId)}.png`,
        imageAsset: input.imageAssetId ? { id: input.imageAssetId } : null,
        translations: input.translations,
        items: input.items.map((entry, index) => ({
            ...entry,
            id: entry.id ?? `${fallbackId}-item-${String(index)}`,
            imageAsset: entry.imageAssetId ? { id: entry.imageAssetId } : null,
        })),
    };
}

test('manifest maps the three approved adverts to stable media and real catalog targets', () => {
    assert.deepEqual(homepageCarouselMediaKeys, [
        'home-hero-token-topup-v1',
        'home-hero-codex-tiers-v1',
        'home-hero-account-services-v1',
    ]);
    assert.deepEqual(
        homepageCarouselManifest.map(definition => definition.code),
        ['home-hero-token-topup', 'home-hero-codex-tiers', 'home-hero-account-services'],
    );
    assert.equal(homepageCarouselManifest[0].target.collectionSlug, '中专站充值');
    assert.equal(homepageCarouselManifest[1].target.collectionSlug, 'gpt订阅');
    assert.deepEqual(
        homepageCarouselManifest[0].items.map(entry => entry.zh[0]),
        ['$1', '$5', '$10'],
    );
    assert.deepEqual(
        homepageCarouselManifest[1].items.map(entry => entry.zh[0]),
        ['PLUS', 'X5', 'X20'],
    );
});

test('Shop verification mirrors the client language query route', () => {
    assert.equal(shopApiPathForLanguage('zh_Hans'), 'shop-api?languageCode=zh_Hans');
    assert.equal(shopApiPathForLanguage('en'), 'shop-api?languageCode=en');
});

test('plan adopts the single legacy hero, creates two slides, and preserves the surrounding order', () => {
    const plan = buildHomepageCarouselPlan({
        blocks: initialBlocks(),
        assetIds,
        collectionIds,
    });

    assert.equal(plan.requiresWrite, true);
    assert.deepEqual(
        plan.entries.map(entry => entry.action),
        ['adopt-and-update', 'create', 'create'],
    );
    assert.equal(plan.input.updates[0].id, 'legacy-hero');
    assert.equal(plan.input.updates[0].targetValue, 'collection-token');
    assert.equal(plan.input.creates[0].targetValue, 'collection-gpt');
    assert.deepEqual(plan.input.orderedCodes, [
        'home-fixed-notice',
        'home-hero-token-topup',
        'home-hero-codex-tiers',
        'home-hero-account-services',
        'home-fixed-trust-bar',
    ]);
});

test('a fully matching three-slide carousel produces an idempotent no-op', () => {
    const initial = initialBlocks();
    const first = buildHomepageCarouselPlan({ blocks: initial, assetIds, collectionIds });
    const updatedHero = adminBlockFromInput(first.input.updates[0], 'legacy-hero');
    const created = first.input.creates.map((input, index) =>
        adminBlockFromInput(input, `created-${String(index + 1)}`),
    );
    const byCode = new Map(
        [initial[0], updatedHero, ...created, initial[2]].map(entry => [entry.code, entry]),
    );
    const matching = first.input.orderedCodes.map((code, position) => ({
        ...byCode.get(code),
        position,
    }));

    const second = buildHomepageCarouselPlan({ blocks: matching, assetIds, collectionIds });
    assert.equal(second.requiresWrite, false);
    assert.deepEqual(
        second.entries.map(entry => entry.action),
        ['noop', 'noop', 'noop'],
    );
    assert.equal(second.input.orderedCodes, undefined);
});

test('ambiguous unmanaged hero content stops before any write plan is produced', () => {
    const blocks = [
        ...initialBlocks(),
        block({ id: 'second-hero', code: 'another-hero', type: 'HERO', position: 2 }),
    ];
    assert.throws(() => resolveCarouselBlocks(blocks), /at most one legacy HERO/u);
});

test('CLI defaults to dry-run and remote writes require the second guard', async () => {
    assert.deepEqual(parseCliArguments([]), {
        allowRemote: false,
        apply: false,
        verify: false,
        validate: false,
    });
    assert.deepEqual(parseCliArguments(['--apply', '--allow-remote', '--channel-codes', 'cn-mainland']), {
        allowRemote: true,
        apply: true,
        verify: false,
        validate: false,
        channelCodes: ['cn-mainland'],
    });

    await assert.rejects(
        syncHomepageCarousel({
            apiOrigin: 'https://api.example.com',
            username: 'admin',
            password: 'password',
            channelCodes: ['cn-mainland'],
            apply: true,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /--apply and --allow-remote/u,
    );
});

function createPublisherFixture({ missingCollection = false, mutateShop, corruptRestore = false } = {}) {
    const state = { blocks: initialBlocks(), assets: new Map(), mutations: [], shopRequests: [] };
    let version = 0;
    const channel = { id: 'channel-default', code: '__default_channel__', token: 'fixture-channel' };
    const fetchImpl = async (url, init) => {
        const request =
            init.body instanceof FormData
                ? JSON.parse(String(init.body.get('operations')))
                : JSON.parse(init.body);
        const { query, variables } = request;
        if (/mutation\s/u.test(query) && !query.includes('Login')) state.mutations.push(request);
        if (query.includes('Login')) {
            return Response.json(
                { data: { login: { id: 'fixture-admin', channels: [channel] } } },
                { headers: { 'vendure-auth-token': 'fixture-auth' } },
            );
        }
        assert.equal(init.headers['vendure-token'], channel.token);
        if (query.includes('HomepageCarouselAdminBlocks') || query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: state.blocks } });
        }
        if (query.includes('HomepageCarouselCollection')) {
            assert.equal(new URL(url).searchParams.get('languageCode'), 'zh_Hans');
            assert.equal(init.headers['language-code'], 'zh_Hans');
            const id = collectionIds.get(variables.slug);
            return Response.json({ data: { collections: { items: missingCollection ? [] : [{ id }] } } });
        }
        if (/query\s+StorefrontMediaAsset\b/u.test(query)) {
            const key = variables.tags.find(tag => tag.startsWith('storefront-media:'));
            const asset = state.assets.get(key);
            return Response.json({ data: { assets: { items: asset ? [asset] : [] } } });
        }
        if (request.operationName === 'CreateStorefrontMediaAsset') {
            const key = variables.input[0].tags.find(tag => tag.startsWith('storefront-media:'));
            const asset = { id: assetIds.get(key.slice('storefront-media:'.length)) };
            assert.ok(asset.id);
            state.assets.set(key, asset);
            return Response.json({ data: { createAssets: [asset] } });
        }
        if (query.includes('AssignStorefrontMediaAsset')) {
            return Response.json({ data: { assignAssetsToChannel: [{ id: variables.input.assetIds[0] }] } });
        }
        if (query.includes('ApplyHomepageCarousel')) {
            const { input } = variables;
            assert.deepEqual(
                input.expectedBlocks,
                state.blocks.map(entry => ({ id: entry.id, expectedUpdatedAt: entry.updatedAt })),
            );
            version += 1;
            for (const update of input.updates) {
                const index = state.blocks.findIndex(entry => entry.id === update.id);
                assert.ok(index >= 0);
                assert.equal(update.expectedUpdatedAt, state.blocks[index].updatedAt);
                state.blocks[index] = adminBlockFromInput(update, update.id);
                state.blocks[index].updatedAt = `fixture-version-${version}`;
            }
            for (const create of input.creates) {
                state.blocks.push(adminBlockFromInput(create, `fixture-${create.code}`));
            }
            if (input.orderedCodes) {
                const byCode = new Map(state.blocks.map(entry => [entry.code, entry]));
                state.blocks = input.orderedCodes.map((code, position) => ({
                    ...byCode.get(code),
                    position,
                }));
            }
            if (corruptRestore && input.updates.some(entry => entry.code === 'home-block-mt9wegax-0')) {
                state.blocks.find(entry => entry.type === 'HERO').textColor = '#000000';
            }
            return Response.json({ data: { applyStorefrontContentChanges: state.blocks } });
        }
        if (query.includes('DeleteHomepageCarouselBlock')) {
            state.blocks = state.blocks.filter(entry => entry.id !== variables.id);
            return Response.json({ data: { deleteStorefrontContentBlock: { result: 'DELETED' } } });
        }
        if (query.includes('HomepageCarouselShopBlocks')) {
            const languageCode = new URL(url).searchParams.get('languageCode');
            assert.equal(languageCode, init.headers['language-code']);
            assert.equal(new URL(url).origin, 'https://shop.example.com');
            state.shopRequests.push(languageCode);
            const published = structuredClone(state.blocks).map(entry => {
                const { translations, items, ...fields } = entry;
                return {
                    ...fields,
                    ...translations.find(copy => copy.languageCode === languageCode),
                    items: items.map(({ translations: itemTranslations, ...itemFields }) => ({
                        ...itemFields,
                        ...itemTranslations.find(copy => copy.languageCode === languageCode),
                    })),
                };
            });
            mutateShop?.(published, languageCode);
            return Response.json({ data: { storefrontContent: published } });
        }
        throw new Error(`Unexpected fixture request: ${query}`);
    };
    const run = options =>
        syncHomepageCarousel({
            apiOrigin: 'http://127.0.0.1:3000',
            shopOrigin: 'https://shop.example.com',
            username: 'fixture-admin',
            password: 'fixture-password',
            channelCodes: [channel.code],
            production: false,
            fetchImpl,
            ...options,
        });
    return { state, run };
}

test('dry-run previews three content changes without uploading or changing backend state', async () => {
    const { state, run } = createPublisherFixture();
    const before = structuredClone(state.blocks);
    const result = await run();
    assert.equal(result.applied, false);
    assert.deepEqual(state.mutations, []);
    assert.deepEqual(state.blocks, before);
    assert.equal(result.results[0].entries.length, 3);
});

test('all content targets are checked before any upload or content mutation', async () => {
    const { state, run } = createPublisherFixture({ missingCollection: true });
    await assert.rejects(run({ apply: true }), /Expected one collection/u);
    assert.deepEqual(state.mutations, []);
});

test('apply binds uploaded assets to editable blocks, verifies both locales, and repeats without new content', async () => {
    const { state, run } = createPublisherFixture();
    const result = await run({ apply: true });
    assert.equal(result.verified, true);
    const heroes = state.blocks.filter(entry => entry.type === 'HERO');
    assert.deepEqual(
        heroes.map(entry => entry.imageAsset.id),
        [...assetIds.values()],
    );
    assert.deepEqual(
        heroes.map(entry => entry.code),
        homepageCarouselManifest.map(entry => entry.code),
    );
    assert.deepEqual(state.shopRequests, ['zh_Hans', 'en']);
    assert.equal(
        state.mutations.filter(entry => entry.operationName === 'CreateStorefrontMediaAsset').length,
        3,
    );
    assert.equal(state.mutations.filter(entry => entry.query.includes('ApplyHomepageCarousel')).length, 1);

    state.mutations.length = 0;
    const repeated = await run({ apply: true });
    assert.ok(repeated.results[0].entries.every(entry => entry.action === 'noop'));
    assert.equal(
        state.mutations.some(entry => entry.query.includes('ApplyHomepageCarousel')),
        false,
    );
    assert.equal(
        state.mutations.some(entry => entry.operationName === 'CreateStorefrontMediaAsset'),
        false,
    );

    state.mutations.length = 0;
    await run({ verify: true });
    assert.deepEqual(state.mutations, []);
});

test('rollback is reported as failed when the Admin API does not persist the restored fields', async () => {
    const { run } = createPublisherFixture({
        corruptRestore: true,
        mutateShop: blocks => {
            blocks.find(entry => entry.type === 'HERO').title = 'Stale title';
        },
    });
    await assert.rejects(run({ apply: true }), /rollback also failed/u);
});

for (const [name, mutate] of [
    [
        'image URL',
        blocks => {
            blocks.find(entry => entry.type === 'HERO').imageUrl = '/assets/stale.png';
        },
    ],
    [
        'theme',
        blocks => {
            blocks.find(entry => entry.type === 'HERO').settings.accentColor = '#000000';
        },
    ],
    [
        'enabled state',
        blocks => {
            blocks.find(entry => entry.type === 'HERO').enabled = false;
        },
    ],
    [
        'carousel order',
        blocks => {
            blocks.reverse();
        },
    ],
    [
        'English copy',
        (blocks, languageCode) => {
            if (languageCode === 'en') blocks.find(entry => entry.type === 'HERO').title = 'Stale English';
        },
    ],
]) {
    test(`Shop ${name} drift fails publication and restores the previous editable content`, async () => {
        const { state, run } = createPublisherFixture({ mutateShop: mutate });
        const before = structuredClone(state.blocks);
        await assert.rejects(run({ apply: true }), /previous content bindings were restored/u);
        assert.deepEqual(
            state.blocks.map(entry => entry.code),
            before.map(entry => entry.code),
        );
        const restored = state.blocks.find(entry => entry.type === 'HERO');
        const original = before.find(entry => entry.type === 'HERO');
        for (const field of ['imageAsset', 'settings', 'translations', 'targetType', 'targetValue']) {
            assert.deepEqual(restored[field], original[field]);
        }
        assert.equal(state.assets.size, 3, 'Uploaded assets remain available for audit and reuse');
        assert.equal(
            state.mutations.filter(entry => entry.query.includes('DeleteHomepageCarouselBlock')).length,
            2,
        );
    });
}
