import { describe, expect, it, vi } from 'vitest';

import { createOfflinePaymentProof } from '../offline-payment-proof';

import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';
const ctx = { channelId: 'shop-a' } as any;
function harness(purpose?: 'REFUND_ONLY') {
    const order = { id: 'order-a', currencyCode: 'MYR' };
    const arrived = Date.now() - 3 * 86_400_000;
    const receipt = {
        channelId: 'shop-a',
        orderId: order.id,
        paymentId: 'payment-a',
        amount: 2000,
        currencyCode: order.currencyCode,
        transactionId: 'BANK-A',
        evidenceReference: 'synthetic://bank-a',
        receivedAt: arrived,
        verifiedBy: 'admin-a',
        idempotencyKey: 'confirm-a',
        purpose,
    };
    const payment = {
        id: 'payment-a',
        method: 'merchant-offline-payment',
        amount: 2000,
        transactionId: 'BANK-A',
        metadata: {
            offlineManual: { kind: 'OFFLINE_MANUAL', receiptProof: createOfflinePaymentProof(receipt) },
            ...(purpose ? { manualReview: { required: true } } : {}),
        },
    };
    const service = new StoreCouponLifecycleService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
    vi.spyOn(service as any, 'loadOrder').mockResolvedValue(order);
    vi.spyOn(service as any, 'hasCouponEntitlements').mockResolvedValue(true);
    const issues = vi
        .spyOn(service as any, 'paymentCouponIssues')
        .mockImplementation((_ctx: unknown, _order: unknown, paidAt: unknown) =>
            Promise.resolve(
                (paidAt as Date).getTime() >= Date.now() - 86_400_000
                    ? [{ reason: 'Coupon was expired at arrival' }]
                    : [],
            ),
        );
    return { service, payment, receipt, issues };
}
describe('coupon validation for protected offline receipts', () => {
    it('uses actual bank arrival before expiry, even when the administrator confirms days later', async () => {
        const test = harness();
        expect(
            await (test.service as any).validateConfirmedPayment(
                ctx,
                'order-a',
                test.payment,
                'Settled',
                'handler',
            ),
        ).toBeUndefined();
        expect(test.issues).toHaveBeenCalledWith(ctx, expect.anything(), new Date(test.receipt.receivedAt));
        expect(test.payment.metadata).toMatchObject({
            couponPaymentValidation: {
                paidAt: new Date(test.receipt.receivedAt).toISOString(),
                source: 'VERIFIED_OFFLINE_RECEIPT',
            },
        });
    });
    it('requires signed ownership and amount instead of trusting public or manual input', async () => {
        const test = harness();
        test.payment.metadata.offlineManual.receiptProof = createOfflinePaymentProof({
            ...test.receipt,
            amount: 1,
        });
        expect(
            await (test.service as any).validateConfirmedPayment(
                ctx,
                'order-a',
                test.payment,
                'Settled',
                'handler',
            ),
        ).toContain('无法核实');
        expect(test.issues).not.toHaveBeenCalled();
    });
    it('recognizes a refund-only receipt without approving or redeeming the business coupon', async () => {
        const test = harness('REFUND_ONLY');
        expect(
            await (test.service as any).validateConfirmedPayment(
                ctx,
                'order-a',
                test.payment,
                'Settled',
                'handler',
            ),
        ).toBeUndefined();
        expect(test.issues).not.toHaveBeenCalled();
        expect(test.payment.metadata).not.toHaveProperty('couponPaymentValidation');
        expect(test.payment.metadata.manualReview?.required).toBe(true);
    });
});
