import { describe, expect, it } from 'vitest';

import { formatUsdtPaymentAmount, isSettledTestOrder, usdtPaymentReceipt } from './order-payment-display';

describe('simulated checkout receipt', () => {
    const payment = {
        id: 'simulation',
        method: 'controlled-test-payment-platform',
        amount: 1990,
        state: 'Settled',
        metadata: { public: { testPayment: true } },
    };
    it('identifies a settled simulation and preserves the legacy settled state', () => {
        expect(isSettledTestOrder({ state: 'PaymentSettled', payments: [payment] })).toBe(true);
        expect(isSettledTestOrder({ state: 'TestPaymentSettled' })).toBe(true);
    });
    it('requires server simulation evidence and preserves later order states', () => {
        expect(
            isSettledTestOrder({ state: 'PaymentSettled', payments: [{ ...payment, metadata: null }] }),
        ).toBe(false);
        expect(
            isSettledTestOrder({ state: 'PaymentSettled', payments: [{ ...payment, method: 'offline' }] }),
        ).toBe(false);
        expect(isSettledTestOrder({ state: 'Cancelled', payments: [payment] })).toBe(false);
    });
});

describe('USDT payment display', () => {
    it('reads the exact settled USDT amount from public payment metadata', () => {
        const receipt = usdtPaymentReceipt({
            payments: [
                {
                    id: 'payment-1',
                    method: 'usdt-trc20',
                    amount: 7200,
                    state: 'Settled',
                    transactionId: 'tron:0xabc',
                    metadata: {
                        public: { network: 'TRC20', transactionId: '0xabc', usdtAmount: 10.000137 },
                    },
                },
            ],
        });

        expect(receipt).toEqual({ amount: 10.000137, network: 'TRC20', transactionId: '0xabc' });
        expect(receipt && formatUsdtPaymentAmount(receipt)).toBe('₮10.000137');
    });

    it('does not present unverified or incomplete payment metadata as an actual payment', () => {
        expect(
            usdtPaymentReceipt({
                payments: [
                    {
                        id: 'payment-1',
                        method: 'usdt-trc20',
                        amount: 7200,
                        state: 'Declined',
                        metadata: { public: { usdtAmount: 10 } },
                    },
                ],
            }),
        ).toBeNull();
    });
});
