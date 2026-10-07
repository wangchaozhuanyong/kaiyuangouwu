import { GlobalFlag } from '@vendure/common/lib/generated-types';
import * as nativeCore from '@vendure/core';
import {
    Allocation,
    BaseStockLocationStrategy,
    ConfigService,
    HistoryService,
    LanguageCode,
    Order,
    OrderLine,
    OrderService,
    Payment,
    Permission,
    ProductService,
    ProductVariantService,
    Refund,
    Release,
    StockLevel,
    StockLevelService,
    StockLocation,
    StockLocationService,
    StockMovement,
    StockMovementService,
    TransactionSubscriber,
} from '@vendure/core';
import { StorefrontCart, StorefrontCartService } from '@vendure/storefront-cart-plugin';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { createNoLifecycleLegacyCompensationHost } from '../../../dev-server/scripts/public-preview-legacy-compensation-host.mjs';
import {
    compensationFingerprint,
    createLegacyCompensationExecutor,
    LEGACY_COMPENSATION_AUTHORIZATION,
    LEGACY_COMPENSATION_VERSION,
} from '../../../dev-server/scripts/public-preview-legacy-compensation.mjs';
import { CouponLedgerEntry } from '../../../store-management-plugin/src/entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../../../store-management-plugin/src/entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../../../store-management-plugin/src/entities/customer-coupon.entity';
import { StoreCouponLifecycleService } from '../../../store-management-plugin/src/promotion/store-coupon-lifecycle.service';
import { AutoCardSupplySnapshot } from '../../src/entities/auto-card-supply-grant.entity';
import { CheckoutResourceHold } from '../../src/entities/digital-product.entity';
import { PhysicalReturnReceipt } from '../../src/entities/physical-return-receipt.entity';

import { destroyLegacyFixture, initializeLegacyFixture } from './native-fixture';

type Fixture = Awaited<ReturnType<typeof initializeLegacyFixture>>;
type Executor = ReturnType<typeof createLegacyCompensationExecutor>;
// Core bootstraps these CommonJS modules already. Loading a deep entity via Vite
// would register its decorators a second time against the same inherited table.
const requireFromCore = createRequire(resolve(__dirname, '../../../core/package.json'));
const { TransactionWrapper } = requireFromCore(
    './dist/connection/transaction-wrapper',
) as typeof import('@vendure/core/dist/connection/transaction-wrapper');
const { OrderHistoryEntry } = requireFromCore(
    './dist/entity/history-entry/order-history-entry.entity',
) as typeof import('@vendure/core/dist/entity/history-entry/order-history-entry.entity');
let fixture: Fixture;
let executor: Executor;
let historical34: Awaited<ReturnType<typeof seedLegacyOrder>>;
let historical36: Awaited<ReturnType<typeof seedLegacyOrder>>;
let deadlocksBefore = 0;
const testSnapshotSha256 = createHash('sha256')
    .update('isolated synthetic legacy compensation snapshot')
    .digest('hex');

beforeAll(async () => {
    fixture = await initializeLegacyFixture();
    const { server, connection, orders, coupons } = fixture;
    executor = createLegacyCompensationExecutor({
        connection,
        orders,
        carts: server.app.get(StorefrontCartService),
        stockMovements: server.app.get(StockMovementService),
        stockLocations: server.app.get(StockLocationService),
        coupons,
        history: server.app.get(HistoryService),
        superAdminPermission: Permission.SuperAdmin,
        isolatedTest: true,
        verifyProductionRuntimeProtections: undefined,
        entities: {
            Order,
            OrderLine,
            Payment,
            StockMovement,
            StockLevel,
            StockLocation,
            OrderHistoryEntry,
            CustomerCoupon,
            CouponOrderAllocation,
            CouponLedgerEntry,
        },
    });
    const rows: Array<{ count: number | string }> = await connection.rawConnection.query(
        "SELECT COUNT AS count FROM information_schema.INNODB_METRICS WHERE NAME = 'lock_deadlocks'",
    );
    deadlocksBefore = Number(rows[0].count);
    historical34 = await seedLegacyOrder(34, [{ id: 235, quantity: 4 }], 7);
}, 300000);

afterAll(async () => {
    try {
        if (fixture) {
            const rows: Array<{ count: number | string }> = await fixture.connection.rawConnection.query(
                "SELECT COUNT AS count FROM information_schema.INNODB_METRICS WHERE NAME = 'lock_deadlocks'",
            );
            expect(Number(rows[0].count), 'No new InnoDB deadlocks hidden by transaction retries').toBe(
                deadlocksBefore,
            );
        }
    } finally {
        await destroyLegacyFixture();
    }
});

async function seedLegacyOrder(
    orderId: number,
    lines: Array<{ id: number; quantity: number }>,
    couponId?: number,
) {
    const {
        connection,
        ctx,
        customer,
        orders,
        adminCtx,
        coupons,
        physicalId,
        couponCampaignId,
        location,
        server,
    } = fixture;
    const shell = await orders.create(ctx, customer.user?.id);
    await connection.getRepository(ctx, Order).update(shell.id, { active: false });
    const persistedClone = new Order();
    for (const column of connection.rawConnection.getMetadata(Order).columns) {
        column.setEntityValue(persistedClone, column.getEntityValue(shell));
    }
    Object.assign(persistedClone, { id: orderId, code: `synthetic-legacy-${orderId}`, active: true });
    persistedClone.channels = await orders.getOrderChannels(ctx, shell);
    const historical = await connection.getRepository(ctx, Order).save(persistedClone);
    for (const [index, line] of lines.entries()) {
        let variantId = physicalId;
        if (index > 0) {
            const product = await server.app.get(ProductService).create(adminCtx, {
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: `Synthetic legacy ${orderId} ${index}`,
                        slug: `synthetic-legacy-${orderId}-${index}`,
                        description: 'Isolated additional physical line',
                    },
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: `合成历史${orderId}规格${index}`,
                        slug: `synthetic-legacy-${orderId}-${index}`,
                        description: '本地隔离追加实物订单行',
                    },
                ],
                customFields: { fulfillmentType: 'physical' },
            });
            const [created] = await server.app.get(ProductVariantService).create(adminCtx, [
                {
                    productId: product.id,
                    sku: `SYNTHETIC-LEGACY-${orderId}-${index}`,
                    price: 1000,
                    trackInventory: GlobalFlag.TRUE,
                    stockLevels: [{ stockLocationId: location.id, stockOnHand: 1000 }],
                    translations: [
                        { languageCode: LanguageCode.en, name: `Synthetic legacy ${index}` },
                        { languageCode: LanguageCode.zh_Hans, name: `合成历史规格${index}` },
                    ],
                },
            ]);
            variantId = created.id;
        }
        const added = await orders.addItemToOrder(ctx, historical.id, variantId, line.quantity);
        if ('errorCode' in added) throw new Error(added.message);
        const orderLine = await connection
            .getRepository(ctx, OrderLine)
            .findOneByOrFail({ order: { id: historical.id }, productVariantId: variantId });
        await connection.getRepository(ctx, OrderLine).update(orderLine.id, { id: line.id });
    }
    let coupon: CustomerCoupon | undefined;
    if (couponId != null) {
        const granted = await connection.withTransaction(adminCtx, tx =>
            coupons.grant(tx, couponCampaignId, customer.id),
        );
        const persistedGranted = await connection
            .getRepository(ctx, CustomerCoupon)
            .findOneByOrFail({ id: granted.id });
        // The native grant's immutable CLAIMED ledger remains attached to its synthetic source row.
        // The clone models the separately identified historical entitlement without rewriting that FK.
        coupon = await connection
            .getRepository(ctx, CustomerCoupon)
            .save(new CustomerCoupon({ ...persistedGranted, id: couponId }));
        await orders.withOrderMutationTransaction(ctx, tx => coupons.apply(tx, couponId));
        const usedAt = new Date(Date.now() - 7 * 86400000);
        await connection.getRepository(ctx, CustomerCoupon).update(couponId, {
            status: 'USED',
            usedOrderId: orderId,
            usedAt,
            lockedOrderId: orderId,
            lockExpiresAt: null,
            validFrom: new Date(Date.now() - 8 * 86400000),
            validUntil: new Date(Date.now() - 86400000),
        });
        await connection
            .getRepository(ctx, CouponOrderAllocation)
            .update({ orderId, customerCouponId: couponId }, { status: 'USED', usedAt });
        coupon = await connection.getRepository(ctx, CustomerCoupon).findOneByOrFail({ id: couponId });
        await connection.getRepository(ctx, CouponLedgerEntry).save(
            new CouponLedgerEntry({
                channelId: ctx.channelId,
                customerCouponId: couponId,
                promotionId: coupon.promotionId,
                customerId: customer.id,
                orderId,
                eventType: 'REDEEMED',
                actorType: 'SYSTEM',
                idempotencyKey: `SYNTHETIC-HISTORICAL-REDEEMED:${orderId}`,
                discountAmount: 100,
                note: 'Synthetic historical redemption',
                metadata: { syntheticHistoricalFixture: true },
            }),
        );
    }
    await orders.withOrderMutationTransaction(adminCtx, tx =>
        server.app.get(StockMovementService).createAllocationsForOrderLines(
            tx,
            lines.map(line => ({ orderLineId: line.id, quantity: line.quantity })),
        ),
    );
    const payment = await connection.getRepository(ctx, Payment).save(
        new Payment({
            order: historical,
            amount: historical.totalWithTax || lines.reduce((sum, line) => sum + line.quantity * 1000, 0),
            method: 'controlled-test-payment-2',
            state: 'Settled',
            transactionId: `synthetic-legacy-${randomUUID()}`,
            metadata: {},
        }),
    );
    payment.metadata = { public: { testPayment: true } };
    await connection.getRepository(ctx, Payment).save(payment);
    await connection.getRepository(ctx, Order).update(orderId, {
        state: 'PaymentSettled',
        active: false,
        orderPlacedAt: new Date(Date.now() - 7 * 86400000),
    });
    expect(await connection.getRepository(ctx, CheckoutResourceHold).countBy({ orderId })).toBe(0);
    return { orderId, lines, coupon, payment };
}

async function manifestFor(orderId: number) {
    const entry = await executor.capture(fixture.adminCtx, orderId);
    return {
        version: LEGACY_COMPENSATION_VERSION,
        authorization: LEGACY_COMPENSATION_AUTHORIZATION,
        sourceSnapshotSha256: testSnapshotSha256,
        capturedAt: new Date().toISOString(),
        orders: [entry],
    };
}

function evidence(name: string, value: unknown) {
    writeFileSync(resolve(fixture.output, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}

it('legacy compensation rejects stale coupon versions and original order snapshots before writing', async () => {
    const { connection, adminCtx } = fixture;
    const manifest = await manifestFor(34);
    await expect(
        executor.execute(fixture.readonlyAdminCtx, { manifest, orderId: 34, apply: true }),
    ).rejects.toThrow(/SuperAdmin/);
    const coupon = await connection.getRepository(adminCtx, CustomerCoupon).findOneByOrFail({ id: 7 });
    await connection.getRepository(adminCtx, CustomerCoupon).update(7, { version: coupon.version + 1 });
    await expect(executor.execute(adminCtx, { manifest, orderId: 34, apply: true })).rejects.toThrow(
        /snapshot\/version changed/,
    );
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 235 } })).toBe(0);
    const current = await manifestFor(34);
    await connection.getRepository(adminCtx, Order).update(34, { updatedAt: new Date(Date.now() + 1000) });
    await expect(executor.execute(adminCtx, { manifest: current, orderId: 34, apply: true })).rejects.toThrow(
        /snapshot\/version changed/,
    );
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 235 } })).toBe(0);
    evidence('version-conflicts', {
        couponVersionConflictBlocked: true,
        orderTimestampConflictBlocked: true,
        releaseCount: 0,
    });
});

it('legacy compensation rolls back native releases and coupon corrections when the receipt write fails', async () => {
    const { server, connection, adminCtx } = fixture;
    const manifest = await manifestFor(34);
    const before = manifest.orders[0];
    let nativeWritesObserved = false;
    const spy = vi
        .spyOn(server.app.get(HistoryService), 'createHistoryEntryForOrder')
        .mockImplementationOnce(async ({ ctx: tx }) => {
            expect(await connection.getRepository(tx, Release).countBy({ orderLine: { id: 235 } })).toBe(1);
            expect(
                (await connection.getRepository(tx, CustomerCoupon).findOneByOrFail({ id: 7 })).status,
            ).toBe('EXPIRED');
            expect(
                await connection
                    .getRepository(tx, CouponLedgerEntry)
                    .countBy({ customerCouponId: 7, eventType: 'CORRECTED' }),
            ).toBe(1);
            nativeWritesObserved = true;
            throw new Error('Synthetic receipt failure after native stock and coupon writes');
        });
    try {
        await expect(executor.execute(adminCtx, { manifest, orderId: 34, apply: true })).rejects.toThrow(
            'Synthetic receipt failure',
        );
    } finally {
        spy.mockRestore();
    }
    expect((await executor.capture(adminCtx, 34)).fingerprint).toBe(before.fingerprint);
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 235 } })).toBe(0);
    expect((await connection.getRepository(adminCtx, CustomerCoupon).findOneByOrFail({ id: 7 })).status).toBe(
        'USED',
    );
    expect(
        await connection
            .getRepository(adminCtx, CouponLedgerEntry)
            .countBy({ customerCouponId: 7, eventType: 'CORRECTED' }),
    ).toBe(0);
    evidence('atomic-rollback', {
        nativeStockAndCouponWritesReached: nativeWritesObserved,
        receiptFailureRolledBackAllCapturedRows: true,
        fingerprint: before.fingerprint,
    });
});

it('legacy compensation restores the exact warehouse once and expires used coupons while preserving original evidence', async () => {
    const { connection, adminCtx, server } = fixture;
    const manifest = await manifestFor(34);
    const original = manifest.orders[0].snapshot;
    expect((await executor.execute(adminCtx, { manifest, orderId: 34, apply: false })).status).toBe(
        'PREVIEW_ONLY',
    );
    expect((await executor.capture(adminCtx, 34)).fingerprint).toBe(manifest.orders[0].fingerprint);
    const history = server.app.get(HistoryService);
    const createReceipt = history.createHistoryEntryForOrder.bind(history);
    const acquired = barrier();
    const finish = barrier();
    const spy = vi.spyOn(history, 'createHistoryEntryForOrder').mockImplementationOnce(async (...args) => {
        const receipt = await createReceipt(...args);
        acquired.release();
        await finish.promise;
        return receipt;
    });
    let result!: Awaited<ReturnType<Executor['execute']>>;
    let raceReplay!: Awaited<ReturnType<Executor['execute']>>;
    let initialRaceWaiters = 0;
    const first = executor.execute(adminCtx, { manifest, orderId: 34, apply: true });
    try {
        await Promise.race([
            acquired.promise,
            first.then(() => {
                throw new Error('First compensation completed before its transaction barrier');
            }),
        ]);
        const second = executor.execute(adminCtx, { manifest, orderId: 34, apply: true });
        try {
            initialRaceWaiters = await waitForRealMysqlLock('order');
        } finally {
            finish.release();
            [result, raceReplay] = await Promise.all([first, second]);
        }
    } finally {
        finish.release();
        await first;
        spy.mockRestore();
    }
    expect(result.status).toBe('APPLIED');
    expect(result.changedQuantity).toBe(4);
    expect(result.correctedCoupons).toBe(1);
    expect(raceReplay.status).toBe('ALREADY_APPLIED');
    expect(raceReplay.changedQuantity).toBe(0);
    expect(raceReplay.correctedCoupons).toBe(0);
    const after = (await executor.capture(adminCtx, 34)).snapshot;
    expect(after.order).toEqual(original.order);
    expect(after.payments).toEqual(original.payments);
    expect(after.lines).toEqual(original.lines);
    expect(after.fulfillments).toEqual(original.fulfillments);
    for (const originalLedger of original.ledger) expect(after.ledger).toContainEqual(originalLedger);
    expect(after.coupons[0]).toMatchObject({
        id: '7',
        status: 'EXPIRED',
        usedAt: original.coupons[0].usedAt,
        usedOrderId: '34',
        returnCount: original.coupons[0].returnCount,
    });
    expect(after.allocations[0]).toMatchObject({
        status: 'RELEASED',
        usedAt: original.allocations[0].usedAt,
        refundedAmount: 0,
        refundId: null,
    });
    expect(after.stockLevels[0]).toMatchObject({
        stockOnHand: original.stockLevels[0].stockOnHand,
        stockAllocated: Number(original.stockLevels[0].stockAllocated) - 4,
    });
    expect(after.movements.filter(row => row.type === 'RELEASE')).toEqual([
        expect.objectContaining({
            orderLineId: '235',
            stockLocationId: original.movements[0].stockLocationId,
            quantity: 4,
        }),
    ]);
    const replays = await Promise.all([
        executor.execute(adminCtx, { manifest, orderId: 34, apply: true }),
        executor.execute(adminCtx, { manifest, orderId: 34, apply: true }),
    ]);
    expect(replays.map(replay => replay.status)).toEqual(['ALREADY_APPLIED', 'ALREADY_APPLIED']);
    expect((await executor.capture(adminCtx, 34)).fingerprint).toBe(compensationFingerprint(after));
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 235 } })).toBe(1);
    expect(
        await connection
            .getRepository(adminCtx, CouponLedgerEntry)
            .countBy({ customerCouponId: 7, eventType: 'CORRECTED' }),
    ).toBe(1);
    expect(
        await connection
            .getRepository(adminCtx, CouponLedgerEntry)
            .countBy({ customerCouponId: 7, eventType: 'EXPIRED' }),
    ).toBe(1);
    evidence('successful-compensation', {
        syntheticHistoricalOrder: historical34.orderId,
        changedQuantity: result.changedQuantity,
        correctedCoupons: result.correctedCoupons,
        exactOriginalLocation: true,
        expiredEntitlementNeverAvailable: true,
        originalOrderPaymentLinesRedemptionPreserved: true,
        concurrentReplayChangedQuantity: replays.map(replay => replay.changedQuantity),
        initialConcurrentStatuses: [result.status, raceReplay.status],
        initialConcurrentChangedQuantity: [result.changedQuantity, raceReplay.changedQuantity],
        initialRaceActualMysqlWaiters: initialRaceWaiters,
        initialRaceBlockedTable: 'order',
        receipt: result,
    });
});

it('legacy compensation blocks real unknown mixed and incomplete test evidence before releasing stock', async () => {
    const { connection, adminCtx } = fixture;
    const historical = await seedLegacyOrder(25, [{ id: 187, quantity: 1 }]);
    const scenarios: Array<{ state: string; method: string; metadata: Payment['metadata'] }> = [
        { state: 'Settled', method: 'synthetic-real-method', metadata: {} },
        {
            state: 'Created',
            method: 'controlled-test-payment-2',
            metadata: { public: { testPayment: true } },
        },
        { state: 'Error', method: 'controlled-test-payment-2', metadata: { public: { testPayment: true } } },
        {
            state: 'CustomUnknown',
            method: 'controlled-test-payment-2',
            metadata: { public: { testPayment: true } },
        },
        {
            state: 'Settled',
            method: 'controlled-test-payment-2',
            metadata: { public: { testPayment: false } },
        },
        { state: 'Settled', method: 'synthetic-real-method', metadata: { public: { testPayment: true } } },
        {
            state: 'Settled',
            method: 'controlled-test-payment-2',
            metadata: { public: { testPayment: true }, manualReview: { required: true } },
        },
    ];
    for (const scenario of scenarios) {
        const persisted = await connection
            .getRepository(adminCtx, Payment)
            .findOneByOrFail({ id: historical.payment.id });
        persisted.state = scenario.state as Payment['state'];
        persisted.method = scenario.method;
        persisted.metadata = scenario.metadata;
        await connection.getRepository(adminCtx, Payment).save(persisted);
        const manifest = await manifestFor(25);
        await expect(executor.execute(adminCtx, { manifest, orderId: 25, apply: true })).rejects.toThrow();
        expect((await executor.capture(adminCtx, 25)).fingerprint).toBe(manifest.orders[0].fingerprint);
    }
    const restored = await connection
        .getRepository(adminCtx, Payment)
        .findOneByOrFail({ id: historical.payment.id });
    restored.state = 'Settled';
    restored.method = 'controlled-test-payment-2';
    restored.metadata = { public: { testPayment: true } };
    await connection.getRepository(adminCtx, Payment).save(restored);
    const additional = await connection.getRepository(adminCtx, Payment).save(
        new Payment({
            order: { id: 25 },
            amount: 100,
            state: 'Settled',
            method: 'synthetic-real-method',
            metadata: {},
            transactionId: randomUUID(),
        }),
    );
    for (const state of ['Settled', 'Created'] as const) {
        await connection.getRepository(adminCtx, Payment).update(additional.id, { state });
        const manifest = await manifestFor(25);
        await expect(executor.execute(adminCtx, { manifest, orderId: 25, apply: true })).rejects.toThrow();
        expect((await executor.capture(adminCtx, 25)).fingerprint).toBe(manifest.orders[0].fingerprint);
    }
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 187 } })).toBe(0);
    evidence('funds-protection', {
        rejectedVariants: scenarios.length + 2,
        mixedRealAndCreatedBlocked: true,
        releaseCount: 0,
    });
});

it('legacy compensation rejects wrong stores foreign warehouses multiple locations and unauthorized orders', async () => {
    const { connection, adminCtx, platform, server, location } = fixture;
    const historical29 = await seedLegacyOrder(29, [{ id: 223, quantity: 1 }]);
    const valid = await manifestFor(historical29.orderId);
    await expect(executor.execute(platform, { manifest: valid, orderId: 29, apply: true })).rejects.toThrow(
        /Channel mismatch/,
    );
    await expect(executor.capture(adminCtx, 41)).rejects.toThrow(/outside.*authorization/);
    const foreign = await server.app
        .get(StockLocationService)
        .create(platform, { name: 'Synthetic foreign warehouse' });
    await server.app
        .get(StockLevelService)
        .updateStockOnHandForLocation(adminCtx, fixture.physicalId, foreign.id, 100);
    const originalAllocation = await connection
        .getRepository(adminCtx, Allocation)
        .findOneByOrFail({ orderLine: { id: 223 } });
    await connection
        .getRepository(adminCtx, Allocation)
        .update(originalAllocation.id, { stockLocationId: foreign.id });
    const foreignManifest = await manifestFor(29);
    await expect(
        executor.execute(adminCtx, { manifest: foreignManifest, orderId: 29, apply: true }),
    ).rejects.toThrow(/outside sales Channel/);
    const historical28 = await seedLegacyOrder(28, [
        { id: 188, quantity: 4 },
        { id: 217, quantity: 1 },
        { id: 218, quantity: 3 },
        { id: 219, quantity: 1 },
        { id: 220, quantity: 1 },
        { id: 221, quantity: 1 },
        { id: 222, quantity: 1 },
    ]);
    const second = await server.app
        .get(StockLocationService)
        .create(adminCtx, { name: 'Synthetic second warehouse' });
    await server.app
        .get(StockLevelService)
        .updateStockOnHandForLocation(adminCtx, fixture.physicalId, second.id, 100);
    await server.app
        .get(StockLevelService)
        .updateStockAllocatedForLocation(adminCtx, fixture.physicalId, second.id, 2);
    const allocation = await connection
        .getRepository(adminCtx, Allocation)
        .findOneByOrFail({ orderLine: { id: 188 } });
    await connection.getRepository(adminCtx, Allocation).update(allocation.id, { quantity: 2 });
    await connection.getRepository(adminCtx, Allocation).save(
        new Allocation({
            orderLine: { id: 188 },
            productVariant: { id: fixture.physicalId },
            stockLocation: second,
            quantity: 2,
        }),
    );
    const split = await manifestFor(historical28.orderId);
    await expect(executor.execute(adminCtx, { manifest: split, orderId: 28, apply: true })).rejects.toThrow(
        /Multiple original stock locations/,
    );
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 223 } })).toBe(0);
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 188 } })).toBe(0);
    evidence('scope-protection', {
        wrongStoreBlocked: true,
        foreignWarehouseBlocked: true,
        multipleOriginalLocationsBlocked: true,
        newlyAuditedOrder41OutsideAuthorization: true,
    });
});

function barrier() {
    let release!: () => void;
    const promise = new Promise<void>(resolveBarrier => {
        release = resolveBarrier;
    });
    return { promise, release };
}

async function waitForRealMysqlLock(table: string) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const rows: Array<{ count: number | string }> = await fixture.connection.rawConnection.query(
            'SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits waiting ' +
                'JOIN performance_schema.data_locks requested ON requested.ENGINE_LOCK_ID = waiting.REQUESTING_ENGINE_LOCK_ID ' +
                'WHERE requested.OBJECT_NAME = ?',
            [table],
        );
        if (Number(rows[0].count) >= 1) return Number(rows[0].count);
        await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
    throw new Error('No actual MySQL compensation lock wait observed');
}

it('legacy compensation protects late real or unknown payments refund evidence and stale inventory', async () => {
    const { connection, adminCtx, orders, server } = fixture;
    historical36 = await seedLegacyOrder(36, [{ id: 238, quantity: 1 }]);
    const cart = await server.app.get(StorefrontCartService).getCart(fixture.ctx);
    await connection.getRepository(adminCtx, StorefrontCart).update(cart.id, { checkoutOrderId: 36 });
    expect((await manifestFor(36)).orders[0].snapshot.carts).toContainEqual(
        expect.objectContaining({ id: String(cart.id), checkoutOrderId: '36' }),
    );
    const physicalReceipt = await connection.getRepository(adminCtx, PhysicalReturnReceipt).save(
        new PhysicalReturnReceipt({
            channelId: adminCtx.channelId,
            requestId: 1000,
            orderId: 1000,
            orderLineId: 238,
            stockLocationId: fixture.location.id,
            idempotencyKey: 'synthetic-isolated-return-line',
            quantity: 1,
            quality: 'GOOD',
            state: 'RECORDED',
            actorId: null,
        }),
    );
    const physicalRisk = await manifestFor(36);
    expect(physicalRisk.orders[0].snapshot.risks.physical_return_receipt).toHaveLength(1);
    await expect(
        executor.execute(adminCtx, { manifest: physicalRisk, orderId: 36, apply: true }),
    ).rejects.toThrow(/Existing physical_return_receipt blocks compensation/);
    await connection.getRepository(adminCtx, PhysicalReturnReceipt).delete(physicalReceipt.id);
    const supply = await connection.getRepository(adminCtx, AutoCardSupplySnapshot).save(
        new AutoCardSupplySnapshot({
            orderLineId: 238,
            orderId: 1000,
            channelId: adminCtx.channelId,
            sourceChannelId: adminCtx.channelId,
            configId: 1000,
            grantId: null,
            grantVersion: null,
            quantity: 1,
            configSnapshot: {
                delimiter: '|',
                fieldsJson: '[]',
                instructions: 'Synthetic local snapshot',
                instructionsZh: null,
                instructionsEn: null,
            },
        }),
    );
    const supplyRisk = await manifestFor(36);
    expect(supplyRisk.orders[0].snapshot.risks.auto_card_supply_snapshot).toHaveLength(1);
    await expect(
        executor.execute(adminCtx, { manifest: supplyRisk, orderId: 36, apply: true }),
    ).rejects.toThrow(/Existing auto_card_supply_snapshot blocks compensation/);
    await connection.getRepository(adminCtx, AutoCardSupplySnapshot).delete(supply.id);
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 238 } })).toBe(0);
    evidence('line-associated-risk-protection', {
        foreignOrderPhysicalReturnAssociatedByLineBlocked: true,
        foreignOrderDigitalSupplyAssociatedByLineBlocked: true,
        bothRisksCapturedCount: [
            physicalRisk.orders[0].snapshot.risks.physical_return_receipt.length,
            supplyRisk.orders[0].snapshot.risks.auto_card_supply_snapshot.length,
        ],
        releaseCount: 0,
    });
    const proof: Array<{ state: string; actualMysqlWaiters: number; blockedAfterReceiptCommit: boolean }> =
        [];
    for (const state of ['Settled', 'Created'] as const) {
        const original = await connection
            .getRepository(adminCtx, Payment)
            .findOneByOrFail({ id: historical36.payment.id });
        original.state = 'Settled';
        original.method = 'controlled-test-payment-2';
        original.metadata = { public: { testPayment: true } };
        await connection.getRepository(adminCtx, Payment).save(original);
        const manifest = await manifestFor(36);
        const acquired = barrier();
        const finish = barrier();
        const receipt = orders.withOrderMutationTransaction(adminCtx, async tx => {
            await server.app.get(StorefrontCartService).lockForOrder(tx, 36);
            await orders.lockOrderForRefund(tx, 36);
            const payment = await connection
                .getRepository(tx, Payment)
                .findOneByOrFail({ id: historical36.payment.id });
            payment.state = state;
            payment.method = 'synthetic-trusted-receipt';
            payment.metadata = {};
            await connection.getRepository(tx, Payment).save(payment);
            acquired.release();
            await finish.promise;
        });
        await acquired.promise;
        const compensation = executor.execute(adminCtx, { manifest, orderId: 36, apply: true }).then(
            value => ({ value, error: null as Error | null }),
            error => ({ value: null, error: error as Error }),
        );
        let waiters = 0;
        try {
            waiters = await waitForRealMysqlLock('storefront_cart');
        } finally {
            finish.release();
        }
        await receipt;
        const result = await compensation;
        expect(result.value).toBeNull();
        expect(result.error?.message).toMatch(/snapshot\/version changed/);
        expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 238 } })).toBe(0);
        proof.push({ state, actualMysqlWaiters: waiters, blockedAfterReceiptCommit: true });
    }
    const restored = await connection
        .getRepository(adminCtx, Payment)
        .findOneByOrFail({ id: historical36.payment.id });
    restored.state = 'Settled';
    restored.method = 'controlled-test-payment-2';
    restored.metadata = { public: { testPayment: true } };
    await connection.getRepository(adminCtx, Payment).save(restored);
    evidence('late-receipt-lock-protection', proof);
    evidence('native-cart-order-lock-path', {
        nativeCartId: String(cart.id),
        checkoutOrderId: '36',
        channelId: String(adminCtx.channelId),
        blockingTableObserved: 'storefront_cart',
        actualLockWaitersPerReceipt: proof.map(row => row.actualMysqlWaiters),
        sourceLockOrder: 'Cart -> Order -> Payment',
        actualPaymentTableLockWaitClaimed: false,
    });

    const { physicalId, location } = fixture;
    const historical = historical36;
    const stale = await manifestFor(36);
    await server.app
        .get(StockLevelService)
        .updateStockAllocatedForLocation(adminCtx, physicalId, location.id, 1);
    await expect(executor.execute(adminCtx, { manifest: stale, orderId: 36, apply: true })).rejects.toThrow(
        /snapshot\/version changed/,
    );
    const refund = await connection.getRepository(adminCtx, Refund).save(
        new Refund({
            paymentId: historical.payment.id,
            items: 0,
            shipping: 0,
            adjustment: 0,
            total: 100,
            method: 'synthetic-original-refund',
            reason: 'Synthetic historical evidence',
            state: 'Pending',
            transactionId: randomUUID(),
            metadata: {},
        }),
    );
    const existingRefund = JSON.stringify(
        await connection.getRepository(adminCtx, Refund).findOneByOrFail({ id: refund.id }),
    );
    const reviewed = await manifestFor(36);
    await expect(
        executor.execute(adminCtx, { manifest: reviewed, orderId: 36, apply: true }),
    ).rejects.toThrow(/Existing refund blocks/);
    expect(
        JSON.stringify(await connection.getRepository(adminCtx, Refund).findOneByOrFail({ id: refund.id })),
    ).toBe(existingRefund);
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 238 } })).toBe(0);
    evidence('refund-and-inventory-protection', {
        existingRefundUnchanged: true,
        staleInventoryBlocked: true,
        releaseCount: 0,
    });
});

it('legacy compensation runs the native no-lifecycle host with the a535 order interface shape', async () => {
    const { connection, adminCtx, server } = fixture;
    if (!(await connection.getRepository(adminCtx, Order).existsBy({ id: 25 }))) {
        await seedLegacyOrder(25, [{ id: 187, quantity: 1 }]);
    }
    const payments = await connection.getRepository(adminCtx, Payment).find({ where: { order: { id: 25 } } });
    for (const payment of payments) {
        payment.state = 'Settled';
        payment.method = 'controlled-test-payment-2';
        payment.metadata = { public: { testPayment: true } };
        await connection.getRepository(adminCtx, Payment).save(payment);
    }
    const cartHook = vi.spyOn(StorefrontCartService.prototype, 'onApplicationBootstrap');
    const couponHook = vi.spyOn(StoreCouponLifecycleService.prototype, 'onApplicationBootstrap');
    const registration = Object.getOwnPropertyDescriptor(OrderService.prototype, 'registerOrderMutationLock');
    Object.defineProperty(OrderService.prototype, 'registerOrderMutationLock', {
        configurable: true,
        value: undefined,
    });
    let host: ReturnType<typeof createNoLifecycleLegacyCompensationHost> | undefined;
    try {
        host = createNoLifecycleLegacyCompensationHost({
            dataSource: connection.rawConnection,
            configService: server.app.get(ConfigService),
            runtime: {
                core: nativeCore,
                TransactionWrapper,
                TransactionSubscriber,
                BaseStockLocationStrategy,
                StorefrontCartService,
                StoreCouponLifecycleService,
            },
            entities: {
                Order,
                OrderLine,
                Payment,
                StockMovement,
                StockLevel,
                StockLocation,
                OrderHistoryEntry,
                CustomerCoupon,
                CouponOrderAllocation,
                CouponLedgerEntry,
            },
            isolatedTest: true,
            clock: () => new Date(),
            verifyProductionRuntimeProtections: undefined,
        });
        const entry = await host.capture(adminCtx, 25);
        const manifest = {
            version: LEGACY_COMPENSATION_VERSION,
            authorization: LEGACY_COMPENSATION_AUTHORIZATION,
            sourceSnapshotSha256: testSnapshotSha256,
            capturedAt: new Date().toISOString(),
            orders: [entry],
        };
        const result = await host.execute(adminCtx, { manifest, orderId: 25, apply: true });
        expect(result.status).toBe('APPLIED');
        expect(result.changedQuantity).toBe(1);
        expect(cartHook).not.toHaveBeenCalled();
        expect(couponHook).not.toHaveBeenCalled();
        expect(host.lifecycle).toMatchObject({
            nestBootstrap: false,
            workerBootstrap: false,
            moduleInitializationHooksInvoked: false,
            applicationBootstrapHooksInvoked: false,
            workerSchedulerHooksInvoked: false,
            scannerStarted: false,
            schedulerStarted: false,
            jobsStarted: false,
        });
        expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 187 } })).toBe(1);
        evidence('native-no-lifecycle-host', {
            a535InterfaceWithoutRegistration: true,
            nativeMysqlQuantityReleased: result.changedQuantity,
            lifecycle: host.lifecycle,
            pluginHookCalls: { cart: cartHook.mock.calls.length, coupon: couponHook.mock.calls.length },
        });
    } finally {
        host?.close();
        cartHook.mockRestore();
        couponHook.mockRestore();
        if (registration)
            Object.defineProperty(OrderService.prototype, 'registerOrderMutationLock', registration);
    }
});
