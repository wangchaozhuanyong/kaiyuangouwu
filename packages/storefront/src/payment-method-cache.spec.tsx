// @vitest-environment jsdom
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { PaymentPage } from './payment-pages';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { invalidateStorefrontRealtimeQueries } from './realtime-updates';
import { type MarketConfig, type Order } from './types';

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { location: { href: '/payment' } } }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('uses separate real query entries for both payment currencies on the same order', async () => {
    const cache = createStorefrontQueryClient();
    const host = document.createElement('div');
    const root = createRoot(host);
    const card = {
        id: 'card',
        code: 'stripe-card',
        name: 'Synthetic card',
        isEligible: true,
        description: '',
    };
    const usdt = { ...card, id: 'usdt', code: 'usdt-trc20', name: 'USDT-TRC20' };
    const read = vi.fn().mockResolvedValue([card]);
    const api = {
        eligiblePaymentMethods: read,
        createUsdtCheckoutQuote: vi.fn().mockResolvedValue(null),
    } as unknown as ShopApi;
    const render = async (currency: string) => {
        act(() => {
            root.render(
                <QueryClientProvider client={cache}>
                    <PaymentPage
                        api={api}
                        cart={{ state: 'PAYMENT_PENDING' } as never}
                        order={
                            {
                                id: 'same-order',
                                code: 'TEST',
                                state: 'ArrangingPayment',
                                currencyCode: 'CNY',
                                lines: [],
                                payments: [],
                                subTotalWithTax: 990,
                                shippingWithTax: 0,
                                totalWithTax: 990,
                                taxSummary: [],
                                customFields: { paymentCurrencyCode: currency },
                            } as unknown as Order
                        }
                        customer={null}
                        market={{ code: 'fixture', currencyCode: 'CNY' } as never}
                        displayCurrencyCode={currency}
                        locale="zh-CN"
                        language="zh"
                        onCancel={vi.fn()}
                        onComplete={vi.fn()}
                        onOrderChange={vi.fn()}
                    />
                </QueryClientProvider>,
            );
        });
        await act(async () => {
            await vi.waitFor(() => expect(cache.isFetching()).toBe(0));
        });
    };
    try {
        await render('CNY');
        expect(host.textContent).toContain('Synthetic card');
        read.mockResolvedValue([usdt]);
        await render('USDT');
        expect(
            cache.getQueryData(
                storefrontQueryKeys.paymentMethods('fixture:CNY', 'zh_Hans', 'same-order', 'USDT', ''),
            ),
        ).toEqual([usdt]);
        expect(host.textContent).not.toContain('Synthetic card');
        await render('CNY');
        expect(host.textContent).toContain('Synthetic card');
        expect(read).toHaveBeenCalledTimes(2);
    } finally {
        act(() => root.unmount());
        cache.clear();
    }
});

it.each(['CNY', 'USDT'])(
    'uses the real API for prefetch, currency switch, SSE and the retry button (starting %s)',
    async first => {
        const market: MarketConfig = {
            code: 'fixture',
            currencyCode: 'CNY',
            defaultLanguageCode: 'zh_Hans',
            countryCode: 'CN',
            locale: 'zh-CN',
            label: 'Synthetic',
        };
        const cache = createStorefrontQueryClient();
        cache.setDefaultOptions({ queries: { retry: false } });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        let currency = first;
        let failRead = false;
        let revision = 1;
        const reads: string[] = [];
        const method = () => ({
            id: currency,
            code: currency === 'USDT' ? 'usdt-trc20' : 'stripe-card',
            name: `${currency} method ${revision}`,
            isEligible: true,
            description: '',
        });
        const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            await Promise.resolve();
            if (typeof init?.body !== 'string') throw new Error('Expected GraphQL JSON body');
            const body = JSON.parse(init.body);
            if (body.query.includes('SetStorefrontPaymentCurrency')) {
                currency = body.variables.currencyCode;
                return new Response(
                    JSON.stringify({
                        data: {
                            setStorefrontPaymentCurrency: {
                                id: 'same-order',
                                customFields: { paymentCurrencyCode: currency },
                            },
                        },
                    }),
                );
            }
            if (body.query.includes('eligiblePaymentMethods')) {
                reads.push(currency);
                return new Response(
                    JSON.stringify(
                        failRead
                            ? {
                                  errors: [
                                      {
                                          message: 'Synthetic methods unavailable',
                                          extensions: { code: 'USER_INPUT_ERROR' },
                                      },
                                  ],
                              }
                            : { data: { eligiblePaymentMethods: [method()] } },
                    ),
                );
            }
            if (body.query.includes('createStorefrontUsdtCheckoutQuote'))
                return new Response(JSON.stringify({ data: { createStorefrontUsdtCheckoutQuote: null } }));
            throw new Error('Unexpected synthetic GraphQL operation');
        });
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const key = () =>
            storefrontQueryKeys.paymentMethods('fixture:CNY', 'zh_Hans', 'same-order', currency, '');
        const render = async () => {
            await act(
                async () =>
                    await Promise.resolve(
                        root.render(
                            <QueryClientProvider client={cache}>
                                <PaymentPage
                                    api={api}
                                    market={market}
                                    locale="zh-CN"
                                    language="zh"
                                    displayCurrencyCode={currency}
                                    customer={null}
                                    cart={{ state: 'PAYMENT_PENDING' } as never}
                                    order={
                                        {
                                            id: 'same-order',
                                            code: 'SYNTHETIC',
                                            state: 'ArrangingPayment',
                                            currencyCode: 'CNY',
                                            lines: [],
                                            payments: [],
                                            subTotalWithTax: 990,
                                            shippingWithTax: 0,
                                            totalWithTax: 990,
                                            taxSummary: [],
                                            customFields: { paymentCurrencyCode: currency },
                                        } as unknown as Order
                                    }
                                    onCancel={vi.fn()}
                                    onComplete={vi.fn()}
                                    onOrderChange={vi.fn()}
                                />
                            </QueryClientProvider>,
                        ),
                    ),
            );
        };
        const wait = async (assert: () => void) => {
            await act(async () => {
                await vi.waitFor(assert);
            });
        };
        try {
            // Uses the production key and API; PaymentPage must consume this exact entry.
            await cache.prefetchQuery({
                queryKey: key(),
                queryFn: ({ signal }) => api.eligiblePaymentMethods(signal),
            });
            await render();
            await wait(() => expect(host.textContent).toContain(`${first} method 1`));
            expect(reads).toEqual([first]);
            const second = first === 'CNY' ? 'USDT' : 'CNY';
            await api.setPaymentCurrencyForOrder(second);
            await render();
            await wait(() => expect(reads).toEqual([first, second]));
            expect(cache.getQueryData(key())).toEqual([expect.objectContaining({ id: second })]);
            expect(host.textContent).not.toContain(`${first} method 1`);
            revision = 2;
            await act(async () => {
                await invalidateStorefrontRealtimeQueries(
                    cache,
                    {
                        version: 1,
                        id: 'synthetic-event',
                        occurredAt: '2026-10-26T00:00:00Z',
                        topics: ['orders'],
                        entityType: 'Order',
                        entityIds: ['same-order'],
                    },
                    { marketCode: 'fixture:CNY', languageCode: 'zh_Hans' },
                );
            });
            expect(reads).toEqual([first, second, second]);
            expect(cache.getQueryData(key())).toEqual([
                expect.objectContaining({ name: `${second} method 2` }),
            ]);
            failRead = true;
            await act(async () => {
                await cache.refetchQueries({ queryKey: key(), exact: true });
            });
            await wait(() => expect(cache.getQueryState(key())?.status).toBe('error'));
            failRead = false;
            revision = 3;
            await wait(() =>
                expect(
                    [...host.querySelectorAll<HTMLButtonElement>('button')].some(button =>
                        button.textContent?.includes('重试'),
                    ),
                ).toBe(true),
            );
            const retry = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button =>
                button.textContent?.includes('重试'),
            );
            expect(retry).toBeDefined();
            await act(async () => {
                retry?.click();
                await Promise.resolve();
            });
            await wait(() => expect(cache.getQueryState(key())?.status).toBe('success'));
            expect(cache.getQueryData(key())).toEqual([
                expect.objectContaining({ name: `${second} method 3` }),
            ]);
            expect(reads).toEqual([first, second, second, second, second]);
        } finally {
            act(() => root.unmount());
            cache.clear();
            host.remove();
            vi.unstubAllGlobals();
        }
    },
);

it('pauses a first read offline and resumes the actual payment query after reconnect', async () => {
    const cache = createStorefrontQueryClient();
    const host = document.createElement('div');
    const root = createRoot(host);
    const read = vi.fn().mockResolvedValue([]);
    onlineManager.setOnline(false);
    try {
        await act(
            async () =>
                await Promise.resolve(
                    root.render(
                        <QueryClientProvider client={cache}>
                            <PaymentPage
                                api={{ eligiblePaymentMethods: read } as unknown as ShopApi}
                                market={{ code: 'fixture', currencyCode: 'CNY' } as never}
                                locale="zh-CN"
                                language="zh"
                                displayCurrencyCode="CNY"
                                customer={null}
                                cart={{ state: 'PAYMENT_PENDING' } as never}
                                order={
                                    {
                                        id: 'offline-order',
                                        code: 'SYNTHETIC',
                                        state: 'ArrangingPayment',
                                        currencyCode: 'CNY',
                                        lines: [],
                                        payments: [],
                                        taxSummary: [],
                                        customFields: {},
                                    } as unknown as Order
                                }
                                onCancel={vi.fn()}
                                onComplete={vi.fn()}
                                onOrderChange={vi.fn()}
                            />
                        </QueryClientProvider>,
                    ),
                ),
        );
        expect(read).not.toHaveBeenCalled();
        await act(async () => {
            onlineManager.setOnline(true);
            await Promise.resolve();
        });
        await act(async () => {
            await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
        });
    } finally {
        onlineManager.setOnline(true);
        act(() => root.unmount());
        cache.clear();
    }
});

it('does not let a late response for the old currency replace the current payment methods', async () => {
    const cache = createStorefrontQueryClient();
    const host = document.createElement('div');
    const root = createRoot(host);
    const card = { id: 'card', code: 'stripe-card', name: 'Old CNY card', isEligible: true, description: '' };
    const usdt = { ...card, id: 'usdt', code: 'usdt-trc20', name: 'USDT-TRC20' };
    let finishOld: ((methods: Array<typeof card>) => void) | undefined;
    const read = vi
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishOld = resolve;
                }),
        )
        .mockResolvedValue([usdt]);
    const api = {
        eligiblePaymentMethods: read,
        createUsdtCheckoutQuote: vi.fn().mockResolvedValue(null),
    } as unknown as ShopApi;
    const render = async (currency: string) => {
        await act(
            async () =>
                await Promise.resolve(
                    root.render(
                        <QueryClientProvider client={cache}>
                            <PaymentPage
                                api={api}
                                customer={null}
                                market={{ code: 'fixture', currencyCode: 'CNY' } as never}
                                locale="zh-CN"
                                language="zh"
                                displayCurrencyCode={currency}
                                cart={{ state: 'PAYMENT_PENDING' } as never}
                                order={
                                    {
                                        id: 'late-order',
                                        code: 'SYNTHETIC',
                                        state: 'ArrangingPayment',
                                        currencyCode: 'CNY',
                                        lines: [],
                                        payments: [],
                                        taxSummary: [],
                                        customFields: { paymentCurrencyCode: currency },
                                    } as unknown as Order
                                }
                                onCancel={vi.fn()}
                                onComplete={vi.fn()}
                                onOrderChange={vi.fn()}
                            />
                        </QueryClientProvider>,
                    ),
                ),
        );
    };
    try {
        await render('CNY');
        await render('USDT');
        await act(async () => {
            await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        });
        await act(async () => {
            if (!finishOld) throw new Error('Old request did not start');
            finishOld([card]);
            await Promise.resolve();
        });
        await act(async () => {
            await vi.waitFor(() =>
                expect(
                    cache.getQueryData(
                        storefrontQueryKeys.paymentMethods(
                            'fixture:CNY',
                            'zh_Hans',
                            'late-order',
                            'USDT',
                            '',
                        ),
                    ),
                ).toEqual([usdt]),
            );
        });
        expect(host.textContent).not.toContain('Old CNY card');
        expect(read.mock.calls[0][0].aborted).toBe(true);
    } finally {
        act(() => root.unmount());
        cache.clear();
    }
});
