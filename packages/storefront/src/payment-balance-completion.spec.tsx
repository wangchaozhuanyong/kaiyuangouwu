// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { PaymentPage } from './payment-pages';

const mocks = vi.hoisted(() => ({
    refetch: vi.fn().mockResolvedValue({}),
    methods: [],
    preloadRoute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./route-component-preload', () => ({
    preloadStorefrontRouteComponent: mocks.preloadRoute,
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-query')>()),
    useQuery: (options: { queryKey: string[] }) => ({
        data: options.queryKey.includes('referral-program')
            ? { enabled: true, allowBalanceSpend: true }
            : options.queryKey.includes('referral')
              ? { wallets: [{ currencyCode: 'CNY', availableBalance: 700 }] }
              : options.queryKey.includes('payment-methods')
                ? mocks.methods
                : undefined,
        refetch: mocks.refetch,
    }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('balance payment completion', () => {
    it('shows the remaining amount and locks editing after partial balance payment', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const order = {
            id: '44',
            code: 'SIM',
            state: 'ArrangingPayment',
            currencyCode: 'CNY',
            lines: [],
            payments: [{ id: '28', method: 'referral-balance', amount: 50, state: 'Settled' }],
            subTotalWithTax: 113,
            shippingWithTax: 0,
            totalWithTax: 113,
            taxSummary: [],
            customFields: {},
        };
        try {
            act(() =>
                root.render(
                    <PaymentPage
                        api={{} as never}
                        order={order as never}
                        cart={{ state: 'PAYMENT_PENDING' } as never}
                        customer={{ id: '27' } as never}
                        market={{ code: 'sim', currencyCode: 'CNY' } as never}
                        displayCurrencyCode="CNY"
                        locale="zh-CN"
                        language="zh"
                        onCancel={vi.fn()}
                        onOrderChange={vi.fn()}
                        onComplete={vi.fn()}
                    />,
                ),
            );
            const remaining = [...host.querySelectorAll('dt')].find(
                item => item.textContent === '剩余待支付',
            );
            expect(remaining?.nextElementSibling?.textContent).toBe('¥0.63');
            const buttons = [...host.querySelectorAll('button')];
            expect(buttons.some(item => item.textContent === '使用余额')).toBe(false);
            expect(buttons.find(item => item.textContent === '余额已抵扣，订单需完成支付')?.disabled).toBe(
                true,
            );
            const paymentMethodError = host.querySelector('.payment-method-section > .inline-error');
            expect(paymentMethodError?.children[0]?.tagName).toBe('svg');
            expect(paymentMethodError?.querySelector('span')?.textContent).toBe(
                '当前店铺尚未接入支付方式，订单已保留',
            );
            expect(paymentMethodError?.querySelector('button')?.textContent).toBe('重试');
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });

    it.each([
        { paymentState: 'Settled', remaining: '¥0.43' },
        { paymentState: 'Authorized', remaining: '¥0.43' },
        { paymentState: 'Declined', remaining: '¥0.63' },
    ])(
        'counts an external $paymentState payment only when it covers the order',
        ({ paymentState, remaining }) => {
            const host = document.createElement('div');
            document.body.append(host);
            const root = createRoot(host);
            const order = {
                id: '44',
                code: 'SIM',
                state: 'ArrangingPayment',
                currencyCode: 'CNY',
                lines: [],
                payments: [
                    { id: '28', method: 'referral-balance', amount: 50, state: 'Settled' },
                    { id: '29', method: 'external-card', amount: 20, state: paymentState },
                ],
                subTotalWithTax: 113,
                shippingWithTax: 0,
                totalWithTax: 113,
                taxSummary: [],
                customFields: {},
            };
            try {
                act(() =>
                    root.render(
                        <PaymentPage
                            api={{} as never}
                            order={order as never}
                            cart={{ state: 'PAYMENT_PENDING' } as never}
                            customer={{ id: '27' } as never}
                            market={{ code: 'sim', currencyCode: 'CNY' } as never}
                            displayCurrencyCode="CNY"
                            locale="zh-CN"
                            language="zh"
                            onCancel={vi.fn()}
                            onOrderChange={vi.fn()}
                            onComplete={vi.fn()}
                        />,
                    ),
                );
                const remainingRow = [...host.querySelectorAll('dt')].find(
                    item => item.textContent === '剩余待支付',
                );
                expect(remainingRow?.nextElementSibling?.textContent).toBe(remaining);
                const externalRow = [...host.querySelectorAll('dt')].find(
                    item => item.textContent === '已付／已授权',
                );
                expect(externalRow?.nextElementSibling?.textContent).toBe(
                    paymentState === 'Declined' ? undefined : '-¥0.2',
                );
            } finally {
                act(() => root.unmount());
                host.remove();
            }
        },
    );

    it.each(['Delivered', 'PartiallyDelivered', 'PaymentSettled', 'ArrangingPayment'])(
        'handles the payment response state %s',
        async state => {
            const order = {
                id: 'sim',
                code: 'SIM',
                state: 'ArrangingPayment',
                currencyCode: 'CNY',
                lines: [],
                payments: [],
                subTotalWithTax: 113,
                shippingWithTax: 0,
                totalWithTax: 113,
                taxSummary: [],
                customFields: {},
            };
            const paidOrder = { ...order, state };
            const api = {
                createOrderConfirmationToken: vi.fn().mockResolvedValue({ token: 'synthetic-test-token' }),
                useReferralBalance: vi.fn().mockResolvedValue({ order: paidOrder }),
            };
            const onComplete = vi.fn().mockResolvedValue(undefined);
            const onOrderChange = vi.fn();
            const host = document.createElement('div');
            document.body.append(host);
            const root = createRoot(host);
            try {
                act(() =>
                    root.render(
                        <PaymentPage
                            api={api as never}
                            order={order as never}
                            cart={{ state: 'PAYMENT_PENDING' } as never}
                            customer={{ id: '27' } as never}
                            market={{ code: 'sim', currencyCode: 'CNY' } as never}
                            displayCurrencyCode="CNY"
                            locale="zh-CN"
                            language="zh"
                            onCancel={vi.fn()}
                            onOrderChange={onOrderChange}
                            onComplete={onComplete}
                        />,
                    ),
                );
                const button = [...host.querySelectorAll('button')].find(
                    item => item.textContent === '使用余额',
                );
                expect(button).toBeDefined();
                await act(async () => {
                    button?.click();
                    await Promise.resolve();
                });
                expect(api.useReferralBalance).toHaveBeenCalledExactlyOnceWith(113);
                expect(onOrderChange).toHaveBeenCalledWith(paidOrder);
                if (state === 'ArrangingPayment') expect(onComplete).not.toHaveBeenCalled();
                else expect(onComplete).toHaveBeenCalledExactlyOnceWith(paidOrder, 'synthetic-test-token');
            } finally {
                act(() => root.unmount());
                host.remove();
            }
        },
    );
});
