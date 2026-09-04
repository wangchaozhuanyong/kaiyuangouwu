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

test('channel selection uses the sole accessible Channel when no target is configured', () => {
    assert.deepEqual(selectStorefrontMediaChannels([defaultChannel]), [defaultChannel]);
});

test('channel selection requires an explicit target when multiple Channels are accessible', () => {
    assert.throws(
        () =>
            selectStorefrontMediaChannels([
                defaultChannel,
                { id: 'channel-2', code: 'my-malaysia', token: 'malaysia-token' },
            ]),
        /STOREFRONT_MEDIA_CHANNEL_CODES is required/,
    );
});

test('channel selection fails clearly when the admin cannot access any Channel', () => {
    assert.throws(() => selectStorefrontMediaChannels([]), /cannot access any Channel/);
});

test('channel selection never falls back when an explicit target is inaccessible', () => {
    assert.throws(
        () => selectStorefrontMediaChannels([defaultChannel], ['cn-mainland']),
        /Admin user cannot access Channel cn-mainland/,
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
            '--channel-codes',
            'cn-mainland,my-malaysia',
            '--keys',
            'referral-poster-neon-layout-reference',
        ]),
        {
            apply: true,
            allowRemote: true,
            validate: false,
            apiOrigin: 'https://api.example.com/',
            channelCodes: ['cn-mainland', 'my-malaysia'],
            mediaKeys: ['referral-poster-neon-layout-reference'],
        },
    );
    assert.equal(parseCliArguments([]).apply, false);
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
        if (request.query.includes('StorefrontMediaAsset')) {
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

test('asset-library media resolves the sole accessible Channel without a configured code', async () => {
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
                            channels: [defaultChannel],
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
        apply: false,
        fetchImpl,
        manifest: [reference],
    });

    assert.deepEqual(result.channelCodes, ['__default_channel__']);
    assert.equal(result.results[0].targets[0].channelCode, '__default_channel__');
});

test('only localhost origins count as local writes', () => {
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://vendure.localhost'), true);
    assert.equal(isLocalApiOrigin('https://api.example.com'), false);
});
