import assert from 'node:assert/strict';
import test from 'node:test';

import { collectPlatformPaymentDataPlan } from './platform-payment-data-plan.mjs';

test('payment mapping binds configuration hashes and local states without selecting credentials or rewriting history', async () => {
    const statements = [];
    const adapter = {
        kind: 'mysql',
        tableExists: async table =>
            ['payment_method', 'payment_method_channels_channel', 'payment'].includes(table),
        columnExists: async () => true,
        query: async sql => {
            statements.push(sql);
            if (sql.includes('SELECT id, code'))
                return [
                    { id: 1, code: '__default_channel__' },
                    { id: 5, code: 'shop' },
                ];
            if (sql.includes('SHA2'))
                return [
                    {
                        id: 4,
                        handlerCode: 'shared-payment',
                        handlerDigest: 'a'.repeat(64),
                        checkerDigest: 'b'.repeat(64),
                    },
                ];
            if (sql.includes('FROM `payment_method_channels_channel`'))
                return [{ paymentMethodId: 4, channelId: 1 }];
            if (sql.includes('FROM `payment_method`')) return [{ id: 4, code: 'shared', enabled: 0 }];
            if (sql.includes('FROM `payment`'))
                return [{ id: 9, method: 'old-payment', orderId: 7, state: 'Settled' }];
            throw new Error('Unexpected query');
        },
    };
    const plan = await collectPlatformPaymentDataPlan(adapter);
    assert.deepEqual(plan.operatingChannels, [{ id: '5', code: 'shop' }]);
    assert.equal(plan.entries[0].configurationEvidence.handlerDigest, 'a'.repeat(64));
    assert.equal(plan.entries[0].enabled, 0);
    assert.equal(plan.productionReady, false);
    assert.equal(plan.entries[0].automaticMigration, false);
    assert.equal(plan.historicalPayments[0].method, 'old-payment');
    assert.equal(plan.switches.length, 0);
    assert.ok(statements.every(sql => /^SELECT/u.test(sql.trim())));
    assert.ok(statements.every(sql => !/SELECT\s+[^\n]*\b(handler|checker)\s*(,|FROM)/u.test(sql)));
    assert.ok(!JSON.stringify(plan).includes('args'));
});

test('missing configuration evidence stays missing rather than becoming an equal or enabled mapping', async () => {
    const plan = await collectPlatformPaymentDataPlan({
        tableExists: async table => table === 'payment_method',
        query: async sql =>
            sql.includes('SELECT id, code')
                ? [{ id: 1, code: '__default_channel__' }]
                : [{ id: 2, code: 'legacy', enabled: 1 }],
    });
    assert.equal(plan.entries[0].configurationEvidence, 'DATA_MISSING');
    assert.equal(plan.entries[0].scope, 'LEGACY_STORE_CONFIGURATION');
    assert.deepEqual(plan.switches, []);
    assert.ok(plan.applyRequirements.includes('separate production authorization'));
});
