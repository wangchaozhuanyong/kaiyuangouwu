import { describe, expect, it, vi } from 'vitest';

import { OrderService } from './order.service';

// Preview must fail before handlers, manual receipts or discount side effects execute.
describe('shared checkout payment validation', () => {
    it.each(['handler', 'manual'] as const)(
        'honors validator errors before %s payment side effects',
        async source => {
            const order = { id: 'order', state: 'ArrangingPayment', totalWithTax: 1000 };
            const payments = [{ method: 'controlled-test-payment-synthetic', state: 'Cancelled' }];
            const paymentService = { createPayment: vi.fn(), createManualPayment: vi.fn() };
            const revalidateCouponCodesForOrder = vi.fn();
            const service = Object.assign(Object.create(OrderService.prototype), {
                checkoutValidators: new Map(),
                assertInTransaction: vi.fn(),
                lockOrderForRefund: vi.fn(),
                getOrderOrThrow: vi.fn().mockResolvedValue(order),
                getOrderPayments: vi.fn().mockResolvedValue(payments),
                canAddPaymentToOrder: vi.fn().mockReturnValue(true),
                paymentService,
                revalidateCouponCodesForOrder,
            }) as OrderService;
            const validate = vi.fn().mockResolvedValue({ error: '公开预览仅允许模拟付款' });
            service.registerCheckoutValidator('preview', validate);
            const result =
                source === 'manual'
                    ? await service.addManualPaymentToOrder({} as any, {
                          orderId: order.id,
                          method: 'real',
                          transactionId: 'manual',
                          metadata: {},
                      })
                    : await service.addPaymentToOrder({} as any, order.id, { method: 'real', metadata: {} });
            expect(result).toMatchObject({
                __typename: source === 'manual' ? 'ManualPaymentStateError' : 'PaymentFailedError',
                ...(source === 'manual'
                    ? { message: expect.stringContaining('模拟付款') }
                    : { paymentErrorMessage: expect.stringContaining('模拟付款') }),
            });
            expect(validate.mock.calls[0][3]).toBe(source === 'manual' ? 'manual' : undefined);
            expect(validate.mock.calls[0][1]).toHaveProperty('payments', payments);
            expect(paymentService.createPayment).not.toHaveBeenCalled();
            expect(paymentService.createManualPayment).not.toHaveBeenCalled();
            expect(revalidateCouponCodesForOrder).not.toHaveBeenCalled();
        },
    );
});
