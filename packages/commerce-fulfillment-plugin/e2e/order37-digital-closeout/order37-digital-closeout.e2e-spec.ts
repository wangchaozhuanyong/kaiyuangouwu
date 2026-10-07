import { GlobalFlag } from '@vendure/common/lib/generated-types';
import * as nativeCore from '@vendure/core';
import {
    Allocation,
    BaseStockLocationStrategy,
    ConfigService,
    FulfillmentLine,
    GlobalSettings,
    Order,
    OrderLine,
    Payment,
    ProductVariant,
    Refund,
    Release,
    RequestContextService,
    StockLevel,
    StockLocation,
    StockMovement,
    TransactionSubscriber,
} from '@vendure/core';
import { StorefrontCart, StorefrontCartService } from '@vendure/storefront-cart-plugin';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { ObjectLiteral, ObjectType } from 'typeorm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { compensationFingerprint } from '../../../dev-server/scripts/public-preview-legacy-compensation.mjs';
import { createNoLifecycleLegacyDigitalCompensationHost } from '../../../dev-server/scripts/public-preview-legacy-digital-compensation-host.mjs';
import {
    AdminNotificationConfigService,
    AdminNotificationRuntimeConfig,
} from '../../../operations-dashboard-plugin/src/admin-notification-config.service';
import { AdminNotificationService } from '../../../operations-dashboard-plugin/src/admin-notification.service';
import { AdminIncidentAction } from '../../../operations-dashboard-plugin/src/entities/admin-incident-action.entity';
import { AdminIncidentEvidence } from '../../../operations-dashboard-plugin/src/entities/admin-incident-evidence.entity';
import { AdminNotificationDelivery } from '../../../operations-dashboard-plugin/src/entities/admin-notification-delivery.entity';
import { IncidentResponseService } from '../../../operations-dashboard-plugin/src/incident-response.service';
import { TelegramNotificationWorkerService } from '../../../operations-dashboard-plugin/src/telegram-notification-worker.service';
import { CouponLedgerEntry } from '../../../store-management-plugin/src/entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../../../store-management-plugin/src/entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../../../store-management-plugin/src/entities/customer-coupon.entity';
import { StoreCouponLifecycleService } from '../../../store-management-plugin/src/promotion/store-coupon-lifecycle.service';
import { DigitalProductService } from '../../src/digital-product.service';
import {
    CheckoutResourceHold,
    DigitalOrderReservation,
    DigitalReceiptAccess,
    DigitalVariantConfig,
} from '../../src/entities/digital-product.entity';
import { ManualDigitalDeliveryEvent } from '../../src/entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from '../../src/entities/manual-digital-delivery.entity';
import { ManualDigitalDeliveryReadyEvent } from '../../src/manual-digital-delivery.event';
import { ManualDigitalDeliveryService } from '../../src/manual-digital-delivery.service';

import { destroyOrder37Fixture, initializeOrder37Fixture } from './native-fixture';
import { Order37Fixture, seedHistoricalOrder37 } from './native-shape';

const requireFromCore = createRequire(resolve(__dirname, '../../../core/package.json'));
const { TransactionWrapper } = requireFromCore(
    './dist/connection/transaction-wrapper',
) as typeof import('@vendure/core/dist/connection/transaction-wrapper');
const { OrderHistoryEntry } = requireFromCore(
    './dist/entity/history-entry/order-history-entry.entity',
) as typeof import('@vendure/core/dist/entity/history-entry/order-history-entry.entity');
type Host = ReturnType<typeof createNoLifecycleLegacyDigitalCompensationHost>;
type LegacyDigitalManifest = Parameters<Host['execute']>[1]['manifest'];
type LegacyDigitalReviewArtifact = Parameters<Host['execute']>[1]['reviewArtifact'];
let fixture: Order37Fixture;
let host: Host;
let seeded: Awaited<ReturnType<typeof seedHistoricalOrder37>>;
let deadlocksBefore = 0;
let appliedReview: Awaited<ReturnType<typeof reviewed>> | undefined;
const sourceSnapshotSha256 = createHash('sha256')
    .update('owned synthetic order37 digital closeout source')
    .digest('hex');
const version = 'public-preview-legacy-digital-compensation-v1';
const authorization = 'ORDER_37_TEST_ONLY_20261007';

beforeAll(async () => {
    fixture = await initializeOrder37Fixture();
    seeded = await seedHistoricalOrder37(fixture);
    host = createNoLifecycleLegacyDigitalCompensationHost({
        dataSource: fixture.connection.rawConnection,
        configService: fixture.server.app.get(ConfigService),
        runtime: {
            core: nativeCore,
            TransactionWrapper,
            TransactionSubscriber,
            BaseStockLocationStrategy,
            StorefrontCartService,
            StoreCouponLifecycleService,
            DigitalProductService,
            ManualDigitalDeliveryService,
            IncidentResponseService,
        },
        entities: {
            Order,
            OrderLine,
            FulfillmentLine,
            Payment,
            StockMovement,
            StockLevel,
            StockLocation,
            OrderHistoryEntry,
            CustomerCoupon,
            CouponOrderAllocation,
            CouponLedgerEntry,
            ProductVariant,
            GlobalSettings,
            ManualDigitalDelivery,
            ManualDigitalDeliveryEvent,
            DigitalVariantConfig,
            DigitalOrderReservation,
            DigitalReceiptAccess,
            AdminNotificationDelivery,
            AdminIncidentEvidence,
            AdminIncidentAction,
        },
        isolatedTest: true,
        clock: () => new Date(),
        verifyReviewedArtifact: () => Promise.resolve(true),
    });
    const metrics: Array<{ count: number | string }> = await fixture.connection.rawConnection.query(
        "SELECT COUNT AS count FROM information_schema.INNODB_METRICS WHERE NAME = 'lock_deadlocks'",
    );
    deadlocksBefore = Number(metrics[0].count);
}, 300000);

afterAll(async () => {
    try {
        if (fixture) {
            const metrics: Array<{ count: number | string }> = await fixture.connection.rawConnection.query(
                "SELECT COUNT AS count FROM information_schema.INNODB_METRICS WHERE NAME = 'lock_deadlocks'",
            );
            expect(Number(metrics[0].count), 'No hidden transaction retry deadlock').toBe(deadlocksBefore);
        }
    } finally {
        host?.close();
        await destroyOrder37Fixture();
    }
});

async function reviewed(): Promise<{
    manifest: LegacyDigitalManifest;
    reviewArtifact: LegacyDigitalReviewArtifact;
}> {
    const entry = await host.capture(fixture.adminCtx, '37');
    return {
        manifest: {
            version,
            authorization,
            sourceSnapshotSha256,
            capturedAt: new Date().toISOString(),
            entry,
        },
        reviewArtifact: {
            version: 'historical-test-digital-review-v1',
            orderId: '37',
            channelId: '5',
            deliveryId: entry.snapshot.digital.task.id,
            beforeFingerprint: entry.fingerprint,
            contentFingerprint: entry.snapshot.digital.task.contentFingerprint,
            contentClassification: 'TEST_ONLY',
            realResourceDisposition: 'NO_REAL_RESOURCE',
            attestationSource: 'HUMAN_USER_20261007',
            attestationDigest: sourceSnapshotSha256,
            externalDeliveryOutcome: 'NOT_VERIFIED',
            reviewedAt: new Date().toISOString(),
        },
    };
}

function evidence(name: string, value: unknown) {
    writeFileSync(
        resolve(fixture.output, name + '.json'),
        JSON.stringify(
            {
                measuredAt: new Date().toISOString(),
                scope: 'owned UUID MySQL synthetic fixtures only',
                productionWrites: 0,
                ...Object(value),
            },
            null,
            2,
        ) + '\n',
    );
}

async function assertUnchanged(review: Awaited<ReturnType<typeof reviewed>>) {
    expect((await host.capture(fixture.adminCtx, '37')).fingerprint).toBe(review.manifest.entry.fingerprint);
    expect(
        await fixture.connection.getRepository(fixture.adminCtx, Release).countBy({ orderLine: { id: 248 } }),
    ).toBe(0);
}

function persistedFingerprint<T extends ObjectLiteral>(target: ObjectType<T>, row: T) {
    const columns = fixture.connection.rawConnection.getMetadata(target).columns;
    return compensationFingerprint(
        Object.fromEntries(columns.map(column => [column.propertyPath, column.getEntityValue(row)])),
    );
}

function isolatedIncidentReceiver() {
    const config: AdminNotificationRuntimeConfig = {
        id: 'synthetic-disabled',
        enabled: false,
        tokenConfigured: false,
        chatId: null,
        chatIdSource: 'NONE',
        adminBaseUrl: null,
        timezone: 'UTC',
        minSeverity: 'P3',
        sendResolved: false,
        p2Silent: true,
        p3Silent: true,
        notifyOrderEvents: false,
        notifyPaymentEvents: false,
        notifyFulfillmentEvents: false,
        notifyRefundEvents: false,
        notifyInventoryEvents: false,
        notifyOnlineReports: false,
        notifyServiceReviews: false,
        notifyPromotionExpiry: false,
        notifyAiCredentials: false,
        notifySecurityEvents: false,
        inventoryLowThreshold: 0,
        p1EscalationMinutes: 60,
        p0RepeatMinutes: 5,
        p1RepeatMinutes: 60,
        departmentMentions: {},
        routeOverrides: [],
        botUsername: null,
        lastConnectionAt: null,
        lastConnectionError: null,
    };
    const worker = {
        dispatch: vi.fn(() => {
            throw new Error('External dispatch is forbidden in this native test');
        }),
    };
    const receiver = new AdminNotificationService(
        host.connection,
        { get: () => Promise.resolve(config) } as unknown as AdminNotificationConfigService,
        worker as unknown as TelegramNotificationWorkerService,
        host.providers.incidents as IncidentResponseService,
    );
    return { receiver, worker };
}

function barrier() {
    let release!: () => void;
    const promise = new Promise<void>(resolveBarrier => {
        release = resolveBarrier;
    });
    return { promise, release };
}

async function actualMysqlWait(table: string) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const rows: Array<{ count: number | string }> = await fixture.connection.rawConnection.query(
            'SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits waiting ' +
                'JOIN performance_schema.data_locks requested ON requested.ENGINE_LOCK_ID = waiting.REQUESTING_ENGINE_LOCK_ID WHERE requested.OBJECT_NAME = ?',
            [table],
        );
        if (Number(rows[0].count) > 0) return Number(rows[0].count);
        await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
    throw new Error(`No actual owned MySQL lock wait observed for ${table}`);
}

it('captures the genuine digital Modifying published-content shape through a no-lifecycle native host', async () => {
    const { connection, adminCtx, digitalId } = fixture;
    const entry = await host.capture(adminCtx, '37');
    const order = await connection.getRepository(adminCtx, Order).findOneByOrFail({ id: 37 });
    const line = await connection.getRepository(adminCtx, OrderLine).findOneByOrFail({ id: 248 });
    const level = await connection
        .getRepository(adminCtx, StockLevel)
        .findOneByOrFail({ productVariantId: digitalId, stockLocationId: fixture.location.id });
    expect(String(order.salesChannelId)).toBe('5');
    expect(order.state).toBe('Modifying');
    expect(line.customFields).toMatchObject({
        fulfillmentTypeSnapshot: 'digital',
        digitalDeliveryModeSnapshot: 'manual_service',
    });
    expect(line.quantity).toBe(1);
    expect(line.orderPlacedQuantity).toBe(1);
    expect(level).toMatchObject({ stockOnHand: 100, stockAllocated: 1 });
    expect(await connection.getRepository(adminCtx, Allocation).findOneByOrFail({ id: 884 })).toMatchObject({
        quantity: 1,
    });
    expect(
        await connection.getRepository(adminCtx, ManualDigitalDeliveryEvent).countBy({ deliveryId: 1 }),
    ).toBe(11);
    expect(
        await connection
            .getRepository(adminCtx, DigitalVariantConfig)
            .countBy({ productVariantId: digitalId }),
    ).toBe(0);
    expect(await connection.getRepository(adminCtx, DigitalOrderReservation).countBy({ orderId: 37 })).toBe(
        0,
    );
    expect(await connection.getRepository(adminCtx, CheckoutResourceHold).countBy({ orderId: 37 })).toBe(0);
    expect(await connection.getRepository(adminCtx, FulfillmentLine).countBy({ orderLineId: 248 })).toBe(0);
    expect(host.lifecycle).toMatchObject({
        nestBootstrap: false,
        workerBootstrap: false,
        scannerStarted: false,
        schedulerStarted: false,
        jobsStarted: false,
    });
    expect(JSON.stringify(entry.snapshot)).not.toContain(seeded.encryptedPackages);
    expect(JSON.stringify(entry.snapshot)).not.toContain('synthetic-order37@example.invalid');
    evidence('shape-and-host', {
        fingerprint: entry.fingerprint,
        lifecycle: host.lifecycle,
        digitalManualSnapshot: true,
        orderState: order.state,
        stockOnHand: level.stockOnHand,
        stockAllocated: level.stockAllocated,
        originalEventCount: 11,
        contentDecrypted: false,
    });
});

it('blocks unknown real and unresolved real-resource reviews without pretending external delivery is verified', async () => {
    const original = await reviewed();
    for (const change of [
        { contentClassification: 'UNKNOWN' },
        { contentClassification: 'REAL_CONTENT' },
        { realResourceDisposition: 'UNKNOWN' },
        { realResourceDisposition: 'REVOCATION_REQUIRED' },
        { beforeFingerprint: '0'.repeat(64) },
        { contentFingerprint: '0'.repeat(64) },
        { attestationSource: 'CLIENT_MARKER' },
    ]) {
        await expect(
            host.execute(fixture.adminCtx, {
                ...original,
                // Negative runtime contract: deliberately malformed review artifacts must be rejected.
                reviewArtifact: {
                    ...original.reviewArtifact,
                    ...change,
                } as unknown as LegacyDigitalReviewArtifact,
                apply: true,
            }),
        ).rejects.toThrow();
        await assertUnchanged(original);
    }
    expect(original.reviewArtifact.externalDeliveryOutcome).toBe('NOT_VERIFIED');
    evidence('content-review-guards', {
        rejectedVariants: 7,
        unknownAndRealBlocked: true,
        externalDeliveryOutcome: 'NOT_VERIFIED',
        noRealResourceIsSeparateAttestation: true,
    });
});

it('blocks read-only users foreign store contexts unsupported order scope and stale task coupon or tracking snapshots', async () => {
    const original = await reviewed();
    await expect(host.execute(fixture.readonlyAdminCtx, { ...original, apply: true })).rejects.toThrow(
        /Authenticated native SuperAdmin required/,
    );
    await expect(host.execute(fixture.platform, { ...original, apply: true })).rejects.toThrow(
        /Context Channel mismatch/,
    );
    await expect(host.capture(fixture.adminCtx, '41')).rejects.toThrow(/exceeds reviewed order scope/);
    const { connection, adminCtx } = fixture;
    const task = await connection.getRepository(adminCtx, ManualDigitalDelivery).findOneByOrFail({ id: 1 });
    await connection
        .getRepository(adminCtx, ManualDigitalDelivery)
        .update(1, { attemptCount: task.attemptCount + 1 });
    await expect(host.execute(adminCtx, { ...original, apply: true })).rejects.toThrow(
        /Persisted digital snapshot\/version changed/,
    );
    await connection.getRepository(adminCtx, ManualDigitalDelivery).save(task);
    const coupon = await connection.getRepository(adminCtx, CustomerCoupon).findOneByOrFail({ id: 8 });
    const beforeCoupon = await reviewed();
    await connection.getRepository(adminCtx, CustomerCoupon).update(8, { version: coupon.version + 1 });
    await expect(host.execute(adminCtx, { ...beforeCoupon, apply: true })).rejects.toThrow(
        /Persisted digital snapshot\/version changed/,
    );
    await connection.getRepository(adminCtx, CustomerCoupon).save(coupon);
    const beforeTracking = await reviewed();
    await connection
        .getRepository(adminCtx, ProductVariant)
        .update(fixture.digitalId, { trackInventory: GlobalFlag.FALSE });
    await expect(host.execute(adminCtx, { ...beforeTracking, apply: true })).rejects.toThrow(
        /Persisted digital snapshot\/version changed/,
    );
    await connection
        .getRepository(adminCtx, ProductVariant)
        .update(fixture.digitalId, { trackInventory: GlobalFlag.TRUE });
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 248 } })).toBe(0);
    evidence('scope-and-cas', {
        readonlyBlocked: true,
        foreignStoreBlocked: true,
        order41Blocked: true,
        taskCouponTrackingCasBlocked: true,
    });
});

it('blocks disabled and inherited-disabled native inventory tracking without writing a fake Release row', async () => {
    const { connection, adminCtx, digitalId } = fixture;
    const settings = await connection.getRepository(adminCtx, GlobalSettings).findOneOrFail({ where: {} });
    for (const flag of [GlobalFlag.FALSE, GlobalFlag.INHERIT]) {
        await connection.getRepository(adminCtx, ProductVariant).update(digitalId, { trackInventory: flag });
        await connection
            .getRepository(adminCtx, GlobalSettings)
            .update(settings.id, { trackInventory: false });
        const review = await reviewed();
        await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow(/track|inventory/i);
        await assertUnchanged(review);
    }
    await connection.getRepository(adminCtx, GlobalSettings).save(settings);
    await connection
        .getRepository(adminCtx, ProductVariant)
        .update(digitalId, { trackInventory: GlobalFlag.TRUE });
    evidence('tracking-guards', {
        currentFalseBlocked: true,
        globalFalseWithInheritBlocked: true,
        noVariantOrGlobalFlagOverriddenByExecutor: true,
        nativeReleaseCount: 0,
    });
});

it('blocks real mixed unknown unmarked refund claim digital-reservation and incident side-effect evidence', async () => {
    const { connection, adminCtx } = fixture;
    const originalPayment = await connection.getRepository(adminCtx, Payment).findOneByOrFail({ id: 10 });
    for (const change of [
        { state: 'Created' },
        { method: 'synthetic-real-method' },
        { method: 'controlled-test-payment-2' },
        { metadata: { public: { testPayment: false } } },
        { metadata: { public: { testPayment: true }, manualReview: { required: true } } },
    ]) {
        const payment = await connection.getRepository(adminCtx, Payment).findOneByOrFail({ id: 10 });
        Object.assign(payment, change);
        await connection.getRepository(adminCtx, Payment).save(payment);
        const paymentReview = await reviewed();
        await expect(host.execute(adminCtx, { ...paymentReview, apply: true })).rejects.toThrow();
        await assertUnchanged(paymentReview);
        await connection.getRepository(adminCtx, Payment).save(originalPayment);
    }
    const extraPayment = await connection.getRepository(adminCtx, Payment).save(
        new Payment({
            order: { id: 37 },
            amount: 1,
            state: 'Settled',
            method: 'synthetic-real-method',
            transactionId: randomUUID(),
            metadata: {},
        }),
    );
    let review = await reviewed();
    await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow();
    await assertUnchanged(review);
    await connection.getRepository(adminCtx, Payment).delete(extraPayment.id);
    const refund = await connection.getRepository(adminCtx, Refund).save(
        new Refund({
            paymentId: 10,
            items: 0,
            shipping: 0,
            adjustment: 0,
            total: 1,
            method: 'synthetic-test-refund',
            reason: 'Synthetic existing evidence',
            state: 'Pending',
            transactionId: randomUUID(),
            metadata: {},
        }),
    );
    review = await reviewed();
    await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow();
    await assertUnchanged(review);
    await connection.getRepository(adminCtx, Refund).delete(refund.id);
    const claim = await connection.getRepository(adminCtx, DigitalReceiptAccess).save(
        new DigitalReceiptAccess({
            channelId: adminCtx.channelId,
            orderId: 37,
            orderLineId: 248,
            claimedQuantity: 1,
            actorId: 'synthetic-local-claim',
        }),
    );
    review = await reviewed();
    await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow();
    await assertUnchanged(review);
    await connection.getRepository(adminCtx, DigitalReceiptAccess).delete(claim.id);
    const config = await connection.getRepository(adminCtx, DigitalVariantConfig).save(
        new DigitalVariantConfig({
            channelId: adminCtx.channelId,
            productVariantId: fixture.digitalId,
            deliveryMode: 'manual_service',
            stockPolicy: 'limited',
            availableQuantity: 1,
            fileVersionId: null,
            migrationState: 'ACTIVE',
        }),
    );
    review = await reviewed();
    await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow();
    await assertUnchanged(review);
    await connection.getRepository(adminCtx, DigitalVariantConfig).delete(config.id);
    const reservation = await connection.getRepository(adminCtx, DigitalOrderReservation).save(
        new DigitalOrderReservation({
            channelId: adminCtx.channelId,
            orderId: 37,
            orderLineId: 248,
            configId: 999,
            deliveryMode: 'manual_service',
            stockPolicy: 'limited',
            quantity: 1,
            releasedQuantity: 0,
            consumedQuantity: 0,
            state: 'HELD',
            expiresAt: new Date(Date.now() + 60000),
            poolItemIdsJson: '[]',
            fileVersionId: null,
        }),
    );
    review = await reviewed();
    await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow(
        /Digital reservations require separate resource review/,
    );
    await assertUnchanged(review);
    await connection.getRepository(adminCtx, DigitalOrderReservation).delete(reservation.id);
    const incident = await connection
        .getRepository(adminCtx, AdminNotificationDelivery)
        .findOneByOrFail({ id: seeded.incidents[0].id });
    await connection
        .getRepository(adminCtx, AdminNotificationDelivery)
        .update(incident.id, { deliveryStatus: 'CLAIMED' });
    review = await reviewed();
    await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow();
    await assertUnchanged(review);
    await connection.getRepository(adminCtx, AdminNotificationDelivery).save(incident);
    const action = await connection.getRepository(adminCtx, AdminIncidentAction).save(
        new AdminIncidentAction({
            incidentId: Number(incident.id),
            title: 'Synthetic still-open corrective action',
            ownerDepartmentCode: 'FULFILLMENT',
            dueAt: new Date(),
            status: 'OPEN',
        }),
    );
    review = await reviewed();
    await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow();
    await assertUnchanged(review);
    await connection.getRepository(adminCtx, AdminIncidentAction).delete(action.id);
    evidence('funds-and-resource-evidence-guards', {
        paymentVariantsRejected: 6,
        refundClaimConfigReservationClaimedIncidentAndOpenActionBlocked: true,
        noResourceOrAuditChanges: true,
    });
});

it('serializes a late real or unknown payment before compensation and rejects the stale reviewed snapshot', async () => {
    const { connection, adminCtx, orders, server } = fixture;
    const cart = await server.app.get(StorefrontCartService).getCart(fixture.ctx);
    await connection.getRepository(adminCtx, StorefrontCart).update(cart.id, { checkoutOrderId: 37 });
    const originalPayment = await connection.getRepository(adminCtx, Payment).findOneByOrFail({ id: 10 });
    const observed: Array<{ paymentState: string; actualMysqlWaiters: number }> = [];
    for (const state of ['Settled', 'Created'] as const) {
        const review = await reviewed();
        const acquired = barrier();
        const finish = barrier();
        const receipt = orders.withOrderMutationTransaction(adminCtx, async tx => {
            await server.app.get(StorefrontCartService).lockForOrder(tx, 37);
            await orders.lockOrderForRefund(tx, 37);
            const payment = await connection.getRepository(tx, Payment).findOneByOrFail({ id: 10 });
            payment.state = state;
            payment.method = 'synthetic-trusted-receipt';
            payment.metadata = {};
            await connection.getRepository(tx, Payment).save(payment);
            acquired.release();
            await finish.promise;
        });
        await acquired.promise;
        const apply = host.execute(adminCtx, { ...review, apply: true }).then(
            value => ({ value, error: null as Error | null }),
            error => ({ value: null, error: error as Error }),
        );
        let waiters = 0;
        try {
            try {
                waiters = await actualMysqlWait('storefront_cart');
            } finally {
                finish.release();
            }
            await receipt;
            const result = await apply;
            expect(result.value).toBeNull();
            expect(result.error?.message).toMatch(/changed|snapshot|fingerprint|version/i);
            expect(
                await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 248 } }),
            ).toBe(0);
        } finally {
            finish.release();
            await receipt;
            await apply;
            await connection.getRepository(adminCtx, Payment).save(originalPayment);
        }
        observed.push({ paymentState: state, actualMysqlWaiters: waiters });
    }
    evidence('late-funds-native-lock', {
        observed,
        blockedTable: 'storefront_cart',
        lockOrder: 'Cart -> Order -> Payment -> Task',
        staleApplyRejected: true,
    });
});

it('rolls back native task incident warehouse and coupon writes if the final receipt fails', async () => {
    const { connection, adminCtx } = fixture;
    const review = await reviewed();
    let writesObserved = false;
    const spy = vi
        .spyOn(host.providers.history, 'createHistoryEntryForOrder')
        .mockImplementationOnce(async ({ ctx: tx }) => {
            expect(await connection.getRepository(tx, Release).countBy({ orderLine: { id: 248 } })).toBe(1);
            expect(
                (await connection.getRepository(tx, ManualDigitalDelivery).findOneByOrFail({ id: 1 })).state,
            ).toBe('CANCELLED');
            expect(
                (await connection.getRepository(tx, CustomerCoupon).findOneByOrFail({ id: 8 })).status,
            ).toBe('EXPIRED');
            expect(
                await connection.getRepository(tx, AdminIncidentEvidence).countBy({ eventType: 'CLOSED' }),
            ).toBe(2);
            expect(
                (
                    await connection.getRepository(tx, StockLevel).findOneByOrFail({
                        productVariantId: fixture.digitalId,
                        stockLocationId: fixture.location.id,
                    })
                ).stockAllocated,
            ).toBe(0);
            writesObserved = true;
            throw new Error('synthetic-final-receipt-failure');
        });
    // Capture native stock calls separately; their presence does not alone prove DB commit.
    const releases = vi.spyOn(host.providers.stockMovements, 'createReleasesForOrderLines');
    try {
        await expect(host.execute(adminCtx, { ...review, apply: true })).rejects.toThrow(
            /synthetic-final-receipt-failure/,
        );
        writesObserved = releases.mock.calls.length > 0;
        expect(writesObserved).toBe(true);
        await assertUnchanged(review);
        expect(
            (await connection.getRepository(adminCtx, ManualDigitalDelivery).findOneByOrFail({ id: 1 }))
                .state,
        ).toBe('MANUAL_REVIEW');
        expect(
            (await connection.getRepository(adminCtx, CustomerCoupon).findOneByOrFail({ id: 8 })).status,
        ).toBe('USED');
        expect(
            await connection.getRepository(adminCtx, AdminIncidentEvidence).countBy({ eventType: 'CLOSED' }),
        ).toBe(0);
    } finally {
        spy.mockRestore();
        releases.mockRestore();
    }
    evidence('whole-native-transaction-rollback', {
        nativeReleasePathInvoked: writesObserved,
        fullCaptureFingerprintRestored: true,
        taskIncidentCouponAndStockRolledBack: true,
    });
});

async function seedTaskOnly(orderId: number, lineId: number) {
    const { connection, adminCtx } = fixture;
    const originalOrder = await connection.getRepository(adminCtx, Order).findOneByOrFail({ id: 37 });
    const order = new Order();
    for (const column of connection.rawConnection.getMetadata(Order).columns)
        column.setEntityValue(order, column.getEntityValue(originalOrder));
    Object.assign(order, { id: orderId, code: `synthetic-task-race-${orderId}`, active: false });
    order.channels = await fixture.orders.getOrderChannels(adminCtx, originalOrder);
    await connection.getRepository(adminCtx, Order).save(order);
    const originalLine = await connection.getRepository(adminCtx, OrderLine).findOneByOrFail({ id: 248 });
    const line = new OrderLine();
    for (const column of connection.rawConnection.getMetadata(OrderLine).columns)
        column.setEntityValue(line, column.getEntityValue(originalLine));
    Object.assign(line, { id: lineId, order: { id: orderId } });
    await connection.getRepository(adminCtx, OrderLine).save(line);
    const payment = new Payment({
        order: { id: orderId },
        amount: 50,
        state: 'Settled',
        method: 'controlled-test-payment-5',
        transactionId: randomUUID(),
        metadata: {},
    });
    payment.metadata = { public: { testPayment: true } };
    await connection.getRepository(adminCtx, Payment).save(payment);
    const task = await connection.getRepository(adminCtx, ManualDigitalDelivery).save(
        new ManualDigitalDelivery({
            state: 'EMAIL_FAILED',
            recipientEmail: 'synthetic-race@example.invalid',
            languageCode: 'en',
            productName: 'Synthetic task-only race',
            sku: 'SYNTHETIC-TASK-RACE',
            quantity: 1,
            expectedAt: new Date(Date.now() - 86400000),
            encryptedPackages: seeded.encryptedPackages,
            attachmentAssetIdsJson: '[]',
            attemptCount: 2,
            lastError: 'Synthetic failed attempt',
            lastDispatchedAt: new Date(Date.now() - 86400000),
            sentAt: null,
            fulfillmentId: null,
            channelId: adminCtx.channelId,
            orderId,
            orderLineId: lineId,
        }),
    );
    await connection.getRepository(adminCtx, ManualDigitalDeliveryEvent).save(
        new ManualDigitalDeliveryEvent({
            deliveryId: task.id,
            type: 'PUBLISHED',
            actorType: 'ADMIN',
            actorId: String(adminCtx.activeUserId),
            note: 'Synthetic published-content evidence',
        }),
    );
    return task;
}

it('keeps a closed test task terminal while a genuinely concurrent queued email success arrives and preserves its evidence once', async () => {
    const { connection, adminCtx, orders, server } = fixture;
    const manual = server.app.get(ManualDigitalDeliveryService);
    const task = await seedTaskOnly(2001, 349);
    const closed = barrier();
    const finish = barrier();
    const closure = orders.withOrderMutationTransaction(adminCtx, async tx => {
        await orders.lockOrderForRefund(tx, 2001);
        const value = await manual.closeHistoricalTestTask(tx, task.id, 'synthetic-closeout-race-2001');
        closed.release();
        await finish.promise;
        return value;
    });
    await closed.promise;
    const callback = manual.recordEmailResult(adminCtx, task.id, true);
    let waiters = 0;
    try {
        waiters = await actualMysqlWait('order');
    } finally {
        finish.release();
    }
    await closure;
    await callback;
    const terminal = await connection
        .getRepository(adminCtx, ManualDigitalDelivery)
        .findOneByOrFail({ id: task.id });
    expect(terminal).toMatchObject({
        state: 'CANCELLED',
        attemptCount: 2,
        sentAt: null,
        fulfillmentId: null,
        encryptedPackages: seeded.encryptedPackages,
    });
    const late = await connection
        .getRepository(adminCtx, ManualDigitalDeliveryEvent)
        .find({ where: { deliveryId: task.id, type: 'EMAIL_SENT' } });
    expect(late).toHaveLength(1);
    expect(late[0].note).toContain('historical-test-late');
    await manual.recordEmailResult(adminCtx, task.id, true);
    expect(
        await connection
            .getRepository(adminCtx, ManualDigitalDeliveryEvent)
            .countBy({ deliveryId: task.id, type: 'EMAIL_SENT' }),
    ).toBe(1);
    expect(await connection.getRepository(adminCtx, FulfillmentLine).countBy({ orderLineId: 349 })).toBe(0);
    evidence('late-email-native-race', {
        actualMysqlOrderWaiters: waiters,
        taskStayedCancelled: true,
        sentAtAndAttemptCountPreserved: true,
        lateSuccessRecordedOnce: true,
        fulfilledQuantity: 0,
    });
});

it('rechecks a scheduler stale snapshot under native locks and cannot reopen or redispatch a closed test task', async () => {
    const { connection, adminCtx, server } = fixture;
    const manual = server.app.get(ManualDigitalDeliveryService);
    const task = await seedTaskOnly(2002, 350);
    const contexts = server.app.get(RequestContextService);
    const originalCreate = contexts.create.bind(contexts);
    const selected = barrier();
    const resume = barrier();
    const contextSpy = vi.spyOn(contexts, 'create').mockImplementation(async options => {
        selected.release();
        await resume.promise;
        return originalCreate(options);
    });
    const eventBus = server.app.get(nativeCore.EventBus);
    const publish = vi.spyOn(eventBus, 'publish');
    const reconciliation = manual.reconcilePending();
    await selected.promise;
    try {
        await manual.closeHistoricalTestTask(adminCtx, task.id, 'synthetic-closeout-race-2002');
    } finally {
        resume.release();
    }
    const result = await reconciliation;
    contextSpy.mockRestore();
    const ready = publish.mock.calls.filter(
        ([event]) =>
            event instanceof ManualDigitalDeliveryReadyEvent && String(event.deliveryId) === String(task.id),
    );
    publish.mockRestore();
    expect(
        (await connection.getRepository(adminCtx, ManualDigitalDelivery).findOneByOrFail({ id: task.id }))
            .state,
    ).toBe('CANCELLED');
    expect(
        await connection
            .getRepository(adminCtx, ManualDigitalDeliveryEvent)
            .countBy({ deliveryId: task.id, type: 'AUTO_RETRY' }),
    ).toBe(0);
    expect(ready).toHaveLength(0);
    expect(result.redispatched).toBe(0);
    evidence('scheduler-stale-snapshot', {
        staleRowSelectedBeforeClosure: true,
        freshTerminalStateObservedAfterClosure: true,
        autoRetryEvents: 0,
        readyEvents: 0,
        schedulerResult: result,
    });
});

it('applies one atomic native closeout, releases only original allocation, expires the coupon, closes incidents truthfully and preserves history', async () => {
    const { connection, adminCtx, digitalId } = fixture;
    const cart = await fixture.server.app.get(StorefrontCartService).getCart(fixture.ctx);
    await connection.getRepository(adminCtx, StorefrontCart).update(cart.id, { checkoutOrderId: 37 });
    const review = await reviewed();
    appliedReview = review;
    const originalOrder = persistedFingerprint(
        Order,
        await connection.getRepository(adminCtx, Order).findOneByOrFail({ id: 37 }),
    );
    const originalLine = persistedFingerprint(
        OrderLine,
        await connection.getRepository(adminCtx, OrderLine).findOneByOrFail({ id: 248 }),
    );
    const originalPayment = persistedFingerprint(
        Payment,
        await connection.getRepository(adminCtx, Payment).findOneByOrFail({ id: 10 }),
    );
    const originalEvents = await connection
        .getRepository(adminCtx, ManualDigitalDeliveryEvent)
        .find({ where: { deliveryId: 1 }, order: { id: 'ASC' } });
    const originalEventHashes = originalEvents.map(row => [String(row.id), compensationFingerprint(row)]);
    const originalRedeemed = await connection
        .getRepository(adminCtx, CouponLedgerEntry)
        .findOneByOrFail({ orderId: 37, eventType: 'REDEEMED' });
    const originalUsedAt = seeded.coupon.usedAt?.toISOString();
    const releaseWritten = barrier();
    const commitAllowed = barrier();
    const nativeRelease = host.providers.stockMovements.createReleasesForOrderLines.bind(
        host.providers.stockMovements,
    );
    const releaseSpy = vi
        .spyOn(host.providers.stockMovements, 'createReleasesForOrderLines')
        .mockImplementationOnce(async (tx, lines) => {
            const value = await nativeRelease(tx, lines);
            releaseWritten.release();
            await commitAllowed.promise;
            return value;
        });
    const initial = host.execute(adminCtx, { ...review, apply: true });
    await releaseWritten.promise;
    const duplicate = host.execute(adminCtx, { ...review, apply: true });
    const { receiver, worker } = isolatedIncidentReceiver();
    const staleAlerts = ['failed', 'overdue'].map(suffix =>
        receiver.upsertIncident(adminCtx, {
            eventType: `commerce.fulfillment.manual_delivery_${suffix}`,
            category: 'FULFILLMENT',
            severity: 'P1',
            sourceType: 'ManualDigitalDelivery',
            sourceId: '1',
            fingerprint: `commerce.fulfillment.manual_delivery_${suffix}:1`,
            title: 'Synthetic old asynchronous failure signal',
            payload: { orderId: '37', channelId: '5', deliveryId: '1' },
        }),
    );
    let initialApplyWaiters = 0;
    let staleIncidentWaiters = 0;
    try {
        initialApplyWaiters = await actualMysqlWait('storefront_cart');
        staleIncidentWaiters = await actualMysqlWait('manual_digital_delivery');
    } finally {
        commitAllowed.release();
    }
    const result = await initial;
    const concurrent = await duplicate;
    const staleResults = await Promise.all(staleAlerts);
    expect(staleResults).toEqual([null, null]);
    expect(worker.dispatch).not.toHaveBeenCalled();
    releaseSpy.mockRestore();
    expect(concurrent.status).toBe('ALREADY_APPLIED');
    expect(concurrent.changedQuantity ?? 0).toBe(0);
    expect(result.status).toBe('APPLIED');
    expect(result.changedQuantity).toBe(1);
    expect(
        persistedFingerprint(
            Order,
            await connection.getRepository(adminCtx, Order).findOneByOrFail({ id: 37 }),
        ),
    ).toBe(originalOrder);
    expect(
        persistedFingerprint(
            OrderLine,
            await connection.getRepository(adminCtx, OrderLine).findOneByOrFail({ id: 248 }),
        ),
    ).toBe(originalLine);
    expect(
        persistedFingerprint(
            Payment,
            await connection.getRepository(adminCtx, Payment).findOneByOrFail({ id: 10 }),
        ),
    ).toBe(originalPayment);
    const terminal = await connection
        .getRepository(adminCtx, ManualDigitalDelivery)
        .findOneByOrFail({ id: 1 });
    expect(terminal).toMatchObject({
        state: 'CANCELLED',
        attemptCount: 7,
        encryptedPackages: seeded.encryptedPackages,
        sentAt: null,
        fulfillmentId: null,
    });
    const events = await connection
        .getRepository(adminCtx, ManualDigitalDeliveryEvent)
        .find({ where: { deliveryId: 1 }, order: { id: 'ASC' } });
    expect(
        events
            .filter(row => originalEvents.some(original => String(original.id) === String(row.id)))
            .map(row => [String(row.id), compensationFingerprint(row)]),
    ).toEqual(originalEventHashes);
    expect(events.find(row => row.type === 'CANCELLED')?.note).toContain('历史测试任务终止');
    expect(events.find(row => row.type === 'CANCELLED')?.note).not.toContain('订单取消');
    const releases = await connection
        .getRepository(adminCtx, Release)
        .find({ where: { orderLine: { id: 248 } } });
    expect(releases).toHaveLength(1);
    expect(String(releases[0].stockLocationId)).toBe(String(fixture.location.id));
    expect(releases[0].quantity).toBe(1);
    const level = await connection
        .getRepository(adminCtx, StockLevel)
        .findOneByOrFail({ productVariantId: digitalId, stockLocationId: fixture.location.id });
    expect(level).toMatchObject({ stockOnHand: 100, stockAllocated: 0 });
    const coupon = await connection.getRepository(adminCtx, CustomerCoupon).findOneByOrFail({ id: 8 });
    expect(coupon.status).toBe('EXPIRED');
    expect(coupon.usedAt?.toISOString()).toBe(originalUsedAt);
    expect(String(coupon.usedOrderId)).toBe('37');
    expect(
        compensationFingerprint(
            await connection
                .getRepository(adminCtx, CouponLedgerEntry)
                .findOneByOrFail({ id: originalRedeemed.id }),
        ),
    ).toBe(compensationFingerprint(originalRedeemed));
    const incidents = await connection
        .getRepository(adminCtx, AdminNotificationDelivery)
        .find({ where: { sourceType: 'ManualDigitalDelivery', sourceId: '1' } });
    expect(incidents).toHaveLength(2);
    for (const incident of incidents) {
        expect(incident).toMatchObject({
            incidentStatus: 'CLOSED',
            deliveryStatus: 'SKIPPED',
            activeFingerprint: null,
        });
        expect(JSON.stringify(incident)).not.toContain('发送已恢复');
        expect(JSON.stringify(incident)).not.toContain('超时已恢复');
        expect(
            await connection
                .getRepository(adminCtx, AdminIncidentEvidence)
                .countBy({ incidentId: Number(incident.id), eventType: 'CLOSED' }),
        ).toBe(1);
        expect(
            await connection
                .getRepository(adminCtx, AdminIncidentEvidence)
                .countBy({ incidentId: Number(incident.id), eventType: 'CREATED' }),
        ).toBe(1);
        expect(
            await connection
                .getRepository(adminCtx, AdminIncidentAction)
                .countBy({ incidentId: Number(incident.id), status: 'COMPLETED' }),
        ).toBe(1);
    }
    await expect(fixture.server.app.get(ManualDigitalDeliveryService).retry(adminCtx, 1)).rejects.toThrow();
    await expect(
        fixture.server.app.get(ManualDigitalDeliveryService).notificationPayload(adminCtx, 1),
    ).rejects.toThrow();
    expect(await connection.getRepository(adminCtx, FulfillmentLine).countBy({ orderLineId: 248 })).toBe(0);
    expect(await connection.getRepository(adminCtx, DigitalReceiptAccess).countBy({ orderId: 37 })).toBe(0);
    evidence('atomic-native-apply', {
        result,
        originalOrderLinePaymentAndElevenEventsPreserved: true,
        encryptedContentPreservedWithoutDecrypt: true,
        nativeReleaseOriginalLocationQuantity: 1,
        stockOnHand: 100,
        stockAllocated: 0,
        expiredCouponNeverAvailable: true,
        originalRedeemedPreserved: true,
        incidentsClosed: 2,
        externalDeliveryOutcome: 'NOT_VERIFIED',
        initialConcurrentStatuses: [result.status, concurrent.status],
        initialConcurrentActualCartLockWaiters: initialApplyWaiters,
        staleIncidentActualTaskLockWaiters: staleIncidentWaiters,
        staleIncidentResults: staleResults,
        staleIncidentExternalDispatchCalls: worker.dispatch.mock.calls.length,
    });
    const current = await host.capture(adminCtx, '37');
    const replay = await host.execute(adminCtx, { ...review, apply: true });
    expect(replay.status).toBe('ALREADY_APPLIED');
    expect(replay.changedQuantity ?? 0).toBe(0);
    expect((await host.capture(adminCtx, '37')).fingerprint).toBe(current.fingerprint);
    const replays = await Promise.all([
        host.execute(adminCtx, { ...review, apply: true }),
        host.execute(adminCtx, { ...review, apply: true }),
    ]);
    expect(replays.map(row => row.status)).toEqual(['ALREADY_APPLIED', 'ALREADY_APPLIED']);
    expect((await host.capture(adminCtx, '37')).fingerprint).toBe(current.fingerprint);
    evidence('native-receipt-replay', {
        statuses: [replay.status, ...replays.map(row => row.status)],
        extraChanges: 0,
        currentCaptureFingerprint: current.fingerprint,
    });
});

it('blocks late native email evidence from being hidden by receipt replay after apply', async () => {
    if (!appliedReview) throw new Error('This direct dependency requires the native apply case');
    const { connection, adminCtx, server } = fixture;
    const manual = server.app.get(ManualDigitalDeliveryService);
    await manual.recordEmailResult(adminCtx, 1, true);
    const terminal = await connection
        .getRepository(adminCtx, ManualDigitalDelivery)
        .findOneByOrFail({ id: 1 });
    expect(terminal).toMatchObject({
        state: 'CANCELLED',
        attemptCount: 7,
        sentAt: null,
        fulfillmentId: null,
    });
    const late = await connection
        .getRepository(adminCtx, ManualDigitalDeliveryEvent)
        .find({ where: { deliveryId: 1, type: 'EMAIL_SENT' } });
    expect(late).toHaveLength(1);
    expect(late[0].note).toContain('historical-test-late');
    const fresh = await host.capture(adminCtx, '37');
    await expect(host.execute(adminCtx, { ...appliedReview, apply: true })).rejects.toThrow(
        /receipt|changed|late|fingerprint|immutable|reconcile/i,
    );
    expect((await host.capture(adminCtx, '37')).fingerprint).toBe(fresh.fingerprint);
    expect(await connection.getRepository(adminCtx, Release).countBy({ orderLine: { id: 248 } })).toBe(1);
    expect((await connection.getRepository(adminCtx, CustomerCoupon).findOneByOrFail({ id: 8 })).status).toBe(
        'EXPIRED',
    );
    evidence('post-closeout-late-email', {
        terminalStateRetained: true,
        lateSuccessEvidenceRetained: true,
        receiptReplayBlockedForReview: true,
        additionalReleases: 0,
        couponStayedExpired: true,
    });
});
