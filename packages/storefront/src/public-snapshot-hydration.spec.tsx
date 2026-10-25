// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, StrictMode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import {
    publicPageRequestFromUrl,
    publicPageRequestKey,
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
} from '../../storefront-content-plugin/src/shared/public-page-data';
import { fixtureStores, syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { invalidatePublicPageReads } from './public-page-transport';
import { createPublicSnapshotApp } from './public-snapshot';
import {
    readInitialPublicPage,
    seedPublicPage,
    setPublicPageNavigationScope,
    type PublicPageData,
} from './storefront-page-data';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';

// Match public production hydration rather than the development channel-switching entry.
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
    if (elementScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', elementScrollTo);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

it.each(['category', 'services', 'home'] as const)(
    'hydrates %s without replacing its server DOM',
    async kind => {
        const browserHref =
            kind === 'category'
                ? '/zh/category?collectionId=2&childId=all'
                : kind === 'services'
                  ? '/zh/services'
                  : '/zh/';
        window.history.replaceState(null, '', browserHref);
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(0), 0),
        );
        vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
        // No server or private API response participates in the first hydrated tree.
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise(() => undefined)),
        );
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        HTMLElement.prototype.scrollTo = () => undefined;
        const page: PublicPageData = syntheticPage(
            fixtureStores[0],
            'zh_Hans',
            kind === 'category' ? 'catalog' : 'home',
            {
                host: window.location.host,
            },
        );
        // The public response caches a canonical route; the document URL retains its language.
        page.route =
            kind === 'category' ? '/category?collectionId=2' : kind === 'services' ? '/services' : '/';
        const request = publicPageRequestFromUrl(page.route);
        if (!request || !page.collections?.length || !page.products)
            throw new Error('Incomplete synthetic category fixture');
        page.request = request;
        page.requestKey = publicPageRequestKey(request);
        page.collections[0].id = '2';
        page.products.forEach(product =>
            product.collections.forEach(collection => {
                collection.id = '2';
            }),
        );
        if (page.catalog) {
            page.catalog.items = page.products;
            page.catalog.totalItems = page.products.length;
        }

        const { router: runtimeRouter } = await import('./router');
        const router = createRouter({
            ...runtimeRouter.options,
            history: createMemoryHistory({ initialEntries: [browserHref] }),
        });
        const browserWindow = window;
        const browserDocument = document;
        // SSR must not inherit jsdom's location or capability branches.
        vi.stubGlobal('window', undefined);
        vi.stubGlobal('document', undefined);
        let html: string;
        try {
            const snapshot = await createPublicSnapshotApp(page);
            try {
                html = renderToString(snapshot.element);
            } finally {
                snapshot.dispose();
            }
        } finally {
            vi.stubGlobal('window', browserWindow);
            vi.stubGlobal('document', browserDocument);
        }
        expect(html).toContain('<main');
        document.body.innerHTML =
            `<div id="root" data-public-rendered="1">${html}</div>` +
            `<script id="${STOREFRONT_PAGE_DATA_ELEMENT_ID}" type="application/json"></script>`;
        const pageDataElement = document.getElementById(STOREFRONT_PAGE_DATA_ELEMENT_ID);
        if (!pageDataElement) throw new Error('Missing public page data fixture');
        pageDataElement.textContent = JSON.stringify(page);
        expect(readInitialPublicPage()?.scope).toEqual(page.scope);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client = queryClient;
        seedPublicPage(queryClient, page);
        router.update({ history: createMemoryHistory({ initialEntries: [browserHref] }) });
        router.ssr = { manifest: undefined };
        await router.load();
        const errors: unknown[] = [];
        const element = document.getElementById('root');
        if (!element) throw new Error('Missing hydration root fixture');
        const initialMain = element.querySelector('main');
        const initialProductLink = element.querySelector('.product-card-detail-link');
        expect(initialMain).not.toBeNull();
        if (kind === 'category') expect(initialProductLink).not.toBeNull();
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
                { onRecoverableError: error => errors.push(error) },
            );
            await vi.dynamicImportSettled();
            await new Promise(resolve => window.setTimeout(resolve, 100));
        });
        expect(errors.map(error => String(error))).toEqual([]);
        expect(element.querySelector('main')).toBe(initialMain);
        expect(element.querySelector('.product-card-detail-link')).toBe(initialProductLink);
    },
);
