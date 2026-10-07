import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { DataSource } from 'typeorm';

import {
    applyCleanup,
    buildCleanupPlan,
    collectCleanupSnapshot,
    createFrozenCandidate,
    databaseFingerprint,
    digest,
    executeWithReceipt,
    openBackup,
    publicCleanupPreview,
    restoreCleanup,
    sealBackup,
} from './test-order-cleanup.mjs';

async function fixture(extra = []) {
    const database = new DataSource({
        type: 'sqljs',
        name: 'cleanup-fixture',
        entities: [],
        synchronize: false,
    });
    await database.initialize();
    const runner = database.createQueryRunner();
    for (const sql of [
        'PRAGMA foreign_keys = ON',
        'CREATE TABLE customer(id INTEGER PRIMARY KEY, name TEXT)',
        'CREATE TABLE channel(id INTEGER PRIMARY KEY, code TEXT)',
        'CREATE TABLE catalog_inventory_lot(id INTEGER PRIMARY KEY, quantityOnHand INTEGER)',
        'CREATE TABLE stock_level(id INTEGER PRIMARY KEY, productVariantId INTEGER, stockLocationId INTEGER, stockOnHand INTEGER, stockAllocated INTEGER)',
        'CREATE TABLE "order"(id INTEGER PRIMARY KEY, code TEXT, customerId INTEGER, createdAt TEXT, salesChannelId INTEGER)',
        'CREATE TABLE order_line(id INTEGER PRIMARY KEY, orderId INTEGER REFERENCES "order"(id), productVariantId INTEGER, quantity INTEGER)',
        'CREATE TABLE payment(id INTEGER PRIMARY KEY, orderId INTEGER REFERENCES "order"(id), method TEXT, amount INTEGER)',
        'CREATE TABLE refund(id INTEGER PRIMARY KEY, paymentId INTEGER REFERENCES payment(id), total INTEGER)',
        `CREATE TABLE stock_movement(id INTEGER PRIMARY KEY,
            orderLineId INTEGER REFERENCES order_line(id),
            productVariantId INTEGER,
            stockLocationId INTEGER,
            type TEXT,
            quantity INTEGER)`,
        `CREATE TABLE catalog_inventory_lot_movement(id INTEGER PRIMARY KEY,
            stockMovementId INTEGER REFERENCES stock_movement(id),
            orderLineId INTEGER REFERENCES order_line(id),
            lotId INTEGER REFERENCES catalog_inventory_lot(id),
            variantId INTEGER,
            stockLocationId INTEGER,
            quantity INTEGER)`,
        `CREATE TABLE customer_coupon(id INTEGER PRIMARY KEY,
            usedOrderId INTEGER REFERENCES "order"(id),
            lockedOrderId INTEGER REFERENCES "order"(id),
            status TEXT,
            validUntil TEXT,
            lockedAt TEXT,
            lockExpiresAt TEXT,
            usedAt TEXT)`,
        `CREATE TABLE coupon_ledger_entry(id INTEGER PRIMARY KEY,
            orderId INTEGER REFERENCES "order"(id),
            customerCouponId INTEGER REFERENCES customer_coupon(id),
            eventType TEXT)`,
        'CREATE TABLE referral_wallet(id INTEGER PRIMARY KEY, availableBalance INTEGER, pendingBalance INTEGER, reservedBalance INTEGER)',
        `CREATE TABLE referral_ledger_entry(id INTEGER PRIMARY KEY,
            orderId INTEGER,
            walletId INTEGER REFERENCES referral_wallet(id),
            availableDelta INTEGER,
            pendingDelta INTEGER,
            reservedDelta INTEGER,
            createdAt TEXT)`,
        `CREATE TABLE customer_operations_profile(id INTEGER PRIMARY KEY,
            customerId INTEGER,
            orderCount INTEGER,
            grossRevenue INTEGER,
            refundTotal INTEGER,
            netLifetimeValue INTEGER,
            averageOrderValue INTEGER,
            lastOrderAt TEXT,
            currencyMetricsJson TEXT,
            evaluationVersion TEXT,
            doNotContact BOOLEAN)`,
        "INSERT INTO customer VALUES(11,'Keep customer')",
        "INSERT INTO channel VALUES(1,'Keep store')",
        'INSERT INTO catalog_inventory_lot VALUES(1,9)',
        'INSERT INTO stock_level VALUES(1,77,8,9,0)',
        "INSERT INTO \"order\" VALUES(1,'TEST',11,'2026-10-07T00:00:00.000Z',1)",
        'INSERT INTO order_line VALUES(10,1,77,3)',
        "INSERT INTO payment VALUES(20,1,'controlled-test-payment-1',500)",
        'INSERT INTO refund VALUES(21,20,100)',
        "INSERT INTO stock_movement VALUES(31,10,77,8,'ALLOCATION',3)",
        "INSERT INTO stock_movement VALUES(32,10,77,8,'SALE',-2)",
        "INSERT INTO stock_movement VALUES(33,10,77,8,'CANCELLATION',1)",
        "INSERT INTO stock_movement VALUES(34,10,77,8,'RELEASE',1)",
        'INSERT INTO catalog_inventory_lot_movement VALUES(41,32,10,1,77,8,-2)',
        'INSERT INTO catalog_inventory_lot_movement VALUES(42,33,10,1,77,8,1)',
        "INSERT INTO customer_coupon VALUES(51,1,NULL,'USED',NULL,NULL,NULL,'2026-10-07')",
        "INSERT INTO coupon_ledger_entry VALUES(52,NULL,51,'CLAIMED')",
        "INSERT INTO coupon_ledger_entry VALUES(53,1,51,'REDEEMED')",
        'INSERT INTO referral_wallet VALUES(61,1200,0,0)',
        "INSERT INTO referral_ledger_entry VALUES(62,NULL,61,1000,0,0,'2026-10-01')",
        "INSERT INTO referral_ledger_entry VALUES(63,1,61,200,0,0,'2026-10-07')",
        "INSERT INTO customer_operations_profile VALUES(71,11,1,500,100,400,500,'2026-10-07','{\"MYR\":500}','v1',1)",
        ...extra,
    ])
        await runner.query(sql);
    const freeze = {
        version: 1,
        targetFingerprint: await databaseFingerprint(runner),
        cutoff: '2026-10-07T12:00:00.000Z',
        orderIds: ['1'],
        allOrdersAtCutoffAreTest: true,
        writersPaused: true,
        queuesPaused: true,
        freezeEvidenceHash: digest('operator-reviewed-fixture-freeze'),
        trackingByVariant: { 77: true },
    };
    return {
        database,
        runner,
        freeze,
        close: async () => {
            await runner.release();
            await database.destroy();
        },
    };
}

async function prepared(context) {
    const snapshot = await collectCleanupSnapshot(context.runner, context.freeze);
    const plan = buildCleanupPlan(snapshot, context.freeze);
    const key = randomBytes(32);
    const { envelope, backupHash } = sealBackup(snapshot, context.freeze, plan, key);
    return { snapshot, plan, key, envelope, backupHash };
}

describe('frozen test-order cleanup transaction', () => {
    it('previews net stock including prior cancellations; preserves customer/store/configuration and claim baseline', async () => {
        const context = await fixture();
        try {
            const { plan } = await prepared(context);
            const preview = publicCleanupPreview(plan);
            assert.equal(preview.canApply, true, JSON.stringify(preview.blockers));
            assert.deepEqual(
                preview.inventoryNet.map(row => ({
                    allocatedNet: row.allocatedNet,
                    onHandNet: row.onHandNet,
                })),
                [{ allocatedNet: 0, onHandNet: -1 }],
            );
            assert.equal(
                preview.preservedBaselineChanges.find(row => row.table === 'stock_level').changes.stockOnHand
                    .after,
                10,
            );
            assert.equal(
                preview.preservedBaselineChanges.find(row => row.table === 'referral_wallet').changes
                    .availableBalance.after,
                1000,
            );
            assert.equal(preview.deletionCounts.coupon_ledger_entry, 1);
            assert.deepEqual(await context.runner.query('SELECT stockOnHand FROM stock_level'), [
                { stockOnHand: 9 },
            ]);
            assert.deepEqual(preview.externalActions, []);
        } finally {
            await context.close();
        }
    });
    it('keeps database coupon dates in UTC under Asia/Kuala_Lumpur during preview, apply and restore', async () => {
        const previousTimezone = process.env.TZ;
        process.env.TZ = 'Asia/Kuala_Lumpur';
        const context = await fixture([
            "UPDATE customer_coupon SET validUntil='2026-10-07 13:00:00.000000' WHERE id=51",
            "INSERT INTO customer_coupon VALUES(54,1,NULL,'USED','2026-10-07 11:00:00.000000',NULL,NULL,NULL)",
            "INSERT INTO customer_coupon VALUES(55,1,NULL,'USED','2026-10-07T13:00:00.000Z',NULL,NULL,NULL)",
            "INSERT INTO customer_coupon VALUES(56,1,NULL,'USED','2026-10-07T21:00:00.000+08:00',NULL,NULL,NULL)",
        ]);
        try {
            const backup = await prepared(context);
            assert.equal(
                publicCleanupPreview(backup.plan).canApply,
                true,
                JSON.stringify(backup.plan.blockers),
            );
            const statuses = backup.plan.patches
                .filter(patch => patch.table === 'customer_coupon')
                .map(patch => [patch.before.id, patch.after.status])
                .sort((a, b) => a[0] - b[0]);
            assert.deepEqual(statuses, [
                [51, 'AVAILABLE'],
                [54, 'EXPIRED'],
                [55, 'AVAILABLE'],
                [56, 'AVAILABLE'],
            ]);
            process.env.TZ = 'UTC';
            const { plan } = await prepared(context);
            assert.equal(plan.planHash, backup.plan.planHash);
            const receipt = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.equal(receipt.status, 'APPLIED');
            process.env.TZ = 'Asia/Kuala_Lumpur';
            const restored = await restoreCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
                receipt,
                receipt.receiptHash,
            );
            assert.equal(restored.status, 'RESTORED');
            assert.equal((await prepared(context)).plan.planHash, backup.plan.planHash);
        } finally {
            await context.close();
            if (previousTimezone === undefined) delete process.env.TZ;
            else process.env.TZ = previousTimezone;
        }
    });
    it('commits the complete graph and baseline restoration once; retry never double-restocks', async () => {
        const context = await fixture();
        try {
            const backup = await prepared(context);
            const first = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.equal(first.status, 'APPLIED');
            for (const table of [
                'order',
                'order_line',
                'payment',
                'refund',
                'stock_movement',
                'catalog_inventory_lot_movement',
            ])
                assert.deepEqual(await context.runner.query(`SELECT * FROM "${table}"`), []);
            assert.deepEqual(
                await context.runner.query('SELECT stockOnHand,stockAllocated FROM stock_level'),
                [{ stockOnHand: 10, stockAllocated: 0 }],
            );
            assert.deepEqual(await context.runner.query('SELECT quantityOnHand FROM catalog_inventory_lot'), [
                { quantityOnHand: 10 },
            ]);
            assert.deepEqual(await context.runner.query('SELECT availableBalance FROM referral_wallet'), [
                { availableBalance: 1000 },
            ]);
            assert.deepEqual(await context.runner.query('SELECT status,usedOrderId FROM customer_coupon'), [
                { status: 'AVAILABLE', usedOrderId: null },
            ]);
            assert.deepEqual(await context.runner.query('SELECT eventType FROM coupon_ledger_entry'), [
                { eventType: 'CLAIMED' },
            ]);
            assert.deepEqual(
                await context.runner.query('SELECT orderCount,doNotContact FROM customer_operations_profile'),
                [{ orderCount: 0, doNotContact: 1 }],
            );
            assert.deepEqual(await context.runner.query('SELECT name FROM customer'), [
                { name: 'Keep customer' },
            ]);
            const second = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.equal(second.status, 'ALREADY_APPLIED');
            assert.deepEqual(await context.runner.query('SELECT stockOnHand FROM stock_level'), [
                { stockOnHand: 10 },
            ]);
        } finally {
            await context.close();
        }
    });
    it('rolls back stock, wallets and prior deletes when a later SQL mutation fails', async () => {
        const context = await fixture();
        try {
            const backup = await prepared(context);
            const query = context.runner.query.bind(context.runner);
            let injected = false;
            context.runner.query = async (sql, ...args) => {
                if (sql.startsWith('DELETE FROM') && sql.includes('"payment"') && !injected) {
                    injected = true;
                    throw new Error('fixture mutation failure');
                }
                return query(sql, ...args);
            };
            await assert.rejects(
                applyCleanup(
                    context.runner,
                    backup.envelope,
                    backup.backupHash,
                    backup.plan.planHash,
                    backup.key,
                ),
                /fixture mutation failure/u,
            );
            assert.deepEqual(await query('SELECT stockOnHand FROM stock_level'), [{ stockOnHand: 9 }]);
            assert.deepEqual(await query('SELECT id FROM "order"'), [{ id: 1 }]);
            assert.deepEqual(await query('SELECT availableBalance FROM referral_wallet'), [
                { availableBalance: 1200 },
            ]);
        } finally {
            await context.close();
        }
    });
    it('rejects target/backup/plan drift and never exposes backed-up rows in the preview', async () => {
        const context = await fixture();
        try {
            const backup = await prepared(context);
            assert.throws(
                () => openBackup(backup.envelope, '0'.repeat(64), backup.key),
                /Backup hash mismatch/u,
            );
            assert.throws(() => openBackup(backup.envelope, backup.backupHash, randomBytes(32)));
            await assert.rejects(
                applyCleanup(context.runner, backup.envelope, backup.backupHash, '0'.repeat(64), backup.key),
                /plan hash mismatch/u,
            );
            await context.runner.query('UPDATE stock_level SET stockOnHand=8');
            await assert.rejects(
                applyCleanup(
                    context.runner,
                    backup.envelope,
                    backup.backupHash,
                    backup.plan.planHash,
                    backup.key,
                ),
                /drift/u,
            );
            assert.equal(JSON.stringify(publicCleanupPreview(backup.plan)).includes('Keep customer'), false);
            assert.equal(JSON.stringify(backup.envelope).includes('Keep customer'), false);
        } finally {
            await context.close();
        }
    });
    it('reports unconfirmed tracking as a precise net impact instead of blindly restocking', async () => {
        const context = await fixture();
        try {
            context.freeze.trackingByVariant = {};
            const { plan } = await prepared(context);
            assert.equal(publicCleanupPreview(plan).canApply, false);
            assert.ok(
                plan.blockers.some(
                    row =>
                        row.code === 'TRACKING_HISTORY_UNCONFIRMED' && row.detail.includes('on-hand delta 1'),
                ),
            );
            assert.equal(plan.deletes.filter(row => row.table === 'order').length, 1);
        } finally {
            await context.close();
        }
    });
    for (const [label, extra, code] of [
        [
            'unmapped dependent table',
            [
                'CREATE TABLE unknown_order_extension(id INTEGER PRIMARY KEY, orderId INTEGER REFERENCES "order"(id))',
                'INSERT INTO unknown_order_extension VALUES(91,1)',
            ],
            'UNMAPPED_DERIVED_TABLE',
        ],
        [
            'ambiguous multi-warehouse sale',
            [
                "INSERT INTO stock_movement VALUES(35,10,77,9,'SALE',-2)",
                'INSERT INTO stock_level VALUES(2,77,9,8,0)',
            ],
            'AMBIGUOUS_MULTI_WAREHOUSE_QUANTITY',
        ],
        [
            'external withdrawal',
            [
                'CREATE TABLE referral_withdrawal(id INTEGER PRIMARY KEY,walletId INTEGER REFERENCES referral_wallet(id),status TEXT)',
                "INSERT INTO referral_withdrawal VALUES(81,61,'PAID')",
            ],
            'WITHDRAWAL_MAPPING_REQUIRED',
        ],
        [
            'unfrozen new order',
            ["INSERT INTO \"order\" VALUES(2,'NEW',11,'2026-10-08T00:00:00.000Z',1)"],
            'UNFROZEN_ORDER',
        ],
        [
            'external chain proof',
            [
                'CREATE TABLE storefront_usdt_payment_intent(id INTEGER PRIMARY KEY,orderId INTEGER REFERENCES "order"(id),transactionId TEXT)',
                "INSERT INTO storefront_usdt_payment_intent VALUES(82,1,'chain-proof-fixture')",
            ],
            'EXTERNAL_CHAIN_EVIDENCE',
        ],
        [
            'reconciliation refund chain proof without an intent transaction',
            [
                'CREATE TABLE storefront_usdt_payment_intent(id INTEGER PRIMARY KEY,orderId INTEGER REFERENCES "order"(id),transactionId TEXT)',
                `CREATE TABLE store_usdt_reconciliation_action(id INTEGER PRIMARY KEY,
                    intentId INTEGER,orderId INTEGER,action TEXT,transactionId TEXT,blockNumber INTEGER)`,
                'INSERT INTO storefront_usdt_payment_intent VALUES(82,1,NULL)',
                "INSERT INTO store_usdt_reconciliation_action VALUES(83,82,1,'CONFIRM_EXTERNAL_REFUND','refund-chain-proof-fixture',100)",
            ],
            'EXTERNAL_CHAIN_EVIDENCE',
        ],
        [
            'reconciliation block evidence without a transaction identifier',
            [
                'CREATE TABLE store_usdt_reconciliation_action(id INTEGER PRIMARY KEY,orderId INTEGER,action TEXT,transactionId TEXT,blockNumber INTEGER)',
                "INSERT INTO store_usdt_reconciliation_action VALUES(83,1,'RETRY_SETTLEMENT',NULL,100)",
            ],
            'EXTERNAL_CHAIN_EVIDENCE',
        ],
        [
            'confirmed external reconciliation refund with incomplete stored proof',
            [
                'CREATE TABLE store_usdt_reconciliation_action(id INTEGER PRIMARY KEY,orderId INTEGER,action TEXT,transactionId TEXT,blockNumber INTEGER)',
                "INSERT INTO store_usdt_reconciliation_action VALUES(83,1,'CONFIRM_EXTERNAL_REFUND',NULL,NULL)",
            ],
            'EXTERNAL_CHAIN_EVIDENCE',
        ],
        [
            'legacy reconciliation chain proof reachable only through the frozen intent',
            [
                'CREATE TABLE storefront_usdt_payment_intent(id INTEGER PRIMARY KEY,orderId INTEGER REFERENCES "order"(id),transactionId TEXT)',
                `CREATE TABLE store_usdt_reconciliation_action(id INTEGER PRIMARY KEY,
                    intentId INTEGER,orderId INTEGER,action TEXT,transactionId TEXT,blockNumber INTEGER)`,
                'INSERT INTO storefront_usdt_payment_intent VALUES(82,1,NULL)',
                "INSERT INTO store_usdt_reconciliation_action VALUES(83,82,999,'CONFIRM_EXTERNAL_REFUND','refund-chain-proof-fixture',100)",
            ],
            'EXTERNAL_CHAIN_EVIDENCE',
        ],
        [
            'limited quota without attributable ledger',
            [
                `CREATE TABLE digital_order_reservation(id INTEGER PRIMARY KEY,
                    orderId INTEGER,
                    orderLineId INTEGER,
                    stockPolicy TEXT,
                    quantity INTEGER,
                    releasedQuantity INTEGER,
                    poolItemIdsJson TEXT)`,
                "INSERT INTO digital_order_reservation VALUES(83,1,10,'limited',2,0,'[]')",
            ],
            'UNBOUND_DIGITAL_QUOTA_LEDGER',
        ],
    ])
        it(`blocks ${label} with inspectable reasons and leaves data intact`, async () => {
            const context = await fixture(extra);
            try {
                const backup = await prepared(context);
                assert.ok(
                    backup.plan.blockers.some(row => row.code === code),
                    JSON.stringify(backup.plan.blockers),
                );
                await assert.rejects(
                    applyCleanup(
                        context.runner,
                        backup.envelope,
                        backup.backupHash,
                        backup.plan.planHash,
                        backup.key,
                    ),
                    /Unexplained/u,
                );
                assert.deepEqual(await context.runner.query('SELECT stockOnHand FROM stock_level'), [
                    { stockOnHand: 9 },
                    ...(label === 'ambiguous multi-warehouse sale' ? [{ stockOnHand: 8 }] : []),
                ]);
                if (label.includes('reconciliation'))
                    assert.deepEqual(
                        await context.runner.query(
                            'SELECT COUNT(*) AS count FROM store_usdt_reconciliation_action',
                        ),
                        [{ count: 1 }],
                    );
            } finally {
                await context.close();
            }
        });

    it('cleans and restores reconciliation retry records without external transfer evidence', async () => {
        const context = await fixture([
            'CREATE TABLE storefront_usdt_payment_intent(id INTEGER PRIMARY KEY,orderId INTEGER REFERENCES "order"(id),transactionId TEXT)',
            'CREATE TABLE store_usdt_reconciliation_action(id INTEGER PRIMARY KEY,intentId INTEGER,orderId INTEGER,action TEXT,transactionId TEXT,blockNumber INTEGER)',
            'INSERT INTO storefront_usdt_payment_intent VALUES(82,1,NULL)',
            "INSERT INTO store_usdt_reconciliation_action VALUES(83,82,1,'RETRY_SETTLEMENT',NULL,NULL)",
        ]);
        try {
            const backup = await prepared(context);
            assert.equal(publicCleanupPreview(backup.plan).canApply, true);
            const receipt = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.deepEqual(
                await context.runner.query('SELECT COUNT(*) AS count FROM store_usdt_reconciliation_action'),
                [{ count: 0 }],
            );
            const restored = await restoreCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
                receipt,
                receipt.receiptHash,
            );
            assert.equal(restored.status, 'RESTORED');
            assert.deepEqual(
                await context.runner.query(
                    'SELECT action,transactionId FROM store_usdt_reconciliation_action',
                ),
                [{ action: 'RETRY_SETTLEMENT', transactionId: null }],
            );
        } finally {
            await context.close();
        }
    });

    it('uses a real reconciliation intent foreign key before any implicit USDT mapping', async () => {
        const context = await fixture([
            'CREATE TABLE storefront_usdt_payment_intent(id INTEGER PRIMARY KEY,orderId INTEGER REFERENCES "order"(id),transactionId TEXT)',
            'CREATE TABLE unrelated_intent(id INTEGER PRIMARY KEY)',
            `CREATE TABLE store_usdt_reconciliation_action(id INTEGER PRIMARY KEY,
                intentId INTEGER REFERENCES unrelated_intent(id),orderId INTEGER,
                action TEXT,transactionId TEXT,blockNumber INTEGER)`,
            'INSERT INTO storefront_usdt_payment_intent VALUES(82,1,NULL)',
            'INSERT INTO unrelated_intent VALUES(82)',
            "INSERT INTO store_usdt_reconciliation_action VALUES(83,82,NULL,'RETRY_SETTLEMENT',NULL,NULL)",
        ]);
        try {
            const backup = await prepared(context);
            assert.equal(publicCleanupPreview(backup.plan).canApply, true);
            assert.equal(backup.snapshot.rows.store_usdt_reconciliation_action.length, 0);
            await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.deepEqual(
                await context.runner.query('SELECT COUNT(*) AS count FROM store_usdt_reconciliation_action'),
                [{ count: 1 }],
            );
        } finally {
            await context.close();
        }
    });
});

describe('cleanup receipt persistence', () => {
    it('refuses mutation when the pending receipt cannot be durably saved', async () => {
        let executed = false;
        const handle = {
            truncate: async () => undefined,
            write: async buffer => ({ bytesWritten: buffer.length }),
            sync: async () => {
                throw new Error('disk unavailable');
            },
        };
        await assert.rejects(
            executeWithReceipt(handle, { planHash: 'reviewed' }, async () => {
                executed = true;
                return { status: 'APPLIED' };
            }),
            /disk unavailable/u,
        );
        assert.equal(executed, false);
    });
    it('retains the committed recovery receipt when the final artifact write fails', async () => {
        let syncs = 0;
        const handle = {
            truncate: async () => undefined,
            write: async buffer => ({ bytesWritten: buffer.length }),
            sync: async () => {
                if (++syncs === 2) throw new Error('disk unavailable');
            },
        };
        const receipt = { status: 'APPLIED', receiptHash: 'safe-hash', backupHash: 'encrypted-backup' };
        const result = await executeWithReceipt(handle, { planHash: 'reviewed' }, async () => receipt);
        assert.equal(result.status, 'APPLIED');
        assert.equal(result.receiptArtifact, 'WRITE_FAILED_RETAIN_STDOUT_RECEIPT');
        assert.deepEqual(result.receipt, receipt);
    });
});

describe('cleanup schema and baseline boundaries', () => {
    it('records freeze candidates as unconfirmed and refuses apply even when other evidence is complete', async () => {
        const context = await fixture();
        try {
            const candidate = createFrozenCandidate(
                context.freeze.targetFingerprint,
                context.freeze.cutoff,
                context.freeze.orderIds,
            );
            assert.equal(candidate.allOrdersAtCutoffAreTest, false);
            context.freeze.allOrdersAtCutoffAreTest = candidate.allOrdersAtCutoffAreTest;
            const backup = await prepared(context);
            assert.ok(backup.plan.gates.includes('TEST_ORDER_SCOPE_NOT_CONFIRMED'));
            assert.equal(publicCleanupPreview(backup.plan).canApply, false);
            assert.ok(publicCleanupPreview(backup.plan).inventoryNet.length > 0);
            await assert.rejects(
                applyCleanup(
                    context.runner,
                    backup.envelope,
                    backup.backupHash,
                    backup.plan.planHash,
                    backup.key,
                ),
                /Unexplained/u,
            );
            assert.deepEqual(await context.runner.query('SELECT stockOnHand FROM stock_level'), [
                { stockOnHand: 9 },
            ]);
            assert.deepEqual(await context.runner.query('SELECT id FROM "order"'), [{ id: 1 }]);
        } finally {
            await context.close();
        }
    });
    it('rejects repeat execution after a kept baseline changes, even when stock totals still match', async () => {
        const context = await fixture();
        try {
            const backup = await prepared(context);
            await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            await context.runner.query('UPDATE customer_operations_profile SET doNotContact=0');
            await assert.rejects(
                applyCleanup(
                    context.runner,
                    backup.envelope,
                    backup.backupHash,
                    backup.plan.planHash,
                    backup.key,
                ),
                /Post-cleanup drift/u,
            );
            assert.deepEqual(
                await context.runner.query('SELECT doNotContact FROM customer_operations_profile'),
                [{ doNotContact: 0 }],
            );
            assert.deepEqual(await context.runner.query('SELECT stockOnHand FROM stock_level'), [
                { stockOnHand: 10 },
            ]);
        } finally {
            await context.close();
        }
    });
    it('keeps login sessions and cart contents while clearing frozen projections and checkout snapshots', async () => {
        const context = await fixture([
            'CREATE TABLE session(id INTEGER PRIMARY KEY, activeOrderId INTEGER REFERENCES "order"(id), token TEXT, userId INTEGER)',
            "INSERT INTO session VALUES(201,1,'private-fixture-session-token',11)",
            `CREATE TABLE storefront_cart(id INTEGER PRIMARY KEY,
                checkoutOrderId INTEGER REFERENCES "order"(id),
                ownerId INTEGER,
                revision INTEGER,
                projectedRevision INTEGER,
                state TEXT)`,
            "INSERT INTO storefront_cart VALUES(301,1,11,9,9,'PAYMENT_PENDING')",
            `CREATE TABLE storefront_cart_line(id INTEGER PRIMARY KEY,
                cartId INTEGER REFERENCES storefront_cart(id),
                orderLineId INTEGER REFERENCES order_line(id),
                quantity INTEGER,
                selected BOOLEAN)`,
            'INSERT INTO storefront_cart_line VALUES(302,301,10,3,1)',
            'INSERT INTO storefront_cart_line VALUES(303,301,NULL,4,0)',
            'CREATE TABLE storefront_cart_checkout(id INTEGER PRIMARY KEY, cartId INTEGER REFERENCES storefront_cart(id), orderId INTEGER REFERENCES "order"(id))',
            'INSERT INTO storefront_cart_checkout VALUES(401,301,1)',
            `CREATE TABLE storefront_cart_checkout_line(id INTEGER PRIMARY KEY,
                checkoutId INTEGER REFERENCES storefront_cart_checkout(id),
                cartLineId INTEGER REFERENCES storefront_cart_line(id),
                quantity INTEGER)`,
            'INSERT INTO storefront_cart_checkout_line VALUES(501,401,302,3)',
            'CREATE TABLE storefront_cart_command_receipt(id INTEGER PRIMARY KEY, cartId INTEGER REFERENCES storefront_cart(id), commandId TEXT)',
            "INSERT INTO storefront_cart_command_receipt VALUES(601,301,'keep-cart-receipt')",
        ]);
        try {
            const backup = await prepared(context);
            assert.equal(backup.plan.blockers.length, 0);
            assert.ok(
                !JSON.stringify(publicCleanupPreview(backup.plan)).includes('private-fixture-session-token'),
            );
            const receipt = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.deepEqual(await context.runner.query('SELECT activeOrderId,token FROM session'), [
                { activeOrderId: null, token: 'private-fixture-session-token' },
            ]);
            assert.deepEqual(
                await context.runner.query(
                    'SELECT ownerId,revision,projectedRevision,state FROM storefront_cart',
                ),
                [{ ownerId: 11, revision: 10, projectedRevision: null, state: 'OPEN' }],
            );
            assert.deepEqual(
                await context.runner.query(
                    'SELECT id,orderLineId,quantity FROM storefront_cart_line ORDER BY id',
                ),
                [
                    { id: 302, orderLineId: null, quantity: 3 },
                    { id: 303, orderLineId: null, quantity: 4 },
                ],
            );
            assert.equal(
                (await context.runner.query('SELECT * FROM storefront_cart_checkout_line')).length,
                0,
            );
            assert.equal((await context.runner.query('SELECT * FROM storefront_cart_checkout')).length, 0);
            assert.equal(
                (await context.runner.query('SELECT * FROM storefront_cart_command_receipt')).length,
                1,
            );
            await restoreCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
                receipt,
                receipt.receiptHash,
            );
            assert.deepEqual(await context.runner.query('SELECT activeOrderId FROM session'), [
                { activeOrderId: 1 },
            ]);
            assert.deepEqual(
                await context.runner.query('SELECT orderLineId FROM storefront_cart_line WHERE id=302'),
                [{ orderLineId: 10 }],
            );
        } finally {
            await context.close();
        }
    });
    it('deletes only exact order/sale-service notification references and preserves unrelated operations', async () => {
        const context = await fixture([
            'CREATE TABLE after_sales_request(id INTEGER PRIMARY KEY, orderId INTEGER REFERENCES "order"(id))',
            'INSERT INTO after_sales_request VALUES(901,1)',
            'CREATE TABLE admin_notification_outbox(id INTEGER PRIMARY KEY, sourceType TEXT, sourceId TEXT, payload TEXT)',
            "INSERT INTO admin_notification_outbox VALUES(701,'Order','1','{}')",
            "INSERT INTO admin_notification_outbox VALUES(702,'Payment','20','{}')",
            "INSERT INTO admin_notification_outbox VALUES(703,'CustomOrderNotice','x','{\"orderId\":\"1\"}')",
            "INSERT INTO admin_notification_outbox VALUES(704,'ProductVariant','77','{}')",
            'CREATE TABLE store_notification_read(id INTEGER PRIMARY KEY, eventKey TEXT)',
            "INSERT INTO store_notification_read VALUES(711,'ORDER:1:2026-10-07T00:00:00.000Z')",
            "INSERT INTO store_notification_read VALUES(712,'AFTER_SALES:901:2026-10-07T00:00:00.000Z')",
            "INSERT INTO store_notification_read VALUES(713,'ORDER:999:2026-10-07T00:00:00.000Z')",
        ]);
        try {
            const backup = await prepared(context);
            assert.equal(backup.plan.blockers.length, 0);
            await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.deepEqual(await context.runner.query('SELECT id FROM admin_notification_outbox'), [
                { id: 704 },
            ]);
            assert.deepEqual(await context.runner.query('SELECT id FROM store_notification_read'), [
                { id: 713 },
            ]);
        } finally {
            await context.close();
        }
    });
    it('retains malformed notification-reference evidence by blocking execution', async () => {
        const context = await fixture([
            'CREATE TABLE store_notification_read(id INTEGER PRIMARY KEY, eventKey TEXT)',
            "INSERT INTO store_notification_read VALUES(711,'ORDER:1:unknown-version')",
        ]);
        try {
            const { plan } = await prepared(context);
            assert.ok(plan.blockers.some(item => item.code === 'NOTIFICATION_REFERENCE_UNKNOWN'));
        } finally {
            await context.close();
        }
    });
    it('orders self-referencing rows for FK-safe deletion and reverse recovery', async () => {
        const context = await fixture([
            'CREATE TABLE history_entry(id INTEGER PRIMARY KEY, orderId INTEGER REFERENCES "order"(id), parentId INTEGER REFERENCES history_entry(id))',
            'INSERT INTO history_entry VALUES(81,1,NULL)',
            'INSERT INTO history_entry VALUES(82,1,81)',
        ]);
        try {
            const backup = await prepared(context);
            assert.deepEqual(
                backup.plan.deletes.filter(row => row.table === 'history_entry').map(row => row.identity.id),
                [82, 81],
            );
            const receipt = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            await restoreCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
                receipt,
                receipt.receiptHash,
            );
            assert.deepEqual(
                await context.runner.query('SELECT id,parentId FROM history_entry ORDER BY id'),
                [
                    { id: 81, parentId: null },
                    { id: 82, parentId: 81 },
                ],
            );
        } finally {
            await context.close();
        }
    });
    it('blocks a mapped derived table without a stable primary key', async () => {
        const context = await fixture([
            'CREATE TABLE history_entry(orderId INTEGER REFERENCES "order"(id), detail TEXT)',
            "INSERT INTO history_entry VALUES(1,'unstable')",
        ]);
        try {
            const { plan } = await prepared(context);
            assert.ok(plan.blockers.some(item => item.code === 'DERIVED_PRIMARY_KEY_MISSING'));
        } finally {
            await context.close();
        }
    });
    it('restores binary backed-up values without converting them into JSON objects', async () => {
        const context = await fixture([
            'ALTER TABLE payment ADD COLUMN privatePayload BLOB',
            "UPDATE payment SET privatePayload=X'0001FF'",
        ]);
        try {
            const backup = await prepared(context);
            const decoded = openBackup(backup.envelope, backup.backupHash, backup.key);
            assert.ok(Buffer.isBuffer(decoded.snapshot.rows.payment[0].privatePayload));
            const receipt = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            await restoreCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
                receipt,
                receipt.receiptHash,
            );
            const [payment] = await context.runner.query('SELECT privatePayload FROM payment');
            assert.deepEqual([...payment.privatePayload], [0, 1, 255]);
        } finally {
            await context.close();
        }
    });
    it('stops unexplained wallet balance differences instead of erasing them', async () => {
        const context = await fixture([
            'ALTER TABLE referral_ledger_entry ADD COLUMN availableAfter INTEGER',
            'ALTER TABLE referral_ledger_entry ADD COLUMN pendingAfter INTEGER',
            'ALTER TABLE referral_ledger_entry ADD COLUMN reservedAfter INTEGER',
            'UPDATE referral_ledger_entry SET availableAfter=availableDelta,pendingAfter=0,reservedAfter=0',
            'UPDATE referral_ledger_entry SET availableAfter=1200 WHERE id=63',
            'UPDATE referral_wallet SET availableBalance=1201',
        ]);
        try {
            const backup = await prepared(context);
            assert.ok(backup.plan.blockers.some(item => item.code === 'WALLET_LEDGER_BASELINE_MISMATCH'));
            await assert.rejects(
                applyCleanup(
                    context.runner,
                    backup.envelope,
                    backup.backupHash,
                    backup.plan.planHash,
                    backup.key,
                ),
                /Unexplained/u,
            );
            assert.deepEqual(await context.runner.query('SELECT availableBalance FROM referral_wallet'), [
                { availableBalance: 1201 },
            ]);
        } finally {
            await context.close();
        }
    });
    it('requires boolean tracking-history evidence instead of treating a string as approval', async () => {
        const context = await fixture();
        try {
            context.freeze.trackingByVariant[77] = 'false';
            const { plan } = await prepared(context);
            assert.ok(plan.blockers.some(item => item.code === 'TRACKING_HISTORY_UNCONFIRMED'));
        } finally {
            await context.close();
        }
    });
});

describe('cleanup typed references and recovery', () => {
    it('includes bare orderCode review/feedback while preserving general feedback', async () => {
        const context = await fixture([
            'CREATE TABLE customer_service_review(id INTEGER PRIMARY KEY,orderId INTEGER,orderCode TEXT)',
            "INSERT INTO customer_service_review VALUES(81,NULL,'TEST')",
            'CREATE TABLE customer_service_feedback(id INTEGER PRIMARY KEY,orderId INTEGER,orderCode TEXT)',
            "INSERT INTO customer_service_feedback VALUES(82,NULL,'TEST')",
            "INSERT INTO customer_service_feedback VALUES(83,NULL,'GENERAL')",
        ]);
        try {
            const backup = await prepared(context);
            const preview = publicCleanupPreview(backup.plan);
            assert.equal(preview.deletionCounts.customer_service_review, 1);
            assert.equal(preview.deletionCounts.customer_service_feedback, 1);
            await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.deepEqual(await context.runner.query('SELECT orderCode FROM customer_service_feedback'), [
                { orderCode: 'GENERAL' },
            ]);
        } finally {
            await context.close();
        }
    });
    it('maps manual delivery events without FK to manual parent rather than same-ID auto-card parent', async () => {
        const context = await fixture([
            'CREATE TABLE auto_card_delivery(id INTEGER PRIMARY KEY,orderId INTEGER)',
            'INSERT INTO auto_card_delivery VALUES(81,NULL)',
            'CREATE TABLE manual_digital_delivery(id INTEGER PRIMARY KEY,orderId INTEGER)',
            'INSERT INTO manual_digital_delivery VALUES(81,1)',
            'CREATE TABLE manual_digital_delivery_event(id INTEGER PRIMARY KEY,deliveryId INTEGER)',
            'INSERT INTO manual_digital_delivery_event VALUES(82,81)',
        ]);
        try {
            const backup = await prepared(context);
            assert.equal(publicCleanupPreview(backup.plan).deletionCounts.manual_digital_delivery_event, 1);
            await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.deepEqual(await context.runner.query('SELECT id FROM auto_card_delivery'), [{ id: 81 }]);
        } finally {
            await context.close();
        }
    });
    it('uses wallet usage metadata to reverse additional-payment ledger rows with null orderId', async () => {
        const context = await fixture([
            'ALTER TABLE referral_ledger_entry ADD COLUMN metadata TEXT',
            'CREATE TABLE referral_wallet_usage(id INTEGER PRIMARY KEY,walletId INTEGER REFERENCES referral_wallet(id),customerId INTEGER,metadata TEXT)',
            `INSERT INTO referral_wallet_usage VALUES(81,61,11,'{"orderId":"1"}')`,
            `INSERT INTO referral_ledger_entry VALUES(82,NULL,61,-100,0,100,'2026-10-07T01:00:00.000Z','{"usageId":"81"}')`,
            `INSERT INTO referral_ledger_entry VALUES(83,NULL,61,0,0,-100,'2026-10-07T02:00:00.000Z','{"usageId":"81"}')`,
            'UPDATE referral_wallet SET availableBalance=1100',
        ]);
        try {
            const backup = await prepared(context);
            assert.equal(publicCleanupPreview(backup.plan).deletionCounts.referral_ledger_entry, 3);
            await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            assert.deepEqual(
                await context.runner.query('SELECT availableBalance,reservedBalance FROM referral_wallet'),
                [{ availableBalance: 1000, reservedBalance: 0 }],
            );
        } finally {
            await context.close();
        }
    });
    for (const [label, state, attest, reveal, expected] of [
        ['assigned/dispatched', 'ASSIGNED', false, false, 'DISABLED'],
        ['unknown reserved', 'RESERVED', false, false, 'DISABLED'],
        ['verified unexposed reserved', 'RESERVED', true, false, 'AVAILABLE'],
        ['revealed reserved despite attestation', 'RESERVED', true, true, 'DISABLED'],
    ])
        it(`never automatically resells ${label} card payloads`, async () => {
            const context = await fixture([
                'CREATE TABLE auto_card_delivery(id INTEGER PRIMARY KEY,orderId INTEGER,state TEXT,sentAt TEXT,lastDispatchedAt TEXT)',
                ...(state === 'ASSIGNED'
                    ? ["INSERT INTO auto_card_delivery VALUES(80,1,'SENT','2026-10-07','2026-10-07')"]
                    : []),
                `CREATE TABLE auto_card_pool_item(id INTEGER PRIMARY KEY,
                    deliveryId INTEGER REFERENCES auto_card_delivery(id),
                    state TEXT,
                    assignedAt TEXT,
                    disabledReason TEXT,
                    encryptedPayload TEXT,
                    fingerprint TEXT)`,
                `INSERT INTO auto_card_pool_item VALUES(81,${state === 'ASSIGNED' ? '80' : 'NULL'},'${state}',
                    ${state === 'ASSIGNED' ? "'2026-10-07'" : 'NULL'},NULL,'encrypted-fixture-payload','keep-fingerprint')`,
                `CREATE TABLE digital_order_reservation(id INTEGER PRIMARY KEY,
                    orderId INTEGER,
                    orderLineId INTEGER,
                    stockPolicy TEXT,
                    quantity INTEGER,
                    releasedQuantity INTEGER,
                    poolItemIdsJson TEXT)`,
                "INSERT INTO digital_order_reservation VALUES(82,1,10,'pool_derived',1,0,'[81]')",
                'CREATE TABLE governance_audit_entry(id INTEGER PRIMARY KEY,resourceType TEXT,resourceId TEXT,eventType TEXT)',
                ...(reveal
                    ? [
                          "INSERT INTO governance_audit_entry VALUES(83,'AutoCardPoolItem','81','AUTO_CARD_POOL_SECRET_REVEALED')",
                      ]
                    : []),
            ]);
            try {
                context.freeze.unrevealedPoolItemIds = attest ? ['81'] : [];
                const backup = await prepared(context);
                const patch = backup.plan.patches.find(row => row.table === 'auto_card_pool_item');
                assert.equal(patch.after.state, expected);
                assert.equal(patch.after.encryptedPayload, 'encrypted-fixture-payload');
                assert.equal(patch.after.fingerprint, 'keep-fingerprint');
                assert.ok(
                    backup.plan.blockers.some(row => row.code === 'DIGITAL_POOL_STOCK_MAPPING_REQUIRED'),
                );
                assert.equal(
                    JSON.stringify(publicCleanupPreview(backup.plan)).includes('encrypted-fixture-payload'),
                    false,
                );
            } finally {
                await context.close();
            }
        });
    it('restores from the verified encrypted backup and refuses post-cleanup drift', async () => {
        const context = await fixture();
        try {
            const backup = await prepared(context);
            const receipt = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            const restored = await restoreCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
                receipt,
                receipt.receiptHash,
            );
            assert.equal(restored.status, 'RESTORED');
            assert.deepEqual(await context.runner.query('SELECT stockOnHand FROM stock_level'), [
                { stockOnHand: 9 },
            ]);
            assert.deepEqual(await context.runner.query('SELECT id FROM "order"'), [{ id: 1 }]);
            const again = await restoreCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
                receipt,
                receipt.receiptHash,
            );
            assert.equal(again.status, 'ALREADY_RESTORED');
            const second = await applyCleanup(
                context.runner,
                backup.envelope,
                backup.backupHash,
                backup.plan.planHash,
                backup.key,
            );
            await context.runner.query('UPDATE stock_level SET stockOnHand=11');
            await assert.rejects(
                restoreCleanup(
                    context.runner,
                    backup.envelope,
                    backup.backupHash,
                    backup.plan.planHash,
                    backup.key,
                    second,
                    second.receiptHash,
                ),
                /drift/u,
            );
            assert.deepEqual(await context.runner.query('SELECT stockOnHand FROM stock_level'), [
                { stockOnHand: 11 },
            ]);
        } finally {
            await context.close();
        }
    });
});
