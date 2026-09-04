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
    it('keeps every method returned by the active Channel', () => {
        const result = paymentAvailability([
            method(),
            method({ id: 'test', code: '模拟支付', name: '模拟支付（测试）' }),
        ]);

        expect(result.status).toBe('READY');
        expect(result.methods.map(item => item.id)).toEqual(['payment-1', 'test']);
    });

    it('allows an enabled simulated method to make checkout ready', () => {
        const result = paymentAvailability([
            method({ code: 'simulated-payment', name: 'Simulated payment (test)' }),
        ]);

        expect(result.status).toBe('READY');
        expect(result.methods).toHaveLength(1);
    });

    it('preserves provider eligibility errors for the active order', () => {
        const result = paymentAvailability([
            method({ isEligible: false, eligibilityMessage: 'Minimum order total is MYR 10' }),
        ]);

        expect(result.status).toBe('ORDER_INELIGIBLE');
        expect(result.eligibleMethods).toEqual([]);
        expect(result.methods[0].eligibilityMessage).toContain('MYR 10');
    });
});

describe('isTestPaymentMethod', () => {
    it('detects common placeholder payment handlers without matching normal provider names', () => {
        expect(isTestPaymentMethod(method({ code: 'dummy-payment-handler' }))).toBe(true);
        expect(isTestPaymentMethod(method({ code: 'simulated-payment' }))).toBe(true);
        expect(isTestPaymentMethod(method({ name: '模拟支付' }))).toBe(true);
        expect(isTestPaymentMethod(method({ code: 'tng-ewallet', name: 'Touch n Go eWallet' }))).toBe(false);
    });
});
