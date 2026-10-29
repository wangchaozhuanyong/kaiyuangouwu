// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { readFileSync } from 'node:fs';
import { act, StrictMode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import {
    publicPageRequestFromUrl,
    publicPageRequestKey,
    publicPageRouteHref,
    serializeStorefrontPageData,
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
} from '../../storefront-content-plugin/src/shared/public-page-data';
import { fixtureStores, syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { invalidatePublicPageReads } from './public-page-transport';
import { createPublicSnapshotApp } from './public-snapshot';
import { router as runtimeRouter } from './router';
import {
    readInitialPublicPage,
    seedPublicPage,
    setPublicPageNavigationScope,
    type PublicPageData,
} from './storefront-page-data';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';

vi.hoisted(() => vi.stubEnv('VITE_CLIENT_CHANNEL_SWITCHING', 'false'));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let client: QueryClient | undefined;
const elementScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

afterEach(async () => {
    await act(async () => {
        root?.unmount();
        await vi.dynamicImportSettled();
    });
    client?.clear();
    root = undefined;
    setPublicPageNavigationScope(undefined);
    invalidatePublicPageReads();
    document.body.replaceChildren();
    sessionStorage.clear();
    if (elementScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', elementScrollTo);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

type Scenario = {
    name: string;
    href: string;
    offline?: boolean;
    stale?: boolean;
    updateImmediately?: boolean;
    child?: boolean;
    empty?: boolean;
    hidden?: boolean;
    implicit?: boolean;
};

const scenarios: Scenario[] = [
    ...(process.env.REAL_HYDRATION_FIXTURE
        ? [
              {
                  name: 'the captured public category',
                  href: '/zh/category?collectionId=49&childId=86&sort=recommended&fulfillment=all',
              },
          ]
        : []),
    {
        name: 'an explicit child category and non-default filters',
        href: '/zh/category?collectionId=2&childId=42&sort=price-desc&fulfillment=digital&inStockOnly=true&minPrice=20&maxPrice=200&page=2',
        child: true,
    },
    { name: 'the implicit first category', href: '/zh/category', implicit: true },
    { name: 'a confirmed empty result', href: '/zh/category?collectionId=2&sort=price-asc', empty: true },
    {
        name: 'a delayed document with expired public data',
        href: '/zh/category?collectionId=2&childId=all',
        stale: true,
    },
    {
        name: 'an immediate aggregate refresh after delayed scripts',
        href: '/zh/category?collectionId=2&childId=all',
        stale: true,
        updateImmediately: true,
    },
    {
        name: 'an offline browser at first hydration',
        href: '/zh/category?collectionId=2&childId=all',
        offline: true,
    },
    {
        name: 'a hidden tab at first hydration',
        href: '/zh/category?collectionId=2&childId=all',
        hidden: true,
    },
];

function requestHref(input: RequestInfo | URL): string {
    return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function fixture(scenario: Scenario): PublicPageData {
    if (scenario.name === 'the captured public category') {
        const fixturePath = process.env.REAL_HYDRATION_FIXTURE;
        if (!fixturePath) throw new Error('Expected public fixture path');
        const captured = JSON.parse(readFileSync(fixturePath, 'utf8')) as PublicPageData;
        const replay = JSON.parse(
            JSON.stringify(captured).replaceAll(`https://${captured.scope.host}`, window.location.origin),
        ) as PublicPageData;
        replay.scope.host = window.location.host;
        replay.generatedAt = Date.now();
        return replay;
    }
    const page: PublicPageData = syntheticPage(fixtureStores[0], 'zh_Hans', 'catalog', {
        host: window.location.host,
        generatedAt: Date.now() - (scenario.stale ? 45_000 : 0),
    });
    const request = publicPageRequestFromUrl(scenario.href);
    if (
        !request ||
        request.kind !== 'catalog' ||
        !page.collections?.length ||
        !page.products ||
        !page.catalog
    )
        throw new Error('Incomplete synthetic category fixture');
    // The public API emits the canonical effective collection, not the browser's
    // parent/child URL. Using the browser URL here previously hid real #418 failures.
    page.route = publicPageRouteHref(request);
    page.request = request;
    page.requestKey = publicPageRequestKey(request);
    page.collections[0].id = '2';
    if (scenario.child) {
        page.collections[0].children = [
            { ...page.collections[0], id: '42', parentId: '2', children: [], name: '合成子分类' },
        ];
    }
    page.products.forEach(product =>
        product.collections.forEach(collection => {
            collection.id = scenario.child ? '42' : '2';
        }),
    );
    page.catalog.items = scenario.empty ? [] : page.products.slice(0, scenario.implicit ? 11 : 12);
    page.catalog.totalItems = scenario.empty ? 0 : 36;
    if (scenario.implicit) delete page.products;
    return page;
}

it.each(scenarios)('preserves the actual server DOM while hydrating $name', async scenario => {
    window.history.replaceState(null, '', scenario.href);
    vi.stubGlobal('matchMedia', () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    HTMLElement.prototype.scrollTo = () => undefined;
    const page = fixture(scenario);
    const fresh = structuredClone(page);
    fresh.generatedAt = Date.now();
    fresh.config.description = '刷新后的合成说明';
    if (fresh.catalog?.items[0]) fresh.catalog.items[0].name = '刷新后的合成商品';
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const href = requestHref(input);
        return scenario.updateImmediately && href.includes('/_storefront/page-data')
            ? Promise.resolve(Response.json(fresh))
            : new Promise<Response>((_resolve, reject) =>
                  init?.signal?.addEventListener(
                      'abort',
                      () => reject(new DOMException('Aborted', 'AbortError')),
                      { once: true },
                  ),
              );
    });
    vi.stubGlobal('fetch', fetch);
    // A refreshed document receives a new router. Reusing the singleton across tests
    // retains the prior document's pending loader and does not model a browser refresh.
    const router = createRouter({
        ...runtimeRouter.options,
        history: createMemoryHistory({ initialEntries: [scenario.href] }),
    });
    const browser = { window, document, navigator };
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    let html: string;
    try {
        const snapshot = await createPublicSnapshotApp(page);
        try {
            html = renderToString(snapshot.element);
        } finally {
            snapshot.dispose();
        }
    } finally {
        vi.stubGlobal('window', browser.window);
        vi.stubGlobal('document', browser.document);
        vi.stubGlobal('navigator', browser.navigator);
    }
    document.body.innerHTML =
        `<div id="root" data-public-rendered="1">${html}</div>` +
        `<script id="${STOREFRONT_PAGE_DATA_ELEMENT_ID}" type="application/json">${serializeStorefrontPageData(page)}</script>`;
    expect(readInitialPublicPage()?.requestKey).toBe(page.requestKey);
    const connection = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(!scenario.offline);
    if (scenario.hidden) vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client = queryClient;
    seedPublicPage(queryClient, page);
    router.ssr = { manifest: undefined };
    await router.load();
    const errors: Array<{ message: string; stack?: string | null }> = [];
    const element = document.getElementById('root');
    if (!element) throw new Error('Missing hydration root fixture');
    const initialMain = element.querySelector('main');
    const initialStatus = element.querySelector('.category-pagination-status');
    const initialProductLink = element.querySelector('a.product-card-detail-link');
    expect(initialMain).not.toBeNull();
    if (!scenario.empty) {
        expect(initialProductLink).not.toBeNull();
        expect(element.querySelectorAll('.category-product-list a.product-card-detail-link')).toHaveLength(
            page.catalog?.items.length ?? 0,
        );
        expect(element.querySelector('.category-product-list .product-card-skeleton')).toBeNull();
        expect(initialProductLink?.querySelector('img.safe-image')).not.toBeNull();
    }
    await act(async () => {
        root = hydrateRoot(
            element,
            <StrictMode>
                <QueryClientProvider client={queryClient}>
                    <StorefrontErrorBoundary>
                        <RouterProvider router={router} />
                    </StorefrontErrorBoundary>
                </QueryClientProvider>
            </StrictMode>,
            {
                onRecoverableError: (error, info) =>
                    errors.push({ message: String(error), stack: info.componentStack }),
            },
        );
        await vi.dynamicImportSettled();
        await new Promise(resolve => window.setTimeout(resolve, 80));
    });
    expect(errors).toEqual([]);
    expect(element.querySelector('main')).toBe(initialMain);
    if (initialStatus) expect(element.querySelector('.category-pagination-status')).toBe(initialStatus);
    if (initialProductLink)
        expect(element.querySelector('a.product-card-detail-link')).toBe(initialProductLink);
    if (scenario.updateImmediately) {
        // Query batches post-commit observer notifications onto a timer. Let that
        // separate render commit before checking the freshly returned content.
        await act(async () => {
            await new Promise(resolve => window.setTimeout(resolve, 30));
        });
        expect(
            fetch.mock.calls.some(([input]) => requestHref(input).includes('/_storefront/page-data')),
        ).toBe(true);
        expect(element.textContent).toContain('刷新后的合成商品');
    }
    if (scenario.offline) {
        expect(initialStatus?.textContent).toContain('网络已断开，连接后继续');
        await act(async () => {
            connection.mockReturnValue(true);
            window.dispatchEvent(new Event('online'));
            await Promise.resolve();
        });
        expect(initialStatus?.textContent).not.toContain('网络已断开，连接后继续');
        expect(element.querySelector('main')).toBe(initialMain);
        expect(element.querySelector('.category-pagination-status')).toBe(initialStatus);
        expect(element.querySelector('a.product-card-detail-link')).toBe(initialProductLink);
        expect(errors).toEqual([]);
    }
});
