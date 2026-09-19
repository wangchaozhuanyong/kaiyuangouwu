import { describe, expect, it } from 'vitest';

import { formatUsdtPaymentAmount, usdtPaymentReceipt } from './order-payment-display';

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
