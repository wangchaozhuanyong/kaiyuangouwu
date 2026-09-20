import { Payment } from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { describe, expect, it, vi } from 'vitest';

import { StoreUsdtManualRefund } from './entities/store-usdt-manual-refund.entity';
import { StoreUsdtReconciliationAction } from './entities/store-usdt-reconciliation-action.entity';
import { StorefrontUsdtPaymentIntent } from './entities/storefront-usdt-payment-intent.entity';
import { PaymentReconciliationService } from './payment-reconciliation.service';

const now = new Date('2026-09-21T02:20:00.000Z');

function harness(input: {
    settledIntents: StorefrontUsdtPaymentIntent[];
    resolvedIntents: StorefrontUsdtPaymentIntent[];
    payments: Payment[];
    linkedIntents: StorefrontUsdtPaymentIntent[];
    refunds: StoreUsdtManualRefund[];
    manualReviews: StorefrontUsdtPaymentIntent[];
    actions: StoreUsdtReconciliationAction[];
}) {
    const intentRepository = {
        find: vi.fn(({ where }) => {
            if (where?.paymentId) return Promise.resolve(input.linkedIntents);
            if (where?.status === 'SETTLED') return Promise.resolve(input.settledIntents);
            if (where?.status === 'RESOLVED') return Promise.resolve(input.resolvedIntents);
            if (where?.status === 'MANUAL_REVIEW') return Promise.resolve(input.manualReviews);
            throw new Error('Unexpected intent query');
        }),
    };
    const paymentRepository = { find: vi.fn().mockResolvedValue(input.payments) };
    const refundRepository = { find: vi.fn().mockResolvedValue(input.refunds) };
    const actionRepository = { find: vi.fn().mockResolvedValue(input.actions) };
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const service = new PaymentReconciliationService(
        {
            getRepository: vi.fn((_ctx, target) => {
                if (target === StorefrontUsdtPaymentIntent) return intentRepository;
                if (target === Payment) return paymentRepository;
                if (target === StoreUsdtManualRefund) return refundRepository;
                if (target === StoreUsdtReconciliationAction) return actionRepository;
                throw new Error(`Unexpected repository ${String(target)}`);
            }),
        } as never,
        eventBus as never,
    );
    return { eventBus, service };
}

function matchedPayment() {
    const order = { id: 'order-1' } as never;
    const payment = new Payment({
        id: 'payment-1',
        method: 'usdt-trc20',
        state: 'Settled',
        transactionId: `tron:${'a'.repeat(64)}`,
        order,
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
    });
    const intent = new StorefrontUsdtPaymentIntent({
        id: 'intent-1',
        orderId: 'order-1',
        paymentId: payment.id,
        payment,
        status: 'SETTLED',
        transactionId: 'a'.repeat(64),
        createdAt: payment.createdAt,
    });
    return { intent, payment };
}

describe('payment daily reconciliation', () => {
    it('closes the daily incident when receipts and payments match', async () => {
        const { intent, payment } = matchedPayment();
        const { eventBus, service } = harness({
            settledIntents: [intent],
            resolvedIntents: [],
            payments: [payment],
            linkedIntents: [intent],
            refunds: [],
            manualReviews: [],
            actions: [],
        });
        const result = await service.reconcile({} as never, now);
        expect(result).toMatchObject({ healthy: true, manualReviewCount: 0, truncated: false });
        const event = eventBus.publish.mock.calls[0][0] as AdminNotificationRequestedEvent;
        expect(event).toBeInstanceOf(AdminNotificationRequestedEvent);
        expect(event.notification).toMatchObject({ mode: 'INCIDENT_RESOLVED', severity: 'P1' });
    });

    it('reports broken links, invalid refunds and overdue manual review as P0', async () => {
        const { intent, payment } = matchedPayment();
        payment.transactionId = 'tron:wrong';
        const manualReview = new StorefrontUsdtPaymentIntent({
            id: 'manual-1',
            status: 'MANUAL_REVIEW',
            createdAt: new Date('2026-09-19T00:00:00.000Z'),
        });
        const invalidResolution = new StorefrontUsdtPaymentIntent({
            id: 'resolved-without-evidence',
            channelId: 'channel-1',
            orderId: 'order-2',
            status: 'RESOLVED',
            activeMatchKey: null,
            resolutionActionId: null,
            resolvedAt: new Date('2026-09-20T01:30:00.000Z'),
            resolvedByUserId: 'admin-1',
            createdAt: new Date('2026-09-20T01:00:00.000Z'),
        });
        const refund = new StoreUsdtManualRefund({
            id: 'refund-audit-1',
            paymentId: payment.id,
            payment,
            orderId: 'order-1',
            order: payment.order,
            refund: { id: 'refund-1', state: 'Failed', paymentId: payment.id },
            transactionId: 'b'.repeat(64),
            createdAt: new Date('2026-09-20T01:00:00.000Z'),
        });
        const { eventBus, service } = harness({
            settledIntents: [intent],
            resolvedIntents: [invalidResolution],
            payments: [payment],
            linkedIntents: [],
            refunds: [refund],
            manualReviews: [manualReview],
            actions: [],
        });
        const result = await service.reconcile({} as never, now);
        expect(result).toMatchObject({
            healthy: false,
            unsettledIntentIds: ['intent-1'],
            unlinkedPaymentIds: ['payment-1'],
            invalidRefundIds: ['refund-audit-1'],
            invalidResolutionIntentIds: ['resolved-without-evidence'],
            overdueManualReviewIds: ['manual-1'],
        });
        const event = eventBus.publish.mock.calls[0][0] as AdminNotificationRequestedEvent;
        expect(event.notification).toMatchObject({ mode: 'INCIDENT_FIRING', severity: 'P0' });
    });
});
