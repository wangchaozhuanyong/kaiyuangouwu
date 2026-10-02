import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { collectPlatformGovernanceDataPreflight } from './platform-governance-data-preflight.mjs';

test('preflight exports only fixed IDs and states, preserves missing evidence and binds the full read-only plan digest', async () => {
    const adapter = {
        tableExists: async table =>
            [
                'product',
                'product_channels_channel',
                'payment_method',
                'payment_method_channels_channel',
            ].includes(table),
        query: async sql => {
            if (sql.includes('SELECT id, code'))
                return [
                    { id: 1, code: '__default_channel__' },
                    { id: 5, code: 'moyao-ai' },
                ];
            if (sql.includes('FROM `product`'))
                return [
                    { id: 10, channelId: 1 },
                    { id: 10, channelId: 5 },
                ];
            if (sql.includes('FROM `payment_method_channels_channel`'))
                return [{ paymentMethodId: 7, channelId: 1 }];
            if (sql.includes('FROM `payment_method`'))
                return [{ id: 7, code: 'platform-method', enabled: true }];
            throw new Error('Unexpected SQL');
        },
    };
    const result = await collectPlatformGovernanceDataPreflight(adapter);
    const bytes = gunzipSync(Buffer.from(result.compressedPlan, 'base64'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), result.snapshotHash);
    const plan = JSON.parse(bytes.toString());
    assert.equal(plan.productionApply, false);
    assert.equal(plan.payment.switches.length, 0);
    assert.equal(plan.payment.entries[0].scope, 'PLATFORM_CONFIGURATION');
    assert.equal(
        plan.catalog.resources.find(resource => resource.resourceId === '10').proposedOwnerChannelId,
        '5',
    );
    assert.equal(result.enabledStoreSwitchCount, 0);
    assert.ok(plan.catalog.validation.dataMissing.includes('Facet'));
    assert.ok(!bytes.toString().includes('arguments'));
});

test('the complete plan survives a catalog larger than one SSM response', async () => {
    const adapter = {
        tableExists: async table => ['product', 'product_channels_channel'].includes(table),
        query: async sql => {
            if (sql.includes('SELECT id, code'))
                return [
                    { id: 1, code: '__default_channel__' },
                    { id: 5, code: 'store' },
                ];
            if (sql.includes('FROM `product`'))
                return Array.from({ length: 6000 }, (_, id) => ({ id: id + 1, channelId: 5 }));
            throw new Error('Unexpected SQL');
        },
    };
    const result = await collectPlatformGovernanceDataPreflight(adapter);
    assert.ok(result.compressedPlan.length > 24000);
    const plan = JSON.parse(gunzipSync(Buffer.from(result.compressedPlan, 'base64')).toString());
    const products = plan.catalog.resources.filter(resource => resource.resourceType === 'Product');
    assert.equal(products.length, 6000);
    assert.equal(products.at(-1).resourceId, '6000');
});
