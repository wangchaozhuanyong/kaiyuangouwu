import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMigrationPlan } from './store-isolation-migration-plan.mjs';

function preflight() {
    const empty = () => ({ available: true, sharedCount: 0, shared: [] });
    return {
        format: 1,
        mode: 'read-only',
        generatedAt: '2026-09-13T00:00:00Z',
        channels: [
            { id: '1', code: 'store-a' },
            { id: '2', code: 'store-b' },
        ],
        associations: Object.fromEntries(
            [
                'customers',
                'stockLocations',
                'paymentMethods',
                'shippingMethods',
                'products',
                'productVariants',
                'collections',
                'sellers',
            ].map(key => [key, empty()]),
        ),
        icloud: [
            { tableName: 'icloud_primary_account', totalRows: 1, unscopedRows: 1 },
            { tableName: 'icloud_virtual_email', totalRows: 5, unscopedRows: 5 },
            { tableName: 'icloud_received_mail', totalRows: 29, unscopedRows: 29 },
            { tableName: 'icloud_query_audit_log', totalRows: 4, unscopedRows: 4 },
        ],
        digitalDelivery: { configured: true, exists: true, legacyFiles: [] },
        blockers: { unscopedIcloudRows: 39 },
    };
}

test('legacy preflight is interpreted with the confirmed shared-iCloud policy, not a fake store assignment', () => {
    const source = preflight();
    const snapshot = structuredClone(source);
    const plan = buildMigrationPlan(source);
    assert.equal(plan.icloud.rowCount, 39);
    assert.equal(plan.icloud.ownershipBlocker, false);
    assert.equal(plan.icloud.action, 'retain-existing-records-and-relations');
    assert.equal(plan.readyForExecution, false);
    assert.equal(plan.requiresFreshPreflightBeforeExecution, true);
    assert.deepEqual(source, snapshot);
});

test('historical orders propose their own stores without duplicating wallet funds or guessing missing identity links', () => {
    const source = preflight();
    source.associations.customers = {
        available: true,
        sharedCount: 1,
        shared: [
            {
                entityRef: 'customer-ref',
                orders: [
                    { channelId: '1', count: 5 },
                    { channelId: '2', count: 4 },
                ],
            },
        ],
    };
    const plan = buildMigrationPlan(source);
    assert.deepEqual(plan.customers[0].orderAssignments, [
        { channelId: '1', orderCount: 5 },
        { channelId: '2', orderCount: 4 },
    ]);
    assert.equal(plan.customers[0].duplicateWalletBalance, false);
    assert.ok(plan.missingFacts[0].facts.includes('wallet-ledger'));
    assert.ok(plan.missingFacts[0].facts.includes('login-user-links'));
});

test('shared variants require an allocation decision and preserve on-hand, reserved quantity and movement history', () => {
    const source = preflight();
    source.associations.stockLocations = {
        available: true,
        sharedCount: 1,
        shared: [
            {
                entityRef: 'stock-ref',
                variantBuckets: [
                    { channelIds: ['1', '2'], variantCount: 1, stockOnHand: 8, stockAllocated: 3 },
                ],
            },
        ],
    };
    const plan = buildMigrationPlan(source);
    assert.ok(plan.stockLocations[0].missingFacts.includes('ambiguous-variant-allocation'));
    assert.equal(plan.stockLocations[0].preserveStockOnHand, true);
    assert.equal(plan.stockLocations[0].preserveStockAllocated, true);
    assert.equal(plan.stockLocations[0].preserveMovementHistory, true);
});

test('counts alone do not create a file migration manifest or fabricate names and hashes', () => {
    const source = preflight();
    source.digitalDelivery.legacyFiles = [{ fileRef: 'file-ref', bytes: 100 }];
    const plan = buildMigrationPlan(source);
    assert.equal(plan.digitalFiles[0].fileName, null);
    assert.equal(plan.digitalFiles[0].sha256, null);
    assert.ok(plan.digitalFiles[0].missingFacts.includes('source-file-sha256'));
    assert.equal(plan.digitalFiles[0].retainLegacySource, true);
    source.digitalDelivery.legacyFiles[0] = {
        fileRef: 'file-ref',
        fileName: 'SKU.txt',
        sha256: 'a'.repeat(64),
        candidateChannelIds: ['1'],
    };
    assert.deepEqual(buildMigrationPlan(source).digitalFiles[0].missingFacts, [
        'product-and-order-reference-map',
    ]);
});

test('missing relations and incomplete inventories cannot be treated as safe zero counts', () => {
    const source = preflight();
    delete source.associations.sellers;
    assert.ok(buildMigrationPlan(source).missingFacts.some(item => item.resource === 'sellers'));
    source.associations.customers.sharedCount = 2;
    assert.throws(() => buildMigrationPlan(source), /Incomplete/u);
    assert.throws(() => buildMigrationPlan({ ...preflight(), mode: 'apply' }), /read-only/u);
});
