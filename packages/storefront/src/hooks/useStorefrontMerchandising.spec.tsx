// @vitest-environment jsdom
/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import type { RouteState } from '../storefront-router';
import type { Product, StorefrontContentBlock } from '../types';

import { useStorefrontMerchandising } from './useStorefrontMerchandising';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('home merchandising request scope', () => {
    let root: ReturnType<typeof createRoot>;
    let client: QueryClient;
    let route: RouteState['name'];
    let contentReady: boolean;
    const catalog = vi.fn((_input: { sort: string }) => Promise.resolve({ items: [], totalItems: 0 }));
    const api = { catalog, productSales: vi.fn(() => Promise.resolve({})) } as unknown as ShopApi;

    function Harness() {
        useStorefrontMerchandising({
            api,
            market: enabledMarkets[0],
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: false,
            customer: null,
            recentProductIds: [],
            products: [],
            contentBlocks: [],
            configuredBlockTypes: [],
            activeRoute: route,
            contentReady,
        });
        return null;
    }

    async function render() {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            );
            await Promise.resolve();
        });
    }

    beforeEach(() => {
        catalog.mockClear();
        route = 'category';
        contentReady = false;
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
    });

    it('waits for homepage content and does not request home catalogs on other routes', async () => {
        contentReady = true;
        await render();
        expect(catalog).not.toHaveBeenCalled();

        route = 'home';
        contentReady = false;
        await render();
        expect(catalog).not.toHaveBeenCalled();

        contentReady = true;
        await render();
        await vi.waitFor(() => expect(catalog).toHaveBeenCalledTimes(2));
        expect(catalog.mock.calls.map(([input]) => input.sort).sort()).toEqual(['recommended', 'sales']);

        route = 'category';
        await render();
        expect(catalog).toHaveBeenCalledTimes(2);
    });

    it('loads recommendations without fetching home best sellers on the recommendations route', async () => {
        route = 'recommendations';
        contentReady = true;
        await render();
        await vi.waitFor(() => expect(catalog).toHaveBeenCalledTimes(1));
        expect(catalog.mock.calls[0][0].sort).toBe('recommended');
    });
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => {
        resolve = complete;
    });
    return { promise, resolve };
}

const product = (id: string) => ({ id, name: id, collections: [] }) as unknown as Product;
const bootstrap = product('bootstrap');
const ranked = [product('catalog-1'), product('catalog-2')];
function mount(api: Partial<ShopApi>, { pinned = false, recent = false } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = document.createElement('div');
    const root = createRoot(element);
    const history: Array<ReturnType<typeof useStorefrontMerchandising>> = [];
    let recentProductIds = recent ? ['recent'] : [];
    let activeRoute: RouteState['name'] = 'home';
    let personalizationReady = true;
    function Fixture() {
        const data = useStorefrontMerchandising({
            api: api as ShopApi,
            market: enabledMarkets[0],
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: false,
            customer: null,
            recentProductIds,
            personalizationReady,
            products: [bootstrap],
            contentBlocks: [
                {
                    type: 'BEST_SELLERS',
                    settings: { displayCount: 2, pinnedProductIds: pinned ? ['pinned'] : [] },
                },
                { type: 'RECOMMENDATIONS', settings: { displayCount: 2 } },
            ].map(block => ({
                id: block.type,
                code: block.type,
                enabled: true,
                position: 1,
                startsAt: null,
                endsAt: null,
                imageUrl: null,
                backgroundColor: null,
                textColor: null,
                targetType: 'NONE',
                targetValue: null,
                title: block.type,
                subtitle: '',
                body: '',
                ctaLabel: '',
                items: [],
                ...block,
            })) as StorefrontContentBlock[],
            configuredBlockTypes: ['BEST_SELLERS', 'RECOMMENDATIONS'],
            activeRoute,
            contentReady: true,
        });
        history.push(data);
        return (
            <>
                {data.bestSellersLoading ? 'best-loading' : 'best-ready'}{' '}
                {data.recommendationsLoading ? 'rec-loading' : 'rec-ready'}
            </>
        );
    }
    const render = () =>
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <Fixture />
                </QueryClientProvider>,
            ),
        );
    render();
    return {
        client,
        history,
        element,
        update(activity: { recentProductIds?: string[]; route?: RouteState['name']; ready?: boolean }) {
            recentProductIds = activity.recentProductIds ?? recentProductIds;
            activeRoute = activity.route ?? activeRoute;
            personalizationReady = activity.ready ?? personalizationReady;
            render();
        },
        dispose() {
            act(() => root.unmount());
            client.clear();
        },
    };
}

it('keeps recommendation membership/order through visits, detail/back, catalog refresh and midnight until reload', async () => {
    const candidates = ['a', 'b', 'c', 'd'].map(product);
    const api = {
        catalog: vi.fn(() => Promise.resolve({ items: candidates, totalItems: candidates.length })),
        productSales: vi.fn(() => Promise.resolve({})),
        productsByIds: vi.fn((ids: string[]) =>
            Promise.resolve(candidates.filter(item => ids.includes(item.id))),
        ),
    };
    const fixture = mount(api);
    const latest = () => fixture.history[fixture.history.length - 1];
    let reloaded: ReturnType<typeof mount> | undefined;
    try {
        await act(() => vi.waitFor(() => expect(latest().recommendationsLoading).toBe(false)));
        const original = latest().recommendationProducts.map(item => item.id);
        const clicked = original[0];
        fixture.update({ recentProductIds: [clicked], route: 'product' });
        await act(() => vi.waitFor(() => expect(fixture.client.isFetching()).toBe(0)));
        fixture.update({ route: 'home' });
        expect(latest().recommendationProducts.map(item => item.id)).toEqual(original);
        fixture.update({ route: 'recommendations' });
        expect(latest().recommendationProducts.map(item => item.id)).toEqual(original);

        const catalogQuery = fixture.client
            .getQueryCache()
            .findAll()
            .find(
                query =>
                    (query.queryKey[4] as { purpose?: string } | undefined)?.purpose ===
                    'home-recommendations',
            );
        const refreshed = candidates.map(item => ({ ...item, name: `Updated ${item.id}` })).reverse();
        if (!catalogQuery) throw new Error('Missing recommendation catalog query');
        act(() => {
            fixture.client.setQueryData(catalogQuery.queryKey, {
                items: refreshed,
                totalItems: refreshed.length,
            });
        });
        expect(latest().recommendationProducts.map(item => item.id)).toEqual(original);
        await act(() =>
            vi.waitFor(() =>
                expect(latest().recommendationProducts.every(item => item.name.startsWith('Updated '))).toBe(
                    true,
                ),
            ),
        );
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60_000));
        fixture.update({ route: 'home' });
        expect(latest().recommendationProducts.map(item => item.id)).toEqual(original);
        vi.useRealTimers();

        // A new document owns a new QueryClient and reads the updated browsing history.
        const fresh = mount(api);
        reloaded = fresh;
        fresh.update({ recentProductIds: [clicked] });
        await act(() => vi.waitFor(() => expect(fresh.history.at(-1)?.recommendationsLoading).toBe(false)));
        expect(fresh.history.at(-1)?.recommendationProducts.map(item => item.id)).not.toContain(clicked);
    } finally {
        vi.useRealTimers();
        fixture.dispose();
        reloaded?.dispose();
    }
});

it('waits for the initial browsing history before locking recommendations', async () => {
    const catalog = deferred<{ items: Product[]; totalItems: number }>();
    const fixture = mount({
        catalog: () => catalog.promise,
        productSales: () => Promise.resolve({}),
        productsByIds: () => Promise.resolve([product('a')]),
    });
    const latest = () => {
        const value = fixture.history.at(-1);
        if (!value) throw new Error('Missing merchandising render');
        return value;
    };
    try {
        fixture.update({ ready: false });
        act(() => catalog.resolve({ items: [product('a'), product('b'), product('c')], totalItems: 3 }));
        await act(() => vi.waitFor(() => expect(fixture.client.isFetching()).toBe(0)));
        expect(latest().recommendationsLoading).toBe(true);
        expect(latest().recommendationProducts).toEqual([]);
        fixture.update({ ready: true, recentProductIds: ['a'] });
        await act(() => vi.waitFor(() => expect(latest().recommendationsLoading).toBe(false)));
        expect(latest().recommendationProducts.map(item => item.id)).not.toContain('a');
    } finally {
        fixture.dispose();
    }
});
it('publishes merchandising only after its catalog, ranking and selected products settle', async () => {
    const best = deferred<{ items: Product[]; totalItems: number }>();
    const recommendations = deferred<{ items: Product[]; totalItems: number }>();
    const sales = deferred<Record<string, number>>();
    const pinned = deferred<Product[]>();
    const source = deferred<Product[]>();
    const api = {
        catalog: vi.fn((input: { sort?: string }) =>
            input.sort === 'sales' ? best.promise : recommendations.promise,
        ),
        productSales: vi.fn(() => sales.promise),
        productsByIds: vi.fn((ids: string[]) => (ids.includes('pinned') ? pinned.promise : source.promise)),
    };
    const fixture = mount(api, { pinned: true, recent: true });
    const latest = () => fixture.history[fixture.history.length - 1];
    try {
        expect(latest().bestSellersLoading).toBe(true);
        expect(latest().recommendationsLoading).toBe(true);
        await act(async () => {
            best.resolve({ items: ranked, totalItems: 2 });
            recommendations.resolve({ items: ranked, totalItems: 2 });
            await Promise.resolve();
        });
        await act(() => vi.waitFor(() => expect(api.productSales).toHaveBeenCalled()));
        expect(latest().bestSellersLoading).toBe(true);
        expect(latest().recommendationsLoading).toBe(true);
        await act(async () => {
            sales.resolve({ 'catalog-2': 5 });
            await Promise.resolve();
        });
        await act(() => vi.waitFor(() => expect(fixture.client.isFetching()).toBe(2)));
        expect(latest().bestSellerProducts).toEqual([]);
        expect(latest().bestSellersLoading).toBe(true);
        await act(async () => {
            pinned.resolve([product('pinned')]);
            source.resolve([product('recent')]);
            await Promise.resolve();
        });
        await act(() => vi.waitFor(() => expect(fixture.element.textContent).toBe('best-ready rec-ready')));
        expect(latest().bestSellerProducts.map(item => item.id)).toEqual(['pinned', 'catalog-2']);
        expect(
            fixture.history
                .filter(item => !item.bestSellersLoading)
                .every(item => item.bestSellerProducts[0].id === 'pinned'),
        ).toBe(true);
        // A background refresh with cached data must not restore the skeleton.
        const start = fixture.history.length;
        const pendingRefresh = deferred<{ items: Product[]; totalItems: number }>();
        api.catalog.mockImplementation(() => pendingRefresh.promise);
        await act(async () => {
            void fixture.client.invalidateQueries();
            await Promise.resolve();
        });
        expect(latest().bestSellersLoading).toBe(false);
        expect(latest().recommendationsLoading).toBe(false);
        const updatedSales = deferred<Record<string, number>>();
        api.productSales.mockImplementation(() => updatedSales.promise);
        await act(async () => {
            pendingRefresh.resolve({ items: [product('new-catalog')], totalItems: 1 });
            await Promise.resolve();
        });
        await act(() => vi.waitFor(() => expect(api.productSales).toHaveBeenCalledTimes(3)));
        expect(latest().bestSellerProducts.map(item => item.id)).toEqual(['pinned', 'catalog-2']);
        expect(latest().bestSellersLoading).toBe(false);
        await act(async () => {
            updatedSales.resolve({ 'new-catalog': 10 });
            await Promise.resolve();
        });
        await act(() =>
            vi.waitFor(() =>
                expect(latest().bestSellerProducts.map(item => item.id)).toEqual(['pinned', 'new-catalog']),
            ),
        );
        expect(
            fixture.history
                .slice(start)
                .every(item => !item.bestSellersLoading && !item.recommendationsLoading),
        ).toBe(true);
    } finally {
        fixture.dispose();
    }
});

it.each(['empty', 'error', 'offline'] as const)(
    'finishes without a permanent placeholder for %s catalogs',
    async mode => {
        if (mode === 'offline') onlineManager.setOnline(false);
        const api = {
            catalog: vi.fn(() =>
                mode === 'error'
                    ? Promise.reject(new Error('Unavailable'))
                    : Promise.resolve({ items: [], totalItems: 0 }),
            ),
            productSales: vi.fn(() => Promise.resolve({})),
            productsByIds: vi.fn(() => Promise.resolve([])),
        };
        const fixture = mount(api);
        try {
            await act(() =>
                vi.waitFor(() => expect(fixture.element.textContent).toBe('best-ready rec-ready')),
            );
            const data = fixture.history[fixture.history.length - 1];
            expect(data.bestSellerProducts).toEqual(mode === 'empty' ? [] : [bootstrap]);
            expect(data.recommendationProducts).toEqual(mode === 'empty' ? [] : [bootstrap]);
            if (mode !== 'error') expect(api.productSales).not.toHaveBeenCalled();
        } finally {
            fixture.dispose();
            onlineManager.setOnline(true);
        }
    },
);
