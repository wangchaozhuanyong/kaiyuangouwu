import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serializeStorefrontPageData } from '../../storefront-content-plugin/src/shared/public-page-data';
import { mediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';

import { storefrontQueryKeys } from './query-client';
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
});
