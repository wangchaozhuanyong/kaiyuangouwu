// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import { RouteState } from '../storefront-router';
import { ActiveCustomer, Order } from '../types';

import { useStorefrontRouteData } from './useStorefrontRouteData';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('order detail status recovery', () => {
    it('shows the cached order immediately and refreshes its status when the page remounts', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const pending = { id: 'order-a', state: 'ArrangingPayment' } as Order;
        const settled = { ...pending, state: 'PaymentSettled' };
        let finishRefresh: ((order: Order) => void) | undefined;
        const order = vi
            .fn()
            .mockResolvedValueOnce(pending)
            .mockImplementationOnce(
                () =>
                    new Promise<Order>(resolve => {
                        finishRefresh = resolve;
                    }),
            );
        const api = { order } as unknown as ShopApi;
        const options = {
            api,
            market: enabledMarkets[0],
            language: 'zh' as const,
            vendureLanguageCode: 'zh_Hans' as const,
            storefrontContextResolved: true,
            customerAuthenticated: true,
            customer: { id: 'customer-a' } as ActiveCustomer,
            customerLoadState: 'ready' as const,
            route: { name: 'order-detail', id: 'order-a' } as RouteState,
        };
        const element = document.createElement('div');
        let root = createRoot(element);

        function Page() {
            const { routeOrder } = useStorefrontRouteData(options);
            return <output>{routeOrder?.state ?? 'loading'}</output>;
        }
        async function mount() {
            await act(async () => {
                root.render(
                    <QueryClientProvider client={client}>
                        <Page />
                    </QueryClientProvider>,
                );
                await Promise.resolve();
            });
        }

        try {
            await mount();
            await vi.waitFor(() => expect(element.textContent).toBe('ArrangingPayment'));
            act(() => root.unmount());

            root = createRoot(element);
            await mount();
            expect(element.textContent).toBe('ArrangingPayment');
            await vi.waitFor(() => expect(order).toHaveBeenCalledTimes(2));
            const resolveRefresh = finishRefresh;
            if (!resolveRefresh) throw new Error('Order refresh did not start');
            await act(async () => {
                resolveRefresh(settled);
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(element.textContent).toBe('PaymentSettled'));
        } finally {
            act(() => root.unmount());
            client.clear();
        }
    });
});
