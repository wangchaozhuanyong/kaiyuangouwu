import assert from 'node:assert/strict';
import test from 'node:test';

import { collectPlatformCatalogDataPlan } from './platform-catalog-data-plan.mjs';
const adapter = {
    tableExists: async t => ['product', 'product_channels_channel'].includes(t),
    query: async sql =>
        sql.includes('SELECT id, code')
            ? [
                  { id: 1, code: '__default_channel__' },
                  { id: 2, code: 'a' },
                  { id: 3, code: 'b' },
              ]
            : [
                  { id: 10, channelId: 1 },
                  { id: 10, channelId: 2 },
                  { id: 11, channelId: 2 },
                  { id: 11, channelId: 3 },
              ],
};
test('read-only manifest keeps default and history, identifies missing evidence, never guesses shared ownership', async () => {
    const result = await collectPlatformCatalogDataPlan(adapter);
    assert.equal(result.productionApply, false);
    assert.equal(result.resources.find(r => r.resourceId === '11').proposedOwnerChannelId, null);
    assert.equal(
        result.resources.find(r => r.resourceId === '10').defaultAssociationCleanup.status,
        'BLOCKED_DELIVERY_AND_VARIANT_REVIEW',
    );
    assert.ok(result.validation.dataMissing.includes('Facet'));
    assert.ok(result.snapshotHash);
});
test('rejects forged ids, resource types and absent owner membership before producing a migration plan', async () => {
    await assert.rejects(
        collectPlatformCatalogDataPlan(adapter, [
            { resourceType: 'Order', resourceId: 10, ownerChannelId: 2, evidence: 'wrong type' },
        ]),
    );
    await assert.rejects(
        collectPlatformCatalogDataPlan(adapter, [
            {
                resourceType: 'Product',
                resourceId: 11,
                ownerChannelId: 1,
                evidence: 'default cannot maintain sale',
            },
        ]),
    );
    await assert.rejects(
        collectPlatformCatalogDataPlan(adapter, [
            { resourceType: 'Product', resourceId: 999, ownerChannelId: 2, evidence: 'missing resource' },
        ]),
    );
});

test('recognizes registered authorized shared products without proposing a destructive split', async () => {
    const governed = {
        tableExists: async t =>
            [
                'product',
                'product_channels_channel',
                'catalog_resource_ownership',
                'product_sales_authorization',
            ].includes(t),
        query: async sql => {
            if (sql.includes('SELECT id, code'))
                return [
                    { id: 1, code: '__default_channel__' },
                    { id: 2, code: 'a' },
                    { id: 3, code: 'b' },
                ];
            if (sql.includes('FROM `catalog_resource_ownership`'))
                return [{ resourceType: 'Product', resourceId: 11, ownerChannelId: 2, scope: 'STORE' }];
            if (sql.includes('FROM `product_sales_authorization`'))
                return [
                    {
                        productId: 11,
                        channelId: 3,
                        sourceChannelId: 2,
                        state: 'ACTIVE',
                        variantIds: '["12"]',
                    },
                ];
            return [
                { id: 11, channelId: 1 },
                { id: 11, channelId: 2 },
                { id: 11, channelId: 3 },
            ];
        },
    };
    const result = await collectPlatformCatalogDataPlan(governed);
    const product = result.resources.find(r => r.resourceId === '11');
    assert.equal(product.status, 'REGISTERED_AUTHORIZED_SALES');
    assert.deepEqual(product.proposedActions, []);
    await assert.rejects(
        collectPlatformCatalogDataPlan(governed, [
            {
                resourceType: 'Product',
                resourceId: 11,
                ownerChannelId: 3,
                evidence: 'contradicts owner registry',
            },
        ]),
        /MAPPING_CONFLICTS/,
    );
});
