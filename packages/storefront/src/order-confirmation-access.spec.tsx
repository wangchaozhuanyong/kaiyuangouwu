// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line import/order -- Prettier organizes type-only imports after runtime imports.
import type { ShopApi } from './api';
// eslint-disable-next-line import/order -- Prettier organizes type-only imports after runtime imports.
import type { MarketConfig, Order } from './types';

import { OrderConfirmationPage } from './payment-pages';
import { storefrontQueryKeys } from './query-client';

vi.mock('@tanstack/react-router', async importOriginal => {
    const { createMemoryHistory } = await importOriginal<typeof import('@tanstack/react-router')>();
    const navigate = vi.fn();
    const router = { history: createMemoryHistory({ initialEntries: ['/order-confirmation'] }), navigate };
    return { useNavigate: () => navigate, useRouter: () => router };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market = { code: 'probe', currencyCode: 'MYR' } as MarketConfig;
const order = {
    id: 'private-order-1',
    code: 'PRIVATE-ORDER-123',
    state: 'PaymentSettled',
    totalQuantity: 1,
    subTotalWithTax: 12345,
    shippingWithTax: 0,
    totalWithTax: 12345,
    currencyCode: 'MYR',
    payments: [],
    lines: [],
    discounts: [],
    taxSummary: [],
    couponCodes: [],
    customFields: {},
} satisfies Order;

describe('order confirmation access', () => {
    it('retains a confirmed submission after a read failure and retries in the original order currency', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const submittedOrder = { ...order, state: 'AwaitingManualPayment', currencyCode: 'CNY' };
        const read = vi
            .fn()
            .mockRejectedValueOnce(new Error('Read temporarily unavailable'))
            .mockResolvedValueOnce(submittedOrder);
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() =>
                root.render(
                    <QueryClientProvider client={client}>
                        <OrderConfirmationPage
                            api={{ orderByConfirmationToken: read } as unknown as ShopApi}
                            code={order.code}
                            confirmationToken="valid-token"
                            submittedOrder={submittedOrder}
                            customer={null}
                            market={market}
                            locale="zh-CN"
                            language="zh"
                        />
                    </QueryClientProvider>,
                ),
            );
            await act(async () => {
                await vi.waitFor(() => expect(host.textContent).toContain('请勿重复下单'));
            });
            expect(host.textContent).toContain(order.code);
            expect(host.textContent).not.toContain('123.45');
            expect(host.textContent).toContain('查看我的订单');
            expect(read).toHaveBeenCalledWith('valid-token', expect.any(AbortSignal), 'CNY');
            await act(async () => {
                const retry = Array.from(host.querySelectorAll('button')).find(
                    button => button.textContent === '重试读取',
                );
                if (!retry) throw new Error('Missing read-only retry action');
                retry.click();
                await vi.waitFor(() => expect(host.querySelector('.order-confirmation-page')).not.toBeNull());
            });
            expect(read).toHaveBeenCalledTimes(2);
            expect(host.textContent).toContain('待客服确认收款');
        } finally {
            act(() => root.unmount());
            client.clear();
        }
    });
    it.each([
        { responseCode: order.code, visible: true },
        { responseCode: 'ANOTHER-ORDER', visible: false },
    ])(
        'shows order data only when the token returns the requested code',
        async ({ responseCode, visible }) => {
            const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            const apiMock = {
                orderByConfirmationToken: vi.fn().mockResolvedValue({ ...order, code: responseCode }),
            };
            const host = document.createElement('div');
            const root = createRoot(host);
            try {
                act(() => {
                    root.render(
                        <QueryClientProvider client={client}>
                            <OrderConfirmationPage
                                api={apiMock as unknown as ShopApi}
                                code={order.code}
                                confirmationToken="valid-token"
                                customer={null}
                                market={market}
                                locale="zh-CN"
                                language="zh"
                            />
                        </QueryClientProvider>,
                    );
                });
                const queryKey = [
                    ...storefrontQueryKeys.orderByCode(
                        storefrontQueryKeys.market(market),
                        'zh_Hans',
                        order.code,
                    ),
                    'valid-token',
                ];
                await act(async () => {
                    await vi.waitFor(() => expect(apiMock.orderByConfirmationToken).toHaveBeenCalled());
                    await vi.waitFor(() => expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle'));
                });
                expect(Boolean(host.querySelector('.order-confirmation-page'))).toBe(visible);
                if (visible) expect(host.textContent).toContain(order.code);
                else expect(host.textContent).not.toContain(responseCode);
                expect(apiMock.orderByConfirmationToken).toHaveBeenCalled();
            } finally {
                act(() => root.unmount());
                client.clear();
            }
        },
    );

    it.each([
        { token: '', cachedToken: '' },
        { token: 'invalid-token', cachedToken: 'invalid-token' },
        { token: 'wrong-token', cachedToken: 'valid-token' },
    ])('hides private order data when the confirmation token is "$token"', async ({ token, cachedToken }) => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const baseQueryKey = storefrontQueryKeys.orderByCode(
            storefrontQueryKeys.market(market),
            'zh_Hans',
            order.code,
        );
        client.setQueryData(cachedToken ? [...baseQueryKey, cachedToken] : baseQueryKey, order);
        const queryKey = [...baseQueryKey, token];
        const apiMock = {
            orderByConfirmationToken: vi.fn().mockRejectedValue(new Error('Invalid confirmation token')),
        };
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => {
                root.render(
                    <QueryClientProvider client={client}>
                        <OrderConfirmationPage
                            api={apiMock as unknown as ShopApi}
                            code={order.code}
                            confirmationToken={token}
                            customer={null}
                            market={market}
                            locale="zh-CN"
                            language="zh"
                        />
                    </QueryClientProvider>,
                );
            });
            if (token) {
                await act(async () => {
                    await vi.waitFor(() => expect(apiMock.orderByConfirmationToken).toHaveBeenCalled());
                    await vi.waitFor(() => expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle'));
                });
            } else {
                expect(apiMock.orderByConfirmationToken).not.toHaveBeenCalled();
            }
            expect(host.querySelector('.order-confirmation-page')).toBeNull();
            expect(host.textContent).not.toContain(order.code);
        } finally {
            act(() => root.unmount());
            client.clear();
        }
    });

    it('does not flash a cached order while its token is being revalidated', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const token = 'revoked-token';
        const queryKey = [
            ...storefrontQueryKeys.orderByCode(storefrontQueryKeys.market(market), 'zh_Hans', order.code),
            token,
        ];
        client.setQueryData(queryKey, order);
        let rejectFetch: ((reason: Error) => void) | undefined;
        const apiMock = {
            orderByConfirmationToken: vi.fn().mockImplementation(
                () =>
                    new Promise<Order>((_resolve, reject) => {
                        rejectFetch = reject;
                    }),
            ),
        };
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            act(() => {
                root.render(
                    <QueryClientProvider client={client}>
                        <OrderConfirmationPage
                            api={apiMock as unknown as ShopApi}
                            code={order.code}
                            confirmationToken={token}
                            customer={null}
                            market={market}
                            locale="zh-CN"
                            language="zh"
                        />
                    </QueryClientProvider>,
                );
            });
            expect(host.querySelector('.order-confirmation-page')).toBeNull();
            expect(host.textContent).not.toContain(order.code);
            const reject = rejectFetch;
            if (!reject) throw new Error('Token revalidation did not start');
            await act(async () => {
                reject(new Error('Token expired'));
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle'));
            expect(host.querySelector('.order-confirmation-page')).toBeNull();
            expect(host.textContent).not.toContain(order.code);
        } finally {
            act(() => root.unmount());
            client.clear();
        }
    });

    it('hides the previous order immediately when the token changes on the mounted page', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const baseQueryKey = storefrontQueryKeys.orderByCode(
            storefrontQueryKeys.market(market),
            'zh_Hans',
            order.code,
        );
        client.setQueryData([...baseQueryKey, 'invalid-token'], order);
        let rejectInvalid: ((reason: Error) => void) | undefined;
        const apiMock = {
            orderByConfirmationToken: vi.fn().mockImplementation((token: string) =>
                token === 'valid-token'
                    ? Promise.resolve(order)
                    : new Promise<Order>((_resolve, reject) => {
                          rejectInvalid = reject;
                      }),
            ),
        };
        const host = document.createElement('div');
        const root = createRoot(host);
        const page = (token: string) => (
            <QueryClientProvider client={client}>
                <OrderConfirmationPage
                    api={apiMock as unknown as ShopApi}
                    code={order.code}
                    confirmationToken={token}
                    customer={null}
                    market={market}
                    locale="zh-CN"
                    language="zh"
                />
            </QueryClientProvider>
        );
        try {
            act(() => root.render(page('valid-token')));
            await act(async () => {
                await vi.waitFor(() =>
                    expect(client.getQueryState([...baseQueryKey, 'valid-token'])?.fetchStatus).toBe('idle'),
                );
            });
            expect(host.querySelector('.order-confirmation-page')).not.toBeNull();

            act(() => root.render(page('invalid-token')));
            expect(host.querySelector('.order-confirmation-page')).toBeNull();
            expect(host.textContent).not.toContain(order.code);
            const reject = rejectInvalid;
            if (!reject) throw new Error('New token validation did not start');
            await act(async () => {
                reject(new Error('Invalid token'));
                await Promise.resolve();
            });
            expect(host.querySelector('.order-confirmation-page')).toBeNull();
        } finally {
            act(() => root.unmount());
            client.clear();
        }
    });
});
