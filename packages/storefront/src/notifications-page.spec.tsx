// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line import/order -- Prettier keeps this type-only import with the value group.
import type { AfterSalesRequest, OrderSummary } from './types';

import {
    NotificationsPage,
    notificationReferenceKey,
    recentNotificationEntries,
} from './pages/notifications-page';
import { NotificationsPageContext } from './storefront-page-contexts';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), requests: [] as unknown[], realQueries: false }));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mocks.navigate,
    useRouter: () => ({ history: { back: vi.fn() } }),
}));
vi.mock('@tanstack/react-query', async importOriginal => {
    const original = await importOriginal<typeof import('@tanstack/react-query')>();
    return {
        ...original,
        useQuery: (options: Parameters<typeof original.useQuery>[0]) =>
            mocks.realQueries
                ? original.useQuery(options)
                : {
                      data: options.queryKey.includes('notification-reads')
                          ? { keys: [], versions: [] }
                          : mocks.requests,
                  },
    };
});
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
    it('opens messages in a drawer and keeps explicit order and after-sales destinations', async () => {
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
                                    api: {
                                        contentReviewsApi: {
                                            markNotificationsRead: vi.fn().mockResolvedValue([]),
                                        },
                                    },
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
            await act(async () => {
                (buttons[0] as HTMLButtonElement).click();
                await Promise.resolve();
            });
            expect(mocks.navigate).not.toHaveBeenCalled();
            expect(document.querySelector('.notification-detail-sheet')?.textContent).toContain('ORDER-NEW');
            expect(document.querySelector('.notification-detail-sheet')?.getAttribute('data-side')).toBe(
                'right',
            );
            act(() =>
                (
                    document.querySelector('.notification-detail-footer .primary-action') as HTMLButtonElement
                ).click(),
            );
            expect(mocks.navigate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    to: '/order-detail',
                    search: expect.objectContaining({ id: 'ORDER-NEW' }),
                }),
            );
            await act(async () => {
                (buttons[1] as HTMLButtonElement).click();
                await Promise.resolve();
            });
            expect(document.querySelector('.notification-detail-sheet')?.textContent).toContain('AS-OLD');
            expect(mocks.navigate).toHaveBeenCalledTimes(1);
            act(() =>
                (
                    document.querySelector('.notification-detail-footer .primary-action') as HTMLButtonElement
                ).click(),
            );
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

const versionedOrder = (id: string, version = '2026-10-07T00:00:00Z') =>
    ({ ...order(id, version), updatedAt: version }) as OrderSummary;
const readKey = (entry: OrderSummary) => {
    if (!entry.updatedAt) throw new Error('Expected the notification source version');
    return notificationReferenceKey({ kind: 'ORDER', sourceId: entry.id, version: entry.updatedAt });
};
const settleQueries = () =>
    act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
    });

async function notificationFixture(initialOrders: OrderSummary[], initialReadKeys: string[] | Error) {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.realQueries = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const reads =
        initialReadKeys instanceof Error
            ? vi.fn().mockRejectedValue(initialReadKeys)
            : vi.fn().mockResolvedValue(initialReadKeys);
    let context = {
        api: {
            afterSalesRequests: vi.fn().mockResolvedValue([]),
            contentReviewsApi: {
                notificationReadKeys: reads,
                markNotificationsRead: vi.fn().mockResolvedValue([]),
            },
        },
        customer: { id: 'customer-a', orders: { items: initialOrders } },
        market: { code: 'store-a', currencyCode: 'MYR', defaultLanguageCode: 'zh_Hans' },
        language: 'zh',
        locale: 'zh-CN',
    };
    const render = (next: Partial<typeof context> = {}) => {
        context = { ...context, ...next };
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <NotificationsPageContext.Provider value={context as never}>
                        <NotificationsPage />
                    </NotificationsPageContext.Provider>
                </QueryClientProvider>,
            ),
        );
    };
    render();
    await settleQueries();
    const filterUnread = () =>
        act(() =>
            (
                host.querySelector('.notification-toolbar [aria-pressed]:last-child') as HTMLButtonElement
            ).click(),
        );
    return {
        host,
        reads,
        render,
        filterUnread,
        get context() {
            return context;
        },
        messages: () =>
            Array.from(host.querySelectorAll('.notification-list > button')).map(
                button => button.textContent,
            ),
        close: () => {
            act(() => root.unmount());
            client.clear();
            host.remove();
            mocks.realQueries = false;
        },
    };
}

describe('notification read-status continuity', () => {
    it('keeps known read notifications out of the unread list while an updated batch is pending', async () => {
        const alreadyRead = versionedOrder('already-read');
        const unread = versionedOrder('still-unread');
        const added = versionedOrder('newly-arrived');
        const fixture = await notificationFixture([alreadyRead, unread], [readKey(alreadyRead)]);
        try {
            fixture.filterUnread();
            expect(fixture.messages()).toHaveLength(1);
            expect(fixture.messages()[0]).toContain('still-unread');
            let resolve!: (keys: string[]) => void;
            fixture.reads.mockImplementationOnce(
                () =>
                    new Promise<string[]>(done => {
                        resolve = done;
                    }),
            );
            fixture.render({
                customer: { ...fixture.context.customer, orders: { items: [alreadyRead, unread, added] } },
            });
            await settleQueries();
            expect(fixture.messages()).toHaveLength(1);
            expect(fixture.messages()[0]).toContain('still-unread');
            expect(fixture.host.textContent).not.toContain('没有未读消息');
            await act(() => {
                resolve([readKey(alreadyRead), readKey(added)]);
                return Promise.resolve();
            });
            await settleQueries();
            expect(fixture.messages()).toHaveLength(1);
            expect(fixture.messages()[0]).toContain('still-unread');
        } finally {
            fixture.close();
        }
    });

    it('treats a changed source version as unknown until confirmed, then exposes it as unread', async () => {
        const oldVersion = versionedOrder('updated-order');
        const newVersion = versionedOrder('updated-order', '2026-10-07T01:00:00Z');
        const fixture = await notificationFixture([oldVersion], [readKey(oldVersion)]);
        try {
            fixture.filterUnread();
            expect(fixture.messages()).toHaveLength(0);
            let resolve!: (keys: string[]) => void;
            fixture.reads.mockImplementationOnce(
                () =>
                    new Promise<string[]>(done => {
                        resolve = done;
                    }),
            );
            fixture.render({ customer: { ...fixture.context.customer, orders: { items: [newVersion] } } });
            await settleQueries();
            expect(fixture.messages()).toHaveLength(0);
            expect(fixture.host.textContent).toContain('正在确认未读消息');
            await act(() => {
                resolve([]);
                return Promise.resolve();
            });
            await settleQueries();
            expect(fixture.messages()).toHaveLength(1);
            expect(fixture.messages()[0]).toContain('updated-order');
            expect(fixture.host.querySelector('.notification-list .is-unread')).not.toBeNull();
        } finally {
            fixture.close();
        }
    });

    it.each(['store', 'currency', 'language', 'customer'])(
        'does not reuse read status across %s changes',
        async scope => {
            const entry = versionedOrder('shared-source-id');
            const fixture = await notificationFixture([entry], []);
            try {
                fixture.filterUnread();
                expect(fixture.messages()).toHaveLength(1);
                let resolve!: (keys: string[]) => void;
                fixture.reads.mockImplementationOnce(
                    () =>
                        new Promise<string[]>(done => {
                            resolve = done;
                        }),
                );
                fixture.render(
                    scope === 'customer'
                        ? { customer: { ...fixture.context.customer, id: 'customer-b' } }
                        : scope === 'language'
                          ? { language: 'en', locale: 'en-MY' }
                          : {
                                market: {
                                    ...fixture.context.market,
                                    ...(scope === 'store' ? { code: 'store-b' } : { currencyCode: 'CNY' }),
                                },
                            },
                );
                await settleQueries();
                expect(fixture.messages()).toHaveLength(0);
                await act(() => {
                    resolve([readKey(entry)]);
                    return Promise.resolve();
                });
                await settleQueries();
                expect(fixture.messages()).toHaveLength(0);
                expect(fixture.host.textContent).toContain(
                    scope === 'language' ? 'No unread notifications' : '没有未读消息',
                );
            } finally {
                fixture.close();
            }
        },
    );

    it('keeps messages visible and read controls unavailable after an initial read-state failure', async () => {
        const entry = versionedOrder('available-order');
        const fixture = await notificationFixture([entry], new Error('Fixture initial read failure'));
        try {
            expect(fixture.messages()).toHaveLength(1);
            expect(fixture.host.querySelector('[role="alert"]')?.textContent).toContain('已读状态加载失败');
            expect(
                (
                    fixture.host.querySelector(
                        '.notification-toolbar [aria-pressed]:last-child',
                    ) as HTMLButtonElement
                ).disabled,
            ).toBe(true);
            expect(fixture.host.querySelector('.notification-read-status')).toBeNull();
            fixture.reads.mockResolvedValueOnce([]);
            await act(() => {
                (fixture.host.querySelector('[role="alert"] button') as HTMLButtonElement).click();
                return Promise.resolve();
            });
            await settleQueries();
            fixture.filterUnread();
            expect(fixture.messages()).toHaveLength(1);
            expect(fixture.host.querySelector('[role="alert"]')).toBeNull();
        } finally {
            fixture.close();
        }
    });

    it('removes a confirmed unread notification after marking that exact version as read', async () => {
        const entry = versionedOrder('mark-order');
        const fixture = await notificationFixture([entry], []);
        try {
            fixture.filterUnread();
            fixture.context.api.contentReviewsApi.markNotificationsRead.mockResolvedValueOnce([
                readKey(entry),
            ] as never);
            await act(() => {
                (fixture.host.querySelector('.notification-list > button') as HTMLButtonElement).click();
                return Promise.resolve();
            });
            await settleQueries();
            expect(fixture.messages()).toHaveLength(0);
            expect(fixture.host.textContent).toContain('没有未读消息');
            expect(fixture.context.api.contentReviewsApi.markNotificationsRead).toHaveBeenCalledWith([
                { kind: 'ORDER', sourceId: entry.id, version: entry.updatedAt },
            ]);
        } finally {
            fixture.close();
        }
    });

    it('retains confirmed unread results and shows a retry when the new status read fails', async () => {
        const alreadyRead = versionedOrder('already-read');
        const unread = versionedOrder('still-unread');
        const added = versionedOrder('newly-arrived');
        const fixture = await notificationFixture([alreadyRead, unread], [readKey(alreadyRead)]);
        try {
            fixture.filterUnread();
            fixture.reads.mockRejectedValueOnce(new Error('Fixture read unavailable'));
            fixture.render({
                customer: { ...fixture.context.customer, orders: { items: [alreadyRead, unread, added] } },
            });
            await settleQueries();
            expect(fixture.messages()).toHaveLength(1);
            expect(fixture.messages()[0]).toContain('still-unread');
            expect(fixture.host.querySelector('[role="alert"]')?.textContent).toContain('已读状态加载失败');
            fixture.reads.mockResolvedValueOnce([readKey(alreadyRead)]);
            await act(() => {
                (fixture.host.querySelector('[role="alert"] button') as HTMLButtonElement).click();
                return Promise.resolve();
            });
            await settleQueries();
            expect(fixture.host.querySelector('[role="alert"]')).toBeNull();
            expect(fixture.messages()).toHaveLength(2);
            expect(fixture.messages().join(' ')).toContain('newly-arrived');
        } finally {
            fixture.close();
        }
    });
});
