import { Allocation, Order, OrderLine, Payment, StockLevel } from '@vendure/core';
import { createHash, randomUUID } from 'node:crypto';

import { AdminIncidentAction } from '../../../operations-dashboard-plugin/src/entities/admin-incident-action.entity';
import { AdminIncidentEvidence } from '../../../operations-dashboard-plugin/src/entities/admin-incident-evidence.entity';
import { AdminNotificationDelivery } from '../../../operations-dashboard-plugin/src/entities/admin-notification-delivery.entity';
import { CouponLedgerEntry } from '../../../store-management-plugin/src/entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../../../store-management-plugin/src/entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../../../store-management-plugin/src/entities/customer-coupon.entity';
import { AutoCardCipherService } from '../../src/auto-card-cipher.service';
import { DigitalVariantConfig } from '../../src/entities/digital-product.entity';
import { ManualDigitalDeliveryEvent } from '../../src/entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from '../../src/entities/manual-digital-delivery.entity';

import { initializeOrder37Fixture } from './native-fixture';

export type Order37Fixture = Awaited<ReturnType<typeof initializeOrder37Fixture>>;

/** Production shape only; all payloads and payment identifiers are local synthetic data. */
export async function seedHistoricalOrder37(fixture: Order37Fixture) {
    const {
        connection,
        ctx,
        adminCtx,
        orders,
        customer,
        digitalId,
        coupons,
        couponCampaignId,
        location,
        server,
    } = fixture;
    const shell = await orders.create(ctx, customer.user?.id);
    await connection.getRepository(ctx, Order).update(shell.id, { active: false });
    const historical = new Order();
    for (const column of connection.rawConnection.getMetadata(Order).columns) {
        column.setEntityValue(historical, column.getEntityValue(shell));
    }
    Object.assign(historical, { id: 37, code: 'synthetic-order37-historical', active: true });
    historical.channels = await orders.getOrderChannels(ctx, shell);
    await connection.getRepository(ctx, Order).save(historical);
    const added = await orders.addItemToOrder(ctx, 37, digitalId, 1);
    if ('errorCode' in added) throw new Error(added.message);
    const line = await connection
        .getRepository(ctx, OrderLine)
        .findOneByOrFail({ order: { id: 37 }, productVariantId: digitalId });
    await connection.getRepository(ctx, OrderLine).update(line.id, {
        id: 248,
        orderPlacedQuantity: 1,
        customFields: {
            fulfillmentTypeSnapshot: 'digital',
            digitalDeliveryModeSnapshot: 'manual_service',
            manualDeliverySlaMinutesSnapshot: 1440,
        },
    });
    const granted = await connection.withTransaction(adminCtx, tx =>
        coupons.grant(tx, couponCampaignId, customer.id),
    );
    const grantedRow = await connection
        .getRepository(adminCtx, CustomerCoupon)
        .findOneByOrFail({ id: granted.id });
    await connection
        .getRepository(adminCtx, CustomerCoupon)
        .save(new CustomerCoupon({ ...grantedRow, id: 8 }));
    await orders.withOrderMutationTransaction(ctx, tx => coupons.apply(tx, 8));
    const usedAt = new Date(Date.now() - 7 * 86400000);
    await connection.getRepository(ctx, CustomerCoupon).update(8, {
        status: 'USED',
        version: 5,
        usedOrderId: 37,
        usedAt,
        lockedOrderId: 37,
        lockExpiresAt: null,
        validFrom: new Date(Date.now() - 8 * 86400000),
        validUntil: new Date(Date.now() - 86400000),
    });
    await connection
        .getRepository(ctx, CouponOrderAllocation)
        .update({ orderId: 37, customerCouponId: 8 }, { status: 'USED', usedAt });
    const coupon = await connection.getRepository(ctx, CustomerCoupon).findOneByOrFail({ id: 8 });
    await connection.getRepository(ctx, CouponLedgerEntry).save(
        new CouponLedgerEntry({
            channelId: ctx.channelId,
            customerCouponId: 8,
            promotionId: coupon.promotionId,
            customerId: customer.id,
            orderId: 37,
            eventType: 'REDEEMED',
            actorType: 'SYSTEM',
            idempotencyKey: 'SYNTHETIC-ORDER37-ORIGINAL-REDEEMED',
            discountAmount: 10,
            note: 'Synthetic original historical redemption',
            metadata: { syntheticHistoricalFixture: true },
        }),
    );
    // Present-day checkout must not create fresh warehouse allocations for digital orders.
    // Seed the recorded legacy movement and counter; only the native closeout RELEASE is executed.
    await connection.getRepository(adminCtx, Allocation).save(
        new Allocation({
            id: 884,
            orderLine: { id: 248 },
            productVariant: { id: digitalId },
            stockLocation: location,
            quantity: 1,
        }),
    );
    await connection
        .getRepository(adminCtx, StockLevel)
        .update(
            { productVariantId: digitalId, stockLocationId: location.id },
            { stockOnHand: 100, stockAllocated: 1 },
        );
    const payment = await connection.getRepository(ctx, Payment).save(
        new Payment({
            id: 10,
            order: { id: 37 },
            amount: 50,
            method: 'controlled-test-payment-5',
            state: 'Settled',
            transactionId: `synthetic-order37-${randomUUID()}`,
            metadata: {},
        }),
    );
    payment.metadata = { public: { testPayment: true } };
    await connection.getRepository(ctx, Payment).save(payment);
    await connection.getRepository(ctx, Order).update(37, {
        state: 'Modifying',
        active: false,
        orderPlacedAt: new Date(Date.now() - 7 * 86400000),
    });
    // Synthetic payload only. Tests retain and hash ciphertext; closeout must never decrypt it.
    const encryptedPackages = server.app.get(AutoCardCipherService).encrypt({
        payload: JSON.stringify([
            { fields: [], note: 'Synthetic disposable test sample', attachmentAssetIds: [] },
        ]),
    });
    const task = await connection.getRepository(adminCtx, ManualDigitalDelivery).save(
        new ManualDigitalDelivery({
            id: 1,
            state: 'MANUAL_REVIEW',
            recipientEmail: 'synthetic-order37@example.invalid',
            languageCode: 'en',
            productName: 'Synthetic order37 historical digital manual service',
            sku: 'SYNTHETIC-ORDER37-DIGITAL',
            quantity: 1,
            expectedAt: new Date(Date.now() - 6 * 86400000),
            encryptedPackages,
            attachmentAssetIdsJson: '[]',
            attemptCount: 7,
            lastError: 'Synthetic recorded send failure',
            lastDispatchedAt: new Date(Date.now() - 86400000),
            sentAt: null,
            fulfillmentId: null,
            channelId: ctx.channelId,
            orderId: 37,
            orderLineId: 248,
        }),
    );
    const events: Array<ManualDigitalDeliveryEvent['type']> = [
        'TASK_CREATED',
        'DRAFT_SAVED',
        'PUBLISHED',
        'EMAIL_FAILED',
        'EMAIL_FAILED',
        'EMAIL_FAILED',
        'EMAIL_FAILED',
        'MANUAL_REVIEW',
        'MANUAL_REVIEW',
        'MANUAL_RETRY',
        'MANUAL_REVIEW',
    ];
    for (const [index, type] of events.entries()) {
        await connection.getRepository(adminCtx, ManualDigitalDeliveryEvent).save(
            new ManualDigitalDeliveryEvent({
                type,
                actorType: ['DRAFT_SAVED', 'PUBLISHED', 'MANUAL_RETRY'].includes(type) ? 'ADMIN' : 'SYSTEM',
                actorId: null,
                note: `Synthetic historical event ${index + 1}`,
                deliveryId: 1,
                createdAt: new Date(Date.now() - (20 - index) * 60000),
            }),
        );
    }
    const incidents: AdminNotificationDelivery[] = [];
    for (const suffix of ['failed', 'overdue']) {
        const fingerprint = `commerce.fulfillment.manual_delivery_${suffix}:1`;
        const occurredAt = new Date(Date.now() - 86400000);
        const incident = await connection.getRepository(adminCtx, AdminNotificationDelivery).save(
            new AdminNotificationDelivery({
                eventType: `commerce.fulfillment.manual_delivery_${suffix}`,
                category: 'FULFILLMENT',
                ownerDepartmentCode: 'FULFILLMENT',
                collaboratorDepartmentCodes: ['TECH'],
                actionHint: 'Synthetic test review',
                severity: 'P1',
                mode: 'INCIDENT',
                eventState: 'FIRING',
                incidentStatus: 'OPEN',
                actionRequired: true,
                sourceType: 'ManualDigitalDelivery',
                sourceId: '1',
                fingerprint,
                activeFingerprint: fingerprint,
                title: 'Synthetic historical manual-delivery incident',
                payload: { orderId: '37', channelId: '5', deliveryId: '1' },
                firstOccurredAt: occurredAt,
                lastOccurredAt: occurredAt,
                availableAt: occurredAt,
                deliveryStatus: 'RETRY',
                deliveryAction: 'SEND',
                priority: 10,
                silent: true,
            }),
        );
        const eventId = randomUUID();
        await connection.getRepository(adminCtx, AdminIncidentEvidence).save(
            new AdminIncidentEvidence({
                incidentId: Number(incident.id),
                eventId,
                eventType: 'CREATED',
                actorType: 'SYSTEM',
                actorUserId: null,
                summary: 'Synthetic original incident evidence',
                evidence: { localSynthetic: true, fingerprint },
                occurredAt,
                evidenceHash: createHash('sha256').update(eventId).digest('hex'),
            }),
        );
        await connection.getRepository(adminCtx, AdminIncidentAction).save(
            new AdminIncidentAction({
                incidentId: Number(incident.id),
                title: 'Synthetic previously completed investigation',
                ownerDepartmentCode: 'FULFILLMENT',
                dueAt: occurredAt,
                status: 'COMPLETED',
                completedAt: occurredAt,
                completedByUserId: String(adminCtx.activeUserId),
                completionNote: 'Synthetic original completion',
            }),
        );
        incidents.push(incident);
    }
    // Current product APIs materialize a digital config. Historical order 37 predates that
    // configuration, so remove only this newly generated synthetic fixture config.
    await connection
        .getRepository(adminCtx, DigitalVariantConfig)
        .delete({ channelId: adminCtx.channelId, productVariantId: digitalId });
    return { payment, task, coupon, locationId: location.id, encryptedPackages, incidents };
}
