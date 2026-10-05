import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';

import { matchesProcessingCategory, ProcessingSource, summarizeProcessing } from './order-processing-summary';
function order(overrides: Partial<ProcessingSource> = {}): ProcessingSource {
    return {
        id: 'order-1',
        state: 'PaymentSettled',
        active: false,
        placed: true,
        canManage: true,
        canUpdate: true,
        totalWithTax: 1000,
        recipientEmail: 'buyer@example.invalid',
        payments: [
            {
                id: 'payment-1',
                state: 'Settled',
                amount: 1000,
                method: 'fixture-payment',
                refundSettlementMode: 'manual',
                refunds: [],
            },
        ],
        lines: [
            {
                id: 'line-1',
                productName: '账号',
                sku: 'account',
                quantity: 2,
                placedQuantity: 2,
                type: 'digital',
                mode: 'manual_service',
                fulfillments: [],
                task: { id: 'task-1', state: 'WAITING_PROCESSING', quantity: 2 },
            },
        ],
        afterSales: [],
        deliveryException: false,
        ...overrides,
    };
}
describe('canonical order processing summary', () => {
    it('uses the current delivery email ahead of an old task recipient', () => {
        const source = order({ recipientEmail: 'updated@example.invalid' });
        requireFixture(source.lines[0].task).recipientEmail = 'old@example.invalid';
        expect(summarizeProcessing(source).lines[0].recipientEmail).toBe('updated@example.invalid');
    });
    it('explains missing payment-method permission on a price-difference task', () => {
        const source = order({ totalWithTax: 1500, canFinance: true, canArrangePayment: false });
        expect(summarizeProcessing(source).nextAction).toMatchObject({
            code: 'ARRANGE_PAYMENT',
            enabled: false,
            reason: '登记补款需要读取支付方式的权限，请联系店铺负责人',
        });
    });
    it('keeps a confirmed charge with unavailable reserved resources in the actionable exception queue', () => {
        const summary = summarizeProcessing(
            order({ resourceReviewReason: '付款已记录，交付资源不足，请补货后重试' }),
        );
        expect(summary.blockedReason).toContain('交付资源不足');
        expect(summary.nextAction).toMatchObject({
            code: 'RETRY_RESOURCE_DELIVERY',
            enabled: true,
            targetId: 'order-1',
        });
        expect(summary.hasException).toBe(true);
        expect(matchesProcessingCategory(summary, 'EXCEPTIONS', false)).toBe(true);
    });
    it('explains the next action for a paid digital order instead of calling it no logistics', () => {
        const summary = summarizeProcessing(order());
        expect(summary.nextAction).toMatchObject({
            code: 'PREPARE_DELIVERY',
            label: '准备交付',
            enabled: true,
            targetId: 'task-1',
        });
        expect(summary.remainingDigitalQuantity).toBe(2);
        expect(matchesProcessingCategory(summary, 'PENDING', false)).toBe(true);
        expect(matchesProcessingCategory(summary, 'DIGITAL', false)).toBe(true);
        expect(summary.lines[0].claimStatus).toBe('UNKNOWN');
    });
    it('keeps historical collected money visible after cancellation zeroes current quantities and amount', () => {
        const summary = summarizeProcessing(
            order({
                state: 'Cancelled',
                totalWithTax: 0,
                lines: order().lines.map(line => ({ ...line, quantity: 0 })),
            }),
        );
        expect(summary.settledAmount).toBe(1000);
        expect(summary.refundableAmount).toBe(1000);
        expect(summary.fulfillmentStatus).toBe('CANCELLED');
        expect(summary.nextAction?.code).toBe('PROCESS_REFUND');
        expect(summary.remainingDigitalQuantity).toBe(0);
        expect(summary.lines[0].refundableQuantity).toBe(2);
        expect(summary.needsProcessing).toBe(true);
    });
    it('does not describe a simulation as real revenue or refundable money', () => {
        const source = order();
        source.payments[0].method = 'controlled-test-payment-fixture';
        const summary = summarizeProcessing(source);
        expect(summary.paymentStatus).toBe('TEST');
        expect(summary.settledAmount).toBe(0);
        expect(summary.canRefund).toBe(false);
        expect(summary.needsProcessing).toBe(false);
        expect(summary.nextAction).toBeNull();
    });
    it('recognizes historical simulation metadata even when its method lacks the controlled prefix', () => {
        const source = order();
        source.payments[0].isTest = true;
        const summary = summarizeProcessing(source);
        expect(summary.paymentStatus).toBe('TEST');
        expect(summary.settledAmount).toBe(0);
        expect(summary.paymentCapabilities[0].canRefund).toBe(false);
        expect(summary.needsProcessing).toBe(false);
    });
    it('reserves a refunded item only once when cancellation already reduced current quantity', () => {
        const source = order();
        source.lines[0].quantity = 1;
        source.payments[0].refunds = [
            { state: 'Pending', total: 500, lines: [{ orderLineId: 'line-1', quantity: 1 }] },
        ];
        const summary = summarizeProcessing(source);
        expect(summary.lines[0].requiredQuantity).toBe(1);
        expect(summary.remainingDigitalQuantity).toBe(1);
        expect(summary.pendingRefundAmount).toBe(500);
        expect(summary.refundableAmount).toBe(500);
    });
    it('amount compensation preserves item entitlement while a failed item refund releases its reservation', () => {
        const source = order();
        source.payments[0].refunds = [
            { state: 'Settled', total: 100, lines: [] },
            { state: 'Failed', total: 500, lines: [{ orderLineId: 'line-1', quantity: 1 }] },
        ];
        const summary = summarizeProcessing(source);
        expect(summary.remainingDigitalQuantity).toBe(2);
        expect(summary.refundableAmount).toBe(900);
        expect(summary.hasException).toBe(true);
    });
    it('routes a failed refund back to its original request without labelling completed delivery as failed', () => {
        const source = order();
        source.payments[0].refunds = [
            {
                id: 'failed-refund',
                state: 'Failed',
                total: 500,
                lines: [{ orderLineId: 'line-1', quantity: 1 }],
            },
        ];
        source.lines[0].task = { id: 'task-1', state: 'SENT', quantity: 2, readyQuantity: 2 };
        const summary = summarizeProcessing(source);
        expect(summary.nextAction).toMatchObject({
            code: 'RETRY_REFUND',
            targetId: 'failed-refund',
            enabled: true,
        });
        expect(summary.paymentStatus).toBe('REFUND_FAILED');
        expect(summary.fulfillmentStatus).toBe('COMPLETE');
        expect(summary.needsProcessing).toBe(true);
        expect(matchesProcessingCategory(summary, 'AFTER_SALES', false)).toBe(true);
    });
    it('keeps a past failed attempt in history without reopening a fully refunded cancellation', () => {
        const source = order({ state: 'Cancelled', totalWithTax: 0, deliveryException: true });
        source.payments[0].refunds = [
            { id: 'old-failure', state: 'Failed', total: 1000 },
            { id: 'confirmed-return', state: 'Settled', total: 1000 },
        ];
        const summary = summarizeProcessing(source);
        expect(summary.paymentStatus).toBe('REFUNDED');
        expect(summary.hasException).toBe(false);
        expect(summary.needsProcessing).toBe(false);
        expect(summary.nextAction).toBeNull();
    });
    it('keeps full pending refund actionable until the provider confirms it', () => {
        const source = order({ state: 'Cancelled', totalWithTax: 0 });
        source.payments[0].refunds = [{ state: 'Pending', total: 1000, lines: [] }];
        const summary = summarizeProcessing(source);
        expect(summary.refundableAmount).toBe(0);
        expect(summary.needsProcessing).toBe(true);
        expect(matchesProcessingCategory(summary, 'AFTER_SALES', false)).toBe(true);
        expect(summary.paymentStatus).toBe('REFUND_PENDING');
    });
    it('retains owed money even if the payment provider has no executable refund capability', () => {
        const source = order({ state: 'Cancelled', totalWithTax: 0 });
        source.payments[0].refundSettlementMode = 'unsupported';
        const summary = summarizeProcessing(source);
        expect(summary.refundableAmount).toBe(1000);
        expect(summary.canRefund).toBe(false);
        expect(summary.needsProcessing).toBe(true);
    });
    it('keeps a usable digital delivery available while failed notification remains an exception', () => {
        const source = order();
        source.lines[0].task = {
            id: 'task-1',
            state: 'EMAIL_FAILED',
            quantity: 2,
            readyQuantity: 2,
            notificationStatus: 'FAILED',
            claimedQuantity: 0,
        };
        const summary = summarizeProcessing(source);
        expect(summary.lines[0].deliveredQuantity).toBe(2);
        expect(summary.lines[0].claimStatus).toBe('UNCLAIMED');
        expect(summary.lines[0].status).toBe('COMPLETE');
        expect(summary.fulfillmentStatus).toBe('COMPLETE');
        expect(summary.hasException).toBe(true);
        expect(matchesProcessingCategory(summary, 'EXCEPTIONS', false)).toBe(true);
        expect(matchesProcessingCategory(summary, 'DIGITAL', false)).toBe(false);
        expect(summary.nextAction?.code).toBe('RETRY_NOTIFICATION');
        expect(summary.needsProcessing).toBe(true);
    });
    it('uses the shared receipt projection ahead of legacy email task completion', () => {
        const source = order();
        source.lines[0].task = { id: 'task-1', state: 'SENT', quantity: 2 };
        source.lines[0].delivery = { readyQuantity: 1, claimedQuantity: 0, notificationStatus: 'FAILED' };
        const summary = summarizeProcessing(source);
        expect(summary.lines[0].deliveredQuantity).toBe(1);
        expect(summary.lines[0].claimStatus).toBe('UNCLAIMED');
        expect(summary.remainingDigitalQuantity).toBe(1);
        expect(summary.nextAction).toMatchObject({ code: 'PREPARE_DELIVERY', targetId: 'task-1' });
    });
    it('prepares newly purchased manual units before resending an older failed notification', () => {
        const source = order();
        source.lines[0].task = {
            id: 'task-1',
            state: 'EMAIL_FAILED',
            quantity: 1,
            readyQuantity: 1,
            notificationStatus: 'FAILED',
        };
        const summary = summarizeProcessing(source);
        expect(summary.remainingDigitalQuantity).toBe(1);
        expect(summary.hasException).toBe(true);
        expect(summary.nextAction).toMatchObject({
            code: 'PREPARE_DELIVERY',
            enabled: true,
            targetId: 'task-1',
        });
        source.lines[0].task.quantity = 2;
        source.lines[0].task.readyQuantity = 2;
        expect(summarizeProcessing(source).nextAction?.code).toBe('RETRY_NOTIFICATION');
    });
    it('does not mislabel a payment-blocked file as a missing-file configuration error', () => {
        const source = order();
        source.payments[0].amount = 500;
        source.lines[0].mode = 'file_download';
        source.lines[0].task = undefined;
        source.lines[0].fileReady = false;
        const summary = summarizeProcessing(source);
        expect(summary.lines[0].status).toBe('BLOCKED');
        expect(summary.hasException).toBe(false);
        expect(summary.nextAction?.code).toBe('ARRANGE_PAYMENT');
    });
    it('distinguishes partial customer receipt and retains the history after cancellation', () => {
        const source = order();
        source.lines[0].task = {
            id: 'task-1',
            state: 'SENT',
            quantity: 2,
            readyQuantity: 2,
            claimedQuantity: 1,
        };
        const partial = summarizeProcessing(source).lines[0];
        expect(partial.claimStatus).toBe('PARTIAL');
        expect(partial.claimedQuantity).toBe(1);
        source.state = 'Cancelled';
        const cancelled = summarizeProcessing(source).lines[0];
        expect(cancelled.claimStatus).toBe('CLAIMED');
        expect(cancelled.claimedQuantity).toBe(1);
        expect(cancelled.requiredQuantity).toBe(0);
    });
    it('created physical fulfillment is not complete and mixed fulfillment stays separate', () => {
        const source = order();
        source.lines.push({
            id: 'line-2',
            productName: '实物',
            sku: 'physical',
            quantity: 1,
            placedQuantity: 1,
            type: 'physical',
            mode: 'manual_service',
            fulfillments: [{ state: 'Created', quantity: 1 }],
        });
        const summary = summarizeProcessing(source);
        expect(summary.kind).toBe('MIXED');
        expect(summary.lines[1].deliveredQuantity).toBe(0);
        expect(summary.lines[1].status).toBe('WAITING');
        expect(summary.lines[1].pendingDispatchQuantity).toBe(1);
        expect(summary.remainingPhysicalQuantity).toBe(1);
        expect(summary.remainingPhysicalLines).toEqual([]);
        expect(summary.remainingDigitalQuantity).toBe(2);
    });
    it('does not permit a management channel to operate another store order', () => {
        const summary = summarizeProcessing(order({ canManage: false }));
        expect(summary.nextAction?.enabled).toBe(false);
        expect(summary.canRefund).toBe(false);
        expect(summary.blockedReason).toContain('所属经营店铺');
    });
    it('a missing digital file is still an exception even after a legacy order became Delivered', () => {
        const source = order({ state: 'Delivered' });
        source.lines[0] = { ...source.lines[0], mode: 'file_download', task: undefined, fileReady: false };
        const summary = summarizeProcessing(source);
        expect(summary.nextAction?.code).toBe('CONFIGURE_FILE');
        expect(summary.fulfillmentStatus).toBe('EXCEPTION');
    });
    it('returns modification work even when old fulfillment state would suppress a reminder', () => {
        const summary = summarizeProcessing(order({ state: 'Modifying' }));
        expect(summary.nextAction?.code).toBe('FINISH_MODIFICATION');
        expect(summary.needsProcessing).toBe(true);
    });
    it('read-only permissions do not change the actual delivery result', () => {
        const source = order({ canUpdate: false, canManage: false });
        requireFixture(source.lines[0].task).state = 'SENT';
        const summary = summarizeProcessing(source);
        expect(summary.fulfillmentStatus).toBe('COMPLETE');
        expect(matchesProcessingCategory(summary, 'DELIVERED', false)).toBe(true);
        expect(summary.canRefund).toBe(false);
    });
    it('continues the same created package instead of allocating another one', () => {
        const source = order();
        source.lines = [
            {
                ...source.lines[0],
                type: 'physical',
                task: undefined,
                fulfillments: [{ id: 'package-1', state: 'Created', quantity: 2 }],
            },
        ];
        const summary = summarizeProcessing(source);
        expect(summary.nextAction).toMatchObject({ code: 'DISPATCH_PHYSICAL', targetId: 'package-1' });
        expect(summary.needsProcessing).toBe(true);
        expect(summary.remainingPhysicalLines).toEqual([]);
    });
    it('cancelled orders keep authorized funds as an explicit cancellation task', () => {
        const source = order({ state: 'Cancelled', totalWithTax: 0 });
        source.payments[0].state = 'Authorized';
        source.payments[0].canCancel = true;
        const summary = summarizeProcessing(source);
        expect(summary.nextAction).toMatchObject({ code: 'CANCEL_AUTHORIZATION', enabled: true });
        expect(summary.needsProcessing).toBe(true);
        expect(summary.refundableAmount).toBe(0);
        expect(matchesProcessingCategory(summary, 'AFTER_SALES', false)).toBe(true);
    });
    it('does not open file access against partially settled funds', () => {
        const source = order();
        source.payments[0].amount = 500;
        source.lines[0] = { ...source.lines[0], task: undefined, mode: 'file_download', fileReady: true };
        const summary = summarizeProcessing(source);
        expect(summary.lines[0].deliveredQuantity).toBe(0);
        expect(summary.nextAction?.code).toBe('ARRANGE_PAYMENT');
    });
    it('uses original shipping budget and reserves pending refunds without offering digital shipping', () => {
        const source = order({ shippingWithTax: 0, state: 'Cancelled', totalWithTax: 0 });
        source.lines[0].type = 'physical';
        source.payments[0].shippingBudget = 200;
        source.payments[0].refunds = [{ state: 'Pending', total: 50, shipping: 50 }];
        expect(summarizeProcessing(source).refundableShippingAmount).toBe(150);
        source.lines[0].type = 'digital';
        expect(summarizeProcessing(source).refundableShippingAmount).toBe(0);
    });
    it('never increases refundable shipping based on a newer unpaid modification', () => {
        const source = order({ shippingWithTax: 300 });
        source.lines[0].type = 'physical';
        source.payments[0].shippingBudget = 200;
        expect(summarizeProcessing(source).refundableShippingAmount).toBe(200);
        source.payments[0].shippingBudget = 0;
        expect(summarizeProcessing(source).refundableShippingAmount).toBe(0);
    });
    it('preserves authorized physical shipping while digital units still await real settlement', () => {
        const source = order();
        source.payments[0].state = 'Authorized';
        source.lines[0].type = 'physical';
        let summary = summarizeProcessing(source);
        expect(summary.nextAction).toMatchObject({ code: 'SHIP_PHYSICAL', enabled: true });
        expect(summary.lines[0].status).toBe('WAITING');
        source.lines.push({ ...order().lines[0], id: 'digital-2' });
        summary = summarizeProcessing(source);
        expect(summary.nextAction?.code).toBe('ARRANGE_PAYMENT');
        expect(summary.lines[0].status).toBe('WAITING');
        expect(summary.lines[1].status).toBe('BLOCKED');
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
