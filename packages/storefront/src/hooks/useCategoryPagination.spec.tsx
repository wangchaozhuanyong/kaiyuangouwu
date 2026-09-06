// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketConfig, Product, ProductSearchPage, StorefrontCatalogInput } from '../types';

import { useCategoryPagination } from './useCategoryPagination';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market: MarketConfig = {
    code: 'my-malaysia',
    currencyCode: 'MYR',
    defaultLanguageCode: 'zh_Hans',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

function page(start: number, count = 12, totalItems = 36): ProductSearchPage {
    return {
        items: Array.from({ length: count }, (_, index) => ({ id: `${start + index}` }) as Product),
        totalItems,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('category automatic pagination', () => {
    let client: QueryClient;
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let pagination: ReturnType<typeof useCategoryPagination>;
    let catalog: ReturnType<typeof vi.fn>;
    let input: StorefrontCatalogInput;
    let enabled: boolean;
    let suspended: boolean;
    let connected: boolean;
    let visibility: DocumentVisibilityState;
    let observers: Array<{
        callback: IntersectionObserverCallback;
        options?: IntersectionObserverInit;
        target?: Element;
        disconnected: boolean;
    }>;

    function Harness() {
        pagination = useCategoryPagination({
            api: { catalog },
            market,
            languageCode: 'zh_Hans',
            language: 'zh',
            input,
            enabled,
            suspended,
        });
        return (
            <section ref={pagination.resultsRef}>
                {pagination.products.map(product => (
                    <article key={product.id}>{product.id}</article>
                ))}
                {pagination.products.length > 0 && <div ref={pagination.sentinelRef} />}
            </section>
        );
    }

    function render() {
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            ),
        );
    }

    async function settle(ms = 20) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    }

    function intersect(observer = observers.filter(item => !item.disconnected).at(-1)) {
        if (!observer?.target) throw new Error('Expected an observed sentinel');
        act(() =>
            observer.callback(
                [{ target: observer.target, isIntersecting: true } as IntersectionObserverEntry],
                {} as IntersectionObserver,
            ),
        );
    }

    beforeEach(() => {
        vi.useFakeTimers();
        connected = true;
        visibility = 'visible';
        vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => connected);
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
        onlineManager.setOnline(true);
        observers = [];
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                record: (typeof observers)[number];
                constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
                    this.record = { callback, options, disconnected: false };
                    observers.push(this.record);
                }
                observe(target: Element) {
                    this.record.target = target;
                }
                disconnect() {
                    this.record.disconnected = true;
                }
            },
        );
        client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        input = { collectionId: 'one', sort: 'recommended' };
        enabled = true;
        suspended = false;
        catalog = vi.fn((args: StorefrontCatalogInput) => Promise.resolve(page(args.skip ?? 0)));
    });

    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        onlineManager.setOnline(true);
    });

    it('uses the results scroller and requests the next 12 products once during rapid triggers', async () => {
        const next = deferred<ProductSearchPage>();
        catalog.mockImplementation(args => (args.skip === 0 ? Promise.resolve(page(0)) : next.promise));
        render();
        await settle();
        expect(catalog).toHaveBeenCalledTimes(1);
        const observer = observers.at(-1);
        if (!observer) throw new Error('Expected a pagination observer');
        expect(observer.options).toMatchObject({
            root: container.firstElementChild,
            rootMargin: '0px 0px 300px 0px',
        });
        intersect(observer);
        intersect(observer);
        act(() => {
            void pagination.loadMore();
        });
        await settle();
        expect(catalog).toHaveBeenCalledTimes(2);
        expect(catalog.mock.calls[1][0]).toMatchObject({ skip: 12, take: 12 });
        expect(pagination.products).toHaveLength(12);
        expect(pagination.query.isFetchingNextPage).toBe(true);
        next.resolve(page(12));
        await settle();
        expect(pagination.products).toHaveLength(24);
        expect(observers.at(-1)?.disconnected).toBe(false);
    });

    it('deduplicates overlapping products without changing server offsets', async () => {
        catalog.mockImplementation(args => Promise.resolve(args.skip === 12 ? page(11) : page(args.skip)));
        render();
        await settle();
        intersect();
        await settle();
        expect(pagination.products).toHaveLength(23);
        intersect();
        await settle();
        expect(catalog.mock.calls.map(call => call[0].skip)).toEqual([0, 12, 24]);
        expect(pagination.products.map(product => product.id).slice(0, 12)).toEqual(
            page(0).items.map(p => p.id),
        );
        expect(pagination.query.hasNextPage).toBe(false);
        expect(observers.filter(observer => !observer.disconnected)).toHaveLength(0);
    });

    it('preserves products and pauses after a failed next page until explicit retry', async () => {
        let failing = true;
        catalog.mockImplementation(args => {
            if (args.skip > 0 && failing) return Promise.reject(new Error('Temporary failure'));
            return Promise.resolve(page(args.skip));
        });
        render();
        await settle();
        const observer = observers.at(-1);
        if (!observer) throw new Error('Expected a pagination observer');
        intersect(observer);
        await settle(1500);
        expect(catalog).toHaveBeenCalledTimes(3);
        expect(pagination.query.isFetchNextPageError).toBe(true);
        expect(pagination.products).toHaveLength(12);
        intersect(observer);
        await settle(5000);
        expect(catalog).toHaveBeenCalledTimes(3);
        failing = false;
        act(() => {
            void pagination.loadMore();
        });
        await settle();
        expect(catalog.mock.calls.at(-1)?.[0].skip).toBe(12);
        expect(pagination.products).toHaveLength(24);
        expect(pagination.query.isError).toBe(false);
    });

    it.each(['empty', 'repeated'])('pauses an abnormal %s page and retries the same offset', async mode => {
        let invalid = true;
        catalog.mockImplementation(args => {
            if (args.skip > 0 && invalid) return Promise.resolve(mode === 'empty' ? page(12, 0) : page(0));
            return Promise.resolve(page(args.skip));
        });
        render();
        await settle();
        intersect();
        await settle(5000);
        expect(catalog).toHaveBeenCalledTimes(2);
        expect(pagination.query.isFetchNextPageError).toBe(true);
        expect(pagination.products).toHaveLength(12);
        invalid = false;
        act(() => {
            void pagination.loadMore();
        });
        await settle();
        expect(catalog.mock.calls.at(-1)?.[0].skip).toBe(12);
        expect(pagination.products).toHaveLength(24);
    });

    it('does not append an old response or trigger from a disconnected observer after switching category', async () => {
        const old = deferred<ProductSearchPage>();
        const fresh = deferred<ProductSearchPage>();
        catalog.mockImplementation(args => {
            if (args.collectionId === 'two') return fresh.promise;
            return args.skip === 0 ? Promise.resolve(page(0)) : old.promise;
        });
        render();
        await settle();
        const observer = observers.at(-1);
        if (!observer) throw new Error('Expected a pagination observer');
        intersect();
        await settle();
        input = { collectionId: 'two', sort: 'sales' };
        render();
        await settle();
        expect(pagination.query.isPlaceholderData).toBe(true);
        intersect(observer);
        act(() => {
            void pagination.loadMore();
        });
        await settle();
        expect(catalog).toHaveBeenCalledTimes(3);
        expect(catalog.mock.calls[1][1].aborted).toBe(true);
        old.resolve(page(12));
        fresh.resolve(page(100, 12, 12));
        await settle();
        expect(pagination.products.map(product => product.id)).toEqual(
            page(100, 12, 12).items.map(p => p.id),
        );
        expect(pagination.query.hasNextPage).toBe(false);
    });

    it('pauses observation for overlays, hidden pages and offline connections', async () => {
        render();
        await settle();
        suspended = true;
        render();
        expect(observers.filter(observer => !observer.disconnected)).toHaveLength(0);
        suspended = false;
        render();
        act(() => {
            visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(observers.filter(observer => !observer.disconnected)).toHaveLength(0);
        act(() => {
            visibility = 'visible';
            document.dispatchEvent(new Event('visibilitychange'));
            connected = false;
            window.dispatchEvent(new Event('offline'));
        });
        expect(pagination.online).toBe(false);
        act(() => {
            void pagination.loadMore();
        });
        await settle();
        expect(catalog).toHaveBeenCalledTimes(1);
        act(() => {
            connected = true;
            window.dispatchEvent(new Event('online'));
        });
        expect(observers.at(-1)?.disconnected).toBe(false);
        intersect();
        await settle();
        expect(pagination.products).toHaveLength(24);
    });

    it('allows manual pagination when IntersectionObserver is unavailable', async () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        render();
        await settle();
        expect(pagination.automaticSupported).toBe(false);
        act(() => {
            void pagination.loadMore();
        });
        await settle();
        expect(pagination.products).toHaveLength(24);
    });

    it('does not request disabled, empty or completed catalog pages', async () => {
        enabled = false;
        render();
        await settle();
        act(() => {
            void pagination.loadMore();
        });
        await settle();
        expect(catalog).not.toHaveBeenCalled();
        enabled = true;
        catalog.mockResolvedValue(page(0, 0, 0));
        render();
        await settle();
        expect(pagination.query.hasNextPage).toBe(false);
        expect(observers).toHaveLength(0);
    });

    it('refreshes existing pages normally and retries refresh errors from the first page', async () => {
        render();
        await settle();
        intersect();
        await settle();
        act(() => {
            void pagination.query.refetch();
        });
        await settle();
        expect(pagination.query.isError).toBe(false);
        expect(catalog.mock.calls.map(call => call[0].skip)).toEqual([0, 12, 0, 12]);
        catalog.mockRejectedValue(new Error('Refresh failed'));
        act(() => {
            void pagination.query.refetch();
        });
        await settle(1500);
        expect(pagination.query.isRefetchError).toBe(true);
        catalog.mockImplementation(args => Promise.resolve(page(args.skip)));
        act(() => {
            void pagination.loadMore();
            void pagination.loadMore();
        });
        await settle();
        expect(catalog.mock.calls.slice(-2).map(call => call[0].skip)).toEqual([0, 12]);
        expect(pagination.products).toHaveLength(24);
    });
});
