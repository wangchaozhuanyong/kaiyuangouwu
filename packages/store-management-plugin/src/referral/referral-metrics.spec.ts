import { describe, expect, it } from 'vitest';

import { REFERRAL_METRIC_SETTLED_ORDER_STATES, settledOrderNetTotal } from './referral-metrics';

describe('referral today metrics', () => {
    it('does not treat payment authorization as a settled order', () => {
        expect(REFERRAL_METRIC_SETTLED_ORDER_STATES).not.toContain('PaymentAuthorized');
        expect(REFERRAL_METRIC_SETTLED_ORDER_STATES).toContain('PaymentSettled');
    });

    it('uses settled payments and subtracts only settled refunds', () => {
        expect(
            settledOrderNetTotal({
                totalWithTax: 10_000,
                payments: [
                    {
                        amount: 10_000,
                        state: 'Settled',
                        refunds: [
                            { state: 'Settled', total: 2_500 },
                            { state: 'Pending', total: 1_000 },
                        ],
                    },
                ],
            }),
        ).toBe(7_500);
    });

    it('returns zero for an incompletely settled or fully refunded order', () => {
        expect(
            settledOrderNetTotal({
                totalWithTax: 10_000,
                payments: [{ amount: 9_999, state: 'Settled', refunds: [] }],
            }),
        ).toBe(0);
        expect(
            settledOrderNetTotal({
                totalWithTax: 10_000,
                payments: [
                    {
                        amount: 10_000,
                        state: 'Settled',
                        refunds: [{ state: 'Settled', total: 10_000 }],
                    },
                ],
            }),
        ).toBe(0);
    });
});
