// organize-imports-ignore -- Preserve ESLint type groups.
// @vitest-environment jsdom
import type { AnnouncementList } from '../api/announcements';
import type { StorefrontSystemAnnouncement } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { storefrontQueryKeys } from '../query-client';
import { routeFromHash, routeHref } from '../storefront-router';

import { AnnouncementsPage, type AnnouncementsPageProps } from './announcements-page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const announcement = (id: string): StorefrontSystemAnnouncement => ({
    id,
    title: `Announcement ${id}`,
    content: `Body ${id}`,
    createdAt: '2026-10-09T00:00:00Z',
    linkUrl: null,
    startsAt: null,
    endsAt: null,
});
const settle = () =>
    act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
    });
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

function fixture(items: StorefrontSystemAnnouncement[] = [], options: Partial<AnnouncementsPageProps> = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = vi.fn(
        ({ skip, take }: { skip: number; take: number }, _signal?: AbortSignal): Promise<AnnouncementList> =>
            Promise.resolve({ totalItems: items.length, items: items.slice(skip, skip + take) }),
    );
    const detail = vi.fn((id: string, _signal?: AbortSignal): Promise<StorefrontSystemAnnouncement | null> =>
        Promise.resolve(items.find(item => item.id === id) ?? null),
    );
    let props: AnnouncementsPageProps = {
        api: {
            contentReviewsApi: { announcements: list, announcement: detail },
        } as unknown as AnnouncementsPageProps['api'],
        market: {
            code: 'fixture-a',
            currencyCode: 'MYR',
            defaultLanguageCode: 'zh_Hans',
            countryCode: 'MY',
            label: 'Fixture',
            locale: 'zh-CN',
        },
        language: 'zh',
        locale: 'zh-CN',
        route: { name: 'announcements' },
        onBack: vi.fn(),
        onReturnToRoute: vi.fn(route => render({ route: routeFromHash(routeHref(route)) })),
        onContentTarget: vi.fn(),
        onNavigate: vi.fn(route => render({ route: routeFromHash(routeHref(route)) })),
        ...options,
    };
    function render(next: Partial<AnnouncementsPageProps> = {}) {
        props = { ...props, ...next };
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <AnnouncementsPage {...props} />
                </QueryClientProvider>,
            ),
        );
    }
    function button(label: string): HTMLButtonElement {
        const result = Array.from(host.querySelectorAll('button')).find(
            item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
        );
        if (!result) throw new Error(`Button not found: ${label}`);
        return result;
    }
    async function click(label: string) {
        act(() => button(label).click());
        await settle();
    }
    cleanups.push(() => {
        act(() => root.unmount());
        client.clear();
        host.remove();
    });
    render();
    return {
        host,
        client,
        list,
        detail,
        render,
        button,
        click,
        get props() {
            return props;
        },
    };
}

describe('all announcements and detail navigation', () => {
    it('reaches all 25 records, including records older than the homepage feed, using URL pagination', async () => {
        const view = fixture(Array.from({ length: 25 }, (_, index) => announcement(String(index + 1))));
        await settle();
        expect(view.host.querySelectorAll('.notification-list > button')).toHaveLength(12);
        expect(view.button('上一页').disabled).toBe(true);
        await view.click('下一页');
        expect(view.props.route.page).toBe(2);
        expect(view.host.querySelector('.notification-list')?.textContent).toContain('Announcement 24');
        await view.click('下一页');
        expect(view.props.route.page).toBe(3);
        expect(view.host.querySelectorAll('.notification-list > button')).toHaveLength(1);
        expect(view.host.querySelector('.notification-list')?.textContent).toContain('Announcement 25');
        expect(view.button('下一页').disabled).toBe(true);
        expect(view.list.mock.calls.map(([options]) => options)).toEqual([
            { skip: 0, take: 12 },
            { skip: 12, take: 12 },
            { skip: 24, take: 12 },
        ]);
        act(() => (view.host.querySelector('.notification-list > button') as HTMLButtonElement).click());
        await settle();
        expect(view.props.route).toMatchObject({ name: 'announcements', page: 3, id: '25' });
        expect(view.host.querySelector('.announcement-body')?.textContent).toBe('Body 25');
        await view.click('返回');
        expect(view.props.onReturnToRoute).toHaveBeenLastCalledWith({ name: 'announcements', page: 3 });
        expect(view.props.route.page).toBe(3);
        expect(view.props.route.id).toBeUndefined();
        expect(view.host.querySelector('.notification-list')?.textContent).toContain('Announcement 25');
    });

    it('loads a shared detail URL without depending on a loaded list and retains its return page', async () => {
        const item = { ...announcement('shared-id'), linkUrl: '/support' };
        const view = fixture([item], { route: routeFromHash('/announcements?id=shared-id&page=2') });
        await settle();
        expect(view.list).not.toHaveBeenCalled();
        expect(view.detail).toHaveBeenCalledWith('shared-id', expect.any(AbortSignal));
        expect(view.host.querySelector('.announcement-article')?.textContent).toContain(item.title);
        await view.click('前往相关页面');
        expect(view.props.onContentTarget).toHaveBeenCalledWith('URL', '/support');
        await view.click('返回');
        expect(view.props.onReturnToRoute).toHaveBeenLastCalledWith({ name: 'announcements', page: 2 });
        expect(view.props.route).toMatchObject({ name: 'announcements', page: 2 });
        expect(view.list).toHaveBeenLastCalledWith({ skip: 12, take: 12 }, expect.any(AbortSignal));
    });

    it('renders a successful empty list as empty, not loading or an error', async () => {
        const view = fixture();
        await settle();
        expect(view.host.textContent).toContain('暂无系统公告');
        expect(view.host.textContent).toContain('共 0 条');
        expect(view.host.textContent).not.toContain('页面数据加载失败');
        expect(view.host.querySelector('[data-page-pending]')).toBeNull();
    });

    it('offers a first-page recovery when records are removed from the requested page', async () => {
        const view = fixture([announcement('only-one')], { route: { name: 'announcements', page: 3 } });
        await settle();
        expect(view.host.textContent).toContain('本页暂无公告');
        await view.click('返回第一页');
        expect(view.props.route.page).toBeUndefined();
        expect(view.host.textContent).toContain('Announcement only-one');
    });

    it('treats a null detail as unavailable and provides an all-announcements return', async () => {
        const view = fixture([], { route: { name: 'announcements', id: 'removed' } });
        await settle();
        expect(view.host.textContent).toContain('此公告暂不可查看');
        expect(view.host.textContent).not.toContain('页面数据加载失败');
        await view.click('返回全部公告');
        expect(view.props.onReturnToRoute).toHaveBeenLastCalledWith({
            name: 'announcements',
            page: undefined,
        });
        expect(view.props.route.id).toBeUndefined();
        expect(view.host.textContent).toContain('暂无系统公告');
    });
});

describe('announcement query continuity', () => {
    it('deduplicates repeated retry clicks while the same announcement page is pending', async () => {
        const view = fixture([announcement('retry-once')]);
        await settle();
        view.list.mockRejectedValueOnce(new Error('Fixture initial failure'));
        act(() => {
            view.client.removeQueries();
            view.render();
        });
        await settle();
        let resolve!: (result: AnnouncementList) => void;
        view.list.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        const retry = view.button('重试');
        const before = view.list.mock.calls.length;
        act(() => {
            retry.click();
            retry.click();
        });
        await settle();
        expect(view.list).toHaveBeenCalledTimes(before + 1);
        act(() => resolve({ totalItems: 1, items: [announcement('retry-once')] }));
        await settle();
        expect(view.host.textContent).toContain('Announcement retry-once');
    });

    it.each(['list', 'detail'] as const)(
        'retries an initial %s failure without treating it as empty',
        async kind => {
            const view = fixture([announcement('retry')], {
                route: { name: 'announcements', ...(kind === 'detail' ? { id: 'retry' } : {}) },
            });
            await settle();
            const read = kind === 'list' ? view.list : view.detail;
            read.mockRejectedValueOnce(new Error('Fixture unavailable'));
            act(() => {
                view.client.removeQueries();
                view.render();
            });
            await settle();
            expect(view.host.textContent).toContain('页面数据加载失败');
            expect(view.host.textContent).not.toContain('暂无系统公告');
            await view.click('重试');
            expect(view.host.textContent).toContain('Announcement retry');
            expect(view.host.textContent).not.toContain('页面数据加载失败');
        },
    );

    it('keeps confirmed contents on slow and failed background refresh, then recovers', async () => {
        const view = fixture([announcement('confirmed')]);
        await settle();
        let reject!: (error: Error) => void;
        view.list.mockImplementationOnce(
            () =>
                new Promise((_resolve, fail) => {
                    reject = fail;
                }),
        );
        let refresh!: Promise<void>;
        act(() => {
            refresh = view.client.invalidateQueries();
        });
        await settle();
        expect(view.host.textContent).toContain('Announcement confirmed');
        expect(view.host.querySelector('[data-page-pending]')).toBeNull();
        await act(async () => {
            reject(new Error('Fixture refresh failure'));
            await refresh;
        });
        await settle();
        expect(view.host.textContent).toContain('Announcement confirmed');
        expect(view.host.textContent).not.toContain('页面数据加载失败');
        view.list.mockResolvedValueOnce({ totalItems: 1, items: [announcement('updated')] });
        await act(() => view.client.invalidateQueries());
        await settle();
        expect(view.host.textContent).toContain('Announcement updated');
    });

    it.each(['store', 'language', 'currency'] as const)(
        'clears both list and detail on %s changes and never reuses incompatible cached data',
        async dimension => {
            const view = fixture([announcement('old-scope')]);
            await settle();
            view.render({ route: { name: 'announcements', id: 'old-scope' } });
            await settle();
            expect(view.host.textContent).toContain('Body old-scope');
            let resolve!: (item: StorefrontSystemAnnouncement) => void;
            view.detail.mockImplementationOnce(
                () =>
                    new Promise(done => {
                        resolve = done;
                    }),
            );
            view.render(
                dimension === 'language'
                    ? { language: 'en', locale: 'en-MY' }
                    : {
                          market: {
                              ...view.props.market,
                              ...(dimension === 'store' ? { code: 'fixture-b' } : { currencyCode: 'CNY' }),
                          },
                      },
            );
            await settle();
            expect(view.host.textContent).not.toContain('Body old-scope');
            act(() => resolve(announcement('new-scope')));
            await settle();
            expect(view.host.textContent).toContain('Body new-scope');
            view.list.mockResolvedValueOnce({ totalItems: 1, items: [announcement('new-list')] });
            view.render({ route: { name: 'announcements' } });
            expect(view.host.textContent).not.toContain('Announcement old-scope');
            await settle();
            expect(view.host.textContent).toContain('Announcement new-list');
            expect(view.list).toHaveBeenCalledTimes(2);
        },
    );

    it('cancels an obsolete scope request and rejects its late result', async () => {
        const view = fixture([announcement('initial')]);
        await settle();
        let resolve!: (result: AnnouncementList) => void;
        view.list.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        act(() => {
            void view.client.invalidateQueries();
        });
        await settle();
        const oldSignal = view.list.mock.calls.at(-1)?.[1];
        view.list.mockResolvedValueOnce({ totalItems: 1, items: [announcement('current-store')] });
        view.render({ market: { ...view.props.market, code: 'new-store' } });
        await settle();
        expect(oldSignal?.aborted).toBe(true);
        act(() => resolve({ totalItems: 1, items: [announcement('late-old-store')] }));
        await settle();
        expect(view.host.textContent).toContain('Announcement current-store');
        expect(view.host.textContent).not.toContain('late-old-store');
        expect(
            view.client.getQueryData(storefrontQueryKeys.announcements('new-store:MYR', 'zh_Hans', 1, 12)),
        ).toMatchObject({ items: [{ id: 'current-store' }] });
    });
});
