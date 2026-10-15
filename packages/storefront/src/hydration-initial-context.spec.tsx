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

import { ShopApi } from './api';
import { invalidatePublicPageReads } from './public-page-transport';
import * as publicRefresh from './public-refresh-scheduler';
import { createPublicSnapshotApp } from './public-snapshot';
import { router as runtimeRouter } from './router';
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
    sessionStorage.clear();
    if (elementScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', elementScrollTo);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

it('preserves public HTML when connectivity is lost before hydration and keeps offline feedback live', async () => {
    const connection = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const stream = vi
        .spyOn(ShopApi.prototype, 'watchRealtime')
        .mockRejectedValue(new TypeError('Optional realtime chunk unavailable'));
    const schedulerConnection = vi.fn();
    const schedulerDispose = vi.fn();
    const scheduler = vi.spyOn(publicRefresh, 'publicRefreshScheduler').mockReturnValue({
        connection: schedulerConnection,
        dispose: schedulerDispose,
    });
    const browserHref = '/zh/category?collectionId=2&childId=all';
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
        vi.fn(
            (_input: RequestInfo | URL, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) =>
                    init?.signal?.addEventListener(
                        'abort',
                        () => reject(new DOMException('Aborted', 'AbortError')),
                        { once: true },
                    ),
                ),
        ),
    );
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    HTMLElement.prototype.scrollTo = () => undefined;
    const page: PublicPageData = syntheticPage(fixtureStores[0], 'zh_Hans', 'catalog', {
        host: window.location.host,
    });
    // The public response caches a canonical route; the document URL retains its language.
    page.route = '/category?collectionId=2';
    const request = publicPageRequestFromUrl(page.route);
    if (!request || !page.collections?.length || !page.products || !page.catalog)
        throw new Error('Incomplete synthetic category fixture');
    page.request = request;
    page.requestKey = publicPageRequestKey(request);
    page.collections[0].id = '2';
    page.products.forEach(product =>
        product.collections.forEach(collection => {
            collection.id = '2';
        }),
    );
    page.catalog.items = page.products;
    page.catalog.totalItems = page.products.length;

    // A refresh has a fresh Router; a prior document's loaders do not participate.
    const router = createRouter({
        ...runtimeRouter.options,
        history: createMemoryHistory({ initialEntries: [browserHref] }),
    });
    const browserWindow = window;
    const browserDocument = document;
    const browserNavigator = navigator;
    // SSR must not inherit jsdom's location or capability branches.
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
        vi.stubGlobal('window', browserWindow);
        vi.stubGlobal('document', browserDocument);
        vi.stubGlobal('navigator', browserNavigator);
    }
    expect(html).toContain('<main');
    document.body.innerHTML = `<div id="root" data-public-rendered="1">${html}</div><script id="${STOREFRONT_PAGE_DATA_ELEMENT_ID}" type="application/json"></script>`;
    const pageDataElement = document.getElementById(STOREFRONT_PAGE_DATA_ELEMENT_ID);
    if (!pageDataElement) throw new Error('Missing public page data fixture');
    pageDataElement.textContent = JSON.stringify(page);
    // The document arrived while connected; connectivity changes before its
    // scripts adopt that already-visible HTML.
    connection.mockReturnValue(false);
    expect(readInitialPublicPage()?.scope).toEqual(page.scope);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client = queryClient;
    seedPublicPage(queryClient, page);
    router.ssr = { manifest: undefined };
    await router.load();
    const errors: unknown[] = [];
    const element = document.getElementById('root');
    if (!element) throw new Error('Missing hydration root fixture');
    const initialMain = element.querySelector('main');
    const initialProductLink = element.querySelector('.product-card-detail-link');
    expect(initialMain).not.toBeNull();
    expect(initialProductLink).not.toBeNull();
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
    expect(element.querySelector('.network-banner')?.textContent).toContain('当前网络不可用');
    expect(element.querySelector('.storefront-app')?.classList.contains('is-offline')).toBe(true);
    expect(stream).not.toHaveBeenCalled();
    expect(scheduler).not.toHaveBeenCalled();

    await act(async () => {
        connection.mockReturnValue(true);
        window.dispatchEvent(new Event('online'));
        await Promise.resolve();
    });
    expect(element.querySelector('.network-banner')).toBeNull();
    expect(element.querySelector('.storefront-app')?.classList.contains('is-offline')).toBe(false);
    expect(element.querySelector('main')).toBe(initialMain);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(schedulerConnection).toHaveBeenCalledWith(false);
    const streamSignal = stream.mock.calls[0][1];
    expect(streamSignal.aborted).toBe(false);

    await act(async () => {
        connection.mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        await Promise.resolve();
    });
    expect(element.querySelector('.network-banner')?.textContent).toContain('当前网络不可用');
    expect(element.querySelector('main')).toBe(initialMain);
    expect(element.querySelector('.product-card-detail-link')).toBe(initialProductLink);
    expect(errors.map(error => String(error))).toEqual([]);
    expect(streamSignal.aborted).toBe(true);
    expect(schedulerDispose).toHaveBeenCalledTimes(1);

    let rejectStaleStream: (reason: unknown) => void = () => {
        throw new Error('Second realtime owner did not start');
    };
    stream.mockImplementationOnce(
        () =>
            new Promise((_resolve, reject) => {
                rejectStaleStream = reject;
            }),
    );
    await act(async () => {
        connection.mockReturnValue(true);
        window.dispatchEvent(new Event('online'));
        await Promise.resolve();
    });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1][1]).not.toBe(streamSignal);
    expect(schedulerConnection).toHaveBeenCalledTimes(1);
    await act(async () => {
        connection.mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        await Promise.resolve();
    });
    expect(stream.mock.calls[1][1].aborted).toBe(true);
    expect(schedulerDispose).toHaveBeenCalledTimes(2);
    await act(async () => {
        rejectStaleStream(new TypeError('A cancelled chunk failed late'));
        await Promise.resolve();
    });
    expect(schedulerConnection).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
    expect(element.querySelector('main')).toBe(initialMain);
});
