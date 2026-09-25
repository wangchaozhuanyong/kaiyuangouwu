// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line import/order -- Prettier keeps this type-only import with the value group.
import type { AfterSalesRequest, OrderSummary } from './types';

import { NotificationsPage, recentNotificationEntries } from './pages/notifications-page';
import { NotificationsPageContext } from './storefront-page-contexts';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), requests: [] as unknown[] }));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mocks.navigate,
    useRouter: () => ({ history: { back: vi.fn() } }),
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-query')>()),
    useQuery: () => ({ data: mocks.requests }),
}));
const order = (id: string, date?: string | null) =>
    ({ id, code: id, state: 'Delivered', orderPlacedAt: date }) as OrderSummary;
const request = (id: string, date: string) =>
    ({ id, code: id, updatedAt: date, state: 'COMPLETED', order: { code: 'ORDER' } }) as AfterSalesRequest;
const ids = (entries: ReturnType<typeof recentNotificationEntries>) =>
    entries.map(entry => (entry.kind === 'order' ? entry.order.id : entry.request.id));

describe('recent notification chronology', () => {
    it('interleaves both sources newest first without changing their input order', () => {
        const orders = [order('older', '2026-09-13T00:00:00Z'), order('latest', '2026-09-14T08:00:00Z')];
        const requests = [request('middle', '2026-09-14T07:00:00Z')];
        expect(ids(recentNotificationEntries(orders, requests))).toEqual(['latest', 'middle', 'older']);
        expect(orders.map(item => item.id)).toEqual(['older', 'latest']);
    });
    it('puts missing and invalid dates last without losing records', () => {
        expect(
            ids(
                recentNotificationEntries(
                    [order('missing'), order('invalid', 'not-a-date')],
                    [request('valid', '2026-09-14T00:00:00Z')],
                ),
            ),
        ).toEqual(['valid', 'missing', 'invalid']);
    });
    it('handles empty sources', () => expect(recentNotificationEntries([], [])).toEqual([]));
    it('renders sorted rows and keeps the distinct order and after-sales destinations', () => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
            true;
        mocks.navigate.mockClear();
        mocks.requests = [request('AS-OLD', '2026-09-13T00:00:00Z')];
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        try {
            act(() =>
                root.render(
                    <QueryClientProvider client={client}>
                        <NotificationsPageContext.Provider
                            value={
                                {
                                    api: {},
                                    customer: {
                                        id: '27',
                                        orders: { items: [order('ORDER-NEW', '2026-09-14T00:00:00Z')] },
                                    },
                                    market: {
                                        code: 'sim',
                                        defaultLanguageCode: 'zh_Hans',
                                        currencyCode: 'CNY',
                                    },
                                    language: 'zh',
                                    locale: 'zh-CN',
                                } as never
                            }
                        >
                            <NotificationsPage />
                        </NotificationsPageContext.Provider>
                    </QueryClientProvider>,
                ),
            );
            const buttons = host.querySelectorAll('.notification-list button');
            expect(buttons[0].textContent).toContain('ORDER-NEW');
            expect(buttons[1].textContent).toContain('AS-OLD');
            act(() => (buttons[0] as HTMLButtonElement).click());
            expect(mocks.navigate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    to: '/order-detail',
                    search: expect.objectContaining({ id: 'ORDER-NEW' }),
                }),
            );
            act(() => (buttons[1] as HTMLButtonElement).click());
            expect(mocks.navigate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    to: '/orders',
                    search: expect.objectContaining({ tab: 'service' }),
                }),
            );
        } finally {
            act(() => root.unmount());
            client.clear();
            host.remove();
        }
    });
});
