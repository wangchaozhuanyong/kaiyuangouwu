// @vitest-environment jsdom
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useStorefrontNavigation } from './hooks/useStorefrontNavigation';
import { storefrontQueryClient, storefrontQueryKeys } from './query-client';
import { PageSkeleton } from './route-loading';
import { router as productionRouter } from './router';
import { registerStorefrontNavigationHistory } from './storefront-navigation-history';
import { setPublicPageNavigationScope } from './storefront-page-data';
import { useStorefront } from './StorefrontContext';
import { StorefrontShell } from './StorefrontShell';
import { type Product } from './types';

const loads = vi.hoisted(() => ({
    code: vi.fn<() => Promise<void>>(),
    product: vi.fn<() => Promise<Product | null>>(),
    retryPage: vi.fn(),
}));
vi.mock('./route-component-preload', () => ({ preloadStorefrontRouteComponent: loads.code }));
vi.mock('./route-media-preload', () => ({ preloadRouteMedia: vi.fn() }));
vi.mock('./storefront-enhancements', () => ({ trackStorefrontEnhancements: () => () => undefined }));
vi.mock('./desktop-layout', async importOriginal => ({
    ...(await importOriginal<typeof import('./desktop-layout')>()),
    useDesktopViewport: () => false,
}));
vi.mock('./storefront-deferred-ui', async importOriginal => ({
    ...(await importOriginal<typeof import('./storefront-deferred-ui')>()),
    useDeferredStorefrontUi: () => false,
}));
vi.mock('./App', () => ({ App: () => null }));
vi.mock('./routeTree.gen', async () => {
    const { createRoute } = await import('@tanstack/react-router');
    const { Route: rootRoute } = await import('./routes/__root');
    const { Route: product } = await import('./routes/product');
    const { Route: home } = await import('./routes/index');
    rootRoute.update({ component: MobileShell });
    return {
        routeTree: rootRoute.addChildren([
            createRoute({
                getParentRoute: () => rootRoute,
                path: '/',
                loader: home.options.loader,
                component: Home,
            }),
            createRoute({
                getParentRoute: () => rootRoute,
                path: '/product',
                validateSearch: product.options.validateSearch,
                loaderDeps: product.options.loaderDeps,
                loader: product.options.loader,
                component: ProductBody,
            }),
            createRoute({
                getParentRoute: () => rootRoute,
                path: '/services',
                loader: () => loads.code(),
                component: () => <article>Services ready</article>,
            }),
        ]),
    };
});

function Home() {
    const { navigate } = useStorefront();
    return (
        <article data-mobile-home>
            Home ready
            <button onClick={() => navigate({ name: 'product', id: 'cold' })}>Open product</button>
        </article>
    );
}
function ProductBody() {
    const { navigate, route } = useStorefront();
    const result = useQuery({
        queryKey: storefrontQueryKeys.product('store-a:MYR', 'en', route.id ?? ''),
        queryFn: loads.product,
    });
    if (result.isPending) return <PageSkeleton variant="detail" />;
    return (
        <article data-mobile-product>
            Product ready
            <button onClick={() => navigate({ name: 'services' })}>Open services</button>
            <div data-product-purchase-bar>Existing purchase bar</div>
        </article>
    );
}
function MobileShell() {
    const navigation = useStorefrontNavigation({ collections: [] });
    const state = {
        ...navigation,
        online: true,
        language: 'en',
        customer: null,
        customerLoadState: 'ready',
        retryPageLoad: loads.retryPage,
        storefrontContextValue: {
            ...navigation,
            customer: null,
            market: { code: 'store-a', currencyCode: 'MYR' },
            storefrontCode: 'store-a',
            storefrontName: 'Fixture',
            logoUrl: null,
            displayCurrencyCode: 'MYR',
            availableCurrencyCodes: ['MYR'],
            cartLoading: false,
            toggleLanguage: () => undefined,
            switchCurrency: () => Promise.resolve(),
            storefrontContextResolved: true,
            configQuery: { isError: false, isFetching: false },
        },
    };
    return <StorefrontShell state={state as never} />;
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let router: typeof productionRouter;
let release: () => void;
beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    loads.code.mockReset().mockResolvedValue(undefined);
    loads.product.mockReset().mockResolvedValue({ id: 'cold', name: 'Fixture product' } as Product);
    loads.retryPage.mockReset();
    release = () => undefined;
    storefrontQueryClient.clear();
    setPublicPageNavigationScope({
        channelCode: 'store-a',
        currencyCode: 'MYR',
        languageCode: 'en',
        api: { product: loads.product, catalog: () => Promise.resolve({ items: [], totalItems: 0 }) },
    });
    router = createRouter({
        ...productionRouter.options,
        history: createMemoryHistory({ initialEntries: ['/en/'] }),
        scrollRestoration: false,
    });
    registerStorefrontNavigationHistory(router);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => {
        release();
        root.unmount();
        await Promise.resolve();
    });
    host.remove();
    setPublicPageNavigationScope(undefined);
    storefrontQueryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
async function start() {
    await act(async () => {
        await router.load();
        root.render(
            <QueryClientProvider client={storefrontQueryClient}>
                <RouterProvider router={router} />
            </QueryClientProvider>,
        );
    });
}
function holdCode() {
    const promise = new Promise<void>(resolve => {
        release = resolve;
    });
    loads.code.mockImplementation(() => promise);
}
async function click(label: string, delay = 0) {
    const button = Array.from(host.querySelectorAll('button')).find(node => node.textContent === label);
    expect(button).toBeDefined();
    if (!button) throw new Error('Missing fixture action: ' + label);
    await act(async () => {
        button.click();
        await new Promise(resolve => setTimeout(resolve, delay));
    });
}
it('preserves query scalar coercion and ignores omitted or compound search values', () => {
    const stringify = productionRouter.options.stringifySearch;
    if (!stringify) throw new Error('Missing production search serializer');
    expect(
        stringify({
            text: 'a b+&中',
            zero: 0,
            yes: true,
            no: false,
            empty: '',
            missing: undefined,
            nil: null,
            array: ['2'],
            object: {},
            callback: () => undefined,
            symbol: Symbol('ignored'),
            bigint: BigInt(1),
            nan: NaN,
            infinity: Infinity,
        }),
    ).toBe('?text=a+b%2B%26%E4%B8%AD&zero=0&yes=true&nan=NaN&infinity=Infinity');
    expect(stringify({ no: false, empty: '', nil: null })).toBe('');
    expect(productionRouter.options.parseSearch?.('?same=first&same=last&text=a+b%2B%26')).toEqual({
        same: 'last',
        text: 'a b+&',
    });
    expect(productionRouter.options.parseSearch?.('??x=1')).toEqual({ x: '1' });
});
it.each(['code', 'data', 'timeout'])(
    'shows the mobile target pending body and keeps browser return usable while product %s is pending',
    async kind => {
        await start();
        if (kind === 'data') {
            const promise = new Promise<Product>(resolve => {
                release = () => resolve({ id: 'cold', name: 'Fixture product' } as Product);
            });
            loads.product.mockImplementation(() => promise);
        } else holdCode();
        await click('Open product', 240);
        const home = host.querySelector('[data-mobile-home]');
        expect(home === null || getComputedStyle(home).display === 'none').toBe(true);
        expect(host.querySelector('[data-route]')?.getAttribute('data-route')).toBe('product');
        expect(host.querySelector('[data-page-pending]')).not.toBeNull();
        await vi.waitFor(async () => {
            await act(async () => {
                await Promise.resolve();
            });
            expect(host.querySelector('.page-readiness-navigation')).not.toBeNull();
        });
        expect(host.querySelector('[data-product-purchase-bar]')).toBeNull();
        if (kind === 'timeout') {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 10_000));
            });
            expect(host.querySelector('.page-readiness-error[role="status"]')).not.toBeNull();
        }
        await act(async () => {
            if (kind === 'timeout') {
                const back = Array.from(host.querySelectorAll('.page-readiness-error button')).find(
                    node => node.textContent === 'Back',
                ) as HTMLButtonElement | undefined;
                if (!back) throw new Error('Timeout return action is missing');
                expect(back.closest('[hidden],[inert]')).toBeNull();
                back.click();
            } else router.history.back();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(host.querySelector('[data-mobile-home]')?.textContent).toContain('Home ready');
        await act(async () => {
            release();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(host.querySelector('[data-mobile-home]')).not.toBeNull();
        expect(host.querySelector('.page-readiness-navigation')).toBeNull();
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.querySelector('.page-back-button')).toBeNull();
    },
    15_000,
);
it('removes source purchase actions from view and immediately exposes target navigation', async () => {
    await start();
    await click('Open product');
    expect(host.querySelector('[data-product-purchase-bar]')).not.toBeNull();
    expect(host.querySelector('.page-back-button')).toBeNull();
    expect(host.querySelector('.storefront-bottom-nav')).toBeNull();
    holdCode();
    vi.useFakeTimers();
    try {
        const button = Array.from(host.querySelectorAll('button')).find(
            node => node.textContent === 'Open services',
        );
        if (!button) throw new Error('Services navigation action is missing');
        await act(async () => {
            button.click();
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(host.querySelector('[data-product-purchase-bar]')).not.toBeNull();
        expect(host.querySelector('.page-back-button')).not.toBeNull();
        expect(host.querySelector('.storefront-bottom-nav')).not.toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        const purchaseBar = host.querySelector('[data-product-purchase-bar]');
        expect(purchaseBar).not.toBeNull();
        const purchaseArticle = purchaseBar?.closest('article');
        if (!purchaseArticle) throw new Error('Expected the purchase bar inside the source article');
        expect(getComputedStyle(purchaseArticle).display).toBe('none');
        expect(host.querySelector('[data-page-pending]')).not.toBeNull();
        expect(host.querySelector('.page-readiness-navigation')).not.toBeNull();
        await act(async () => {
            release();
            await vi.advanceTimersByTimeAsync(20);
        });
        expect(host.textContent).toContain('Services ready');
    } finally {
        vi.useRealTimers();
    }
});

it('gives each pending destination its own timeout and retries the latest navigation only', async () => {
    await start();
    holdCode();
    vi.useFakeTimers();
    try {
        await act(async () => {
            void router.navigate({ to: '/product', search: { id: 'cold' } } as never);
            await vi.advanceTimersByTimeAsync(9_000);
        });
        expect(host.querySelector('[role="alert"]')).toBeNull();
        await act(async () => {
            void router.navigate({ to: '/services' } as never);
            await vi.advanceTimersByTimeAsync(1_100);
        });
        expect(router.state.location.pathname).toBe('/services');
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.querySelector('[data-route]')?.getAttribute('data-route')).toBe('services');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9_000);
        });
        expect(host.querySelector('.page-readiness-error[role="status"]')).not.toBeNull();
        const reload = vi.spyOn(router, 'load');
        const retry = Array.from(host.querySelectorAll('button')).find(
            node => node.textContent === 'Try again',
        );
        if (!retry) throw new Error('Expected the navigation retry action');
        await act(async () => {
            retry.click();
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(reload).toHaveBeenCalledOnce();
        expect(loads.retryPage).not.toHaveBeenCalled();
        expect(router.state.location.pathname).toBe('/services');
        expect(host.querySelector('[role="alert"]')).toBeNull();
        await act(async () => {
            release();
            await vi.advanceTimersByTimeAsync(20);
        });
        expect(host.textContent).toContain('Services ready');
        expect(host.querySelector('[data-mobile-product]')).toBeNull();
        expect(host.querySelector('[data-page-pending]')).toBeNull();
        expect(host.querySelector('.page-readiness-navigation')).toBeNull();
    } finally {
        vi.useRealTimers();
    }
});

it('keeps the mobile brand and notification controls available while home code is pending', async () => {
    router = createRouter({
        ...productionRouter.options,
        history: createMemoryHistory({ initialEntries: ['/en/product?id=cold'] }),
        scrollRestoration: false,
    });
    registerStorefrontNavigationHistory(router);
    await start();
    holdCode();
    let navigation: Promise<void> | undefined;
    await act(async () => {
        navigation = router.navigate({ to: '/' } as never);
        await new Promise(resolve => setTimeout(resolve, 240));
    });
    const header = host.querySelector('.storefront-pending-mobile-header .mobile-page-header');
    expect(header?.textContent).toContain('Fixture');
    const notifications = header?.querySelector<HTMLButtonElement>('button[aria-label="Notifications"]');
    expect(notifications?.disabled).toBe(false);
    expect(host.querySelector('.storefront-bottom-nav')).not.toBeNull();
    await act(async () => {
        router.history.back();
        await new Promise(resolve => setTimeout(resolve, 20));
    });
    await act(async () => {
        release();
        await navigation;
    });
    expect(host.querySelector('[data-mobile-product]')).not.toBeNull();
    expect(host.querySelector('.storefront-pending-mobile-header')).toBeNull();
});
