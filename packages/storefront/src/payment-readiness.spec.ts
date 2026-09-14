import { describe, expect, it } from 'vitest';

import {
    isPaymentCompletedOrderState,
    isTestPaymentMethod,
    paymentAvailability,
    resolveCurrentCheckoutOrder,
} from './payment-readiness';
import { Order, PaymentMethod } from './types';

describe('current checkout order', () => {
    const stale = { id: '44', payments: [] } as unknown as Order;
    const partial = {
        ...stale,
        payments: [{ id: '28', method: 'referral-balance', amount: 50, state: 'Settled' }],
    } as Order;

    it('retains partial payment returned after the cart snapshot', () => {
        expect(resolveCurrentCheckoutOrder(stale, partial)).toBe(partial);
    });
    it('uses a new cart checkout rather than another order response', () => {
        const next = { ...stale, id: '45' };
        expect(resolveCurrentCheckoutOrder(next, partial)).toBe(next);
    });
    it('supports the initial cart and standalone payment responses', () => {
        expect(resolveCurrentCheckoutOrder(stale, null)).toBe(stale);
        expect(resolveCurrentCheckoutOrder(null, partial)).toBe(partial);
        expect(resolveCurrentCheckoutOrder(undefined, null)).toBeNull();
    });
});

describe('completed payment states', () => {
    it.each([
        'PaymentAuthorized',
        'PaymentSettled',
        'TestPaymentSettled',
        'PartiallyShipped',
        'Shipped',
        'PartiallyDelivered',
        'Delivered',
    ])('recognizes %s', state => {
        expect(isPaymentCompletedOrderState(state)).toBe(true);
    });
    it.each(['Created', 'AddingItems', 'ArrangingPayment', 'Cancelled', 'Modifying', ''])(
        'does not complete %s',
        state => {
            expect(isPaymentCompletedOrderState(state)).toBe(false);
        },
    );
});

function method(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
    return {
        id: 'payment-1',
        code: 'card-payment',
        name: 'Card payment',
        description: 'Visa and Mastercard',
        isEligible: true,
        eligibilityMessage: null,
        ...overrides,
    };
}

describe('paymentAvailability', () => {
    it('keeps real handlers alongside legacy test handlers in development', () => {
        const result = paymentAvailability(
            [method(), method({ id: 'test', code: '测试支付', name: '测试支付' })],
            { allowTestMethods: true },
        );

        expect(result.status).toBe('READY');
        expect(result.methods.map(item => item.id)).toEqual(['payment-1', 'test']);
    });

    it('shows an eligible controlled test method in a production build alongside real payments', () => {
        const test = method({ id: 'controlled', code: 'controlled-test-payment-2', name: '测试支付' });
        const result = paymentAvailability([method(), test], { allowTestMethods: false });
        expect(result.methods.map(item => item.id)).toEqual(['payment-1', 'controlled']);
    });

    it('hides controlled test payments for accounts rejected by the server in every build', () => {
        const test = method({ code: 'controlled-test-payment-2', isEligible: false });
        for (const allowTestMethods of [true, false]) {
            expect(paymentAvailability([test], { allowTestMethods }).methods).toEqual([]);
        }
    });

    it('keeps real handlers in production and excludes test handlers', () => {
        const result = paymentAvailability(
            [method(), method({ id: 'dummy', code: 'dummy-payment-handler', name: 'Dummy' })],
            { allowTestMethods: false },
        );

        expect(result.status).toBe('READY');
        expect(result.methods.map(item => item.id)).toEqual(['payment-1']);
    });

    it('reports a channel without a real provider as not configured', () => {
        const result = paymentAvailability([method({ code: '测试支付', name: '测试支付' })], {
            allowTestMethods: false,
        });

        expect(result.status).toBe('NOT_CONFIGURED');
        expect(result.methods).toEqual([]);
    });

    it('preserves provider eligibility errors for the active order', () => {
        const result = paymentAvailability(
            [method({ isEligible: false, eligibilityMessage: 'Minimum order total is MYR 10' })],
            { allowTestMethods: false },
        );

        expect(result.status).toBe('ORDER_INELIGIBLE');
        expect(result.eligibleMethods).toEqual([]);
        expect(result.methods[0].eligibilityMessage).toContain('MYR 10');
    });
});

describe('isTestPaymentMethod', () => {
    it('detects common placeholder payment handlers without matching normal provider names', () => {
        expect(isTestPaymentMethod(method({ code: 'dummy-payment-handler' }))).toBe(true);
        expect(isTestPaymentMethod(method({ code: 'tng-ewallet', name: 'Touch n Go eWallet' }))).toBe(false);
    });
});
