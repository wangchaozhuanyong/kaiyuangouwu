import assert from 'node:assert/strict';
import test from 'node:test';

import { collectLegacyCompensationReadOnlyEvidence } from './public-preview-legacy-compensation-readonly.mjs';
import { LEGACY_COMPENSATION_SCOPE } from './public-preview-legacy-compensation.mjs';

test('collector only SELECTs the original six and never exports payment metadata secrets', async () => {
    const queries = [];
    const adapter = {
        tableExists: async () => true,
        columnExists: async () => true,
        async query(sql, parameters) {
            queries.push({ sql, parameters });
            assert.match(sql, /^SELECT /);
            const table = sql.match(/FROM `([^`]+)`/)[1];
            if (table === 'order')
                return [
                    {
                        id: parameters[0],
                        salesChannelId: LEGACY_COMPENSATION_SCOPE[parameters[0]].channelId,
                        state: 'PaymentSettled',
                        updatedAt: '2026-10-07T05:00:00.000Z',
                    },
                ];
            if (table === 'payment')
                return [
                    {
                        id: 'p-' + parameters[0],
                        orderId: parameters[0],
                        method:
                            'controlled-test-payment-' + LEGACY_COMPENSATION_SCOPE[parameters[0]].channelId,
                        state: 'Settled',
                        amount: 100,
                        metadata: {
                            public: { testPayment: true },
                            private: { secret: 'synthetic-secret-never-export' },
                        },
                    },
                ];
            if (table === 'order_line')
                return Object.entries(LEGACY_COMPENSATION_SCOPE[parameters[0]].lines).map(
                    ([id, quantity]) => ({ id, orderId: parameters[0], productVariantId: '10', quantity }),
                );
            if (table === 'stock_movement')
                return [
                    {
                        id: 'movement-' + parameters[0],
                        orderLineId: parameters[0],
                        productVariantId: '10',
                        stockLocationId: '3',
                        type: 'ALLOCATION',
                        quantity: 1,
                    },
                ];
            if (table === 'stock_level')
                return [
                    {
                        id: 'level',
                        productVariantId: '10',
                        stockLocationId: '3',
                        stockOnHand: 100,
                        stockAllocated: 20,
                    },
                ];
            if (table === 'stock_location') return [{ id: parameters[0] }];
            if (table === 'stock_location_channels_channel')
                return [
                    { stockLocationId: parameters[0], channelId: '2' },
                    { stockLocationId: parameters[0], channelId: '5' },
                ];
            return [];
        },
    };
    const report = await collectLegacyCompensationReadOnlyEvidence(
        adapter,
        () => new Date('2026-10-07T05:00:00.000Z'),
    );
    assert.equal(report.status, 'TARGETED_EVIDENCE_COMPLETE');
    assert.deepEqual(
        report.orders.map(row => row.order.id),
        ['25', '28', '29', '34', '36', '37'],
    );
    assert.equal(report.productionWriteAllowed, false);
    assert.equal(report.executionManifest, false);
    assert.equal(JSON.stringify(report).includes('synthetic-secret-never-export'), false);
    assert.ok(queries.every(row => row.sql.startsWith('SELECT ')));
});

test('collector fails closed on missing risk schema without issuing evidence queries', async () => {
    let queries = 0;
    const report = await collectLegacyCompensationReadOnlyEvidence({
        tableExists: async table => table !== 'storefront_usdt_payment_intent',
        columnExists: async () => true,
        query() {
            queries++;
            throw new Error('Unexpected query');
        },
    });
    assert.equal(report.status, 'UNVERIFIED_SCHEMA');
    assert.ok(report.missing.includes('storefront_usdt_payment_intent'));
    assert.equal(queries, 0);
    assert.equal(report.productionWriteAllowed, false);
});

test('collector stops on changed immutable ownership before returning executable evidence', async () => {
    await assert.rejects(
        collectLegacyCompensationReadOnlyEvidence({
            tableExists: async () => true,
            columnExists: async () => true,
            query: async () => [{ id: '25', salesChannelId: '5' }],
        }),
        /Immutable sales Channel changed/,
    );
});

test('collector unions order and line risk ownership without losing unmatched or duplicate records', async () => {
    const report = await collectLegacyCompensationReadOnlyEvidence({
        tableExists: async () => true,
        columnExists: async () => true,
        async query(sql, parameters) {
            const table = sql.match(/FROM `([^`]+)`/)[1];
            if (table === 'order')
                return [
                    { id: parameters[0], salesChannelId: LEGACY_COMPENSATION_SCOPE[parameters[0]].channelId },
                ];
            if (table === 'order_line')
                return Object.keys(LEGACY_COMPENSATION_SCOPE[parameters[0]].lines).map(id => ({ id }));
            if (table === 'physical_return_receipt') {
                assert.ok(sql.includes('`orderId`') && sql.includes('`orderLineId`'));
                const shared = { id: 'shared', orderId: '25', orderLineId: '187' };
                if (sql.endsWith('WHERE orderId = ?') && String(parameters[0]) === '25')
                    return [shared, { id: 'order-only', orderId: '25', orderLineId: 'unrelated' }];
                if (sql.endsWith('WHERE orderLineId = ?') && String(parameters[0]) === '187')
                    return [shared, { id: 'line-only', orderId: 'unrelated', orderLineId: '187' }];
            }
            return [];
        },
    });
    assert.deepEqual(report.orders[0].risks.physical_return_receipt.map(row => row.id).sort(), [
        'line-only',
        'order-only',
        'shared',
    ]);
    assert.equal(report.productionWriteAllowed, false);
});

test('dual-owned risk schema requires both persisted association columns before queries', async () => {
    const report = await collectLegacyCompensationReadOnlyEvidence({
        tableExists: async () => true,
        columnExists: async (table, column) =>
            !(table === 'auto_card_supply_snapshot' && column === 'orderId'),
        query() {
            throw new Error('Missing association must block queries');
        },
    });
    assert.equal(report.status, 'UNVERIFIED_SCHEMA');
    assert.ok(report.missing.includes('auto_card_supply_snapshot.orderId'));
});
