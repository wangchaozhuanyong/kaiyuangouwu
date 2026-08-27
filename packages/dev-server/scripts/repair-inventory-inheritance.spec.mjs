import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildInventoryInheritancePlan,
    isLocalApiOrigin,
    parseCliArguments,
    parseCsv,
    repairInventoryInheritance,
} from './repair-inventory-inheritance.mjs';

function loginResponse() {
    return new Response(
        JSON.stringify({
            data: {
                login: {
                    id: 'admin-1',
                    channels: [
                        { id: 'channel-1', code: 'cn-mainland', token: 'cn-token' },
                        { id: 'channel-2', code: 'my-malaysia', token: 'my-token' },
                    ],
                },
            },
        }),
        { headers: { 'content-type': 'application/json', 'vendure-auth-token': 'auth-token' } },
    );
}

function variant(id, sku, trackInventory) {
    return {
        id,
        name: `Variant ${sku}`,
        sku,
        trackInventory,
        product: { id: `product-${id}`, name: `Product ${sku}` },
    };
}

test('CLI and CSV parsing keep writes opt-in and targets deduplicated', () => {
    assert.deepEqual(parseCsv('sku-a, sku-b,sku-a'), ['sku-a', 'sku-b']);
    assert.deepEqual(parseCliArguments([]), { allowRemote: false, apply: false, validate: false });
    assert.deepEqual(parseCliArguments(['--apply', '--allow-remote']), {
        allowRemote: true,
        apply: true,
        validate: false,
    });
});

test('only localhost origins count as local writes', () => {
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://vendure.localhost'), true);
    assert.equal(isLocalApiOrigin('https://api.example.com'), false);
});

test('remote apply requires an explicit remote-write guard before any request', async () => {
    await assert.rejects(
        repairInventoryInheritance({
            apiOrigin: 'https://api.example.com',
            username: 'admin',
            password: 'secret',
            channelCodes: ['cn-mainland'],
            skus: ['sku-a'],
            apply: true,
            allowRemote: false,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /--apply and --allow-remote/u,
    );
});

test('production apply requires the guard even through loopback', async () => {
    await assert.rejects(
        repairInventoryInheritance({
            apiOrigin: 'http://127.0.0.1:3002',
            username: 'admin',
            password: 'secret',
            channelCodes: ['cn-mainland'],
            skus: ['sku-a'],
            apply: true,
            allowRemote: false,
            production: true,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /--apply and --allow-remote/u,
    );
});

test('a bearer token can reuse an authenticated Admin API session without logging in', async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        requests.push({ request, headers: init.headers });
        if (request.query.includes('InventoryInheritanceCurrentUser')) {
            assert.equal(init.headers.authorization, 'Bearer admin-session-token');
            return Response.json({
                data: {
                    me: {
                        id: 'admin-1',
                        channels: [{ id: 'channel-1', code: 'cn-mainland', token: 'cn-token' }],
                    },
                },
            });
        }
        if (request.query.includes('InventoryInheritanceVariant')) {
            return Response.json({
                data: {
                    productVariants: { items: [variant('variant-a', request.variables.sku, 'FALSE')] },
                },
            });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    const result = await repairInventoryInheritance({
        apiOrigin: 'http://127.0.0.1:3000',
        adminBearerToken: 'admin-session-token',
        channelCodes: ['cn-mainland'],
        skus: ['sku-a'],
        fetchImpl,
    });

    assert.equal(result.variants[0].action, 'update');
    assert.equal(
        requests.some(({ request }) => request.query.includes('InventoryInheritanceLogin')),
        false,
    );
});

test('dry-run resolves all Channels and never sends a mutation', async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        if (request.query.includes('InventoryInheritanceLogin')) return loginResponse();
        if (request.query.includes('InventoryInheritanceVariant')) {
            return Response.json({
                data: { productVariants: { items: [variant('variant-a', request.variables.sku, 'FALSE')] } },
            });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    const result = await repairInventoryInheritance({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        channelCodes: ['cn-mainland', 'my-malaysia'],
        skus: ['sku-a'],
        fetchImpl,
    });

    assert.equal(result.applied, false);
    assert.deepEqual(result.variants, [
        {
            action: 'update',
            channelCodes: ['cn-mainland', 'my-malaysia'],
            currentTrackInventory: 'FALSE',
            productId: 'product-variant-a',
            productName: 'Product sku-a',
            requestedTrackInventory: 'INHERIT',
            sku: 'sku-a',
            variantId: 'variant-a',
            variantName: 'Variant sku-a',
        },
    ]);
    assert.equal(
        requests.some(request => request.query.includes('RepairInventoryInheritance')),
        false,
    );
});

test('apply updates only FALSE variants and verifies the persisted value', async () => {
    const mutations = [];
    const variants = new Map([
        ['sku-a', variant('variant-a', 'sku-a', 'FALSE')],
        ['sku-b', variant('variant-b', 'sku-b', 'INHERIT')],
    ]);
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('InventoryInheritanceLogin')) return loginResponse();
        if (request.query.includes('InventoryInheritanceVariant')) {
            return Response.json({
                data: { productVariants: { items: [variants.get(request.variables.sku)] } },
            });
        }
        if (request.query.includes('RepairInventoryInheritance')) {
            mutations.push(request.variables.input);
            const current = variants.get('sku-a');
            return Response.json({
                data: {
                    updateProductVariant: { ...current, trackInventory: 'INHERIT' },
                },
            });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    const result = await repairInventoryInheritance({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        channelCodes: ['cn-mainland'],
        skus: ['sku-a', 'sku-b'],
        apply: true,
        fetchImpl,
    });

    assert.deepEqual(mutations, [{ id: 'variant-a', trackInventory: 'INHERIT' }]);
    assert.deepEqual(
        result.variants.map(item => [item.sku, item.action]),
        [
            ['sku-a', 'update'],
            ['sku-b', 'unchanged'],
        ],
    );
});

test('ambiguous SKU resolution fails before any mutation', async () => {
    let mutationCount = 0;
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('InventoryInheritanceLogin')) return loginResponse();
        if (request.query.includes('InventoryInheritanceVariant')) {
            return Response.json({
                data: {
                    productVariants: {
                        items: [
                            variant('variant-a', 'sku-a', 'FALSE'),
                            variant('variant-b', 'sku-a', 'FALSE'),
                        ],
                    },
                },
            });
        }
        if (request.query.includes('RepairInventoryInheritance')) mutationCount += 1;
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    await assert.rejects(
        repairInventoryInheritance({
            apiOrigin: 'http://127.0.0.1:3000',
            username: 'admin',
            password: 'secret',
            channelCodes: ['cn-mainland'],
            skus: ['sku-a'],
            apply: true,
            fetchImpl,
        }),
        /Expected one product variant for SKU sku-a/u,
    );
    assert.equal(mutationCount, 0);
});

test('an explicit TRUE variant stops the entire plan before writes', () => {
    assert.throws(
        () =>
            buildInventoryInheritancePlan([
                {
                    channel: { code: 'cn-mainland', token: 'token' },
                    variant: variant('variant-a', 'sku-a', 'FALSE'),
                },
                {
                    channel: { code: 'cn-mainland', token: 'token' },
                    variant: variant('variant-b', 'sku-b', 'TRUE'),
                },
            ]),
        /refusing to replace TRUE with INHERIT/u,
    );
});
