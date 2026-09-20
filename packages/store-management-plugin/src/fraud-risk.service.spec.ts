import { describe, expect, it } from 'vitest';

import { DEFAULT_FRAUD_RISK_RULES, scoreOrderRiskSignals } from './fraud-risk.service';

describe('fraud risk scoring', () => {
    it('combines account, order, payment and referral evidence without storing secrets', () => {
        const signals = scoreOrderRiskSignals(
            {
                totalWithTax: 150_000,
                hasCustomer: true,
                customerAgeHours: 4,
                recentOrderCount: 4,
                failedPaymentCount: 2,
                referralAgeHours: 3,
                customerVerified: false,
            },
            DEFAULT_FRAUD_RISK_RULES,
        );
        expect(signals.map(item => item.code)).toEqual([
            'HIGH_VALUE_ORDER',
            'NEW_ACCOUNT',
            'UNVERIFIED_ACCOUNT',
            'ORDER_VELOCITY',
            'FAILED_PAYMENT_VELOCITY',
            'NEW_REFERRAL_BINDING',
        ]);
        expect(signals.reduce((total, item) => total + item.points, 0)).toBe(140);
        expect(JSON.stringify(signals)).not.toContain('password');
    });

    it('allows a verified established customer below all thresholds', () => {
        expect(
            scoreOrderRiskSignals(
                {
                    totalWithTax: 5_000,
                    hasCustomer: true,
                    customerAgeHours: 500,
                    recentOrderCount: 0,
                    failedPaymentCount: 0,
                    referralAgeHours: null,
                    customerVerified: true,
                },
                DEFAULT_FRAUD_RISK_RULES,
            ),
        ).toEqual([]);
    });
});
