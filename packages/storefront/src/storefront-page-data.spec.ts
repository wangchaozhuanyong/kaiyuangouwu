import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    publicPageRequestKey,
    serializeStorefrontPageData,
} from '../../storefront-content-plugin/src/shared/public-page-data';
import { mediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';

import { persistPublicQueryCache, storefrontQueryKeys, watchStorefrontScopeAccess } from './query-client';
import { ShopApiGraphQlError } from './shop-api-errors';
import { seedPublicPage, validatePublicPageData, type PublicPageData } from './storefront-page-data';

function fixture(now = Date.now()): PublicPageData {
    return {
        schemaVersion: 1,
        version: 'v1',
        generatedAt: now,
        route: '/',
        scope: {
            host: 'store.test',
            channelCode: 'store-a',
            languageCode: 'en',
            currencyCode: 'MYR',
            priceContext: 'public',
        },
        config: {
            code: 'store-a',
            accessMode: 'LIVE',
            defaultCurrencyCode: 'MYR',
            defaultLanguageCode: 'en',
            customFields: {},
            availableCountries: [],
        },
        products: [],
        collections: [],
        media: [],
        failures: ['content'],
    };
}

describe('public page hydration', () => {
    it('stops persistence before a PREVIEW section is seeded while the old config still says LIVE', async () => {
        const client = new QueryClient();
        const unwatch = watchStorefrontScopeAccess(client, () => undefined);
        const configKey = [...storefrontQueryKeys.config('store-a:MYR', 'en'), 'public'];
        await client.fetchQuery({ queryKey: configKey, queryFn: () => Promise.resolve(fixture().config) });
        const productKey = storefrontQueryKeys.products('store-a:MYR', 'en', 12);
        client.setQueryDefaults(productKey, { meta: { persistPublic: true } });
        const page = fixture();
        page.config.accessMode = 'PREVIEW';
        seedPublicPage(client, page, false);
        expect(client.getQueryData(configKey)).toMatchObject({ accessMode: 'LIVE' });
        expect(client.getQueryData(productKey)).toEqual([]);
        let saved = '';
        persistPublicQueryCache(client, {
            setItem: (_key, value) => {
                saved = value;
            },
        });
        expect(saved).toBe('');
        unwatch();
        client.clear();
    });

    it('cannot restore a denied scope by manually seeding an old LIVE snapshot', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const unwatch = watchStorefrontScopeAccess(client, () => undefined);
        await expect(
            client.fetchQuery({
                queryKey: storefrontQueryKeys.catalog('store-a:MYR', 'en', {}),
                queryFn: () => Promise.reject(new ShopApiGraphQlError(['Closed'], 403, 'STOREFRONT_CLOSED')),
            }),
        ).rejects.toMatchObject({ errorCode: 'STOREFRONT_CLOSED' });
        seedPublicPage(client, fixture());
        expect(client.getQueryData(storefrontQueryKeys.products('store-a:MYR', 'en', 12))).toBeUndefined();
        expect(
            client.getQueryData([...storefrontQueryKeys.config('store-a:MYR', 'en'), 'public']),
        ).toBeUndefined();
        const unrelated = fixture();
        unrelated.scope.channelCode = unrelated.config.code = 'store-b';
        seedPublicPage(client, unrelated);
        expect(client.getQueryData(storefrontQueryKeys.products('store-b:MYR', 'en', 12))).toEqual([]);
        unwatch();
        client.clear();
    });
    it('accepts an empty confirmed list but rejects stale, future, wrong-host and private snapshots', () => {
        const page = fixture(10_000);
        expect(validatePublicPageData(page, 'store.test', 20_000)).toBe(true);
        expect(validatePublicPageData(page, 'other.test', 20_000)).toBe(false);
        expect(validatePublicPageData(page, 'store.test', 40_001)).toBe(false);
        expect(validatePublicPageData(page, 'store.test', 0)).toBe(false);
        expect(
            validatePublicPageData(
                { ...page, scope: { ...page.scope, priceContext: 'customer' } },
                'store.test',
                20_000,
            ),
        ).toBe(false);
        expect(
            validatePublicPageData(
                { ...page, config: { ...page.config, code: 'store-b' } },
                'store.test',
                20_000,
            ),
        ).toBe(false);
        expect(
            validatePublicPageData(
                { ...page, config: { ...page.config, accessMode: 'CLOSED' } },
                'store.test',
                20_000,
            ),
        ).toBe(false);
        expect(
            validatePublicPageData(
                { ...page, config: { ...page.config, accessMode: 'PREVIEW' } },
                'store.test',
                20_000,
            ),
        ).toBe(true);
    });

    it('seeds only confirmed public sections in the exact store/currency/language scope', () => {
        const client = new QueryClient();
        const page = fixture();
        seedPublicPage(client, page);
        expect(client.getQueryData(storefrontQueryKeys.products('store-a:MYR', 'en', 12))).toEqual([]);
        expect(client.getQueryData(storefrontQueryKeys.products('store-b:MYR', 'en', 12))).toBeUndefined();
        expect(client.getQueryData(storefrontQueryKeys.products('store-a:CNY', 'en', 12))).toBeUndefined();
        expect(
            client.getQueryData(storefrontQueryKeys.products('store-a:MYR', 'zh_Hans', 12)),
        ).toBeUndefined();
        expect(
            client
                .getQueryCache()
                .findAll()
                .some(query => query.queryKey.includes('content')),
        ).toBe(false);
        expect(
            client
                .getQueryCache()
                .findAll()
                .some(query => query.queryKey.includes('private')),
        ).toBe(false);
        client.clear();
    });

    it('does not let an older in-flight snapshot replace newer reads or populate a detail cache', () => {
        const client = new QueryClient();
        const page = fixture(10_000);
        const key = storefrontQueryKeys.products('store-a:MYR', 'en', 12);
        client.setQueryData(key, [{ id: 'newer' }], { updatedAt: 12_000 });
        seedPublicPage(client, page);
        expect(client.getQueryData(key)).toEqual([{ id: 'newer' }]);
        expect(
            client.getQueryData(storefrontQueryKeys.product('store-a:MYR', 'en', 'newer')),
        ).toBeUndefined();
        client.clear();
    });

    it('seeds flash sales only in their public scope and keeps existing detail data untouched', () => {
        const client = new QueryClient();
        const page = fixture();
        page.flashSales = [{ id: 'sale-a', items: [{ productVariantId: 'sku-a' }] }];
        const detailKey = storefrontQueryKeys.product('store-a:MYR', 'en', 'product-a');
        const detail = { id: 'product-a', description: 'Full detail', assets: [{ id: 'gallery-a' }] };
        client.setQueryData(detailKey, detail, { updatedAt: page.generatedAt - 1 });

        seedPublicPage(client, page);

        expect(client.getQueryData(storefrontQueryKeys.flashSales('store-a:MYR', 'en'))).toEqual(
            page.flashSales,
        );
        expect(client.getQueryData(storefrontQueryKeys.flashSales('store-b:MYR', 'en'))).toBeUndefined();
        expect(client.getQueryData(storefrontQueryKeys.flashSales('store-a:CNY', 'en'))).toBeUndefined();
        expect(client.getQueryData(detailKey)).toEqual(detail);
        expect(
            client
                .getQueryCache()
                .findAll()
                .filter(query => query.queryKey[3] === 'product'),
        ).toHaveLength(1);
        client.clear();
    });

    it('escapes inert JSON parser terminators without changing published text', () => {
        const page = fixture();
        page.config.description = '</script><img onerror="bad">&\u2028';
        const serialized = serializeStorefrontPageData(page);
        expect(serialized).not.toContain('<');
        expect(JSON.parse(serialized).config.description).toBe(page.config.description);
    });

    it('shares versioned candidates and admits only small inline image previews', () => {
        const media = mediaDescriptor('/assets/preview/hero__webp_migrated_2.webp', 'hero');
        expect(media.src).toContain('v=webp-readable-1');
        expect(media.srcSet).toContain('v=webp-readable-1');
        expect(media.placeholder).toBeUndefined();
        expect(
            mediaDescriptor('/asset.webp', 'card', { inlinePreview: '/preview.webp' }).placeholder,
        ).toBeUndefined();
        expect(
            mediaDescriptor('/asset.webp', 'hero', { inlinePreview: 'data:image/webp;base64,AAAA' })
                .placeholder?.inlineData,
        ).toBe('data:image/webp;base64,AAAA');
        expect(mediaDescriptor('/assets/preview/hero__webp_migrated_2.webp?v=new', 'hero').version).toBe(
            'new',
        );
    });
});

describe('public page fetch boundary', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_CLIENT_CHANNEL_SWITCHING', 'false');
        vi.stubGlobal('window', {
            location: { host: 'store.test', origin: 'https://store.test', search: '' },
        });
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('keeps srcdoc preview reads on the Shop API bridge when the document URL has no preview parameters', async () => {
        vi.stubGlobal('window', {
            location: { host: '', origin: 'null', pathname: 'srcdoc', search: '' },
        });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { setStorefrontPreviewParameters } = await import('./storefront-preview-parameters');
        setStorefrontPreviewParameters(
            new URLSearchParams({
                storefrontPreviewEmbedded: '1',
                storefrontPreviewLanguage: 'en',
                storefrontPreviewDocumentUrl: 'https://admin.example.test/',
            }),
        );
        const { fetchPublicPage, readInitialPublicPage } = await import('./storefront-page-data');
        await expect(fetchPublicPage('en', 'MYR')).resolves.toBeUndefined();
        expect(readInitialPublicPage()).toBeUndefined();
        const { CatalogApi } = await import('./api/catalog');
        const request = vi.fn().mockResolvedValue({ storefrontCatalog: { totalItems: 0, items: [] } });
        const api = new CatalogApi({
            market: {
                code: 'store-a',
                defaultLanguageCode: 'en',
                currencyCode: 'MYR',
                countryCode: 'MY',
                locale: 'en-MY',
                label: 'Store A',
            },
            languageCode: 'en',
            request,
            getAuthToken: () => null,
            createAuthTokenCapture: () => () => undefined,
            clearAuthToken: () => undefined,
            authenticationRequest: vi.fn(),
            assertCart: value => value,
            assertCheckoutSession: value => value,
            assertOrder: value => value,
            assertNoError: () => undefined,
            getStorefrontCatalogAvailable: () => null,
            setStorefrontCatalogAvailable: () => undefined,
        });
        await expect(api.catalog({ take: 12 })).resolves.toEqual({ totalItems: 0, items: [] });
        expect(request).toHaveBeenCalledWith(
            expect.stringContaining('query StorefrontCatalog'),
            expect.objectContaining({ input: expect.objectContaining({ take: 12 }) }),
            undefined,
            undefined,
            undefined,
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps standalone URL previews off the public aggregate endpoint', async () => {
        vi.stubGlobal('window', {
            location: {
                host: 'store.test',
                origin: 'https://store.test',
                search: '?storefrontPreviewEmbedded=1',
            },
        });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { fetchPublicPage } = await import('./storefront-page-data');
        await expect(fetchPublicPage('en', 'MYR')).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        [Response.json({ errorCode: 'STOREFRONT_CLOSED' }, { status: 403 }), 'STOREFRONT_CLOSED'],
        [new Response('legacy access denied', { status: 403 }), undefined],
    ])('preserves access-denial status and the reviewed closure code', async (response, errorCode) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
        const { fetchPublicPage } = await import('./storefront-page-data');
        await expect(fetchPublicPage('en')).rejects.toMatchObject({ status: 403, errorCode });
    });

    it('accepts a response for the verified channel without sending account credentials', async () => {
        const page = fixture();
        const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
        vi.stubGlobal('fetch', fetchMock);
        const { fetchPublicPage } = await import('./storefront-page-data');

        await expect(fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a')).resolves.toEqual(
            page,
        );
        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(URL),
            expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) }),
        );
    });

    it('propagates an early closure without making a second read that hides the denial', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(Response.json({ errorCode: 'STOREFRONT_CLOSED' }, { status: 403 }));
        vi.stubGlobal('fetch', fetchMock);
        const { startPublicPageBootstrap } = await import('./public-page-transport');
        const { fetchPublicPage } = await import('./storefront-page-data');
        startPublicPageBootstrap({ kind: 'home' }, 'en', 'MYR');
        await expect(
            fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a'),
        ).rejects.toMatchObject({
            status: 403,
            errorCode: 'STOREFRONT_CLOSED',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('allows the current preview read but never takes preview or closed HTML as a shared snapshot', async () => {
        const preview = fixture();
        preview.config.accessMode = 'PREVIEW';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(preview)));
        vi.stubGlobal('document', { getElementById: () => ({ textContent: JSON.stringify(preview) }) });
        const { fetchPublicPage, readInitialPublicPage } = await import('./storefront-page-data');
        expect(readInitialPublicPage()).toBeUndefined();
        await expect(fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a')).resolves.toEqual(
            preview,
        );
        preview.config.accessMode = 'CLOSED';
        expect(readInitialPublicPage()).toBeUndefined();
    });

    it('does not let an obsolete denial affect the current generation', async () => {
        let complete!: (value: Response) => void;
        vi.stubGlobal(
            'fetch',
            vi.fn(
                () =>
                    new Promise<Response>(resolve => {
                        complete = resolve;
                    }),
            ),
        );
        const { fetchPublicPage } = await import('./storefront-page-data');
        const { invalidatePublicPageReads } = await import('./public-page-transport');
        const obsolete = fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a');
        invalidatePublicPageReads();
        complete(Response.json({ errorCode: 'STOREFRONT_CLOSED' }, { status: 403 }));
        await expect(obsolete).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects delayed manual seeding of a read whose generation has expired', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(fixture())));
        const { fetchPublicPage, seedPublicPage: seed } = await import('./storefront-page-data');
        const { invalidatePublicPageReads } = await import('./public-page-transport');
        const page = await fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a');
        const client = new QueryClient();
        invalidatePublicPageReads();
        if (!page) throw new Error('Expected a current LIVE response');
        seed(client, page);
        expect(client.getQueryCache().findAll()).toHaveLength(0);
        client.clear();
    });

    it('rejects a different channel even when the returned host, language and currency match', async () => {
        const page = fixture();
        page.scope.channelCode = 'store-b';
        page.config.code = 'store-b';
        const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
        vi.stubGlobal('fetch', fetchMock);
        const { fetchPublicPage } = await import('./storefront-page-data');

        await expect(fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a')).rejects.toThrow(
            'different',
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each<[string, (page: PublicPageData) => void]>([
        [
            'host',
            page => {
                page.scope.host = 'other.test';
            },
        ],
        [
            'channel',
            page => {
                page.scope.channelCode = page.config.code = 'store-b';
            },
        ],
        [
            'language',
            page => {
                page.scope.languageCode = 'zh_Hans';
            },
        ],
        [
            'currency',
            page => {
                page.scope.currencyCode = 'CNY';
            },
        ],
        [
            'request key',
            page => {
                page.requestKey = publicPageRequestKey({ kind: 'product', id: 'other' });
            },
        ],
        [
            'canonical request',
            page => {
                page.request = { kind: 'product', id: 'other' };
            },
        ],
        [
            'legacy route',
            page => {
                delete page.requestKey;
                delete page.request;
                page.route = '/product?id=other';
            },
        ],
    ])(
        'does not close the current scope for an unverified 200 CLOSED response with a different %s',
        async (_boundary, change) => {
            const page = fixture();
            page.config.accessMode = 'CLOSED';
            page.request = { kind: 'home' };
            page.requestKey = publicPageRequestKey(page.request);
            change(page);
            const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
            vi.stubGlobal('fetch', fetchMock);
            const { fetchPublicPage } = await import('./storefront-page-data');
            const { isStorefrontScopeAccessDenied, watchStorefrontScopeAccess: watch } =
                await import('./query-client');
            const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            const scope = { marketCode: 'store-a:MYR', languageCode: 'en' };
            const unwatch = watch(client, () => undefined);
            const key = storefrontQueryKeys.products(scope.marketCode, scope.languageCode, 12);
            client.setQueryData(key, [{ id: 'current-product' }]);
            try {
                await expect(
                    client.fetchQuery({
                        queryKey: key,
                        staleTime: 0,
                        queryFn: () => fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a'),
                    }),
                ).rejects.toThrow();
                expect(isStorefrontScopeAccessDenied(client, scope)).toBe(false);
                expect(client.getQueryData(key)).toEqual([{ id: 'current-product' }]);
                expect(fetchMock).toHaveBeenCalledTimes(1);
            } finally {
                unwatch();
                client.clear();
            }
        },
    );

    it.each([true, false])(
        'closes the verified current scope for a 200 CLOSED response with canonical identity=%s',
        async canonical => {
            const page = fixture();
            page.config.accessMode = 'CLOSED';
            if (canonical) {
                page.request = { kind: 'home' };
                page.requestKey = publicPageRequestKey(page.request);
            }
            const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
            vi.stubGlobal('fetch', fetchMock);
            const { fetchPublicPage } = await import('./storefront-page-data');
            const { isStorefrontScopeAccessDenied, watchStorefrontScopeAccess: watch } =
                await import('./query-client');
            const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            const scope = { marketCode: 'store-a:MYR', languageCode: 'en' };
            const unwatch = watch(client, () => undefined);
            const key = storefrontQueryKeys.products(scope.marketCode, scope.languageCode, 12);
            const otherKey = storefrontQueryKeys.products('store-b:MYR', scope.languageCode, 12);
            client.setQueryData(key, [{ id: 'current-product' }]);
            client.setQueryData(otherKey, [{ id: 'other-product' }]);
            try {
                await expect(
                    client.fetchQuery({
                        queryKey: key,
                        staleTime: 0,
                        queryFn: () => fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a'),
                    }),
                ).rejects.toMatchObject({ status: 403, errorCode: 'STOREFRONT_CLOSED' });
                expect(isStorefrontScopeAccessDenied(client, scope)).toBe(true);
                expect(client.getQueryData(key)).toBeUndefined();
                expect(client.getQueryData(otherKey)).toEqual([{ id: 'other-product' }]);
                expect(fetchMock).toHaveBeenCalledTimes(1);
            } finally {
                unwatch();
                client.clear();
            }
        },
    );

    it('does not publish a 200 CLOSED error to a different Channel consumer of the same flight', async () => {
        const page = fixture();
        page.config.accessMode = 'CLOSED';
        page.request = { kind: 'home' };
        page.requestKey = publicPageRequestKey(page.request);
        const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
        vi.stubGlobal('fetch', fetchMock);
        const { fetchPublicPage } = await import('./storefront-page-data');
        await Promise.all([
            expect(fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-b')).rejects.toThrow(
                'different channel',
            ),
            expect(
                fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a'),
            ).rejects.toMatchObject({ status: 403, errorCode: 'STOREFRONT_CLOSED' }),
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('adopts a verified early 200 CLOSED envelope without hiding it behind a second read', async () => {
        const page = fixture();
        page.config.accessMode = 'CLOSED';
        page.request = { kind: 'home' };
        page.requestKey = publicPageRequestKey(page.request);
        const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
        vi.stubGlobal('fetch', fetchMock);
        const { startPublicPageBootstrap } = await import('./public-page-transport');
        const { fetchPublicPage } = await import('./storefront-page-data');
        startPublicPageBootstrap({ kind: 'home' }, 'en', 'MYR');
        await expect(
            fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a'),
        ).rejects.toMatchObject({ status: 403, errorCode: 'STOREFRONT_CLOSED' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects cancellation during JSON parsing before the result can seed any public query', async () => {
        const controller = new AbortController();
        const page = fixture();
        const response = Response.json(page);
        vi.spyOn(response, 'json').mockImplementation(() => {
            controller.abort();
            return Promise.resolve(page);
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
        const { fetchPublicPage, seedPublicPage: seed } = await import('./storefront-page-data');
        const client = new QueryClient();
        const result = fetchPublicPage('en', 'MYR', controller.signal, { kind: 'home' }, 'store-a').then(
            value => {
                if (value) seed(client, value);
            },
        );

        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(client.getQueryCache().findAll()).toHaveLength(0);
        client.clear();
    });

    it('rejects an aggregate response started before a public SSE invalidation', async () => {
        const page = fixture();
        let complete: (value: Response) => void = () => undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn(
                () =>
                    new Promise<Response>(resolve => {
                        complete = resolve;
                    }),
            ),
        );
        const { fetchPublicPage, seedPublicPage: seed } = await import('./storefront-page-data');
        const { invalidatePublicPageReads } = await import('./public-page-transport');
        const client = new QueryClient();
        const result = fetchPublicPage('en', 'MYR', undefined, { kind: 'home' }, 'store-a').then(value => {
            if (value) seed(client, value);
        });
        const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
        invalidatePublicPageReads();
        complete(Response.json(page));
        await rejection;
        expect(client.getQueryCache().findAll()).toHaveLength(0);
        client.clear();
    });
});

// Pagination hydration must agree with both desktop and mobile list owners.
describe('canonical route hydration', () => {
    it('returns a cached destination without waiting for its stale background read', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient();
        const key = storefrontQueryKeys.catalog('store-a:MYR', 'en', {});
        let complete: (value: unknown) => void = () => undefined;
        const data = { pages: [{ items: [], totalItems: 0 }], pageParams: [0] };
        const queryFn = vi.fn(
            () =>
                new Promise(resolve => {
                    complete = resolve;
                }),
        );
        client.setQueryDefaults(key, { queryFn });
        client.setQueryData(key, data, { updatedAt: Date.now() - 60_000 });
        setPublicPageNavigationScope({ channelCode: 'store-a', currencyCode: 'MYR', languageCode: 'en' });
        await prefetchPublicPage(client, '/category');
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(client.getQueryState(key)?.fetchStatus).toBe('fetching');
        expect(client.getQueryData(key)).toEqual(data);
        complete(data);
        setPublicPageNavigationScope(undefined);
        client.clear();
    });
    it('does not collapse previously loaded pages when config or content refreshes', () => {
        const client = new QueryClient();
        const page = fixture();
        page.request = { kind: 'catalog', path: '/category', input: { take: 12, skip: 0 } };
        page.catalog = { items: [], totalItems: 24 };
        const key = storefrontQueryKeys.catalog('store-a:MYR', 'en', {});
        const previous = {
            pages: [
                { items: [{ id: 'first' }], totalItems: 24 },
                { items: [{ id: 'later' }], totalItems: 24 },
            ],
            pageParams: [0, 12],
        };
        client.setQueryData(key, previous, { updatedAt: page.generatedAt - 1 });
        seedPublicPage(client, page);
        expect(client.getQueryData(key)).toEqual(previous);
        client.clear();
    });
    it('seeds a catalog as InfiniteData under normalized filters and preserves a newer result', () => {
        const page = fixture();
        page.request = {
            kind: 'catalog',
            path: '/search',
            input: { term: '  desk  ', sort: 'SALES', take: 12, skip: 0 },
        };
        page.requestKey = publicPageRequestKey(page.request);
        page.catalog = { items: [], totalItems: 0 };
        const client = new QueryClient();
        seedPublicPage(client, page);
        const key = storefrontQueryKeys.catalog('store-a:MYR', 'en', { term: 'desk', sort: 'sales' });
        expect(client.getQueryData(key)).toEqual({ pages: [{ items: [], totalItems: 0 }], pageParams: [0] });
        client.setQueryData(
            key,
            { pages: [{ items: [{ id: 'new' }], totalItems: 1 }], pageParams: [0] },
            { updatedAt: page.generatedAt + 1 },
        );
        seedPublicPage(client, page);
        expect(client.getQueryData(key)).toMatchObject({ pages: [{ totalItems: 1 }] });
        expect(
            client.getQueryData(
                storefrontQueryKeys.catalog('store-a:MYR', 'en', { term: 'desk', sort: 'sales', take: 20 }),
            ),
        ).toBeUndefined();
        client.clear();
    });
    it('does not turn a later pagination offset into a first-page snapshot', () => {
        const page = fixture();
        page.request = { kind: 'catalog', input: { skip: 12, take: 12 } };
        page.catalog = { items: [], totalItems: 12 };
        const client = new QueryClient();
        seedPublicPage(client, page);
        expect(client.getQueryData(storefrontQueryKeys.catalog('store-a:MYR', 'en', {}))).toBeUndefined();
        client.clear();
    });
});
