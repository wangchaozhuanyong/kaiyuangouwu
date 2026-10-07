import assert from 'node:assert/strict';
import test from 'node:test';

import {
    compensationFingerprint,
    LEGACY_COMPENSATION_LINE_RISK_TABLES,
    LEGACY_COMPENSATION_RISK_TABLES,
} from './public-preview-legacy-compensation.mjs';
import {
    createLegacyDigitalCompensationExecutor,
    LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION,
    LEGACY_DIGITAL_COMPENSATION_VERSION,
    validateLegacyDigitalCompensationSnapshot,
    validateLegacyDigitalReviewArtifact,
} from './public-preview-legacy-digital-compensation.mjs';

const now = new Date('2026-10-07T05:00:00Z');
function original() {
    return {
        order: { id: '37', salesChannelId: '5', state: 'Modifying' },
        lines: [{ id: '248', productVariantId: '1093', quantity: 1, fulfillmentType: 'digital' }],
        payments: [
            {
                id: '10',
                state: 'Settled',
                method: 'controlled-test-payment-5',
                serverMarkedTest: true,
                manualReviewRequired: false,
                refunds: [],
            },
        ],
        movements: [
            {
                id: '884',
                orderLineId: '248',
                productVariantId: '1093',
                stockLocationId: '10',
                type: 'ALLOCATION',
                quantity: 1,
            },
        ],
        locations: [{ id: '10', channelIds: ['1', '5'] }],
        stockLevels: [
            { id: '6', productVariantId: '1093', stockLocationId: '10', stockOnHand: 100, stockAllocated: 1 },
        ],
        coupons: [
            {
                id: '8',
                channelId: '5',
                status: 'USED',
                version: 4,
                usedOrderId: '37',
                usedAt: '2026-10-01T00:00:00Z',
                validUntil: '2026-10-05T00:00:00Z',
                lockedOrderId: null,
                revokedAt: null,
            },
        ],
        allocations: [
            {
                id: '9',
                customerCouponId: '8',
                channelId: '5',
                orderId: '37',
                status: 'USED',
                refundId: null,
                refundedAmount: 0,
            },
        ],
        ledger: [{ id: '1', customerCouponId: '8', eventType: 'REDEEMED', orderId: '37' }],
        fulfillments: [],
        carts: [],
        risks: {
            ...Object.fromEntries(
                [...LEGACY_COMPENSATION_RISK_TABLES, ...LEGACY_COMPENSATION_LINE_RISK_TABLES].map(t => [
                    t,
                    [],
                ]),
            ),
            manual_digital_delivery: [{ id: '1', fingerprint: 'a'.repeat(64) }],
        },
        digital: {
            lineIdentity: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'manual_service',
            },
            task: {
                id: '1',
                channelId: '5',
                orderId: '37',
                orderLineId: '248',
                quantity: 1,
                state: 'EMAIL_FAILED',
                hasEncryptedPackages: true,
                sentAt: null,
                fulfillmentId: null,
                fingerprint: 'a'.repeat(64),
                contentFingerprint: 'b'.repeat(64),
            },
            events: [
                { id: '1', deliveryId: '1', type: 'PUBLISHED', lateEvidence: false },
                { id: '2', deliveryId: '1', type: 'EMAIL_FAILED', lateEvidence: false },
            ],
            variant: {
                id: '1093',
                trackInventory: 'TRUE',
                digitalDeliveryMode: 'manual_service',
                digitalStockPolicy: 'limited',
                fulfillmentType: 'digital',
            },
            globalSettings: { id: '1', trackInventory: true },
            configs: [],
            reservations: [],
            receiptAccess: [],
            fulfillmentLines: [],
            incidents: [
                {
                    id: '1',
                    sourceType: 'ManualDigitalDelivery',
                    sourceId: '1',
                    payloadChannelId: '5',
                    payloadOrderId: '37',
                    payloadDeliveryId: '1',
                    mode: 'INCIDENT',
                    incidentStatus: 'OPEN',
                    incidentFingerprint: 'commerce.fulfillment.manual_delivery_failed:1',
                    deliveryStatus: 'SENT',
                    claimedAt: null,
                    claimedBy: null,
                },
            ],
            actions: [{ id: '1', incidentId: '1', status: 'COMPLETED' }],
            evidence: [],
        },
    };
}
function entry() {
    const snapshot = original();
    return { snapshot, fingerprint: compensationFingerprint(snapshot) };
}
function review(e = entry()) {
    return {
        version: 'historical-test-digital-review-v1',
        orderId: '37',
        channelId: '5',
        deliveryId: '1',
        beforeFingerprint: e.fingerprint,
        contentFingerprint: e.snapshot.digital.task.contentFingerprint,
        contentClassification: 'TEST_ONLY',
        realResourceDisposition: 'NO_REAL_RESOURCE',
        attestationSource: 'HUMAN_USER_20261007',
        attestationDigest: 'c'.repeat(64),
        externalDeliveryOutcome: 'NOT_VERIFIED',
        reviewedAt: now.toISOString(),
    };
}

test('reviewed pure-test digital allocation releases only original warehouse quantity', () => {
    assert.deepEqual(validateLegacyDigitalCompensationSnapshot(original(), now), [
        { orderLineId: '248', productVariantId: '1093', stockLocationId: '10', quantity: 1 },
    ]);
});
test('human pure-test attestation retains unverified external delivery outcome', () => {
    const e = entry();
    const artifact = review(e);
    assert.equal(validateLegacyDigitalReviewArtifact(artifact, e, now), compensationFingerprint(artifact));
    assert.equal(artifact.externalDeliveryOutcome, 'NOT_VERIFIED');
});
for (const [label, mutate] of [
    [
        'missing immutable digital sales identity',
        s => {
            s.digital.lineIdentity.fulfillmentTypeSnapshot = null;
        },
    ],
    [
        'wrong immutable delivery mode',
        s => {
            s.digital.lineIdentity.digitalDeliveryModeSnapshot = 'file_download';
        },
    ],
    [
        'current physical variant',
        s => {
            s.digital.variant.fulfillmentType = 'physical';
        },
    ],
    [
        'wrong digital stock policy',
        s => {
            s.digital.variant.digitalStockPolicy = 'unlimited';
        },
    ],
    [
        'other order',
        s => {
            s.order.id = '38';
        },
    ],
    [
        'other sales channel',
        s => {
            s.order.salesChannelId = '2';
        },
    ],
    [
        'physical classification',
        s => {
            s.lines[0].fulfillmentType = 'physical';
        },
    ],
    [
        'extra line',
        s => {
            s.lines.push({ ...s.lines[0], id: '249' });
        },
    ],
    [
        'unplaced state',
        s => {
            s.order.state = 'AddingItems';
        },
    ],
    [
        'real payment',
        s => {
            s.payments[0].method = 'real-card';
        },
    ],
    [
        'forged marker',
        s => {
            s.payments[0].serverMarkedTest = false;
        },
    ],
    [
        'unknown payment',
        s => {
            s.payments.push({ ...s.payments[0], id: '11', state: 'Created' });
        },
    ],
    [
        'unsettled test',
        s => {
            s.payments[0].state = 'Authorized';
        },
    ],
    [
        'manual review',
        s => {
            s.payments[0].manualReviewRequired = true;
        },
    ],
    [
        'refund',
        s => {
            s.payments[0].refunds = [{ id: '1', state: 'Pending' }];
        },
    ],
    [
        'fulfillment',
        s => {
            s.fulfillments.push({ id: '1' });
        },
    ],
    [
        'native fulfillment line',
        s => {
            s.digital.fulfillmentLines.push({ id: '1' });
        },
    ],
    [
        'receipt claim',
        s => {
            s.digital.receiptAccess.push({ id: '1' });
        },
    ],
    [
        'reservation',
        s => {
            s.digital.reservations.push({ id: '1' });
        },
    ],
    [
        'digital config',
        s => {
            s.digital.configs.push({ id: '1' });
        },
    ],
    [
        'foreign task',
        s => {
            s.digital.task.orderId = '38';
        },
    ],
    [
        'task no ciphertext',
        s => {
            s.digital.task.hasEncryptedPackages = false;
        },
    ],
    [
        'unpublished draft',
        s => {
            s.digital.task.state = 'DRAFT';
        },
    ],
    [
        'sent task',
        s => {
            s.digital.task.sentAt = now.toISOString();
        },
    ],
    [
        'task fulfillment',
        s => {
            s.digital.task.fulfillmentId = '1';
        },
    ],
    [
        'missing published event',
        s => {
            s.digital.events = [];
        },
    ],
    [
        'email sent event',
        s => {
            s.digital.events.push({ deliveryId: '1', type: 'EMAIL_SENT' });
        },
    ],
    [
        'late event',
        s => {
            s.digital.events[1].lateEvidence = true;
        },
    ],
    [
        'tracking disabled',
        s => {
            s.digital.variant.trackInventory = 'FALSE';
        },
    ],
    [
        'global tracking disabled with inherit',
        s => {
            s.digital.variant.trackInventory = 'INHERIT';
            s.digital.globalSettings.trackInventory = false;
        },
    ],
    [
        'warehouse switched',
        s => {
            s.movements[0].stockLocationId = '11';
        },
    ],
    [
        'foreign warehouse',
        s => {
            s.locations[0].channelIds = ['2'];
        },
    ],
    [
        'variant switched',
        s => {
            s.movements[0].productVariantId = '1094';
        },
    ],
    [
        'already released movement',
        s => {
            s.movements.push({ ...s.movements[0], id: '885', type: 'RELEASE' });
        },
    ],
    [
        'allocation shortage',
        s => {
            s.stockLevels[0].stockAllocated = 0;
        },
    ],
    [
        'coupon available',
        s => {
            s.coupons[0].status = 'AVAILABLE';
        },
    ],
    [
        'coupon not expired',
        s => {
            s.coupons[0].validUntil = '2027-01-01T00:00:00Z';
        },
    ],
    [
        'coupon foreign cart',
        s => {
            s.coupons[0].lockedOrderId = '38';
        },
    ],
    [
        'coupon missing redeemed',
        s => {
            s.ledger = [];
        },
    ],
    [
        'coupon refund',
        s => {
            s.allocations[0].refundedAmount = 1;
        },
    ],
    [
        'extra manual task',
        s => {
            s.risks.manual_digital_delivery.push({ id: '2', fingerprint: 'd'.repeat(64) });
        },
    ],
    [
        'foreign incident',
        s => {
            s.digital.incidents[0].payloadChannelId = '2';
        },
    ],
    [
        'incident wrong task',
        s => {
            s.digital.incidents[0].payloadDeliveryId = '2';
        },
    ],
    [
        'claimed notification',
        s => {
            s.digital.incidents[0].deliveryStatus = 'CLAIMED';
        },
    ],
    [
        'incident claim owner',
        s => {
            s.digital.incidents[0].claimedBy = 'worker';
        },
    ],
    [
        'unfinished action',
        s => {
            s.digital.actions[0].status = 'OPEN';
        },
    ],
    [
        'pending incident workflow',
        s => {
            s.digital.incidents[0].incidentStatus = 'ACTION_PENDING';
        },
    ],
])
    test(`blocks ${label} before native resource effects`, () => {
        const s = original();
        mutate(s);
        assert.throws(() => validateLegacyDigitalCompensationSnapshot(s, now));
    });
for (const table of new Set([...LEGACY_COMPENSATION_RISK_TABLES, ...LEGACY_COMPENSATION_LINE_RISK_TABLES])) {
    if (table === 'manual_digital_delivery') continue;
    test(`blocks unreviewed ${table} without disguising digital risk as physical`, () => {
        const s = original();
        s.risks[table] = [{ id: '1', fingerprint: 'd'.repeat(64) }];
        assert.throws(() => validateLegacyDigitalCompensationSnapshot(s, now), new RegExp(table));
    });
}
for (const [key, value] of [
    ['contentClassification', 'UNKNOWN'],
    ['contentClassification', 'REAL'],
    ['realResourceDisposition', 'UNKNOWN'],
    ['realResourceDisposition', 'REAL_RESOURCE'],
    ['attestationSource', 'CLIENT_FLAG'],
    ['attestationDigest', 'missing'],
    ['externalDeliveryOutcome', 'REAL_DELIVERY'],
    ['externalDeliveryOutcome', 'UNKNOWN_RESOURCE'],
    ['beforeFingerprint', 'd'.repeat(64)],
    ['contentFingerprint', 'd'.repeat(64)],
    ['orderId', '38'],
    ['deliveryId', '2'],
    ['reviewedAt', '2026-10-07T04:00:00Z'],
])
    test(`independent review rejects ${key}=${value}`, () => {
        const e = entry();
        assert.throws(() => validateLegacyDigitalReviewArtifact({ ...review(e), [key]: value }, e, now));
    });
test('inherits verified global tracking without directly modifying native stock counters', () => {
    const s = original();
    s.digital.variant.trackInventory = 'INHERIT';
    assert.equal(validateLegacyDigitalCompensationSnapshot(s, now)[0].quantity, 1);
});

for (const guardsVerified of [undefined, false, true]) {
    test(`production runtime proof requires current historical digital guards (${guardsVerified})`, async () => {
        // Unit-only fake proofs exercise the real production gate before the first transaction.
        // These objects are never supplied to a production execution host.
        const proof = {
            status: 'VERIFIED',
            runtimeSha: 'b'.repeat(40),
            releaseSha: 'b'.repeat(40),
            protectionsFingerprint: 'c'.repeat(64),
            sourceHashesVerified: true,
            nativeFundingGuardsVerified: true,
            testOrderDeliveryGuardsVerified: true,
            ...(guardsVerified === undefined
                ? {}
                : { historicalDigitalCloseoutGuardsVerified: guardsVerified }),
        };
        let enteredTransaction = false;
        const entities = Object.fromEntries(
            [
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
                'ProductVariant',
                'GlobalSettings',
                'ManualDigitalDelivery',
                'ManualDigitalDeliveryEvent',
                'DigitalVariantConfig',
                'DigitalOrderReservation',
                'DigitalReceiptAccess',
                'FulfillmentLine',
                'AdminNotificationDelivery',
                'AdminIncidentEvidence',
                'AdminIncidentAction',
            ].map(key => [key, class TestOnlyEntity {}]),
        );
        const executor = createLegacyDigitalCompensationExecutor({
            connection: {
                rawConnection: { options: {} },
                getRepository() {
                    throw new Error('No database access allowed in proof unit test');
                },
            },
            orders: {
                withOrderMutationTransaction() {
                    enteredTransaction = true;
                    throw new Error('NATIVE_TRANSACTION_SENTINEL');
                },
            },
            carts: {},
            stockMovements: {},
            stockLocations: {},
            coupons: {},
            history: {},
            manualDelivery: {
                closeHistoricalTestTask() {
                    throw new Error('No delivery mutation allowed in proof unit');
                },
            },
            incidents: {
                closeHistoricalTestTaskIncidents() {
                    throw new Error('No incident mutation allowed in proof unit');
                },
            },
            entities,
            superAdminPermission: 'SuperAdmin',
            clock: () => now,
            verifyProductionRuntimeProtections: async () => proof,
            verifyReviewedArtifact: async () => true,
        });
        const e = entry();
        await assert.rejects(
            executor.execute(
                { apiType: 'admin', activeUserId: '1', channelId: '5', userHasPermissions: () => true },
                {
                    manifest: {
                        version: LEGACY_DIGITAL_COMPENSATION_VERSION,
                        authorization: LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION,
                        sourceSnapshotSha256: 'd'.repeat(64),
                        capturedAt: now.toISOString(),
                        entry: e,
                    },
                    reviewArtifact: review(e),
                    apply: true,
                },
            ),
            guardsVerified === true ? /NATIVE_TRANSACTION_SENTINEL/ : /WAIT_REPAIR_DEPLOYMENT/,
        );
        assert.equal(enteredTransaction, guardsVerified === true);
    });
}
