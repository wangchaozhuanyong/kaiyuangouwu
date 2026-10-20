// @vitest-environment jsdom
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ShopApi } from './api';
import { DesktopLayoutContext } from './desktop-layout';
import { enabledMarkets } from './i18n';
import { OrdersPage } from './order-pages';
import { PageReadinessBoundary } from './page-readiness';
import { storefrontQueryKeys } from './query-client';
import { type ActiveCustomer, type OrderSummary } from './types';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const market = enabledMarkets[0];
const customer = {
    id: 'list-owner',
    firstName: 'Buyer',
    lastName: '',
    emailAddress: 'buyer@example.invalid',
    phoneNumber: null,
} as ActiveCustomer;
const order = {
    id: 'first',
    code: 'FIRST-ORDER',
    state: 'Delivered',
    orderPlacedAt: '2026-10-19T00:00:00Z',
    totalQuantity: 1,
    totalWithTax: 1000,
    currencyCode: market.currencyCode,
    lines: [],
    customFields: {},
} as OrderSummary;
const queryKey = storefrontQueryKeys.customerOrders(storefrontQueryKeys.market(market), 'en', customer.id, {
    tab: 'all',
    orderCode: '',
});

describe('orders list loading and recovery', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let client: QueryClient;
    let readOrders: ReturnType<typeof vi.fn<ShopApi['customerOrders']>>;
    const retryPage = vi.fn();
    beforeEach(() => {
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        readOrders = vi.fn<ShopApi['customerOrders']>().mockResolvedValue({ items: [], totalItems: 0 });
        retryPage.mockClear();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        host.remove();
        onlineManager.setOnline(true);
        vi.useRealTimers();
    });
    async function render(desktop = false, withReadiness = false) {
        await act(async () => {
            const content = (
                <QueryClientProvider client={client}>
                    <DesktopLayoutContext.Provider value={desktop}>
                        <OrdersPage
                            api={
                                {
                                    customerOrders: readOrders,
                                    customerOrderCounts: vi.fn().mockResolvedValue({
                                        pending: 0,
                                        shipping: 0,
                                        receiving: 0,
                                        completed: 0,
                                    }),
                                    afterSalesRequests: vi.fn().mockResolvedValue([]),
                                } as unknown as ShopApi
                            }
                            customer={customer}
                            market={market}
                            locale="en-MY"
                            language="en"
                            storefrontName="Fixture"
                            initialTab="all"
                            onBack={vi.fn()}
                            onBuyAgain={vi.fn()}
                            onNotify={vi.fn()}
                        />
                    </DesktopLayoutContext.Provider>
                </QueryClientProvider>
            );
            root.render(
                withReadiness ? (
                    <PageReadinessBoundary
                        pending={false}
                        online={true}
                        language="en"
                        navigationKey="orders"
                        onRetry={retryPage}
                        onBack={vi.fn()}
                    >
                        {content}
                    </PageReadinessBoundary>
                ) : (
                    content
                ),
            );
            await Promise.resolve();
        });
        await act(async () => {
            if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(20);
            else await new Promise(resolve => setTimeout(resolve, 20));
        });
    }
    it('retries only the slow initial list after its local deadline and keeps order tabs', async () => {
        vi.useFakeTimers();
        let resolveRead!: (value: { items: OrderSummary[]; totalItems: number }) => void;
        readOrders
            .mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        resolveRead = resolve;
                    }),
            )
            .mockResolvedValue({ items: [order], totalItems: 1 });
        await render(false, true);
        const tabs = host.querySelector('.order-tabs');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_001);
        });
        expect(host.querySelector('.orders-page .page-readiness-inline-error')).not.toBeNull();
        expect(host.querySelector('[data-page-pending]')).toBeNull();
        expect(host.querySelector('.page-readiness-overlay')).toBeNull();
        act(() =>
            (host.querySelector('.orders-page .page-readiness-error button') as HTMLButtonElement).click(),
        );
        expect(retryPage).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(readOrders).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll('.order-card')).toHaveLength(1);
        await act(async () => {
            resolveRead({ items: [{ ...order, id: 'abandoned', code: 'ABANDONED' }], totalItems: 1 });
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(host.querySelectorAll('.order-card')).toHaveLength(1);
        expect(host.querySelector('.order-tabs')).toBe(tabs);
        expect(client.getQueryData(queryKey)).toMatchObject({ pages: [{ items: [{ id: 'first' }] }] });
    });
    it('gives a different order tab a full deadline after the prior tab timed out', async () => {
        vi.useFakeTimers();
        readOrders.mockImplementation(() => new Promise(() => undefined));
        await render(false, true);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_001);
        });
        expect(host.querySelector('.page-readiness-inline-error')).not.toBeNull();
        await act(async () => {
            (host.querySelectorAll('.order-tabs button')[1] as HTMLButtonElement).click();
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(host.querySelector('.page-readiness-inline-error')).toBeNull();
        expect(host.querySelector('[data-page-pending]')).not.toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9_998);
        });
        expect(host.querySelector('.page-readiness-inline-error')).toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2);
        });
        expect(host.querySelector('.page-readiness-inline-error')).not.toBeNull();
        expect(readOrders).toHaveBeenCalledTimes(2);
    });
    it('shows a retryable initial failure and then the recovered orders without hiding tabs', async () => {
        readOrders
            .mockRejectedValueOnce(new Error('List failed'))
            .mockResolvedValue({ items: [order], totalItems: 1 });
        await render();
        expect(host.textContent).toContain('Could not load orders');
        expect(host.querySelector('nav[aria-label="Order status"]')).not.toBeNull();
        await act(async () => {
            const retry = Array.from(host.querySelectorAll('button')).find(
                button => button.textContent === 'Retry',
            );
            if (!retry) throw new Error('Expected initial orders retry button');
            retry.click();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(host.querySelectorAll('.order-card')).toHaveLength(1);
        expect(host.textContent).not.toContain('Could not load orders');
    });
    it('shows the offline initial state without an endless skeleton', async () => {
        onlineManager.setOnline(false);
        await render();
        expect(host.textContent).toContain('offline');
        expect(host.querySelector('[data-page-pending]')).toBeNull();
        expect(readOrders).not.toHaveBeenCalled();
    });
    it('uses the confirmed unfiltered list total when the optional recent summary is unavailable', async () => {
        readOrders.mockResolvedValue({ items: [order], totalItems: 1 });
        await render(true);
        expect(host.querySelector('.order-tabs button')?.textContent).toBe('All1');
    });
    it('keeps loaded orders and gives a local retry for a failed next page', async () => {
        readOrders
            .mockResolvedValueOnce({ items: [order], totalItems: 2 })
            .mockRejectedValueOnce(new Error('Next page failed'))
            .mockResolvedValue({ items: [{ ...order, id: 'second', code: 'SECOND-ORDER' }], totalItems: 2 });
        await render();
        await act(async () => {
            (host.querySelector('.order-load-more') as HTMLButtonElement).click();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(host.querySelectorAll('.order-card')).toHaveLength(1);
        const retry = Array.from(host.querySelectorAll('button')).find(
            button => button.textContent === 'Retry',
        );
        expect(retry).toBeDefined();
        if (!retry) throw new Error('Expected orders pagination retry button');
        await act(async () => {
            retry.click();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(host.querySelectorAll('.order-card')).toHaveLength(2);
        expect(readOrders.mock.calls.at(-1)?.[0]).toBe(1);
        expect(host.querySelector('.order-load-more')).toBeNull();
    });
    it('hides load more when a later page lowers the total', async () => {
        readOrders
            .mockResolvedValueOnce({ items: [order], totalItems: 4 })
            .mockResolvedValue({ items: [{ ...order, id: 'second', code: 'SECOND-ORDER' }], totalItems: 2 });
        await render();
        await act(async () => {
            (host.querySelector('.order-load-more') as HTMLButtonElement).click();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(client.getQueryData(queryKey)).toMatchObject({
            pages: [{ totalItems: 4 }, { totalItems: 2 }],
        });
        expect(host.querySelector('.order-load-more')).toBeNull();
    });
    it.each(['slow', 'offline'])('keeps orders and retries only a %s append', async mode => {
        vi.useFakeTimers();
        const readers: Array<(value: { items: OrderSummary[]; totalItems: number }) => void> = [];
        readOrders.mockResolvedValueOnce({ items: [order], totalItems: 2 }).mockImplementation(
            () =>
                new Promise(resolve => {
                    readers.push(resolve);
                }),
        );
        await render(false, true);
        const firstCard = host.querySelector('.order-card');
        if (mode === 'offline') onlineManager.setOnline(false);
        await act(async () => {
            (host.querySelector('.order-load-more') as HTMLButtonElement).click();
            await vi.advanceTimersByTimeAsync(mode === 'slow' ? 10_001 : 1);
        });
        const retry = host.querySelector<HTMLButtonElement>(
            '.order-list .inline-error button, .order-list .page-readiness-error button',
        );
        expect(retry).not.toBeNull();
        expect(host.querySelector('.order-card')).toBe(firstCard);
        expect(host.querySelector('.page-readiness-overlay')).toBeNull();
        if (!retry) throw new Error('Expected orders append recovery button');
        act(() => retry.click());
        expect(retryPage).not.toHaveBeenCalled();
        await act(async () => {
            onlineManager.setOnline(true);
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(readOrders).toHaveBeenCalledTimes(mode === 'slow' ? 3 : 2);
        await act(async () => {
            const latestReader = readers.at(-1);
            if (!latestReader) throw new Error('Expected an active orders append read');
            latestReader({ items: [{ ...order, id: 'second' }], totalItems: 2 });
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(host.querySelectorAll('.order-card')).toHaveLength(2);
        expect(host.querySelector('.order-card')).toBe(firstCard);
        if (mode === 'slow')
            await act(async () => {
                readers[0]({ items: [{ ...order, id: 'abandoned' }], totalItems: 2 });
                await vi.advanceTimersByTimeAsync(1);
            });
        expect(client.getQueryData(queryKey)).toMatchObject({
            pages: [{ items: [{ id: 'first' }] }, { items: [{ id: 'second' }] }],
        });
        expect(readOrders.mock.calls.at(-1)?.[0]).toBe(1);
    });
});
