// @vitest-environment jsdom
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ShopApi } from '../api';
import { useStorefrontRouteData } from '../hooks/useStorefrontRouteData';
import { enabledMarkets } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { HomePageContext } from '../storefront-page-contexts';
import { seedPublicPage, type PublicPageData } from '../storefront-page-data';
import { StorefrontContext, type StorefrontContextValue } from '../StorefrontContext';
import { type Product, type StorefrontLanguage } from '../types';

import { HomeRoutePage, ProductRoutePage } from './catalog-route-pages';

let homeInputs: ReturnType<typeof HomePageContext.useValue> | undefined;
function HomeReadProbe() {
    const value = HomePageContext.useValue();
    homeInputs = value;
    return (
        <div>
            <output>{String(Boolean(value.managedContentLoading))}</output>
            <span data-error>{value.managedContentError}</span>
            <span data-coupons-pending>{String(value.couponCampaignsLoading)}</span>
            <button onClick={value.onManagedContentRetry}>Retry selections</button>
        </div>
    );
}

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    lazyRouteComponent: (_load: unknown, name: string) =>
        name === 'ProductDetailPage'
            ? () => <p>Confirmed product detail</p>
            : name === 'HomePage'
              ? HomeReadProbe
              : () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('home selection read boundaries', () => {
    it('passes the currency completion promise through the home adapter before language can change', () => {
        const client = new QueryClient();
        const root = createRoot(document.createElement('div'));
        const completion = Promise.resolve();
        const switchCurrency = vi.fn(() => completion);
        const value = {
            language: 'en',
            market: enabledMarkets[0],
            collections: [],
            catalogTakes: { sales: 16, recommended: 16 },
            bestSellerProducts: [],
            recommendationProducts: [],
            configQuery: {},
            contentQuery: { data: {} },
            productsQuery: { data: [] },
            switchCurrency,
        } as unknown as StorefrontContextValue;
        try {
            act(() =>
                root.render(
                    <QueryClientProvider client={client}>
                        <StorefrontContext.Provider value={value}>
                            <HomeRoutePage />
                        </StorefrontContext.Provider>
                    </QueryClientProvider>,
                ),
            );
            expect(homeInputs?.onCurrencyChange('MYR')).toBe(completion);
            expect(switchCurrency).toHaveBeenCalledExactlyOnceWith('MYR');
        } finally {
            act(() => root.unmount());
            client.clear();
        }
    });
    it.each([
        ['loading', false, '', true],
        ['ready', true, '', true],
        ['ready', false, '', false],
        ['error', false, '', false],
        ['ready', true, 'Offline', false],
    ] as const)(
        'reserves coupon space for identity=%s / pending=%s / error=%s',
        (identity, pending, error, expected) => {
            const client = new QueryClient();
            const host = document.createElement('div');
            const root = createRoot(host);
            try {
                const value = {
                    language: 'zh',
                    market: enabledMarkets[0],
                    collections: [],
                    catalogTakes: { sales: 16, recommended: 16 },
                    bestSellerProducts: [],
                    recommendationProducts: [],
                    configQuery: {},
                    contentQuery: { data: {} },
                    productsQuery: { data: [] },
                    customerLoadState: identity,
                    couponCampaignsLoading: pending,
                    couponCampaignsError: error,
                } as unknown as StorefrontContextValue;
                act(() =>
                    root.render(
                        <QueryClientProvider client={client}>
                            <StorefrontContext.Provider value={value}>
                                <HomeRoutePage />
                            </StorefrontContext.Provider>
                        </QueryClientProvider>,
                    ),
                );
                expect(host.querySelector('[data-coupons-pending]')?.textContent).toBe(String(expected));
            } finally {
                act(() => root.unmount());
                client.clear();
            }
        },
    );

    it.each([
        { data: [] as Product[] | undefined, paused: true, failed: false, waiting: false },
        { data: [] as Product[] | undefined, paused: false, failed: true, waiting: false },
        { data: undefined, paused: true, failed: false, waiting: true },
        { data: undefined, paused: false, failed: true, waiting: true },
    ])(
        'preserves confirmed empty data and retries only selections: $paused / $failed / $waiting',
        ({ data, paused, failed, waiting }) => {
            const client = new QueryClient();
            const host = document.createElement('div');
            document.body.append(host);
            const root = createRoot(host);
            const refetch = vi.fn().mockResolvedValue(undefined);
            const refetchStorefront = vi.fn();
            try {
                const value = {
                    language: 'zh',
                    market: enabledMarkets[0],
                    collections: [],
                    catalogTakes: { sales: 16, recommended: 16 },
                    bestSellerProducts: [],
                    recommendationProducts: [],
                    configQuery: {},
                    contentQuery: { data: {} },
                    customerQuery: { data: null },
                    productsQuery: { data: [] },
                    managedContentLoading: false,
                    managedContentProductsQuery: {
                        data,
                        isPaused: paused,
                        isError: failed,
                        error: failed ? new Error('Selection read failed') : null,
                        refetch,
                    },
                    refetchStorefront,
                } as unknown as StorefrontContextValue;
                act(() =>
                    root.render(
                        <QueryClientProvider client={client}>
                            <StorefrontContext.Provider value={value}>
                                <HomeRoutePage />
                            </StorefrontContext.Provider>
                        </QueryClientProvider>,
                    ),
                );
                expect(host.querySelector('output')?.textContent).toBe(String(waiting));
                expect(Boolean(host.querySelector('[data-error]')?.textContent)).toBe(waiting);
                act(() => host.querySelector('button')?.click());
                expect(refetch).toHaveBeenCalledWith({ cancelRefetch: false });
                expect(refetchStorefront).not.toHaveBeenCalled();
            } finally {
                act(() => root.unmount());
                client.clear();
                host.remove();
            }
        },
    );
});

describe('product detail read states', () => {
    let mounted:
        { root: ReturnType<typeof createRoot>; client: QueryClient; host: HTMLDivElement } | undefined;

    async function renderPage({
        language = 'zh',
        product = vi.fn().mockResolvedValue(null),
        seed,
        id = 'missing-product',
        contextResolved = true,
    }: {
        language?: StorefrontLanguage;
        product?: ReturnType<typeof vi.fn>;
        seed?: Product | null;
        id?: string;
        contextResolved?: boolean;
    } = {}) {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        const market = enabledMarkets[0];
        const vendureLanguageCode = language === 'zh' ? 'zh_Hans' : 'en';
        const key = storefrontQueryKeys.product(storefrontQueryKeys.market(market), vendureLanguageCode, id);
        if (seed !== undefined) {
            seedPublicPage(client, {
                generatedAt: Date.now(),
                scope: {
                    channelCode: market.code,
                    currencyCode: market.currencyCode,
                    languageCode: vendureLanguageCode,
                },
                config: { accessMode: 'LIVE' },
                request: { kind: 'product', id },
                product: seed,
            } as PublicPageData);
        }
        const goBack = vi.fn();
        const navigate = vi.fn();
        let latest: ReturnType<typeof useStorefrontRouteData> | undefined;
        function Page() {
            latest = useStorefrontRouteData({
                api: { product } as unknown as ShopApi,
                market,
                language,
                vendureLanguageCode,
                storefrontContextResolved: contextResolved,
                customerAuthenticated: false,
                customer: null,
                customerLoadState: 'ready',
                route: { name: 'product', id: id || undefined },
            });
            return (
                <StorefrontContext.Provider
                    value={
                        {
                            ...latest,
                            language,
                            market,
                            route: { name: 'product', id: id || undefined },
                            selectedProduct: latest.routeProduct,
                            activeFlashSaleItems: [],
                            favoriteProductIds: [],
                            goBack,
                            navigate,
                        } as unknown as StorefrontContextValue
                    }
                >
                    <ProductRoutePage />
                </StorefrontContext.Provider>
            );
        }
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        mounted = { root, client, host };
        const render = () =>
            root.render(
                <QueryClientProvider client={client}>
                    <Page />
                </QueryClientProvider>,
            );
        await act(async () => {
            render();
            await vi.dynamicImportSettled();
        });
        return {
            host,
            client,
            key,
            product,
            navigate,
            goBack,
            query: () => latest?.productQuery,
            async resolveContext() {
                contextResolved = true;
                await act(async () => {
                    render();
                    await Promise.resolve();
                });
            },
            async refresh() {
                await act(async () => {
                    await latest?.productQuery.refetch({ cancelRefetch: false });
                });
            },
        };
    }

    async function expectRendered(check: () => void) {
        await vi.waitFor(async () => {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
            check();
        });
    }

    afterEach(() => {
        onlineManager.setOnline(true);
        if (!mounted) return;
        act(() => mounted?.root.unmount());
        mounted.client.clear();
        mounted.host.remove();
        mounted = undefined;
    });

    it.each(['zh', 'en'] as const)(
        'renders an aggregate-seeded null as a completed %s empty state',
        async language => {
            const page = await renderPage({ language, seed: null });
            await expectRendered(() =>
                expect(page.host.textContent).toContain(
                    language === 'zh' ? '没有找到商品' : 'Product not found',
                ),
            );
            expect(page.host.querySelector('[aria-busy="true"]')).toBeNull();
            expect(page.query()?.status).toBe('success');
            expect(page.product).not.toHaveBeenCalled();
            const button = Array.from(page.host.querySelectorAll('button')).find(
                item => item.textContent === (language === 'zh' ? '去逛商品' : 'Browse'),
            );
            expect(button).toBeDefined();
            act(() => button?.click());
            expect(page.navigate).toHaveBeenCalledExactlyOnceWith({ name: 'category' });
        },
    );

    it('accepts a fresh null response without reporting a failed request or retrying it', async () => {
        const page = await renderPage();
        await expectRendered(() => expect(page.query()?.status).toBe('success'));
        expect(page.query()?.data).toBeNull();
        expect(page.host.textContent).toContain('没有找到商品');
        expect(page.host.textContent).not.toContain('重试');
        expect(page.product).toHaveBeenCalledOnce();
    });

    it('waits for a real initial request, then exits the skeleton on a null response', async () => {
        let finish: (value: null) => void = () => {
            throw new Error('Request did not start');
        };
        const page = await renderPage({
            product: vi.fn(
                () =>
                    new Promise<null>(resolve => {
                        finish = resolve;
                    }),
            ),
        });
        expect(page.host.querySelector('[aria-busy="true"]')).not.toBeNull();
        expect(page.host.textContent).not.toContain('没有找到商品');
        await act(async () => {
            finish(null);
            await Promise.resolve();
        });
        await expectRendered(() => expect(page.host.textContent).toContain('没有找到商品'));
        expect(page.host.querySelector('[aria-busy="true"]')).toBeNull();
    });

    it('waits for a valid product route to resolve its storefront scope before fetching', async () => {
        const page = await renderPage({ contextResolved: false });
        expect(page.product).not.toHaveBeenCalled();
        expect(page.host.querySelector('[aria-busy="true"]')).not.toBeNull();
        await page.resolveContext();
        await expectRendered(() => expect(page.host.textContent).toContain('没有找到商品'));
        expect(page.product).toHaveBeenCalledOnce();
    });

    it('does not wait on the disabled query when the route has no product id', async () => {
        const page = await renderPage({ id: '' });
        expect(page.host.textContent).toContain('没有找到商品');
        expect(page.host.querySelector('[aria-busy="true"]')).toBeNull();
        expect(page.product).not.toHaveBeenCalled();
    });

    it.each(['zh', 'en'] as const)(
        'shows an initial %s read failure and retries only on user action',
        async language => {
            const product = vi
                .fn()
                .mockRejectedValueOnce(new Error('fetch failed'))
                .mockResolvedValueOnce(null);
            const page = await renderPage({ language, product });
            await expectRendered(() =>
                expect(page.host.textContent).toContain(language === 'zh' ? '重试' : 'Retry'),
            );
            expect(page.host.querySelector('[aria-busy="true"]')).toBeNull();
            expect(product).toHaveBeenCalledOnce();
            const retry = Array.from(page.host.querySelectorAll('button')).find(
                item => item.textContent === (language === 'zh' ? '重试' : 'Retry'),
            );
            await act(async () => {
                retry?.click();
                await Promise.resolve();
            });
            await expectRendered(() => expect(page.query()?.status).toBe('success'));
            expect(page.query()?.data).toBeNull();
            expect(page.host.textContent).toContain(language === 'zh' ? '去逛商品' : 'Browse');
            expect(product).toHaveBeenCalledTimes(2);
        },
    );

    it('shows the localized offline state instead of waiting forever without a connection', async () => {
        onlineManager.setOnline(false);
        const page = await renderPage();
        expect(page.host.textContent).toContain('重试');
        expect(page.host.textContent).toContain('网络');
        expect(page.host.querySelector('[aria-busy="true"]')).toBeNull();
        expect(page.product).not.toHaveBeenCalled();
    });

    it('preserves confirmed detail when a background refresh fails, then recovers', async () => {
        const seed = { id: 'known-product', name: 'Zero-stock token', variants: [] } as unknown as Product;
        const product = vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(seed);
        const page = await renderPage({ seed, id: seed.id, product });
        expect(page.host.textContent).toContain('Confirmed product detail');
        await page.refresh();
        await expectRendered(() => expect(page.query()?.status).toBe('error'));
        expect(page.query()?.data).toEqual(seed);
        expect(page.host.textContent).toContain('Confirmed product detail');
        expect(page.host.textContent).not.toContain('重试');
        expect(page.host.querySelector('[aria-busy="true"]')).toBeNull();
        await page.refresh();
        await expectRendered(() => expect(page.query()?.status).toBe('success'));
        expect(page.host.textContent).toContain('Confirmed product detail');
    });

    it('keeps a confirmed missing result during a failed refresh without turning it into an initial error', async () => {
        const page = await renderPage({
            seed: null,
            product: vi.fn().mockRejectedValue(new Error('fetch failed')),
        });
        await page.refresh();
        await expectRendered(() => expect(page.query()?.status).toBe('error'));
        expect(page.query()?.data).toBeNull();
        expect(page.host.textContent).toContain('没有找到商品');
        expect(page.host.textContent).toContain('去逛商品');
        expect(page.host.textContent).not.toContain('重试');
        expect(page.host.querySelector('[aria-busy="true"]')).toBeNull();
    });
});
