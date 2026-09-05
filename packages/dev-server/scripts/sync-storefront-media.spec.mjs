import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assetTags,
    findContentBlock,
    isLocalApiOrigin,
    parseChannelCodes,
    parseCliArguments,
    parseMediaKeys,
    prepareStorefrontMediaManifest,
    selectStorefrontMediaChannels,
    storefrontMediaManifest,
    syncStorefrontMedia,
} from './sync-storefront-media.mjs';

const defaultChannel = {
    id: 'channel-1',
    code: '__default_channel__',
    token: 'default-channel-token',
};

test('Channel selection is implicit only when exactly one Channel is accessible', () => {
    assert.deepEqual(selectStorefrontMediaChannels([defaultChannel]), [defaultChannel]);
    assert.throws(
        () =>
            selectStorefrontMediaChannels([
                defaultChannel,
                { id: 'channel-2', code: 'my-malaysia', token: 'malaysia-token' },
            ]),
        /STOREFRONT_MEDIA_CHANNEL_CODES is required/,
    );
    assert.throws(() => selectStorefrontMediaChannels([]), /cannot access any Channel/);
    assert.throws(
        () => selectStorefrontMediaChannels([defaultChannel], ['cn-mainland']),
        /cannot access Channel cn-mainland/,
    );
});

test('storefront media manifest has readable, hashed and uniquely targeted files', async () => {
    const prepared = await prepareStorefrontMediaManifest();

    assert.equal(prepared.length, 4);
    assert.equal(new Set(prepared.map(item => item.key)).size, prepared.length);
    for (const item of prepared) {
        assert.match(item.hash, /^[a-f0-9]{64}$/);
        assert.deepEqual(item.tags, assetTags(item.key, item.hash));
        assert.ok(item.bytes.byteLength > 0);
    }
    const referralReference = prepared.find(item => item.key === 'referral-poster-neon-layout-reference');
    assert.equal(referralReference?.assetOnly?.purpose, 'referral-poster-layout-reference');
    await assert.rejects(
        prepareStorefrontMediaManifest([
            storefrontMediaManifest[0],
            { ...storefrontMediaManifest[0], key: 'duplicate-product-target' },
        ]),
        /targeted by both product-codex-plus and duplicate-product-target/,
    );
});

test('content target uses code first and a unique type/settings fallback second', () => {
    const blocks = [
        { id: '1', code: 'generated-hero', type: 'HERO', settings: { fallbackImage: 'other' } },
        {
            id: '2',
            code: 'renamed-cloudbridge-hero',
            type: 'HERO',
            settings: { fallbackImage: 'cloudbridge-ai-hub' },
        },
        { id: '3', code: 'auth-login-visual', type: 'AUTH_LOGIN', settings: null },
    ];

    assert.equal(
        findContentBlock(blocks, {
            code: 'missing-original-code',
            type: 'HERO',
            matchSettings: { fallbackImage: 'cloudbridge-ai-hub' },
        }).id,
        '2',
    );
    assert.equal(findContentBlock(blocks, { code: 'auth-login-visual', type: 'AUTH_LOGIN' }).id, '3');
});

test('CLI parsing deduplicates Channels and keeps writes opt-in', () => {
    assert.deepEqual(parseChannelCodes('cn-mainland, my-malaysia,cn-mainland'), [
        'cn-mainland',
        'my-malaysia',
    ]);
    assert.deepEqual(
        parseMediaKeys('referral-poster-neon-layout-reference,referral-poster-neon-layout-reference'),
        ['referral-poster-neon-layout-reference'],
    );
    assert.deepEqual(
        parseCliArguments([
            '--apply',
            '--allow-remote',
            '--api-origin',
            'https://api.example.com/',
            '--shop-origin',
            'https://shop.example.com/',
            '--channel-codes',
            'cn-mainland,my-malaysia',
            '--keys',
            'referral-poster-neon-layout-reference',
        ]),
        {
            apply: true,
            allowRemote: true,
            verify: false,
            validate: false,
            apiOrigin: 'https://api.example.com/',
            shopOrigin: 'https://shop.example.com/',
            channelCodes: ['cn-mainland', 'my-malaysia'],
            mediaKeys: ['referral-poster-neon-layout-reference'],
        },
    );
    assert.equal(parseCliArguments([]).apply, false);
    assert.deepEqual(parseCliArguments(['--verify']), {
        apply: false,
        allowRemote: false,
        verify: true,
        validate: false,
    });
    assert.throws(() => parseMediaKeys(''), /at least one media key/);
});

test('media key selection fails before authentication when a key is unknown', async () => {
    await assert.rejects(
        syncStorefrontMedia({
            apiOrigin: 'http://127.0.0.1:3000',
            username: 'admin',
            password: 'secret',
            channelCodes: ['cn-mainland'],
            mediaKeys: ['missing-media-key'],
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /Unknown storefront media key: missing-media-key/,
    );
});

test('remote apply requires the explicit remote-write guard', async () => {
    await assert.rejects(
        syncStorefrontMedia({
            apiOrigin: 'https://api.example.com',
            username: 'admin',
            password: 'secret',
            channelCodes: ['cn-mainland'],
            apply: true,
            allowRemote: false,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
            manifest: [storefrontMediaManifest[0]],
        }),
        /--apply and --allow-remote/,
    );
});

test('production apply requires the guard even through a loopback API origin', async () => {
    await assert.rejects(
        syncStorefrontMedia({
            apiOrigin: 'http://127.0.0.1:3002',
            username: 'admin',
            password: 'secret',
            channelCodes: ['cn-mainland'],
            apply: true,
            allowRemote: false,
            production: true,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
            manifest: [storefrontMediaManifest[0]],
        }),
        /--apply and --allow-remote/,
    );
});

test('dry-run resolves the backend targets without sending mutations', async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        if (request.query.includes('StorefrontMediaLogin')) {
            return new Response(
                JSON.stringify({
                    data: {
                        login: {
                            id: 'admin-1',
                            channels: [{ id: 'channel-1', code: 'cn-mainland', token: 'channel-token' }],
                        },
                    },
                }),
                { headers: { 'content-type': 'application/json', 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: [] } });
        }
        if (request.query.includes('StorefrontMediaProductVariant')) {
            return Response.json({
                data: {
                    productVariants: {
                        items: [
                            {
                                id: 'variant-6',
                                sku: 'gpt-plus-苹果开通',
                                product: { id: 'product-1', name: 'Codex Plus' },
                            },
                        ],
                    },
                },
            });
        }
        if (/query\s+StorefrontMediaAsset\b/.test(request.query)) {
            return Response.json({ data: { assets: { items: [] } } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    const result = await syncStorefrontMedia({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        channelCodes: ['cn-mainland'],
        apply: false,
        fetchImpl,
        manifest: [storefrontMediaManifest[0]],
    });

    assert.equal(result.applied, false);
    assert.equal(result.results[0].assetAction, 'upload');
    assert.deepEqual(result.results[0].targets, [
        {
            channelCode: 'cn-mainland',
            kind: 'product',
            sku: 'gpt-plus-苹果开通',
            productId: 'product-1',
            variantId: 'variant-6',
        },
    ]);
    assert.equal(
        requests.some(request =>
            /AssignStorefront|UpdateStorefront|CreateStorefrontMediaAsset/.test(request.query),
        ),
        false,
    );
});

test('asset-library media is channel-scoped without mutating another managed entity', async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        if (request.query.includes('StorefrontMediaLogin')) {
            return new Response(
                JSON.stringify({
                    data: {
                        login: {
                            id: 'admin-1',
                            channels: [{ id: 'channel-1', code: 'my-malaysia', token: 'channel-token' }],
                        },
                    },
                }),
                { headers: { 'content-type': 'application/json', 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: [] } });
        }
        if (request.query.includes('StorefrontMediaAsset')) {
            return Response.json({ data: { assets: { items: [] } } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };
    const reference = storefrontMediaManifest.find(
        item => item.key === 'referral-poster-neon-layout-reference',
    );
    assert.ok(reference);

    const result = await syncStorefrontMedia({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        channelCodes: ['my-malaysia'],
        apply: false,
        fetchImpl,
        manifest: [reference],
    });

    assert.deepEqual(result.results[0].targets, [
        {
            channelCode: 'my-malaysia',
            kind: 'asset-library',
            purpose: 'referral-poster-layout-reference',
        },
    ]);
    assert.equal(
        requests.some(request =>
            /AssignStorefront|UpdateStorefront|CreateStorefrontMediaAsset/.test(request.query),
        ),
        false,
    );
});

test('apply requests only the Asset id needed for lookup and upload', async () => {
    const assetQueries = [];
    let assigned = false;
    const fetchImpl = async (_url, init) => {
        const request =
            init.body instanceof FormData
                ? JSON.parse(String(init.body.get('operations')))
                : JSON.parse(init.body);
        if (request.query.includes('StorefrontMediaLogin')) {
            return new Response(
                JSON.stringify({
                    data: {
                        login: {
                            id: 'admin-1',
                            channels: [
                                { id: 'channel-1', code: '__default_channel__', token: 'channel-token' },
                            ],
                        },
                    },
                }),
                { headers: { 'content-type': 'application/json', 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: [] } });
        }
        if (request.operationName === 'CreateStorefrontMediaAsset') {
            assetQueries.push(request.query);
            return Response.json({ data: { createAssets: [{ id: 'asset-1' }] } });
        }
        if (/query\s+StorefrontMediaAsset\b/.test(request.query)) {
            assetQueries.push(request.query);
            return Response.json({
                data: { assets: { items: assigned ? [{ id: 'asset-1' }] : [] } },
            });
        }
        if (request.query.includes('AssignStorefrontMediaAsset')) {
            assigned = true;
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'asset-1' }] } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };
    const reference = storefrontMediaManifest.find(
        item => item.key === 'referral-poster-neon-layout-reference',
    );
    assert.ok(reference);

    const result = await syncStorefrontMedia({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        channelCodes: ['__default_channel__'],
        apply: true,
        allowRemote: true,
        fetchImpl,
        manifest: [reference],
    });

    assert.equal(result.applied, true);
    assert.equal(result.results[0].assetId, 'asset-1');
    assert.equal(result.results[0].assetAction, 'upload');
    assert.equal(assetQueries.length, 3);
    for (const query of assetQueries) {
        assert.doesNotMatch(query, /\b(?:name|preview|source)\b/);
    }
});

test('apply reuses a previously uploaded tagged Asset without uploading a duplicate', async () => {
    let uploadCount = 0;
    const assignedAssetIds = [];
    const fetchImpl = async (_url, init) => {
        const request =
            init.body instanceof FormData
                ? JSON.parse(String(init.body.get('operations')))
                : JSON.parse(init.body);
        if (request.query.includes('StorefrontMediaLogin')) {
            return new Response(
                JSON.stringify({
                    data: {
                        login: {
                            id: 'admin-1',
                            channels: [
                                { id: 'channel-1', code: '__default_channel__', token: 'channel-token' },
                            ],
                        },
                    },
                }),
                { headers: { 'content-type': 'application/json', 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: [] } });
        }
        if (/query\s+StorefrontMediaAsset\b/.test(request.query)) {
            assert.doesNotMatch(request.query, /\b(?:name|preview|source)\b/);
            return Response.json({ data: { assets: { items: [{ id: 'existing-asset-1' }] } } });
        }
        if (request.operationName === 'CreateStorefrontMediaAsset') {
            uploadCount += 1;
            return Response.json({ data: { createAssets: [{ id: 'duplicate-asset' }] } });
        }
        if (request.query.includes('AssignStorefrontMediaAsset')) {
            assignedAssetIds.push(...request.variables.input.assetIds);
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'existing-asset-1' }] } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };
    const reference = storefrontMediaManifest.find(
        item => item.key === 'referral-poster-neon-layout-reference',
    );
    assert.ok(reference);

    const result = await syncStorefrontMedia({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        channelCodes: ['__default_channel__'],
        apply: true,
        fetchImpl,
        manifest: [reference],
    });

    assert.equal(result.applied, true);
    assert.equal(result.results[0].assetId, 'existing-asset-1');
    assert.equal(result.results[0].assetAction, 'reuse');
    assert.equal(uploadCount, 0);
    assert.deepEqual(assignedAssetIds, ['existing-asset-1']);
});

test('apply preserves galleries and verifies the same Asset through Admin and Shop APIs', async () => {
    const product = {
        id: 'product-1',
        name: 'Codex Plus',
        featuredAsset: { id: 'asset-old-product' },
        assets: [{ id: 'asset-old-product' }],
    };
    const variant = {
        id: 'variant-1',
        sku: 'gpt-plus-苹果开通',
        featuredAsset: { id: 'asset-old-variant' },
        assets: [{ id: 'asset-old-variant' }],
        product,
    };
    const mutationInputs = [];
    const waits = [];
    let shopReads = 0;
    const fetchImpl = async (url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('StorefrontMediaLogin')) {
            return new Response(
                JSON.stringify({ data: { login: { id: 'admin-1', channels: [defaultChannel] } } }),
                { headers: { 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: [] } });
        }
        if (request.query.includes('StorefrontMediaProductVariant')) {
            return Response.json({ data: { productVariants: { items: [variant] } } });
        }
        if (/query\s+StorefrontMediaAsset\b/.test(request.query)) {
            return Response.json({ data: { assets: { items: [{ id: 'asset-reviewed' }] } } });
        }
        if (request.query.includes('AssignStorefrontMediaAsset')) {
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'asset-reviewed' }] } });
        }
        if (request.query.includes('UpdateStorefrontMediaProduct')) {
            mutationInputs.push(request.variables.input);
            product.featuredAsset = { id: request.variables.input.featuredAssetId };
            product.assets = request.variables.input.assetIds.map(id => ({ id }));
            return Response.json({ data: { updateProduct: { id: product.id } } });
        }
        if (request.query.includes('UpdateStorefrontMediaVariant')) {
            mutationInputs.push(request.variables.input);
            variant.featuredAsset = { id: request.variables.input.featuredAssetId };
            variant.assets = request.variables.input.assetIds.map(id => ({ id }));
            return Response.json({ data: { updateProductVariant: { id: variant.id } } });
        }
        if (request.query.includes('StorefrontMediaShopProduct')) {
            assert.equal(new URL(url).pathname, '/shop-api');
            assert.equal(new URL(url).origin, 'https://moyaoai.com');
            shopReads += 1;
            if (shopReads === 1) {
                return Response.json({
                    data: {
                        product: {
                            ...product,
                            featuredAsset: { id: 'asset-stale-shop' },
                            variants: [variant],
                        },
                    },
                });
            }
            return Response.json({ data: { product: { ...product, variants: [variant] } } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    const result = await syncStorefrontMedia({
        apiOrigin: 'http://127.0.0.1:3000',
        shopOrigin: 'https://moyaoai.com',
        username: 'admin',
        password: 'secret',
        apply: true,
        fetchImpl,
        manifest: [storefrontMediaManifest[0]],
        waitImpl: async delayMs => waits.push(delayMs),
    });

    assert.deepEqual(mutationInputs[0].assetIds, ['asset-old-product', 'asset-reviewed']);
    assert.deepEqual(mutationInputs[1].assetIds, ['asset-old-variant', 'asset-reviewed']);
    assert.equal(result.verified, true);
    assert.equal(result.shopOrigin, 'https://moyaoai.com');
    assert.equal(shopReads, 2);
    assert.deepEqual(waits, [250]);
    assert.deepEqual(result.results[0].verification, [
        {
            channelCode: '__default_channel__',
            kind: 'product',
            sku: 'gpt-plus-苹果开通',
            assetId: 'asset-reviewed',
            adminShopParity: true,
        },
    ]);
});

test('content apply sends the optimistic version and verifies Admin-Shop parity', async () => {
    const block = {
        id: 'block-1',
        updatedAt: '2026-09-05T00:00:00.000Z',
        code: 'home-fixed-category-ad',
        type: 'CATEGORY_AD',
        imageUrl: '/old.png',
        imageAsset: { id: 'asset-old' },
        backgroundColor: null,
        textColor: null,
        settings: {},
    };
    let updateInput;
    const fetchImpl = async (url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('StorefrontMediaLogin')) {
            return new Response(
                JSON.stringify({ data: { login: { id: 'admin-1', channels: [defaultChannel] } } }),
                { headers: { 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: [block] } });
        }
        if (/query\s+StorefrontMediaAsset\b/.test(request.query)) {
            return Response.json({ data: { assets: { items: [{ id: 'asset-reviewed' }] } } });
        }
        if (request.query.includes('AssignStorefrontMediaAsset')) {
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'asset-reviewed' }] } });
        }
        if (request.query.includes('UpdateStorefrontMediaContent')) {
            updateInput = request.variables.input;
            block.updatedAt = '2026-09-05T00:01:00.000Z';
            block.imageAsset = { id: updateInput.imageAssetId };
            block.imageUrl = updateInput.imageUrl;
            return Response.json({ data: { updateStorefrontContentBlock: { ...block } } });
        }
        if (request.query.includes('StorefrontMediaShopContentBlocks')) {
            assert.equal(new URL(url).pathname, '/shop-api');
            return Response.json({ data: { storefrontContent: [block] } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };
    const media = storefrontMediaManifest.find(item => item.key === 'home-gpt-category-ad');
    assert.ok(media);

    const result = await syncStorefrontMedia({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        apply: true,
        fetchImpl,
        manifest: [media],
    });

    assert.equal(updateInput.expectedUpdatedAt, '2026-09-05T00:00:00.000Z');
    assert.equal(result.results[0].verification[0].adminShopParity, true);
});

test('failed Shop verification restores the previous content Asset binding', async () => {
    const block = {
        id: 'block-1',
        updatedAt: '2026-09-05T00:00:00.000Z',
        code: 'home-fixed-category-ad',
        type: 'CATEGORY_AD',
        imageUrl: '/old.png',
        imageAsset: { id: 'asset-old' },
        backgroundColor: '#111111',
        textColor: '#ffffff',
        settings: { preserved: true },
    };
    const updateInputs = [];
    let version = 0;
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('StorefrontMediaLogin')) {
            return new Response(
                JSON.stringify({ data: { login: { id: 'admin-1', channels: [defaultChannel] } } }),
                { headers: { 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: [block] } });
        }
        if (/query\s+StorefrontMediaAsset\b/.test(request.query)) {
            return Response.json({ data: { assets: { items: [{ id: 'asset-reviewed' }] } } });
        }
        if (request.query.includes('AssignStorefrontMediaAsset')) {
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'asset-reviewed' }] } });
        }
        if (request.query.includes('UpdateStorefrontMediaContent')) {
            const input = structuredClone(request.variables.input);
            updateInputs.push(input);
            version += 1;
            block.updatedAt = `2026-09-05T00:0${String(version)}:00.000Z`;
            block.imageAsset = input.imageAssetId ? { id: input.imageAssetId } : null;
            block.imageUrl = input.imageUrl;
            block.backgroundColor = input.backgroundColor ?? block.backgroundColor;
            block.textColor = input.textColor ?? block.textColor;
            block.settings = input.settings ?? block.settings;
            return Response.json({ data: { updateStorefrontContentBlock: { ...block } } });
        }
        if (request.query.includes('StorefrontMediaShopContentBlocks')) {
            return Response.json({
                data: {
                    storefrontContent: [{ ...block, imageAsset: { id: 'asset-stale-shop' } }],
                },
            });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };
    const media = storefrontMediaManifest.find(item => item.key === 'home-gpt-category-ad');
    assert.ok(media);

    await assert.rejects(
        syncStorefrontMedia({
            apiOrigin: 'http://127.0.0.1:3000',
            username: 'admin',
            password: 'secret',
            apply: true,
            fetchImpl,
            manifest: [media],
            verificationAttempts: 1,
        }),
        /previous bindings were restored/,
    );
    assert.equal(updateInputs.length, 2);
    assert.equal(updateInputs[1].expectedUpdatedAt, '2026-09-05T00:01:00.000Z');
    assert.equal(block.imageAsset.id, 'asset-old');
    assert.equal(block.imageUrl, '/old.png');
});

test('a later media failure restores bindings from the entire reviewed batch', async () => {
    const blocks = [
        {
            id: 'block-1',
            updatedAt: '2026-09-05T00:00:00.000Z',
            code: 'batch-block-one',
            type: 'CATEGORY_AD',
            imageUrl: '/old-one.png',
            imageAsset: { id: 'asset-old-one' },
            backgroundColor: null,
            textColor: null,
            settings: {},
        },
        {
            id: 'block-2',
            updatedAt: '2026-09-05T00:00:00.000Z',
            code: 'batch-block-two',
            type: 'CATEGORY_AD',
            imageUrl: '/old-two.png',
            imageAsset: { id: 'asset-old-two' },
            backgroundColor: null,
            textColor: null,
            settings: {},
        },
    ];
    let version = 0;
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('StorefrontMediaLogin')) {
            return new Response(
                JSON.stringify({ data: { login: { id: 'admin-1', channels: [defaultChannel] } } }),
                { headers: { 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('StorefrontMediaContentBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: blocks } });
        }
        if (/query\s+StorefrontMediaAsset\b/.test(request.query)) {
            const logicalTag = request.variables.tags.find(tag => /^storefront-media:/u.test(tag));
            return Response.json({
                data: { assets: { items: [{ id: `asset-${logicalTag.split(':')[1]}` }] } },
            });
        }
        if (request.query.includes('AssignStorefrontMediaAsset')) {
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'assigned' }] } });
        }
        if (request.query.includes('UpdateStorefrontMediaContent')) {
            const input = request.variables.input;
            const block = blocks.find(candidate => candidate.id === input.id);
            version += 1;
            block.updatedAt = `2026-09-05T00:${String(version).padStart(2, '0')}:00.000Z`;
            block.imageAsset = input.imageAssetId ? { id: input.imageAssetId } : null;
            block.imageUrl = input.imageUrl;
            return Response.json({ data: { updateStorefrontContentBlock: { ...block } } });
        }
        if (request.query.includes('StorefrontMediaShopContentBlocks')) {
            return Response.json({
                data: {
                    storefrontContent: blocks.map(block =>
                        block.code === 'batch-block-two'
                            ? { ...block, imageAsset: { id: 'asset-stale-shop' } }
                            : block,
                    ),
                },
            });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };
    const base = storefrontMediaManifest.find(item => item.key === 'home-gpt-category-ad');
    assert.ok(base);
    const manifest = [
        { ...base, key: 'batch-one', content: { code: 'batch-block-one', type: 'CATEGORY_AD' } },
        { ...base, key: 'batch-two', content: { code: 'batch-block-two', type: 'CATEGORY_AD' } },
    ];

    await assert.rejects(
        syncStorefrontMedia({
            apiOrigin: 'http://127.0.0.1:3000',
            username: 'admin',
            password: 'secret',
            apply: true,
            fetchImpl,
            manifest,
            verificationAttempts: 1,
        }),
        /reviewed batch/,
    );
    assert.deepEqual(
        blocks.map(block => [block.code, block.imageAsset?.id, block.imageUrl]),
        [
            ['batch-block-one', 'asset-old-one', '/old-one.png'],
            ['batch-block-two', 'asset-old-two', '/old-two.png'],
        ],
    );
});

test('only localhost origins count as local writes', () => {
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://vendure.localhost'), true);
    assert.equal(isLocalApiOrigin('https://api.example.com'), false);
});
