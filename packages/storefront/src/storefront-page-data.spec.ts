import { QueryClient, QueryObserver, skipToken } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    publicPageRequestKey,
    publicPageRouteHref,
    serializeStorefrontPageData,
} from '../../storefront-content-plugin/src/shared/public-page-data';
import { mediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';
import { syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import {
    PUBLIC_QUERY_STALE_TIME,
    persistPublicQueryCache,
    storefrontQueryKeys,
    watchStorefrontScopeAccess,
} from './query-client';
import { ShopApiGraphQlError } from './shop-api-errors';
import {
    publicSeoQueryKey,
    seedPublicPage,
    validatePublicPageData,
    type PublicPageData,
} from './storefront-page-data';

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
    it('isolates route hints by language, currency and version and clears old routes before preview seeding', () => {
        const client = new QueryClient();
        const page = fixture();
        page.request = { kind: 'page', id: 'services' };
        page.media = [
            mediaDescriptor('/assets/preview/service.webp?v=one', 'hero', {
                inlinePreview: 'data:image/webp;base64,AAAA',
            }),
        ];
        const key = publicSeoQueryKey('store-a:MYR', 'en', page.request, 'public-media');
        seedPublicPage(client, page);
        expect(client.getQueryData(key)).toEqual(page.media);
        expect(
            client.getQueryData(publicSeoQueryKey('store-a:USD', 'en', page.request, 'public-media')),
        ).toBeUndefined();
        expect(
            client.getQueryData(publicSeoQueryKey('store-a:MYR', 'zh_Hans', page.request, 'public-media')),
        ).toBeUndefined();
        const changed = {
            ...page,
            generatedAt: page.generatedAt + 1,
            media: [mediaDescriptor('/assets/preview/service.webp?v=two', 'hero')],
        };
        seedPublicPage(client, changed);
        expect(client.getQueryData(key)).toEqual(changed.media);
        const preview = {
            ...page,
            request: { kind: 'home' as const },
            config: { ...page.config, accessMode: 'PREVIEW' as const },
        };
        seedPublicPage(client, preview);
        expect(client.getQueryData(key)).toBeUndefined();
        expect(
            client.getQueryData(publicSeoQueryKey('store-a:MYR', 'en', preview.request, 'public-media')),
        ).toEqual(preview.media);
        client.clear();
    });
    it('seeds the ranked home inputs and exact visible order without presenting the bootstrap list as best sellers', () => {
        const client = new QueryClient();
        const page = syntheticPage('synthetic-a', 'en', 'home');
        const products = page.products ?? [];
        const [ordinary, low, high, pinned] = products;
        if (!page.content || !ordinary || !low || !high || !pinned) throw new Error('Fixture is incomplete');
        page.content.blocks.push({
            ...page.content.blocks[0],
            id: 'best',
            type: 'BEST_SELLERS',
            settings: { displayCount: 3, pinnedProductIds: [pinned.id] },
        });
        page.products = [ordinary];
        page.bestSellers = {
            catalog: { items: [low, high], totalItems: 2 },
            pinnedProducts: [pinned],
            salesByProductId: { [low.id]: 2, [high.id]: 20 },
            candidateCount: 16,
        };
        seedPublicPage(client, page);
        const market = 'synthetic-a:MYR';
        const key = ['recommendation-order', JSON.stringify([market, 'en']), 'best-sellers'];
        expect(client.getQueryData<Array<{ id: string }>>(key)?.map(item => item.id)).toEqual([
            pinned.id,
            high.id,
            low.id,
        ]);
        expect(
            client.getQueryData(
                storefrontQueryKeys.catalog(market, 'en', {
                    purpose: 'home-best-sellers',
                    sort: 'sales',
                    take: 16,
                }),
            ),
        ).toMatchObject({ items: [{ id: low.id }, { id: high.id }], totalItems: 2 });
        expect(
            client.getQueryData([
                ...storefrontQueryKeys.scope(market, 'en'),
                'home-best-seller-sales',
                [low.id, high.id],
            ]),
        ).toEqual({ [low.id]: 2, [high.id]: 20 });
        expect(
            client.getQueryData(storefrontQueryKeys.products('other-store:MYR', 'en', 12)),
        ).toBeUndefined();
        client.clear();
    });
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
            client.getQueryData(publicSeoQueryKey('store-a:MYR', 'en', { kind: 'home' }, 'public-media')),
        ).toBeUndefined();
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

    it.each([-35_000, 35_000])(
        'adopts this rendered document with clock offset %i without making its data fresh',
        async offset => {
            const now = Date.now();
            vi.spyOn(Date, 'now').mockReturnValue(now);
            const page = fixture(now + offset);
            page.requestKey = publicPageRequestKey({ kind: 'home' });
            vi.stubGlobal('window', {
                location: { host: 'store.test', origin: 'https://store.test', pathname: '/en/', search: '' },
            });
            vi.stubGlobal('document', {
                getElementById: (id: string) =>
                    id === 'root'
                        ? { dataset: { publicRendered: '1' } }
                        : { textContent: JSON.stringify(page) },
            });
            const { readInitialPublicPage } = await import('./storefront-page-data');
            expect(validatePublicPageData(page, 'store.test')).toBe(false);
            expect(readInitialPublicPage()).toEqual(page);
            const client = new QueryClient();
            seedPublicPage(client, page);
            expect(
                client.getQueryState([...storefrontQueryKeys.config('store-a:MYR', 'en'), 'public'])
                    ?.dataUpdatedAt,
            ).toBe(offset > 0 ? now - PUBLIC_QUERY_STALE_TIME : page.generatedAt);
            client.clear();
            vi.stubGlobal('document', {
                getElementById: (id: string) =>
                    id === 'root'
                        ? { dataset: { publicRendered: '1', publicAdopted: '1' } }
                        : { textContent: JSON.stringify(page) },
            });
            expect(readInitialPublicPage()).toBeUndefined();
            vi.stubGlobal('document', {
                getElementById: (id: string) =>
                    id === 'root' ? { dataset: {} } : { textContent: JSON.stringify(page) },
            });
            expect(readInitialPublicPage()).toBeUndefined();
        },
    );

    it.each(['host', 'channel', 'language', 'request', 'private', 'closed'])(
        'still rejects a rendered document with the wrong %s identity',
        async mismatch => {
            const page = fixture(Date.now() - 35_000);
            page.requestKey = publicPageRequestKey({ kind: 'home' });
            if (mismatch === 'host') page.scope.host = 'other.test';
            if (mismatch === 'channel') page.config.code = 'other-store';
            if (mismatch === 'language') page.scope.languageCode = 'zh_Hans';
            if (mismatch === 'request')
                page.requestKey = publicPageRequestKey({ kind: 'product', id: 'wrong' });
            if (mismatch === 'private') page.scope.priceContext = 'customer' as 'public';
            if (mismatch === 'closed') page.config.accessMode = 'CLOSED';
            vi.stubGlobal('window', {
                location: { host: 'store.test', origin: 'https://store.test', pathname: '/en/', search: '' },
            });
            vi.stubGlobal('document', {
                getElementById: (id: string) =>
                    id === 'root'
                        ? { dataset: { publicRendered: '1' } }
                        : { textContent: JSON.stringify(page) },
            });
            const { readInitialPublicPage } = await import('./storefront-page-data');
            expect(readInitialPublicPage()).toBeUndefined();
        },
    );

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
        client.setQueryData(
            publicSeoQueryKey('store-a:MYR', 'en', { kind: 'catalog', input: {} }, 'public-media'),
            [],
        );
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
    it.each([
        { path: '/category' as const, collectionId: undefined, expectedId: 'synthetic-a-collection' },
        { path: '/category' as const, collectionId: 'all', expectedId: 'synthetic-a-collection' },
        { path: '/category' as const, collectionId: 'selected', expectedId: 'selected' },
        { path: '/search' as const, collectionId: undefined, expectedId: undefined },
        { path: '/search' as const, collectionId: 'all', expectedId: undefined },
    ])('seeds $path/$collectionId using the same effective collection key observed by the page', scenario => {
        const page = syntheticPage('synthetic-a', 'en', 'catalog');
        page.request = {
            kind: 'catalog',
            path: scenario.path,
            input: { collectionId: scenario.collectionId, skip: 0, take: 12 },
        };
        page.requestKey = publicPageRequestKey(page.request);
        const requestKey = page.requestKey;
        page.route = `/en${scenario.path}`;
        if (!page.catalog || !page.products || !page.collections?.[0])
            throw new Error('Expected a catalog fixture');
        const collection = page.collections[0];
        page.collections.unshift(
            { ...collection, id: 'hidden', productVariantCount: 0, featuredAsset: null, children: [] },
            { ...collection, id: 'all' },
        );
        page.catalog = { items: page.products.slice(0, 11), totalItems: 47 };
        delete page.products;
        const client = new QueryClient();
        seedPublicPage(client, page);
        const key = storefrontQueryKeys.catalog('synthetic-a:MYR', 'en', {
            collectionId: scenario.expectedId,
        });
        expect(client.getQueryData(key)).toMatchObject({
            pages: [{ items: page.catalog.items, totalItems: 47 }],
            pageParams: [0],
        });
        if (scenario.expectedId)
            expect(
                client.getQueryData(storefrontQueryKeys.catalog('synthetic-a:MYR', 'en', {})),
            ).toBeUndefined();
        expect(page.requestKey).toBe(requestKey);
        expect(page.request.input.collectionId).toBe(scenario.collectionId);
        const collections = client.getQueryData<NonNullable<PublicPageData['collections']>>(
            storefrontQueryKeys.collections('synthetic-a:MYR', 'en'),
        );
        const mediaKey = publicSeoQueryKey(
            'synthetic-a:MYR',
            'en',
            page.request,
            'public-media',
            collections,
        );
        expect(client.getQueryData(mediaKey)).toEqual(page.media);
        if (scenario.expectedId)
            expect(mediaKey).toEqual(
                publicSeoQueryKey(
                    'synthetic-a:MYR',
                    'en',
                    {
                        ...page.request,
                        input: { ...page.request.input, collectionId: scenario.expectedId },
                    },
                    'public-media',
                    collections,
                ),
            );
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

describe('navigation query ownership', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_CLIENT_CHANNEL_SWITCHING', 'false');
        vi.stubGlobal('window', { location: { origin: 'https://store.test', host: 'store.test' } });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
        vi.resetModules();
    });
    afterEach(async () => {
        const { setPublicPageNavigationScope } = await import('./storefront-page-data');
        setPublicPageNavigationScope(undefined);
        vi.unstubAllGlobals();
    });
    it('refreshes expired disabled public metadata through its aggregate owner while returning cached content immediately', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const stale = syntheticPage('synthetic-a', 'en', 'home');
        stale.scope.host = 'store.test';
        const request = { kind: 'page', id: 'services' } as const;
        stale.request = request;
        stale.requestKey = publicPageRequestKey(stale.request);
        stale.generatedAt = Date.now() - 31_000;
        const src = '/assets/preview/warm-service.webp';
        stale.media = [mediaDescriptor(src, 'hero')];
        seedPublicPage(client, stale);
        const key = publicSeoQueryKey('synthetic-a:MYR', 'en', stale.request);
        const observer = new QueryObserver(client, { queryKey: key, queryFn: skipToken, enabled: false });
        const stop = observer.subscribe(() => undefined);
        const fresh = {
            ...stale,
            generatedAt: Date.now(),
            media: [mediaDescriptor(src, 'hero', { inlinePreview: 'data:image/webp;base64,AAAA' })],
        };
        const fetch = vi.fn().mockResolvedValue(Response.json(fresh));
        vi.stubGlobal('fetch', fetch);
        setPublicPageNavigationScope({ channelCode: 'synthetic-a', currencyCode: 'MYR', languageCode: 'en' });
        try {
            await prefetchPublicPage(client, '/en/services');
            expect(client.getQueryData(key)).toBeDefined();
            await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
            await vi.waitFor(() =>
                expect(
                    client.getQueryData(publicSeoQueryKey('synthetic-a:MYR', 'en', request, 'public-media')),
                ).toEqual(fresh.media),
            );
        } finally {
            stop();
            client.clear();
        }
    });
    it.each(['product', 'catalog'] as const)(
        'restores missing %s hints without rereading its fresh business query',
        async kind => {
            const { prefetchPublicPage, setPublicPageNavigationScope } =
                await import('./storefront-page-data');
            const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            const page = syntheticPage('synthetic-a', 'en', kind);
            page.scope.host = 'store.test';
            const collections = page.collections ?? [];
            const request = page.request;
            if (!request || (request.kind !== 'catalog' && request.kind !== 'product'))
                throw new Error('Expected route identity');
            const key =
                request.kind === 'product'
                    ? storefrontQueryKeys.product('synthetic-a:MYR', 'en', request.id)
                    : storefrontQueryKeys.catalog('synthetic-a:MYR', 'en', request.input);
            const business =
                request.kind === 'product'
                    ? page.product
                    : { pages: [page.catalog, page.catalog], pageParams: [0, 12] };
            client.setQueryData(key, business);
            client.setQueryData(storefrontQueryKeys.collections('synthetic-a:MYR', 'en'), collections);
            const catalog = vi.fn();
            const product = vi.fn();
            const fetch = vi.fn().mockResolvedValue(Response.json(page));
            vi.stubGlobal('fetch', fetch);
            setPublicPageNavigationScope({
                channelCode: 'synthetic-a',
                currencyCode: 'MYR',
                languageCode: 'en',
                api: { catalog, product },
            });
            try {
                await prefetchPublicPage(client, `/en${publicPageRouteHref(request)}`);
                expect(fetch).toHaveBeenCalledOnce();
                expect(catalog).not.toHaveBeenCalled();
                expect(product).not.toHaveBeenCalled();
                expect(client.getQueryData(key)).toEqual(business);
                expect(
                    client.getQueryData(
                        publicSeoQueryKey('synthetic-a:MYR', 'en', request, 'public-media', collections),
                    ),
                ).toEqual(page.media);
            } finally {
                client.clear();
            }
        },
    );
    it('discards a late media response after currency changes without caching an empty capability', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const page = syntheticPage('synthetic-a', 'en', 'product');
        page.scope.host = 'store.test';
        const request = page.request;
        if (request?.kind !== 'product') throw new Error('Expected product request');
        const businessKey = storefrontQueryKeys.product('synthetic-a:MYR', 'en', request.id);
        const mediaKey = publicSeoQueryKey('synthetic-a:MYR', 'en', request, 'public-media');
        client.setQueryData(businessKey, page.product);
        let release: ((response: Response) => void) | undefined;
        const fetch = vi.fn(
            () =>
                new Promise<Response>(resolve => {
                    release = resolve;
                }),
        );
        vi.stubGlobal('fetch', fetch);
        const scope = {
            channelCode: 'synthetic-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { product: vi.fn(), catalog: vi.fn() },
        };
        setPublicPageNavigationScope(scope);
        try {
            const href = `/en${publicPageRouteHref(request)}`;
            const navigation = prefetchPublicPage(client, href);
            const rejected = expect(navigation).rejects.toMatchObject({ name: 'AbortError' });
            await Promise.resolve();
            if (!release) throw new Error('Expected pending artwork recovery');
            setPublicPageNavigationScope({ ...scope, currencyCode: 'CNY' });
            release(Response.json(page));
            await rejected;
            expect(client.getQueryData(mediaKey)).toBeUndefined();
            expect(client.getQueryData(businessKey)).toEqual(page.product);
            setPublicPageNavigationScope(scope);
            fetch.mockResolvedValue(Response.json(page));
            await prefetchPublicPage(client, href);
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(client.getQueryData(mediaKey)).toEqual(page.media);
        } finally {
            client.clear();
        }
    });
    it('propagates closure through the media query before cached product artwork can return', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const key = storefrontQueryKeys.product('store-a:MYR', 'en', 'p1');
        client.setQueryData(key, { id: 'p1' });
        const config = [...storefrontQueryKeys.config('store-a:MYR', 'en'), 'public'];
        client.setQueryData(config, fixture().config);
        const queryScope = await import('./query-client');
        const stop = queryScope.watchStorefrontScopeAccess(client, () => undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(Response.json({ errorCode: 'STOREFRONT_CLOSED' }, { status: 403 })),
        );
        setPublicPageNavigationScope({
            channelCode: 'store-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { product: vi.fn(), catalog: vi.fn() },
        });
        try {
            await expect(prefetchPublicPage(client, '/en/product?id=p1')).rejects.toMatchObject({
                errorCode: 'STOREFRONT_CLOSED',
            });
            expect(client.getQueryData(key)).toBeUndefined();
            expect(
                queryScope.isStorefrontScopeAccessDenied(client, {
                    marketCode: 'store-a:MYR',
                    languageCode: 'en',
                }),
            ).toBe(true);
        } finally {
            stop();
            client.clear();
        }
    });
    it('fetches route artwork before resolving when fresh SEO exists without media', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const page = fixture();
        page.request = { kind: 'page', id: 'services' };
        page.requestKey = publicPageRequestKey(page.request);
        page.media = [
            mediaDescriptor('/assets/preview/service.webp', 'hero', {
                inlinePreview: 'data:image/webp;base64,AAAA',
            }),
        ];
        const seo = publicSeoQueryKey('store-a:MYR', 'en', page.request);
        client.setQueryData(seo, null);
        let release: ((response: Response) => void) | undefined;
        const fetch = vi.fn(
            () =>
                new Promise<Response>(resolve => {
                    release = resolve;
                }),
        );
        vi.stubGlobal('fetch', fetch);
        setPublicPageNavigationScope({ channelCode: 'store-a', currencyCode: 'MYR', languageCode: 'en' });
        try {
            let finished = false;
            const navigation = prefetchPublicPage(client, '/en/services').then(() => {
                finished = true;
            });
            await Promise.resolve();
            expect(fetch).toHaveBeenCalledOnce();
            expect(finished).toBe(false);
            if (!release) throw new Error('Expected the pending public media read');
            release(Response.json(page));
            await navigation;
            expect(
                client.getQueryData(publicSeoQueryKey('store-a:MYR', 'en', page.request, 'public-media')),
            ).toEqual(page.media);
            await prefetchPublicPage(client, '/en/services');
            expect(fetch).toHaveBeenCalledOnce();
        } finally {
            client.clear();
        }
    });
    it('uses the aggregate to resolve a cold default category before opening its observed query', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const page = syntheticPage('synthetic-a', 'en', 'catalog');
        page.scope.host = 'store.test';
        page.request = { kind: 'catalog', input: {} };
        page.requestKey = publicPageRequestKey(page.request);
        const catalog = vi.fn();
        const fetch = vi.fn().mockResolvedValue(Response.json(page));
        vi.stubGlobal('fetch', fetch);
        setPublicPageNavigationScope({
            channelCode: 'synthetic-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { catalog, product: vi.fn() },
        });
        try {
            await prefetchPublicPage(client, '/en/category');
            expect(fetch).toHaveBeenCalledOnce();
            expect(catalog).not.toHaveBeenCalled();
            expect(
                client.getQueryData(
                    storefrontQueryKeys.catalog('synthetic-a:MYR', 'en', {
                        collectionId: 'synthetic-a-collection',
                    }),
                ),
            ).toMatchObject({ pages: [{ items: page.catalog?.items }] });
            expect(
                client.getQueryData(storefrontQueryKeys.catalog('synthetic-a:MYR', 'en', {})),
            ).toBeUndefined();
        } finally {
            client.clear();
        }
    });
    it.each([
        { href: '/en/category', expected: 'first' },
        { href: '/en/category?collectionId=all', expected: 'first' },
        { href: '/en/category?collectionId=chosen', expected: 'chosen' },
        { href: '/en/search?term=query', expected: undefined },
    ])('prefetches $href into the exact effective catalog key and API scope', async ({ href, expected }) => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const catalog = vi.fn((_input: { collectionId?: string }) =>
            Promise.resolve({ items: [], totalItems: 0 }),
        );
        const page = syntheticPage('synthetic-a', 'en', 'catalog');
        const collection = page.collections?.[0];
        if (!collection) throw new Error('Missing navigation collection');
        client.setQueryData(storefrontQueryKeys.collections('store-a:MYR', 'en'), [
            { ...collection, id: 'first' },
        ]);
        setPublicPageNavigationScope({
            channelCode: 'store-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { catalog, product: vi.fn() },
        });
        try {
            await prefetchPublicPage(client, href);
            expect(catalog).toHaveBeenCalledOnce();
            expect(catalog.mock.calls[0]?.[0]).toMatchObject({ collectionId: expected });
            const term = href.includes('term=') ? 'query' : undefined;
            expect(
                client.getQueryData(
                    storefrontQueryKeys.catalog('store-a:MYR', 'en', { collectionId: expected, term }),
                ),
            ).toMatchObject({ pages: [{ items: [] }] });
            if (expected)
                expect(
                    client.getQueryData(storefrontQueryKeys.catalog('store-a:MYR', 'en', { term })),
                ).toBeUndefined();
        } finally {
            client.clear();
        }
    });
    it('does not refetch a fresh query merely because a legacy endpoint supplied no SEO envelope', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const product = vi.fn();
        const key = storefrontQueryKeys.product('store-a:MYR', 'en', 'p1');
        client.setQueryDefaults(key, { queryFn: product });
        client.setQueryData(key, { id: 'p1' }, { updatedAt: Date.now() - 45_000 });
        setPublicPageNavigationScope({
            channelCode: 'store-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { product, catalog: vi.fn() },
        });
        try {
            await prefetchPublicPage(client, '/en/product?id=p1');
            expect(product).not.toHaveBeenCalled();
            expect(client.getQueryData(key)).toEqual({ id: 'p1' });
        } finally {
            client.clear();
        }
    });

    it('stores a failed required product read in the exact query, without inventing an empty result', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const failure = new Error('Network failed');
        const product = vi.fn().mockRejectedValue(failure);
        setPublicPageNavigationScope({
            channelCode: 'store-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { product, catalog: vi.fn() },
        });
        try {
            await expect(prefetchPublicPage(client, '/en/product?id=p1')).rejects.toBe(failure);
            expect(product).toHaveBeenCalledWith('p1', expect.any(AbortSignal));
            expect(
                client.getQueryState(storefrontQueryKeys.product('store-a:MYR', 'en', 'p1')),
            ).toMatchObject({ status: 'error', error: failure, data: undefined });
            expect(
                client.getQueryData(storefrontQueryKeys.product('store-a:MYR', 'en', 'p2')),
            ).toBeUndefined();
        } finally {
            client.clear();
        }
    });
    it('cancels the navigation wait without cancelling its shared product query or a later target', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        let finish!: (value: unknown) => void;
        let querySignal!: AbortSignal;
        const product = vi.fn((id: string, signal?: AbortSignal) => {
            if (id === 'b') return Promise.resolve({ id: 'b' });
            if (!signal) throw new Error('Expected Query abort signal');
            querySignal = signal;
            return new Promise(resolve => {
                finish = resolve;
            });
        });
        setPublicPageNavigationScope({
            channelCode: 'store-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { product: product as never, catalog: vi.fn() },
        });
        const controller = new AbortController();
        try {
            const first = prefetchPublicPage(client, '/en/product?id=a', controller.signal);
            const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
            controller.abort();
            await rejection;
            expect(querySignal.aborted).toBe(false);
            await prefetchPublicPage(client, '/en/product?id=b');
            finish({ id: 'a' });
            await vi.waitFor(() =>
                expect(client.getQueryData(storefrontQueryKeys.product('store-a:MYR', 'en', 'a'))).toEqual({
                    id: 'a',
                }),
            );
            expect(client.getQueryData(storefrontQueryKeys.product('store-a:MYR', 'en', 'b'))).toEqual({
                id: 'b',
            });
        } finally {
            client.clear();
        }
    });
    it.each([
        {
            href: '/en/category?collection=parent&child=child&sort=price-desc&fulfillment=digital&stock=1&minPrice=12.345&maxPrice=99&page=2',
            input: {
                collectionId: 'child',
                sort: 'price-desc',
                fulfillmentType: 'digital',
                inStockOnly: true,
                minPriceWithTax: 1235,
                maxPriceWithTax: 9900,
                skip: 12,
                take: 12,
            },
        },
        {
            href: '/en/search?term=%20Query%20&sort=newest&fulfillment=physical',
            input: {
                term: 'Query',
                collectionId: undefined,
                sort: 'newest',
                fulfillmentType: 'physical',
                inStockOnly: false,
                skip: 0,
                take: 12,
            },
        },
    ])('prefetches canonical filters without reparsing $href', async ({ href, input }) => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        setPublicPageNavigationScope({
            channelCode: 'store-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { catalog, product: vi.fn() },
        });
        try {
            await prefetchPublicPage(client, href);
            expect(catalog).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining(input),
                expect.any(AbortSignal),
            );
            expect(
                client.getQueryData(storefrontQueryKeys.catalog('store-a:MYR', 'en', input)),
            ).toMatchObject({ pageParams: [input.skip] });
        } finally {
            client.clear();
        }
    });
    it('warms filtered catalog data in the existing infinite query shape and keeps valid empty results', async () => {
        const { prefetchPublicPage, setPublicPageNavigationScope } = await import('./storefront-page-data');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        setPublicPageNavigationScope({
            channelCode: 'store-a',
            currencyCode: 'MYR',
            languageCode: 'en',
            api: { product: vi.fn(), catalog },
        });
        try {
            await prefetchPublicPage(client, '/en/category?collectionId=c1&sort=price-asc&minPrice=10');
            const key = storefrontQueryKeys.catalog('store-a:MYR', 'en', {
                collectionId: 'c1',
                sort: 'price-asc',
                minPriceWithTax: 1000,
            });
            expect(catalog).toHaveBeenCalledWith(
                expect.objectContaining({
                    collectionId: 'c1',
                    sort: 'price-asc',
                    minPriceWithTax: 1000,
                    skip: 0,
                    take: 12,
                }),
                expect.any(AbortSignal),
            );
            expect(client.getQueryData(key)).toEqual({
                pages: [{ items: [], totalItems: 0 }],
                pageParams: [0],
            });
            expect(client.getQueryState(key)?.status).toBe('success');
        } finally {
            client.clear();
        }
    });
});
