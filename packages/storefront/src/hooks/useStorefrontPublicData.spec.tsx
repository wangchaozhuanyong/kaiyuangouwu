// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Async mocks match the storefront API contract. */
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { ContentReviewsApi } from '../api/content-reviews';
import { enabledMarkets } from '../i18n';
import { STOREFRONT_CONFIG_REFRESH_INTERVAL, storefrontQueryKeys } from '../query-client';
import { type Product, type StorefrontConfig } from '../types';

import { useStorefrontBootstrap } from './useStorefrontBootstrap';
import { useStorefrontMerchandising } from './useStorefrontMerchandising';
import { useStorefrontPublicData } from './useStorefrontPublicData';
import { useStorefrontRouteData } from './useStorefrontRouteData';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('loads public content and products without a customer and preserves them across sign-in changes', async () => {
    const content = { blocks: [], flashSales: [], systemAnnouncements: [], settings: {} };
    let finishContent: () => void = () => {
        throw new Error('Content fixture is not initialized');
    };
    const pendingContent = new Promise<typeof content>(resolve => {
        finishContent = () => resolve(content);
    });
    const api = {
        storefrontConfig: vi.fn(() =>
            Promise.resolve({
                description: 'Public store',
            }),
        ),
        storefrontContent: vi.fn(() => pendingContent),
        storefrontAccountContent: vi.fn(() => Promise.resolve(content)),
        products: vi.fn(() => Promise.resolve([{ id: '1', name: 'Published product' }])),
        collections: vi.fn(() => Promise.resolve([])),
        activeStoreCommerceMode: vi.fn(() => Promise.resolve('RETAIL')),
        reviewSettings: vi.fn(() => Promise.resolve({ enabled: true })),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = document.createElement('div');
    const root = createRoot(element);
    function Fixture({ authorized }: { authorized: boolean }) {
        const data = useStorefrontPublicData({
            api: api as unknown as ShopApi,
            market: enabledMarkets[0],
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: authorized,
        });
        return (
            <div>
                {data.loading ? 'Waiting for hero metadata' : 'Ready'}
                {data.configQuery.data?.description}
                {data.products.map(product => product.name).join(',')}
            </div>
        );
    }
    async function render(authorized: boolean, expected: string) {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Fixture authorized={authorized} />
                </QueryClientProvider>,
            );
            await Promise.resolve();
        });
        await act(() => vi.waitFor(() => expect(element.textContent).toContain(expected)));
    }
    try {
        await render(false, 'Published product');
        expect(element.textContent).toContain('Waiting for hero metadata');
        await act(async () => {
            finishContent();
            await pendingContent;
        });
        await act(() => vi.waitFor(() => expect(element.textContent).toContain('Ready')));
        expect(api.products).toHaveBeenCalledTimes(1);
        expect(api.storefrontContent).toHaveBeenCalledTimes(1);
        expect(api.storefrontAccountContent).not.toHaveBeenCalled();
        expect(api.collections).toHaveBeenCalledTimes(1);
        expect(api.activeStoreCommerceMode).toHaveBeenCalledTimes(1);
        await render(true, 'Published product');
        await render(false, 'Published product');
        expect(element.textContent).toContain('Public store');
        expect(api.products).toHaveBeenCalledTimes(1);
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

it('hides review navigation when a channel settings event invalidates the public setting', async () => {
    let enabled = true;
    const api = {
        storefrontConfig: vi.fn(async () => ({})),
        storefrontContent: vi.fn(async () => ({
            blocks: [
                {
                    id: 'nav',
                    type: 'NAVIGATION',
                    items: [
                        { id: 'review-link', targetValue: '/reviews' },
                        { id: 'home-link', targetValue: '/' },
                    ],
                },
            ],
            flashSales: [],
            systemAnnouncements: [],
            settings: {},
        })),
        products: vi.fn(async () => []),
        collections: vi.fn(async () => []),
        activeStoreCommerceMode: vi.fn(async () => 'RETAIL'),
        reviewSettings: vi.fn(async () => ({ enabled })),
    };
    const market = enabledMarkets[0];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = document.createElement('div');
    const root = createRoot(element);
    function Fixture() {
        const data = useStorefrontPublicData({
            api: api as unknown as ShopApi,
            market,
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: false,
        });
        return (
            <span>
                {data.reviewSettingsStatus}:
                {data.navigationBlock?.items.map(item => item.targetValue).join(',')}
            </span>
        );
    }
    try {
        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <Fixture />
                </QueryClientProvider>,
            ),
        );
        await act(() => vi.waitFor(() => expect(element.textContent).toContain('enabled:/reviews,/')));
        enabled = false;
        await act(async () => {
            await client.invalidateQueries({
                queryKey: storefrontQueryKeys.reviewSettings(storefrontQueryKeys.market(market), 'zh_Hans'),
            });
        });
        await act(() => vi.waitFor(() => expect(element.textContent).toContain('disabled:/')));
        expect(element.textContent).not.toContain('/reviews');
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

it('refreshes guest configuration and toggles without reloading and stops in the background', async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    let published = false;
    let description = 'Old store branding';
    const api = {
        storefrontConfig: vi.fn(() => Promise.resolve({ description })),
        storefrontContent: vi.fn(() =>
            Promise.resolve({
                blocks: published ? [{ id: 'core', title: 'Published core cards' }] : [],
                flashSales: [],
                systemAnnouncements: [],
                settings: {},
            }),
        ),
        products: vi.fn(() => Promise.resolve([])),
        collections: vi.fn(() => Promise.resolve([])),
        activeStoreCommerceMode: vi.fn(() => Promise.resolve('RETAIL')),
        reviewSettings: vi.fn(() => Promise.resolve({ enabled: true })),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = document.createElement('div');
    const root = createRoot(element);
    function Fixture() {
        const data = useStorefrontPublicData({
            api: api as unknown as ShopApi,
            market: enabledMarkets[0],
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: false,
        });
        return (
            <>
                {data.configQuery.data?.description}
                {data.contentBlocks.map(block => block.title).join(',')}
            </>
        );
    }
    async function advance(ms: number) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    }
    try {
        act(() => {
            root.render(
                <QueryClientProvider client={client}>
                    <Fixture />
                </QueryClientProvider>,
            );
        });
        await advance(1);
        expect(element.textContent).toContain('Old store branding');
        published = true;
        description = 'New store branding';
        await advance(STOREFRONT_CONFIG_REFRESH_INTERVAL);
        expect(element.textContent).toContain('Published core cards');
        expect(element.textContent).toContain('New store branding');
        published = false;
        await advance(STOREFRONT_CONFIG_REFRESH_INTERVAL);
        expect(element.textContent).not.toContain('Published core cards');
        expect(api.products).toHaveBeenCalledTimes(1);
        focusManager.setFocused(false);
        const count = api.storefrontContent.mock.calls.length;
        await advance(STOREFRONT_CONFIG_REFRESH_INTERVAL * 2);
        expect(api.storefrontContent).toHaveBeenCalledTimes(count);
        published = true;
        act(() => {
            focusManager.setFocused(true);
        });
        await advance(1);
        expect(element.textContent).toContain('Published core cards');
        act(() => root.unmount());
        const finalCount = api.storefrontContent.mock.calls.length;
        await advance(STOREFRONT_CONFIG_REFRESH_INTERVAL * 2);
        expect(api.storefrontContent).toHaveBeenCalledTimes(finalCount);
    } finally {
        client.clear();
        focusManager.setFocused(undefined);
        vi.useRealTimers();
    }
});

it('rechecks freshly restored content on mount and isolates the two stores', async () => {
    const marketA = enabledMarkets[0];
    const marketB = { ...marketA, code: 'moyao-audit' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [...storefrontQueryKeys.content(storefrontQueryKeys.market(marketA), 'zh_Hans'), 'public'];
    client.setQueryData(key, { blocks: [{ title: 'Cached stale core' }], settings: {} });
    const apiFor = (title: string) => ({
        storefrontConfig: vi.fn(() => Promise.resolve({})),
        storefrontContent: vi.fn(() =>
            Promise.resolve({
                blocks: [{ id: title, title }],
                flashSales: [],
                systemAnnouncements: [],
                settings: {},
            }),
        ),
        products: vi.fn(() => Promise.resolve([])),
        collections: vi.fn(() => Promise.resolve([])),
        activeStoreCommerceMode: vi.fn(() => Promise.resolve('RETAIL')),
        reviewSettings: vi.fn(() => Promise.resolve({ enabled: true })),
    });
    const apiA = apiFor('Damatong core');
    const apiB = apiFor('Moyao core');
    const element = document.createElement('div');
    const root = createRoot(element);
    function Fixture({ store }: { store: 'a' | 'b' }) {
        const data = useStorefrontPublicData({
            api: (store === 'a' ? apiA : apiB) as unknown as ShopApi,
            market: store === 'a' ? marketA : marketB,
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: false,
        });
        return <>{data.contentBlocks.map(block => block.title).join(',')}</>;
    }
    async function show(store: 'a' | 'b', text: string) {
        act(() => {
            root.render(
                <QueryClientProvider client={client}>
                    <Fixture store={store} />
                </QueryClientProvider>,
            );
        });
        await act(() => vi.waitFor(() => expect(element.textContent).toBe(text)));
    }
    try {
        await show('a', 'Damatong core');
        expect(apiA.storefrontContent).toHaveBeenCalledTimes(1);
        await show('b', 'Moyao core');
        expect(client.getQueryData<{ blocks: Array<{ title: string }> }>(key)?.blocks[0].title).toBe(
            'Damatong core',
        );
        await show('a', 'Damatong core');
        expect(apiB.storefrontContent).toHaveBeenCalledTimes(1);
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

describe('resolved storefront requests', () => {
    const product: Product = {
        id: '1',
        createdAt: '2026-01-01T00:00:00Z',
        name: 'Published product',
        slug: 'published-product',
        description: '',
        featuredAsset: null,
        assets: [],
        collections: [],
        variants: [],
    };
    const config: StorefrontConfig = {
        code: 'my-malaysia',
        defaultLanguageCode: 'zh_Hans',
        defaultCurrencyCode: 'MYR',
        availableCountries: [{ code: 'MY', name: 'Malaysia' }],
        customFields: { storefrontNameZh: '测试店铺', storefrontNameEn: 'Test store' },
    };
    let client: QueryClient;
    let root: ReturnType<typeof createRoot>;
    let value: ReturnType<typeof useStorefrontBootstrap>;
    let finishConfig: (config: StorefrontConfig) => void;
    let failConfig: (error: Error) => void;
    let requests: ReturnType<typeof mockRequests>;

    function mockRequests() {
        return {
            products: vi.spyOn(ShopApi.prototype, 'products').mockResolvedValue([product]),
            collections: vi.spyOn(ShopApi.prototype, 'collections').mockResolvedValue([]),
            content: vi.spyOn(ShopApi.prototype, 'storefrontContent').mockResolvedValue({
                blocks: [],
                flashSales: [],
                systemAnnouncements: [],
                settings: {
                    heroAutoplayIntervalSeconds: 5,
                    auth: {
                        emailPasswordEnabled: true,
                        emailAutoRegistrationEnabled: false,
                        emailQuickRegistrationEnabled: false,
                        googleEnabled: false,
                        googleClientId: null,
                    },
                },
            }),
            commerceMode: vi.spyOn(ShopApi.prototype, 'activeStoreCommerceMode').mockResolvedValue('HYBRID'),
            product: vi.spyOn(ShopApi.prototype, 'product').mockResolvedValue({ ...product, id: 'detail' }),
            catalog: vi
                .spyOn(ShopApi.prototype, 'catalog')
                .mockResolvedValue({ items: [product], totalItems: 1 }),
            sales: vi.spyOn(ShopApi.prototype, 'productSales').mockResolvedValue({ '1': 1 }),
            reviewSettings: vi.spyOn(ContentReviewsApi.prototype, 'reviewSettings').mockResolvedValue({
                enabled: true,
            }),
        };
    }

    function Harness() {
        value = useStorefrontBootstrap();
        useStorefrontMerchandising({
            ...value.queryContext,
            customer: null,
            recentProductIds: value.recentProductIds,
            products: value.products,
            contentBlocks: value.contentBlocks,
            configuredBlockTypes: value.configuredBlockTypes,
            activeRoute: 'home',
            contentReady: value.contentQuery.data !== undefined,
        });
        useStorefrontRouteData({
            ...value.queryContext,
            customer: null,
            customerLoadState: 'loading',
            route: { name: 'product', id: 'detail' },
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
        });
    }

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        root = createRoot(document.createElement('div'));
        const pendingConfig = new Promise<StorefrontConfig>((resolve, reject) => {
            finishConfig = resolve;
            failConfig = reject;
        });
        vi.spyOn(ShopApi.prototype, 'storefrontConfig').mockReturnValue(pendingConfig);
        vi.spyOn(ShopApi.prototype, 'activeCustomer').mockResolvedValue(null);
        vi.spyOn(ShopApi.prototype, 'storefrontVisualPreset').mockResolvedValue({
            channelId: config.code,
            presetId: 'classic',
            desktopLayout: 'classic',
            revision: '1',
        });
        requests = mockRequests();
    });

    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        vi.restoreAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('waits for the configured store and requests each public resource only in its resolved scope', async () => {
        await render();
        expect(value.storefrontContextResolved).toBe(false);
        for (const request of Object.values(requests)) expect(request).not.toHaveBeenCalled();

        await act(async () => finishConfig(config));
        await vi.waitFor(async () => {
            await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
            expect(value.storefrontContextResolved).toBe(true);
            expect(requests.sales).toHaveBeenCalledTimes(1);
        });
        for (const [name, request] of Object.entries(requests)) {
            expect(request, name).toHaveBeenCalledTimes(name === 'catalog' ? 2 : 1);
        }
        expect(value.market).toMatchObject({ code: 'my-malaysia', currencyCode: 'MYR' });
        expect(client.getQueryData(storefrontQueryKeys.products('my-malaysia:MYR', 'zh_Hans', 12))).toEqual([
            product,
        ]);
        expect(
            client.getQueryData(
                storefrontQueryKeys.products(storefrontQueryKeys.market(enabledMarkets[0]), 'zh_Hans', 12),
            ),
        ).toBeUndefined();
    });

    it.each([false, true])('keeps a failed configuration visible with cached products: %s', async cached => {
        if (cached) {
            client.setQueryData(
                storefrontQueryKeys.products(storefrontQueryKeys.market(enabledMarkets[0]), 'zh_Hans', 12),
                [product],
            );
        }
        await render();
        await act(async () => failConfig(new Error('Configuration request failed')));
        await act(async () => vi.waitFor(() => expect(value.configQuery.isError).toBe(true)));

        expect(value.storefrontContextResolved).toBe(false);
        expect(value.publicLoadState).toBe('error');
        expect(value.error).toBeTruthy();
        expect(value.products).toEqual(cached ? [product] : []);
        for (const request of Object.values(requests)) expect(request).not.toHaveBeenCalled();
    });
});
