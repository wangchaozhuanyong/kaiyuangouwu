import { describe, expect, it } from 'vitest';

import {
    calculateEligibleReferralRefund,
    calculateReferralClawback,
    calculateReferralReward,
    referralRewardStatusAfterClawback,
} from './referral-calculation';

describe('referral reward calculations', () => {
    it('excludes shipping and the share paid by referral balance', () => {
        expect(
            calculateReferralReward({
                productNet: 10_000,
                settledTotal: 12_000,
                externalSettled: 9_000,
                rewardRateBps: 500,
                minimumOrderAmount: 0,
            }),
        ).toEqual({ eligibleAmount: 7_500, rewardAmount: 375 });
    });

    it('enforces the minimum spend and per-order cap in minor units', () => {
        expect(
            calculateReferralReward({
                productNet: 20_000,
                settledTotal: 20_000,
                externalSettled: 20_000,
                rewardRateBps: 1_000,
                minimumOrderAmount: 10_000,
                maxRewardPerOrder: 1_200,
            }),
        ).toEqual({ eligibleAmount: 20_000, rewardAmount: 1_200 });
        expect(
            calculateReferralReward({
                productNet: 9_999,
                settledTotal: 9_999,
                externalSettled: 9_999,
                rewardRateBps: 1_000,
                minimumOrderAmount: 10_000,
            }).rewardAmount,
        ).toBe(0);
    });

    it('claws rewards back proportionally and never above the original reward', () => {
        expect(calculateReferralClawback(1_000, 2_500, 10_000)).toBe(250);
        expect(calculateReferralClawback(1_000, 20_000, 10_000)).toBe(1_000);
    });

    it('excludes shipping-only refunds and counts itemized or amount-only product refunds', () => {
        expect(
            calculateEligibleReferralRefund({ items: 0, shipping: 2_500, adjustment: 0, total: 2_500 }),
        ).toBe(0);
        expect(
            calculateEligibleReferralRefund({ items: 10_000, shipping: 2_500, adjustment: 0, total: 12_500 }),
        ).toBe(10_000);
        expect(calculateEligibleReferralRefund({ items: 0, shipping: 0, adjustment: 0, total: 3_000 })).toBe(
            3_000,
        );
    });

    it('keeps a partially clawed-back pending reward releasable', () => {
        expect(
            referralRewardStatusAfterClawback({
                rewardAmount: 1_000,
                clawedBackAmount: 250,
                releasedAmount: 0,
            }),
        ).toBe('PENDING');
        expect(
            referralRewardStatusAfterClawback({
                rewardAmount: 1_000,
                clawedBackAmount: 250,
                releasedAmount: 1_000,
            }),
        ).toBe('PARTIALLY_REVERSED');
        expect(
            referralRewardStatusAfterClawback({
                rewardAmount: 1_000,
                clawedBackAmount: 1_000,
                releasedAmount: 0,
            }),
        ).toBe('REVERSED');
    });
});
