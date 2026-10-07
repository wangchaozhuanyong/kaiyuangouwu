import assert from 'node:assert/strict';
import test from 'node:test';

import {
    canonicalCompensationJson,
    compensationFingerprint,
    createLegacyCompensationExecutor,
    LEGACY_COMPENSATION_AUTHORIZATION,
    LEGACY_COMPENSATION_LINE_RISK_TABLES,
    LEGACY_COMPENSATION_RISK_TABLES,
    LEGACY_COMPENSATION_VERSION,
    validateLegacyCompensationSnapshot,
} from './public-preview-legacy-compensation.mjs';

const now = new Date('2026-10-07T05:00:00.000Z');
function original() {
    return {
        order: { id: '25', salesChannelId: '2', state: 'PaymentSettled' },
        payments: [
            {
                id: '2',
                state: 'Settled',
                method: 'controlled-test-payment-2',
                serverMarkedTest: true,
                manualReviewRequired: false,
                refunds: [],
            },
        ],
        lines: [{ id: '187', productVariantId: '10', quantity: 1, fulfillmentType: 'physical' }],
        movements: [
            {
                id: '813',
                orderLineId: '187',
                productVariantId: '10',
                stockLocationId: '3',
                type: 'ALLOCATION',
                quantity: 1,
            },
        ],
        locations: [{ id: '3', channelIds: ['1', '2'] }],
        stockLevels: [
            { id: '90', productVariantId: '10', stockLocationId: '3', stockOnHand: 20, stockAllocated: 1 },
        ],
        coupons: [],
        allocations: [],
        ledger: [],
        fulfillments: [],
        carts: [],
        risks: Object.fromEntries(
            [...LEGACY_COMPENSATION_RISK_TABLES, ...LEGACY_COMPENSATION_LINE_RISK_TABLES].map(table => [
                table,
                [],
            ]),
        ),
    };
}

test('accepts only original native server-marked simulation allocation and exact location', () => {
    assert.deepEqual(validateLegacyCompensationSnapshot(original(), now), [
        { orderLineId: '187', productVariantId: '10', stockLocationId: '3', quantity: 1 },
    ]);
});

for (const state of ['Created', 'Error', 'Declined', 'Cancelled', 'TestSettled', 'Unknown']) {
    test(`rejects persisted ${state} funding evidence before any compensation`, () => {
        const snapshot = original();
        snapshot.payments.push({ ...snapshot.payments[0], id: 'other', state });
        assert.throws(() => validateLegacyCompensationSnapshot(snapshot, now), /Unreconciled payment state/);
    });
}

for (const mutate of [
    snapshot => {
        snapshot.payments[0].method = 'real-card';
    },
    snapshot => {
        snapshot.payments[0].serverMarkedTest = false;
    },
    snapshot => {
        snapshot.payments[0].manualReviewRequired = true;
    },
    snapshot => {
        snapshot.payments[0].refunds = [{ id: 'r', state: 'Failed' }];
    },
]) {
    test('rejects real, single-marker, manual review and any existing refund evidence', () => {
        const snapshot = original();
        mutate(snapshot);
        assert.throws(() => validateLegacyCompensationSnapshot(snapshot, now));
    });
}

for (const table of new Set([...LEGACY_COMPENSATION_RISK_TABLES, ...LEGACY_COMPENSATION_LINE_RISK_TABLES])) {
    test(`fails closed on a persisted ${table} row`, () => {
        const snapshot = original();
        snapshot.risks[table] = [{ id: 'unreconciled' }];
        assert.throws(() => validateLegacyCompensationSnapshot(snapshot, now), /blocks compensation/);
    });
}

test('missing risk evidence is not interpreted as zero rows', () => {
    const snapshot = original();
    delete snapshot.risks.storefront_usdt_payment_intent;
    assert.throws(() => validateLegacyCompensationSnapshot(snapshot, now), /Unverified risk table/);
});

test('excludes newly discovered channel-eight orders and changed immutable sales ownership', () => {
    const snapshot = original();
    snapshot.order.id = '41';
    assert.throws(() => validateLegacyCompensationSnapshot(snapshot, now), /outside the original six/);
    snapshot.order.id = '25';
    snapshot.order.salesChannelId = '5';
    assert.throws(
        () => validateLegacyCompensationSnapshot(snapshot, now),
        /Immutable sales Channel mismatch/,
    );
});

test('blocks foreign location, prior release, multiple original locations and an unapproved stock line', () => {
    for (const mutate of [
        snapshot => {
            snapshot.locations[0].channelIds = ['1', '5'];
        },
        snapshot => {
            snapshot.movements[0].type = 'RELEASE';
        },
        snapshot => {
            snapshot.movements.push({ ...snapshot.movements[0], id: '814', stockLocationId: '4' });
        },
        snapshot => {
            snapshot.lines[0].id = 'new';
            snapshot.movements[0].orderLineId = 'new';
        },
    ]) {
        const snapshot = original();
        mutate(snapshot);
        assert.throws(() => validateLegacyCompensationSnapshot(snapshot, now));
    }
});

test('expired USED coupon preserves its original redemption and cannot be regranted', () => {
    const snapshot = original();
    snapshot.order.id = '34';
    snapshot.lines[0].id = '235';
    snapshot.lines[0].quantity = 4;
    snapshot.movements[0].orderLineId = '235';
    snapshot.movements[0].quantity = 4;
    snapshot.stockLevels[0].stockAllocated = 4;
    snapshot.coupons = [
        {
            id: '7',
            channelId: '2',
            status: 'USED',
            usedOrderId: '34',
            validUntil: '2026-09-25T13:01:11.000Z',
            revokedAt: null,
            lockedOrderId: '34',
        },
    ];
    snapshot.allocations = [
        {
            id: '7',
            channelId: '2',
            customerCouponId: '7',
            orderId: '34',
            status: 'USED',
            refundId: null,
            refundedAmount: 0,
        },
    ];
    snapshot.ledger = [{ id: '7', customerCouponId: '7', orderId: '34', eventType: 'REDEEMED' }];
    assert.equal(validateLegacyCompensationSnapshot(snapshot, now)[0].quantity, 4);
    snapshot.coupons[0].validUntil = '2026-10-08T00:00:00.000Z';
    assert.throws(() => validateLegacyCompensationSnapshot(snapshot, now), /not expired/);
});

test('fingerprint changes with versions or original movement data but ignores object-key order', () => {
    assert.equal(canonicalCompensationJson({ b: 2, a: 1 }), canonicalCompensationJson({ a: 1, b: 2 }));
    const snapshot = original();
    const before = compensationFingerprint(snapshot);
    snapshot.movements[0].quantity = 0;
    assert.notEqual(compensationFingerprint(snapshot), before);
});

function guardedExecutor(options = {}) {
    let transactions = 0;
    const keys = [
        'Order',
        'OrderLine',
        'Payment',
        'StockMovement',
        'StockLevel',
        'StockLocation',
        'OrderHistoryEntry',
        'CustomerCoupon',
        'CouponOrderAllocation',
        'CouponLedgerEntry',
    ];
    const executor = createLegacyCompensationExecutor({
        connection: {
            rawConnection: {
                options: {
                    type: 'mysql',
                    host: '127.0.0.1',
                    database: 'order_closure_abcdef',
                    ...options.database,
                },
            },
        },
        orders: {
            withOrderMutationTransaction() {
                transactions++;
                throw new Error('Unexpected transaction');
            },
        },
        carts: {},
        stockMovements: {},
        stockLocations: {},
        coupons: {},
        history: {},
        entities: Object.fromEntries(keys.map(key => [key, class {}])),
        superAdminPermission: 'SuperAdmin',
        clock: () => now,
        isolatedTest: options.isolatedTest ?? false,
    });
    const snapshot = original();
    const request = {
        orderId: '25',
        apply: true,
        manifest: {
            version: LEGACY_COMPENSATION_VERSION,
            authorization: LEGACY_COMPENSATION_AUTHORIZATION,
            sourceSnapshotSha256: 'a'.repeat(64),
            capturedAt: now.toISOString(),
            orders: [{ snapshot, fingerprint: compensationFingerprint(snapshot) }],
        },
    };
    return { executor, request, transactions: () => transactions };
}

test('read-only admin cannot authorize compensation and obtains no transaction', async () => {
    const fixture = guardedExecutor({ isolatedTest: true });
    await assert.rejects(
        fixture.executor.execute(
            { channelId: '2', apiType: 'admin', userHasPermissions: () => false },
            fixture.request,
        ),
        /authenticated SuperAdmin/,
    );
    assert.equal(fixture.transactions(), 0);
});

test('production apply waits for actual repaired runtime protection proof before locking', async () => {
    const fixture = guardedExecutor();
    await assert.rejects(
        fixture.executor.execute(
            { channelId: '2', apiType: 'admin', userHasPermissions: () => true },
            fixture.request,
        ),
        /WAIT_REPAIR_DEPLOYMENT/,
    );
    assert.equal(fixture.transactions(), 0);
});

test('test bypass cannot target a production hostname or non-owned database', async () => {
    const fixture = guardedExecutor({
        isolatedTest: true,
        database: { host: 'production.invalid', database: 'vendure' },
    });
    await assert.rejects(
        fixture.executor.execute(
            { channelId: '2', apiType: 'admin', userHasPermissions: () => true },
            fixture.request,
        ),
        /loopback/,
    );
    assert.equal(fixture.transactions(), 0);
});

test('digital and unknown physical identity cannot release a warehouse allocation', () => {
    for (const type of ['digital', null]) {
        const snapshot = original();
        snapshot.lines[0].fulfillmentType = type;
        assert.throws(
            () => validateLegacyCompensationSnapshot(snapshot, now),
            /unknown order-line fulfillment/,
        );
    }
});
