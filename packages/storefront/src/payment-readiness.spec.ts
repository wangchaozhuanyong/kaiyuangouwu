import { describe, expect, it } from 'vitest';

import { isTestPaymentMethod, paymentAvailability } from './payment-readiness';
import { PaymentMethod } from './types';

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
    it('keeps test handlers in development and hides real handlers', () => {
        const result = paymentAvailability(
            [method(), method({ id: 'test', code: '测试支付', name: '测试支付' })],
            { allowTestMethods: true },
        );

        expect(result.status).toBe('READY');
        expect(result.methods.map(item => item.id)).toEqual(['test']);
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
        const result = paymentAvailability(
            [method({ code: '测试支付', name: '测试支付' })],
            { allowTestMethods: false },
        );

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
        expect(isTestPaymentMethod(method({ code: 'tng-ewallet', name: 'Touch n Go eWallet' }))).toBe(
            false,
        );
    });
});
