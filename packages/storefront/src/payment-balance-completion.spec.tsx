// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApiError, ShopApiTimeoutError } from './api';
import { PaymentPage } from './payment-pages';
import { ShopApiGraphQlError } from './shop-api-errors';

const mocks = vi.hoisted(() => ({
    refetch: vi.fn().mockResolvedValue({}),
    tokenRefetch: vi.fn().mockResolvedValue({}),
    walletBalance: 700,
    methods: [] as Array<Record<string, unknown>>,
    tokenError: null as Error | null,
    quote: undefined as Record<string, unknown> | undefined,
    queries: [] as Array<{ queryKey: string[]; enabled?: boolean; retry?: boolean }>,
    preloadRoute: vi.fn().mockResolvedValue(undefined),
}));
const queryClient = new QueryClient();
vi.mock('@tanstack/react-router', async importOriginal => {
    const { createMemoryHistory } = await importOriginal<typeof import('@tanstack/react-router')>();
    const navigate = vi.fn();
    const router = { history: createMemoryHistory({ initialEntries: ['/payment'] }), navigate };
    return { useNavigate: () => navigate, useRouter: () => router };
});
vi.mock('./route-component-preload', () => ({
    preloadStorefrontRouteComponent: mocks.preloadRoute,
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-query')>()),
    useQueryClient: () => queryClient,
    useQuery: (options: { queryKey: string[]; enabled?: boolean; retry?: boolean }) => {
        mocks.queries.push(options);
        return {
            data: options.queryKey.includes('referral-program')
                ? { enabled: true, allowBalanceSpend: true }
                : options.queryKey.includes('referral')
                  ? { wallets: [{ currencyCode: 'CNY', availableBalance: mocks.walletBalance }] }
                  : options.queryKey.includes('payment-methods')
                    ? mocks.methods
                    : options.queryKey.includes('usdt-checkout-quote')
                      ? mocks.quote
                      : undefined,
            error: options.queryKey.includes('usdt-order-confirmation-token') ? mocks.tokenError : null,
            refetch: options.queryKey.includes('usdt-order-confirmation-token')
                ? mocks.tokenRefetch
                : mocks.refetch,
        };
    },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
    queryClient.clear();
    sessionStorage.clear();
    mocks.methods = [];
    mocks.tokenError = null;
    mocks.quote = undefined;
    mocks.walletBalance = 700;
    mocks.queries = [];
    mocks.refetch.mockClear();
    mocks.tokenRefetch.mockClear();
});

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
                '暂未接入支付方式，订单已保留',
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

const syntheticOrder = {
    id: 'synthetic-order',
    code: 'SYNTHETIC-ONLY',
    state: 'ArrangingPayment',
    currencyCode: 'CNY',
    lines: [],
    payments: [] as Array<{ id: string; method: string; amount: number; state: string }>,
    subTotalWithTax: 113,
    shippingWithTax: 0,
    totalWithTax: 113,
    taxSummary: [],
    customFields: {},
};
const syntheticMethod = {
    id: 'synthetic-card',
    code: 'synthetic-card',
    name: '合成支付',
    description: '',
    isEligible: true,
    eligibilityMessage: null,
};
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((accept, decline) => {
        resolve = accept;
        reject = decline;
    });
    return { promise, resolve, reject };
}
async function renderPayment(
    api: Record<string, unknown>,
    options: {
        order?: typeof syntheticOrder | null;
        onComplete?: ReturnType<typeof vi.fn>;
        onOrderChange?: ReturnType<typeof vi.fn>;
        marketCode?: string;
    } = {},
) {
    mocks.methods = [syntheticMethod];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onComplete = options.onComplete ?? vi.fn().mockResolvedValue(undefined);
    const onOrderChange = options.onOrderChange ?? vi.fn();
    const props = {
        api,
        order: options.order === undefined ? syntheticOrder : options.order,
        cart: { state: 'PAYMENT_PENDING' },
        customer: { id: 'synthetic-customer' },
        market: { code: options.marketCode ?? 'synthetic', currencyCode: 'CNY' },
        displayCurrencyCode: 'CNY',
        locale: 'zh-CN',
        language: 'zh',
        onCancel: vi.fn(),
        onComplete,
        onOrderChange,
    };
    const render = async (patch: Partial<typeof props> = {}) => {
        Object.assign(props, patch);
        await act(async () => {
            root.render(<PaymentPage {...(props as unknown as Parameters<typeof PaymentPage>[0])} />);
            await Promise.resolve();
        });
    };
    await render();
    return {
        host,
        onComplete,
        onOrderChange,
        render,
        submit: () =>
            host
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        balance: () =>
            [...host.querySelectorAll('button')].find(button => button.textContent === '使用余额')?.click(),
        unmount: async () => {
            await act(async () => {
                root.unmount();
                await Promise.resolve();
            });
            host.remove();
        },
    };
}
function syntheticApi(overrides: Record<string, unknown> = {}) {
    return {
        createOrderConfirmationToken: vi.fn().mockResolvedValue({ token: 'synthetic-original-token' }),
        addPaymentToOrder: vi.fn().mockRejectedValue(new ShopApiTimeoutError('synthetic timeout', true)),
        useReferralBalance: vi.fn(),
        orderByConfirmationToken: vi.fn().mockResolvedValue(syntheticOrder),
        order: vi.fn().mockResolvedValue(syntheticOrder),
        ...overrides,
    };
}

describe('payment response recovery', () => {
    it('checks the original token after a lost response and never submits another payment', async () => {
        const api = syntheticApi();
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            expect(view.host.textContent).toContain('付款结果尚未确认');
            expect(view.host.querySelector('button[type=submit]')?.textContent).toContain('核对付款结果');
            api.orderByConfirmationToken.mockResolvedValueOnce({
                ...syntheticOrder,
                state: 'PaymentSettled',
            });
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.createOrderConfirmationToken).toHaveBeenCalledTimes(1);
            expect(api.orderByConfirmationToken).toHaveBeenNthCalledWith(
                2,
                'synthetic-original-token',
                undefined,
                'CNY',
            );
            expect(view.onComplete).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ state: 'PaymentSettled' }),
                'synthetic-original-token',
            );
        } finally {
            await view.unmount();
        }
    });

    it('coalesces repeated result checks and keeps failures locked', async () => {
        const api = syntheticApi();
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            const read = deferred<never>();
            api.orderByConfirmationToken.mockReturnValueOnce(read.promise);
            await act(async () => {
                view.submit();
                view.submit();

                await Promise.resolve();
            });
            expect(api.orderByConfirmationToken).toHaveBeenCalledTimes(2);
            await act(async () => {
                read.reject(
                    new ShopApiGraphQlError(
                        ['synthetic read validation failure'],
                        400,
                        'GRAPHQL_VALIDATION_FAILED',
                        true,
                    ),
                );
                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(view.host.textContent).toContain('付款结果尚未确认');
            expect(
                [...view.host.querySelectorAll('button')].find(
                    button => button.textContent === '返回修改订单',
                )?.disabled,
            ).toBe(true);
        } finally {
            await view.unmount();
        }
    });

    it('retains the unresolved attempt when the same order is revisited', async () => {
        const payment = deferred<never>();
        const api = syntheticApi({ addPaymentToOrder: vi.fn().mockReturnValue(payment.promise) });
        const first = await renderPayment(api);
        await act(async () => {
            first.submit();
            await Promise.resolve();
        });
        expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
        await first.unmount();
        const second = await renderPayment(api);
        try {
            expect(second.host.textContent).toContain('核对付款结果');
            api.orderByConfirmationToken.mockResolvedValueOnce({
                ...syntheticOrder,
                state: 'PaymentSettled',
            });
            await act(async () => {
                second.submit();

                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.createOrderConfirmationToken).toHaveBeenCalledTimes(1);
            expect(second.onComplete).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ state: 'PaymentSettled' }),
                'synthetic-original-token',
            );
            await act(async () => {
                payment.reject(new Error('synthetic late response loss'));
                await Promise.resolve();
            });
            expect(first.onComplete).not.toHaveBeenCalled();
        } finally {
            await second.unmount();
        }
    });

    it('does not replay an acknowledged payment when the confirmation handoff fails', async () => {
        const paid = { ...syntheticOrder, state: 'PaymentSettled' };
        const api = syntheticApi({ addPaymentToOrder: vi.fn().mockResolvedValue(paid) });
        api.orderByConfirmationToken.mockRejectedValueOnce(new Error('synthetic read failure'));
        const onComplete = vi
            .fn()
            .mockRejectedValueOnce(
                new ShopApiGraphQlError(
                    ['synthetic handoff validation failure'],
                    400,
                    'GRAPHQL_VALIDATION_FAILED',
                    true,
                ),
            )
            .mockResolvedValue(undefined);
        const view = await renderPayment(api, { onComplete });
        try {
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            api.orderByConfirmationToken.mockResolvedValueOnce(paid);
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.createOrderConfirmationToken).toHaveBeenCalledTimes(1);
            expect(onComplete).toHaveBeenLastCalledWith(paid, 'synthetic-original-token');
        } finally {
            await view.unmount();
        }
    });

    it('keeps an ArrangingPayment response pending instead of reporting completion', async () => {
        const api = syntheticApi({ addPaymentToOrder: vi.fn().mockResolvedValue(syntheticOrder) });
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            expect(view.onComplete).not.toHaveBeenCalled();
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(view.host.textContent).toContain('核对付款结果');
        } finally {
            await view.unmount();
        }
    });

    it.each([
        new ShopApiError('PAYMENT_DECLINED_ERROR', 'synthetic decline'),
        new ShopApiGraphQlError(['synthetic validation failure'], 400, 'GRAPHQL_VALIDATION_FAILED', true),
    ])('releases only a definitively rejected initial payment', async rejection => {
        const api = syntheticApi({ addPaymentToOrder: vi.fn().mockRejectedValue(rejection) });
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();
                view.submit();

                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.orderByConfirmationToken).not.toHaveBeenCalled();
            expect(view.host.querySelector('button[type=submit]')?.textContent).toContain('确认支付');
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(2);
        } finally {
            await view.unmount();
        }
    });

    it('uses one synchronous lock for balance and ordinary payments', async () => {
        mocks.walletBalance = 50;
        const balance = deferred<{ order: typeof syntheticOrder }>();
        const api = syntheticApi({ useReferralBalance: vi.fn().mockReturnValue(balance.promise) });
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.balance();
                view.balance();
                view.submit();
                await Promise.resolve();
            });
            expect(api.useReferralBalance).toHaveBeenCalledTimes(1);
            expect(api.addPaymentToOrder).not.toHaveBeenCalled();
            expect(view.host.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
            await act(async () => {
                balance.resolve({
                    order: {
                        ...syntheticOrder,
                        payments: [
                            {
                                id: 'synthetic-balance',
                                method: 'referral-balance',
                                amount: 50,
                                state: 'Settled',
                            },
                        ],
                    },
                });
                await Promise.resolve();
            });
            expect(view.onComplete).not.toHaveBeenCalled();
            expect(mocks.refetch).toHaveBeenCalledTimes(1);
        } finally {
            await view.unmount();
        }
    });

    it('recovers a partial balance write by reading, without spending the balance again', async () => {
        mocks.walletBalance = 50;
        const partial = {
            ...syntheticOrder,
            payments: [{ id: 'synthetic-balance', method: 'referral-balance', amount: 50, state: 'Settled' }],
        };
        const api = syntheticApi({
            useReferralBalance: vi.fn().mockRejectedValue(new Error('synthetic lost response')),
        });
        api.orderByConfirmationToken.mockResolvedValueOnce(partial);
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.balance();

                await Promise.resolve();
            });
            expect(api.useReferralBalance).toHaveBeenCalledExactlyOnceWith(50);
            expect(api.orderByConfirmationToken).toHaveBeenCalledExactlyOnceWith(
                'synthetic-original-token',
                undefined,
                'CNY',
            );
            expect(view.onOrderChange).toHaveBeenCalledWith(partial);
            expect(view.onComplete).not.toHaveBeenCalled();
            expect(view.host.querySelector('button[type=submit]')?.textContent).toContain('确认支付');
            expect(mocks.refetch).toHaveBeenCalledTimes(1);
        } finally {
            await view.unmount();
        }
    });

    it('does not release an unresolved balance write when the order still awaits payment', async () => {
        const api = syntheticApi({
            useReferralBalance: vi.fn().mockRejectedValue(new Error('synthetic lost response')),
        });
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.balance();

                await Promise.resolve();
            });
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            expect(api.useReferralBalance).toHaveBeenCalledTimes(1);
            expect(api.addPaymentToOrder).not.toHaveBeenCalled();
            expect(api.orderByConfirmationToken).toHaveBeenCalledTimes(2);
            expect(view.host.textContent).toContain('核对付款结果');
        } finally {
            await view.unmount();
        }
    });

    it.each([
        { marketCode: 'other-synthetic', orderId: syntheticOrder.id },
        { marketCode: 'synthetic', orderId: 'other-order' },
    ])(
        'isolates a late payment result after changing scope to $marketCode/$orderId',
        async ({ marketCode, orderId }) => {
            const payment = deferred<typeof syntheticOrder>();
            const api = syntheticApi({ addPaymentToOrder: vi.fn().mockReturnValue(payment.promise) });
            const view = await renderPayment(api);
            try {
                await act(async () => {
                    view.submit();
                    await Promise.resolve();
                });
                await view.render({
                    market: { code: marketCode, currencyCode: 'CNY' },
                    order: { ...syntheticOrder, id: orderId },
                });
                await act(async () => {
                    payment.resolve({ ...syntheticOrder, state: 'PaymentSettled' });
                    await Promise.resolve();
                });
                expect(view.onComplete).not.toHaveBeenCalled();
                expect(view.onOrderChange).not.toHaveBeenCalled();
                expect(view.host.textContent).not.toContain('付款结果尚未确认');
            } finally {
                await view.unmount();
            }
        },
    );

    it('keeps the attempt pending after an amount change or mismatched result', async () => {
        const api = syntheticApi();
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            await view.render({ order: { ...syntheticOrder, totalWithTax: 200 } });
            api.orderByConfirmationToken.mockResolvedValueOnce({
                ...syntheticOrder,
                id: 'wrong-order',
                state: 'PaymentSettled',
            });
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(view.onComplete).not.toHaveBeenCalled();
            expect(view.host.textContent).toContain('付款结果尚未确认');
        } finally {
            await view.unmount();
        }
    });

    it('ends a cancelled attempt without replaying payment and keeps an orders entry', async () => {
        const api = syntheticApi();
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            const cancelled = { ...syntheticOrder, state: 'Cancelled' };
            api.orderByConfirmationToken.mockResolvedValueOnce(cancelled);
            await act(async () => {
                view.submit();

                await Promise.resolve();
            });
            await view.render({ order: cancelled });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(view.onComplete).not.toHaveBeenCalled();
            expect(view.host.textContent).toContain('查看我的订单');
        } finally {
            await view.unmount();
        }
    });

    it('can check the original token after the completed order disappears from the active cart', async () => {
        const api = syntheticApi();
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            await view.render({ order: null });
            expect(view.host.textContent).toContain('请核对原付款结果');
            api.orderByConfirmationToken.mockResolvedValueOnce({
                ...syntheticOrder,
                state: 'PaymentSettled',
            });
            const check = [...view.host.querySelectorAll('button')].find(
                button => button.textContent === '核对付款结果',
            );
            await act(async () => {
                check?.click();
                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(view.onComplete).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ state: 'PaymentSettled' }),
                'synthetic-original-token',
            );
        } finally {
            await view.unmount();
        }
    });

    it('keeps an unknown ordinary payment readable after switching the displayed payment currency', async () => {
        const api = syntheticApi();
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            await view.render({
                order: { ...syntheticOrder, customFields: { paymentCurrencyCode: 'USDT' } },
            });
            expect(view.host.querySelector('button[type=submit]')?.textContent).toContain('核对付款结果');
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.orderByConfirmationToken).toHaveBeenCalledTimes(2);
            expect(
                mocks.queries
                    .filter(query => query.queryKey.includes('usdt-checkout-quote'))
                    .every(query => query.enabled === false),
            ).toBe(true);
        } finally {
            await view.unmount();
        }
    });

    it('shows USDT token failure and retries only the token query', async () => {
        mocks.tokenError = new Error('synthetic token failure');
        mocks.quote = {
            usdtAmount: 1.0001,
            network: 'TRC20',
            receivingAddress: 'SYNTHETIC_NOT_REAL',
            receivingAddressFingerprint: 'a'.repeat(64),
            paymentStatus: 'PENDING',
            expiresAt: '2030-10-08T00:00:00.000Z',
            fiatAmount: 113,
            fiatCurrencyCode: 'CNY',
            fiatPerUsdtRate: 7.2,
            markupPercent: 0,
        };
        const api = syntheticApi();
        const view = await renderPayment(api, {
            order: { ...syntheticOrder, customFields: { paymentCurrencyCode: 'USDT' } },
        });
        try {
            expect(view.host.textContent).toContain('到账查询准备失败');
            const retry = [...view.host.querySelectorAll('button')].find(
                button => button.textContent === '重试到账查询',
            );
            await act(async () => {
                retry?.click();
                await Promise.resolve();
            });
            expect(mocks.tokenRefetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false });
            expect(mocks.refetch).not.toHaveBeenCalled();
            expect(api.addPaymentToOrder).not.toHaveBeenCalled();
            expect(api.useReferralBalance).not.toHaveBeenCalled();
            const query = mocks.queries.find(item => item.queryKey.includes('usdt-order-confirmation-token'));
            expect(query?.queryKey).toEqual(
                expect.arrayContaining(['private', 'synthetic-customer', 'zh_Hans']),
            );
        } finally {
            await view.unmount();
        }
    });
});

describe('payment recovery after a full reload', () => {
    async function leaveUnresolvedPayment(api = syntheticApi()) {
        const view = await renderPayment(api);
        await act(async () => {
            view.submit();
            await Promise.resolve();
        });
        await view.unmount();
        queryClient.clear();
        return api;
    }

    it('keeps only a non-capability marker and checks the authenticated order before another write', async () => {
        const api = await leaveUnresolvedPayment();
        expect(sessionStorage.length).toBe(1);
        const stored = JSON.parse(sessionStorage.getItem(sessionStorage.key(0) ?? '') ?? 'null');
        expect(stored[0]).toMatchObject({
            orderId: syntheticOrder.id,
            orderCode: syntheticOrder.code,
            kind: 'payment',
        });
        expect(stored[0]).not.toHaveProperty('token');
        expect(JSON.stringify(stored)).not.toContain('synthetic-original-token');
        const view = await renderPayment(api);
        try {
            expect(view.host.textContent).toContain('核对付款结果');
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            expect(api.order).toHaveBeenCalledExactlyOnceWith(syntheticOrder.id, undefined, 'CNY');
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.createOrderConfirmationToken).toHaveBeenCalledTimes(1);
            expect(api.orderByConfirmationToken).toHaveBeenCalledTimes(1);
            expect(view.host.textContent).toContain('付款结果尚未确认');
        } finally {
            await view.unmount();
        }
    });

    it('shows a confirmed-order entry after authenticated recovery without generating another token', async () => {
        const api = await leaveUnresolvedPayment();
        api.order.mockResolvedValueOnce({ ...syntheticOrder, state: 'PaymentSettled' });
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            expect(view.host.textContent).toContain('付款已确认');
            expect(view.host.textContent).toContain(syntheticOrder.code);
            expect(view.host.textContent).toContain('查看我的订单');
            expect(view.onComplete).not.toHaveBeenCalled();
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.createOrderConfirmationToken).toHaveBeenCalledTimes(1);
            expect(sessionStorage.length).toBe(0);
        } finally {
            await view.unmount();
        }
    });

    it('keeps the recovered paid order after leaving and returning without another payment', async () => {
        const api = await leaveUnresolvedPayment();
        const paidOrder = { ...syntheticOrder, state: 'PaymentSettled' };
        api.order.mockResolvedValueOnce(paidOrder);
        let currentOrder = syntheticOrder;
        const onOrderChange = vi.fn((latest: typeof syntheticOrder) => {
            currentOrder = latest;
        });
        const recovery = await renderPayment(api, { order: currentOrder, onOrderChange });
        try {
            await act(async () => {
                recovery.submit();
                await Promise.resolve();
            });
            expect(recovery.host.textContent).toContain('付款已确认');
            expect(onOrderChange).toHaveBeenCalledExactlyOnceWith(paidOrder);
        } finally {
            await recovery.unmount();
        }
        const returned = await renderPayment(api, { order: currentOrder, onOrderChange });
        try {
            expect(returned.host.querySelector('form')).toBeNull();
            expect(returned.host.textContent).not.toContain('确认支付');
            expect(returned.host.textContent).toContain('查看我的订单');
            await act(async () => {
                returned.submit();
                returned.balance();
                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.createOrderConfirmationToken).toHaveBeenCalledTimes(1);
            expect(api.useReferralBalance).not.toHaveBeenCalled();
        } finally {
            await returned.unmount();
        }
    });

    it('recovers the original order when the active cart has disappeared after reload', async () => {
        const api = await leaveUnresolvedPayment();
        api.order.mockResolvedValueOnce({ ...syntheticOrder, state: 'Delivered' });
        const view = await renderPayment(api, { order: null });
        try {
            expect(view.host.textContent).toContain('请核对原付款结果');
            const check = [...view.host.querySelectorAll('button')].find(
                button => button.textContent === '核对付款结果',
            );
            await act(async () => {
                check?.click();
                await Promise.resolve();
            });
            expect(api.order).toHaveBeenCalledExactlyOnceWith(syntheticOrder.id, undefined, 'CNY');
            expect(view.host.textContent).toContain('付款已确认');
            expect(view.host.textContent).toContain('查看我的订单');
            expect(api.createOrderConfirmationToken).toHaveBeenCalledTimes(1);
            expect(view.onComplete).not.toHaveBeenCalled();
        } finally {
            await view.unmount();
        }
    });

    it('does not unlock after a failed authenticated result check', async () => {
        const api = await leaveUnresolvedPayment();
        api.order.mockRejectedValueOnce(
            new ShopApiGraphQlError(['synthetic validation failure'], 400, 'GRAPHQL_VALIDATION_FAILED', true),
        );
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            expect(api.order).toHaveBeenCalledTimes(2);
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(view.host.textContent).toContain('付款结果尚未确认');
            expect(sessionStorage.length).toBe(1);
        } finally {
            await view.unmount();
        }
    });

    it('recovers a previously applied balance without spending it again after reload', async () => {
        mocks.walletBalance = 50;
        const api = syntheticApi({
            useReferralBalance: vi.fn().mockRejectedValue(new Error('synthetic lost balance result')),
        });
        const first = await renderPayment(api);
        await act(async () => {
            first.balance();
            await Promise.resolve();
        });
        await first.unmount();
        queryClient.clear();
        const partial = {
            ...syntheticOrder,
            payments: [{ id: 'synthetic-balance', method: 'referral-balance', amount: 50, state: 'Settled' }],
        };
        api.order.mockResolvedValueOnce(partial);
        const second = await renderPayment(api);
        try {
            await act(async () => {
                second.submit();
                await Promise.resolve();
            });
            expect(api.useReferralBalance).toHaveBeenCalledTimes(1);
            expect(api.addPaymentToOrder).not.toHaveBeenCalled();
            expect(api.order).toHaveBeenCalledExactlyOnceWith(syntheticOrder.id, undefined, 'CNY');
            expect(second.onOrderChange).toHaveBeenCalledWith(partial);
            await second.render({ order: partial });
            expect(
                [...second.host.querySelectorAll('button')].some(button => button.textContent === '使用余额'),
            ).toBe(false);
            expect(sessionStorage.length).toBe(0);
        } finally {
            await second.unmount();
        }
    });

    it.each([
        { marketCode: 'different-store', customerId: 'synthetic-customer' },
        { marketCode: 'synthetic', customerId: 'different-customer' },
    ])('does not restore another $marketCode/$customerId marker', async ({ marketCode, customerId }) => {
        const api = await leaveUnresolvedPayment();
        const view = await renderPayment(api, { marketCode });
        try {
            await view.render({ customer: { id: customerId } });
            expect(view.host.textContent).not.toContain('付款结果尚未确认');
            expect(view.host.querySelector('button[type=submit]')?.textContent).toContain('确认支付');
            expect(api.order).not.toHaveBeenCalled();
            expect(sessionStorage.length).toBe(1);
        } finally {
            await view.unmount();
        }
    });

    it('does not admit a late authenticated read after the customer changes', async () => {
        const api = await leaveUnresolvedPayment();
        const read = deferred<typeof syntheticOrder>();
        api.order.mockReturnValueOnce(read.promise);
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            await view.render({ customer: { id: 'different-customer' } });
            await act(async () => {
                read.resolve({ ...syntheticOrder, state: 'PaymentSettled' });
                await Promise.resolve();
            });
            expect(view.onOrderChange).not.toHaveBeenCalled();
            expect(view.onComplete).not.toHaveBeenCalled();
            expect(view.host.textContent).not.toContain('付款已确认');
            expect(view.host.textContent).not.toContain('付款结果尚未确认');
        } finally {
            await view.unmount();
        }
    });

    it('retains the original in-memory attempt when the actual market currency changes', async () => {
        const api = syntheticApi();
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            await view.render({
                market: { code: 'synthetic', currencyCode: 'USD' },
                displayCurrencyCode: 'USD',
            });
            expect(view.host.querySelector('button[type=submit]')?.textContent).toContain('核对付款结果');
            api.orderByConfirmationToken.mockResolvedValueOnce({
                ...syntheticOrder,
                state: 'PaymentSettled',
            });
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(view.onComplete).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ currencyCode: 'CNY', state: 'PaymentSettled' }),
                'synthetic-original-token',
            );
        } finally {
            await view.unmount();
        }
    });

    it('restores the original marker under a different displayed market currency after reload', async () => {
        const api = await leaveUnresolvedPayment();
        const view = await renderPayment(api);
        try {
            await view.render({
                market: { code: 'synthetic', currencyCode: 'USD' },
                displayCurrencyCode: 'USD',
            });
            expect(view.host.querySelector('button[type=submit]')?.textContent).toContain('核对付款结果');
            api.order.mockResolvedValueOnce({ ...syntheticOrder, state: 'PaymentAuthorized' });
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            expect(api.order).toHaveBeenCalledExactlyOnceWith(syntheticOrder.id, undefined, 'CNY');
            expect(api.addPaymentToOrder).toHaveBeenCalledTimes(1);
            expect(api.createOrderConfirmationToken).toHaveBeenCalledTimes(1);
            expect(view.onComplete).not.toHaveBeenCalled();
            expect(view.host.textContent).toContain('付款已确认');
            expect(sessionStorage.length).toBe(0);
        } finally {
            await view.unmount();
        }
    });

    it('refuses to send payment when the browser cannot retain the recovery marker', async () => {
        const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('synthetic storage denial');
        });
        const api = syntheticApi();
        const view = await renderPayment(api);
        try {
            await act(async () => {
                view.submit();
                await Promise.resolve();
            });
            expect(api.addPaymentToOrder).not.toHaveBeenCalled();
            expect(api.order).not.toHaveBeenCalled();
            expect(api.orderByConfirmationToken).not.toHaveBeenCalled();
            expect(view.host.textContent).toContain('浏览器无法保存付款核对记录');
        } finally {
            storage.mockRestore();
            await view.unmount();
        }
    });
});
