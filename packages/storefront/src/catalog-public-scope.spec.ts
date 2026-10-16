// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    effectivePublicCatalogInput,
    publicPageRequestKey,
} from '../../storefront-content-plugin/src/shared/public-page-data';
import { syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { publicCatalogRequest } from './catalog-route-query';
import { enabledMarkets } from './i18n';
import { invalidatePublicPageReads } from './public-page-transport';
import { storefrontQueryClient } from './query-client';

function requestInput(url: URL) {
    const input = url.searchParams.get('input');
    if (!input) throw new Error('Expected public catalog input');
    return JSON.parse(input);
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    storefrontQueryClient.clear();
    invalidatePublicPageReads();
});

describe('homepage catalog scope agrees with server merchandising', () => {
    const market = enabledMarkets[0];
    const collections = [{ id: 'first', name: 'First', parentId: 'root', position: 0, children: [] }];
    it('keeps products outside the first navigation category in the real homepage catalog request', async () => {
        vi.stubEnv('VITE_CLIENT_CHANNEL_SWITCHING', 'false');
        vi.resetModules();
        const { ShopApi } = await import('./api');
        const fetch = vi.fn((value: string | URL) => {
            const url = new URL(String(value));
            expect(url.pathname).toBe('/_storefront/page-data');
            const request = {
                kind: 'catalog' as const,
                path: url.searchParams.get('path') as '/category' | '/search',
                input: requestInput(url),
            };
            const effective = effectivePublicCatalogInput(request, collections);
            const page = syntheticPage('synthetic-a', 'en', 'catalog');
            page.scope = {
                ...page.scope,
                host: window.location.host,
                channelCode: market.code,
                currencyCode: market.currencyCode,
                languageCode: 'zh_Hans',
            };
            page.config.code = market.code;
            page.request = request;
            page.requestKey = publicPageRequestKey(request);
            page.collections = [];
            if (!page.catalog) throw new Error('Expected catalog fixture');
            const all = [
                { ...page.catalog.items[0], id: 'first-category-product' },
                { ...page.catalog.items[1], id: 'outside-first-category-product' },
            ];
            page.catalog = {
                items: effective.collectionId ? all.slice(0, 1) : all,
                totalItems: effective.collectionId ? 1 : 2,
            };
            return Promise.resolve(Response.json(page));
        });
        vi.stubGlobal('fetch', fetch);
        const api = new ShopApi(market, 'zh_Hans');
        const result = await api.catalog({ sort: 'sales', take: 16 }, undefined, 'store');
        expect(result.items.map(product => product.id)).toEqual([
            'first-category-product',
            'outside-first-category-product',
        ]);
        expect(fetch).toHaveBeenCalledOnce();
    });
    it.each(['sales', 'recommended'] as const)(
        'uses the same unfiltered public request for %s refresh and its media observer',
        sort => {
            const request = publicCatalogRequest({ sort, take: 16 }, '/zh/', 'store');
            expect(request.path).toBe('/search');
            expect(effectivePublicCatalogInput(request, collections).collectionId).toBeUndefined();
        },
    );
    it('keeps currency/language and cancellation on the existing public read without committing its late hints', async () => {
        vi.stubEnv('VITE_CLIENT_CHANNEL_SWITCHING', 'false');
        vi.resetModules();
        const { ShopApi } = await import('./api');
        const { storefrontQueryClient: client } = await import('./query-client');
        let complete!: (response: Response) => void;
        let request!: { kind: 'catalog'; path: '/category' | '/search'; input: Record<string, unknown> };
        const fetch = vi.fn((value: string | URL) => {
            const url = new URL(String(value));
            expect(url.searchParams.get('languageCode')).toBe('en');
            expect(url.searchParams.get('currencyCode')).toBe('MYR');
            request = {
                kind: 'catalog',
                path: url.searchParams.get('path') as '/search',
                input: requestInput(url),
            };
            expect(request.path).toBe('/search');
            return new Promise<Response>(resolve => {
                complete = resolve;
            });
        });
        vi.stubGlobal('fetch', fetch);
        const controller = new AbortController();
        const api = new ShopApi({ ...market, currencyCode: 'MYR' }, 'en');
        const read = api.catalog({ sort: 'sales', take: 16 }, controller.signal, 'store');
        const rejection = expect(read).rejects.toMatchObject({ name: 'AbortError' });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        controller.abort();
        await rejection;
        const page = syntheticPage('synthetic-a', 'en', 'catalog');
        page.scope.host = window.location.host;
        page.scope.channelCode = market.code;
        page.config.code = market.code;
        page.request = request;
        page.requestKey = publicPageRequestKey(request);
        complete(Response.json(page));
        await vi.dynamicImportSettled();
        expect(
            client
                .getQueryCache()
                .getAll()
                .filter(query => query.queryKey[3] === 'public-media'),
        ).toHaveLength(0);
        client.clear();
    });
    it('retains ordinary category defaults and explicit collection selection', () => {
        const category = publicCatalogRequest({ sort: 'sales' }, '/zh/category');
        expect(effectivePublicCatalogInput(category, collections).collectionId).toBe('first');
        const explicit = publicCatalogRequest({ collectionId: 'selected' }, '/zh/', 'store');
        expect(effectivePublicCatalogInput(explicit, collections).collectionId).toBe('selected');
    });
});
