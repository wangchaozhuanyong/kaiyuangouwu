import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PaymentPage } from './payment-pages';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@tanstack/react-query', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-query')>()),
    useQuery: (options: { queryKey: unknown[] }) => {
        const key = options.queryKey;
        const data = key.includes('payment-methods')
            ? [
                  {
                      id: 'card',
                      code: 'stripe-card',
                      name: '银行卡',
                      description: '',
                      isEligible: true,
                      eligibilityMessage: null,
                  },
                  {
                      id: 'usdt',
                      code: 'usdt-trc20',
                      name: 'USDT-TRC20',
                      description: '',
                      isEligible: true,
                      eligibilityMessage: null,
                  },
              ]
            : key.includes('usdt-checkout-quote')
              ? {
                    id: 'quote-1',
                    fiatCurrencyCode: 'CNY',
                    fiatAmount: 7_200,
                    fiatPerUsdtRate: 7.2,
                    markupPercent: 0,
                    usdtAmount: 10.000137,
                    source: 'test',
                    network: 'TRC20',
                    tokenContractAddress: 'contract',
                    receivingAddress: 'TReceivingAddress',
                    receivingAddressFingerprint: 'a'.repeat(64),
                    paymentStatus: 'PENDING',
                    transactionId: null,
                    settledAt: null,
                    createdAt: '2026-09-19T00:00:00.000Z',
                    expiresAt: '2026-09-19T00:10:00.000Z',
                }
              : key.includes('usdt-order-confirmation-token')
                ? { token: 'confirmation-token' }
                : key.includes('referral-program')
                  ? { enabled: false, allowBalanceSpend: false }
                  : undefined;
        return {
            data,
            error: null,
            isLoading: false,
            isPaused: false,
            isFetching: false,
            refetch: vi.fn(),
        };
    },
}));

describe('payment currency checkout page', () => {
    it('shows only USDT-TRC20 and the exact locked amount for a USDT order', () => {
        const markup = renderToStaticMarkup(
            <PaymentPage
                api={{} as never}
                cart={{ state: 'PAYMENT_PENDING' } as never}
                order={
                    {
                        id: 'order-1',
                        code: 'ORDER-1',
                        state: 'ArrangingPayment',
                        currencyCode: 'CNY',
                        lines: [],
                        payments: [],
                        subTotalWithTax: 7_200,
                        shippingWithTax: 0,
                        totalWithTax: 7_200,
                        discounts: [],
                        taxSummary: [],
                        customFields: { paymentCurrencyCode: 'USDT' },
                    } as never
                }
                customer={null}
                market={{ code: 'cn', currencyCode: 'CNY' } as never}
                displayCurrencyCode="CNY"
                locale="zh-CN"
                language="zh"
                onCancel={vi.fn()}
                onOrderChange={vi.fn()}
                onComplete={vi.fn()}
            />,
        );

        expect(markup).toContain('USDT-TRC20');
        expect(markup).not.toContain('银行卡');
        expect(markup).toContain('USDT 锁价应付');
        expect(markup).toContain('₮10.000137');
    });
});
