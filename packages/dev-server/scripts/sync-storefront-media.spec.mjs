import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assetTags,
    findContentBlock,
    isLocalApiOrigin,
    parseChannelCodes,
    parseCliArguments,
    prepareStorefrontMediaManifest,
    storefrontMediaManifest,
    syncStorefrontMedia,
} from './sync-storefront-media.mjs';

test('storefront media manifest has readable, hashed and uniquely targeted files', async () => {
    const prepared = await prepareStorefrontMediaManifest();

    assert.equal(prepared.length, 3);
    assert.equal(new Set(prepared.map(item => item.key)).size, prepared.length);
    for (const item of prepared) {
        assert.match(item.hash, /^[a-f0-9]{64}$/);
        assert.deepEqual(item.tags, assetTags(item.key, item.hash));
        assert.ok(item.bytes.byteLength > 0);
    }
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
        parseCliArguments([
            '--apply',
            '--allow-remote',
            '--api-origin',
            'https://api.example.com/',
            '--channel-codes',
            'cn-mainland,my-malaysia',
        ]),
        {
            apply: true,
            allowRemote: true,
            validate: false,
            apiOrigin: 'https://api.example.com/',
            channelCodes: ['cn-mainland', 'my-malaysia'],
        },
    );
    assert.equal(parseCliArguments([]).apply, false);
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

test('an existing Admin API bearer session can authenticate the publisher', async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        requests.push({ request, headers: init.headers });
        if (request.query.includes('StorefrontMediaCurrentUser')) {
            return Response.json({
                data: {
                    me: {
                        id: 'admin-1',
                        channels: [{ id: 'channel-1', code: 'cn-mainland', token: 'channel-token' }],
                    },
                },
            });
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

    await syncStorefrontMedia({
        apiOrigin: 'http://127.0.0.1:3000',
        adminBearerToken: 'existing-admin-session',
        channelCodes: ['cn-mainland'],
        apply: false,
        fetchImpl,
        manifest: [storefrontMediaManifest[0]],
    });

    assert.equal(
        requests.some(({ request }) => request.query.includes('StorefrontMediaLogin')),
        false,
    );
    assert.equal(requests[0].headers.authorization, 'Bearer existing-admin-session');
});

test('asset upload does not request the nullable translated name field', async () => {
    let uploadOperations;
    const fetchImpl = async (_url, init) => {
        if (init.body instanceof FormData) {
            uploadOperations = JSON.parse(init.body.get('operations'));
            return Response.json({
                data: {
                    createAssets: [
                        {
                            id: 'asset-25',
                            preview: 'preview/codex-plus.png',
                            source: 'source/codex-plus.png',
                        },
                    ],
                },
            });
        }
        const request = JSON.parse(init.body);
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
        if (request.query.includes('AssignStorefrontMediaAsset')) {
            return Response.json({ data: { assignAssetsToChannel: { id: 'asset-25' } } });
        }
        if (request.query.includes('UpdateStorefrontMediaProduct')) {
            return Response.json({ data: { updateProduct: { id: 'product-1' } } });
        }
        if (request.query.includes('UpdateStorefrontMediaVariant')) {
            return Response.json({ data: { updateProductVariant: { id: 'variant-6' } } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    const result = await syncStorefrontMedia({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        channelCodes: ['cn-mainland'],
        apply: true,
        fetchImpl,
        manifest: [storefrontMediaManifest[0]],
    });

    assert.equal(result.results[0].assetId, 'asset-25');
    assert.doesNotMatch(uploadOperations.query, /^\s*name\s*$/mu);
});

test('only localhost origins count as local writes', () => {
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://vendure.localhost'), true);
    assert.equal(isLocalApiOrigin('https://api.example.com'), false);
});
