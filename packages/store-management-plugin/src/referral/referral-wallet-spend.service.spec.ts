import { describe, expect, it } from 'vitest';

import { calculateReferralWalletSettlement } from './referral-wallet-spend.service';

describe('referral wallet settlement transitions', () => {
    it('captures one output while keeping the remaining outputs reserved', () => {
        expect(
            calculateReferralWalletSettlement(
                { amount: 300, capturedAmount: 0, releasedAmount: 0 },
                { availableBalance: 700, reservedBalance: 300 },
                'CAPTURE',
                100,
            ),
        ).toEqual({
            capturedAmount: 100,
            releasedAmount: 0,
            availableBalance: 700,
            reservedBalance: 200,
            status: 'RESERVED',
            settled: false,
            eventType: 'WALLET_USAGE_CAPTURED',
            availableDelta: 0,
            reservedDelta: -100,
        });
    });

    it('releases only the failed output and restores available balance', () => {
        const result = calculateReferralWalletSettlement(
            { amount: 300, capturedAmount: 100, releasedAmount: 0 },
            { availableBalance: 700, reservedBalance: 200 },
            'RELEASE',
            100,
        );

        expect(result).toEqual(
            expect.objectContaining({
                capturedAmount: 100,
                releasedAmount: 100,
                availableBalance: 800,
                reservedBalance: 100,
                eventType: 'WALLET_USAGE_RELEASED',
            }),
        );
    });

    it('refunds captured money with an auditable available-balance delta', () => {
        const result = calculateReferralWalletSettlement(
            { amount: 100, capturedAmount: 100, releasedAmount: 0 },
            { availableBalance: 900, reservedBalance: 0 },
            'REFUND',
            100,
        );

        expect(result).toEqual(
            expect.objectContaining({
                capturedAmount: 0,
                releasedAmount: 100,
                availableBalance: 1_000,
                reservedBalance: 0,
                status: 'RELEASED',
                eventType: 'WALLET_USAGE_REFUNDED',
                availableDelta: 100,
                reservedDelta: 0,
            }),
        );
    });

    it('rejects over-capture and over-refund', () => {
        expect(() =>
            calculateReferralWalletSettlement(
                { amount: 100, capturedAmount: 0, releasedAmount: 0 },
                { availableBalance: 0, reservedBalance: 100 },
                'CAPTURE',
                101,
            ),
        ).toThrow();
        expect(() =>
            calculateReferralWalletSettlement(
                { amount: 100, capturedAmount: 40, releasedAmount: 60 },
                { availableBalance: 60, reservedBalance: 0 },
                'REFUND',
                41,
            ),
        ).toThrow();
    });

    it('settles a four-image mixed result without losing or duplicating balance', () => {
        const usage = { amount: 400, capturedAmount: 0, releasedAmount: 0 };
        const wallet = { availableBalance: 600, reservedBalance: 400 };
        const apply = (action: 'CAPTURE' | 'RELEASE' | 'REFUND', amount: number) => {
            const result = calculateReferralWalletSettlement(usage, wallet, action, amount);
            usage.capturedAmount = result.capturedAmount;
            usage.releasedAmount = result.releasedAmount;
            wallet.availableBalance = result.availableBalance;
            wallet.reservedBalance = result.reservedBalance;
            return result;
        };

        apply('CAPTURE', 100);
        apply('RELEASE', 100);
        apply('CAPTURE', 100);
        apply('REFUND', 100);
        const final = apply('RELEASE', 100);

        expect(final).toEqual(
            expect.objectContaining({
                capturedAmount: 100,
                releasedAmount: 300,
                availableBalance: 900,
                reservedBalance: 0,
                status: 'PARTIAL',
                settled: true,
            }),
        );
        expect(wallet.availableBalance + wallet.reservedBalance + usage.capturedAmount).toBe(1_000);
    });
});
