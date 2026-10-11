import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storefrontQueryClient, storefrontQueryKeys } from '../query-client';
import * as publicPageData from '../storefront-page-data';
import { CollectionSummary, Product } from '../types';

import { CatalogApi, storefrontNavigationCollections } from './catalog';
import { ShopApiContext } from './client-context';

const category = (id: string, overrides: Partial<CollectionSummary> = {}): CollectionSummary => ({
    id,
    name: id,
    slug: id,
    description: '',
    position: 0,
    parentId: 'root',
    featuredAsset: null,
    children: [],
    productVariantCount: 0,
    ...overrides,
});

describe('configured category navigation', () => {
    it('loads categories beyond the first page and preserves configured root and child order', async () => {
        const items = Array.from({ length: 103 }, (_, index) =>
            category(String(index), {
                position: index,
                productVariantCount: 1,
                children: [
                    category(`${index}-second`, { position: 2, productVariantCount: 1 }),
                    category(`${index}-first`, { position: 1, productVariantCount: 1 }),
                ],
            }),
        );
        const request = vi.fn((_query: string, variables: { skip: number }) =>
            Promise.resolve({
                collections: {
                    totalItems: items.length,
                    items: items.slice(variables.skip, variables.skip + 100),
                },
            }),
        );
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        const result = await api.collections();
        expect(result).toHaveLength(103);
        expect(request.mock.calls.map(call => call[1].skip)).toEqual([0, 100]);
        expect(result[102].children?.map(child => child.id)).toEqual(['102-first', '102-second']);
    });

    it('propagates recommendation failures instead of treating them as zero sales', async () => {
        const request = vi.fn().mockRejectedValue(new Error('Sales unavailable'));
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        await expect(api.dailyRecommendations()).rejects.toThrow('Sales unavailable');
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('stops sales pagination when the cancelled transport rejects the next batch', async () => {
        const controller = new AbortController();
        const request = vi.fn((_query: string, _variables: Record<string, unknown>, signal: AbortSignal) => {
            expect(signal).toBe(controller.signal);
            if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
            controller.abort();
            return Promise.resolve({ storefrontProductSales: [] });
        });
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        await expect(
            api.productSales(
                Array.from({ length: 101 }, (_, i) => String(i)),
                controller.signal,
            ),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('keeps a published illustrated category while its first products are pending', () => {
        const claude = category('claude', {
            featuredAsset: { id: 'icon-claude', preview: '/assets/claude.webp' },
        });

        expect(storefrontNavigationCollections([claude])).toEqual([claude]);
    });

    it('does not create navigation entries for unillustrated empty categories', () => {
        expect(
            storefrontNavigationCollections([
                category('unfinished'),
                category('blank-image', { featuredAsset: { id: 'blank', preview: '  ' } }),
            ]),
        ).toEqual([]);
    });

    it('keeps an illustrated child reachable through its empty parent', () => {
        const child = category('apple-id', {
            featuredAsset: { id: 'icon-apple', preview: '/assets/apple.webp' },
        });
        const parent = category('accounts', { children: [child, category('unfinished-child')] });

        expect(storefrontNavigationCollections([parent])).toEqual([{ ...parent, children: [child] }]);
    });

    it('preserves populated categories and legacy counts without images', () => {
        const populated = category('codex', { productVariantCount: 3 });
        const legacy = category('legacy', { productVariantCount: undefined });

        expect(storefrontNavigationCollections([populated, legacy])).toEqual([populated, legacy]);
    });

    it('keeps distinct configured roots even when a child has the same name and slug prefix', () => {
        const child = category('child', {
            name: 'Claude',
            slug: 'claude',
            featuredAsset: { id: 'claude', preview: '/assets/claude.webp' },
        });
        const root = category('parent', { children: [child] });
        const duplicate = category('duplicate', {
            name: 'Claude',
            slug: 'claude-2',
            productVariantCount: 200,
            featuredAsset: child.featuredAsset,
        });

        expect(storefrontNavigationCollections([root, duplicate])).toEqual([root, duplicate]);
    });
});

describe('product detail response contract', () => {
    const id = 'detail-product';
    const market = { code: 'detail-contract', currencyCode: 'CNY', locale: 'en' };
    const key = storefrontQueryKeys.product('detail-contract:CNY', 'en', id);

    function aggregate(product?: Product | null): publicPageData.PublicPageData {
        return {
            schemaVersion: 1,
            version: 'v1',
            generatedAt: Date.now(),
            route: '/product',
            request: { kind: 'product', id },
            scope: {
                host: 'store.test',
                channelCode: market.code,
                currencyCode: market.currencyCode,
                languageCode: 'en',
                priceContext: 'public',
            },
            config: {
                code: market.code,
                accessMode: 'LIVE',
                defaultCurrencyCode: market.currencyCode,
                defaultLanguageCode: 'en',
                customFields: {},
                availableCountries: [],
            },
            products: [],
            collections: [],
            media: [],
            failures: [],
            ...(product === undefined ? {} : { product }),
        };
    }

    function client(request: ReturnType<typeof vi.fn>) {
        return new CatalogApi({ request, market, languageCode: 'en' } as unknown as ShopApiContext);
    }

    beforeEach(() => {
        vi.spyOn(publicPageData, 'fetchPublicPage').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        storefrontQueryClient.clear();
    });

    it('keeps an aggregate null as a confirmed absence without a legacy request', async () => {
        const request = vi.fn();
        const controller = new AbortController();
        vi.mocked(publicPageData.fetchPublicPage).mockResolvedValue(aggregate(null));

        await expect(client(request).product(id, controller.signal)).resolves.toBeNull();

        expect(publicPageData.fetchPublicPage).toHaveBeenCalledExactlyOnceWith(
            'en',
            market.currencyCode,
            controller.signal,
            { kind: 'product', id },
            market.code,
        );
        expect(storefrontQueryClient.getQueryData(key)).toBeNull();
        expect(request).not.toHaveBeenCalled();
    });

    it('rejects an aggregate missing its product field without a legacy fallback', async () => {
        const request = vi.fn();
        vi.mocked(publicPageData.fetchPublicPage).mockResolvedValue(aggregate());

        await expect(client(request).product(id)).rejects.toThrow(
            'Public product response is missing its detail',
        );

        expect(storefrontQueryClient.getQueryData(key)).toBeUndefined();
        expect(request).not.toHaveBeenCalled();
    });

    it('keeps an explicit legacy null as a confirmed absence', async () => {
        const request = vi.fn().mockResolvedValue({ product: null });
        const controller = new AbortController();

        await expect(client(request).product(id, controller.signal)).resolves.toBeNull();

        expect(request).toHaveBeenCalledOnce();
        expect(request.mock.calls[0][0]).toContain('query StorefrontProduct($id: ID!)');
        expect(request.mock.calls[0][1]).toEqual({ id });
        expect(request.mock.calls[0][2]).toBe(controller.signal);
    });

    it('rejects a legacy response missing its product field', async () => {
        const request = vi.fn().mockResolvedValue({});

        await expect(client(request).product(id)).rejects.toThrow('Product response is missing its detail');

        expect(request).toHaveBeenCalledOnce();
    });

    it.each(['aggregate', 'legacy'] as const)(
        'preserves a %s request failure instead of returning null',
        async source => {
            const failure = new Error('Product request unavailable');
            const request = vi.fn().mockRejectedValue(failure);
            if (source === 'aggregate') vi.mocked(publicPageData.fetchPublicPage).mockRejectedValue(failure);

            await expect(client(request).product(id)).rejects.toBe(failure);

            expect(request).toHaveBeenCalledTimes(source === 'aggregate' ? 0 : 1);
            expect(storefrontQueryClient.getQueryData(key)).toBeUndefined();
        },
    );

    it.each(['aggregate', 'legacy'] as const)(
        'keeps an existing zero-stock product from the %s response',
        async source => {
            const product: Product = {
                id,
                createdAt: '2026-01-01',
                name: 'Zero-stock product',
                slug: 'zero-stock-product',
                description: '',
                featuredAsset: null,
                assets: [],
                collections: [],
                variants: [
                    {
                        id: 'detail-variant',
                        name: 'Zero-stock variant',
                        sku: 'zero-stock',
                        priceWithTax: 500,
                        currencyCode: market.currencyCode,
                        stockLevel: 'OUT_OF_STOCK',
                        saleableStockLevel: 0,
                        featuredAsset: null,
                        product: { id, name: 'Zero-stock product', featuredAsset: null },
                        customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'manual_service' },
                    },
                ],
            };
            const request = vi.fn().mockResolvedValue({ product });
            if (source === 'aggregate')
                vi.mocked(publicPageData.fetchPublicPage).mockResolvedValue(aggregate(product));

            await expect(client(request).product(id)).resolves.toBe(product);

            expect(request).toHaveBeenCalledTimes(source === 'aggregate' ? 0 : 1);
            if (source === 'aggregate') expect(storefrontQueryClient.getQueryData(key)).toBe(product);
        },
    );
});

describe('legacy catalog reads share the existing scoped QueryClient', () => {
    afterEach(() => storefrontQueryClient.clear());
    it('uses live auto-card stock before counting and paging even when index stock is stale', async () => {
        const products = [1, 0].map((stock, index) => ({
            id: String(index),
            name: String(index),
            createdAt: '2026-01-01',
            variants: [
                {
                    priceWithTax: 100,
                    stockLevel: 'OUT_OF_STOCK',
                    autoCardAvailableStock: stock,
                    customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
                },
            ],
        }));
        const request = vi.fn((query: string, variables: { input?: { inStock?: boolean } }) => {
            if (query.includes('query StorefrontCatalog('))
                throw new Error('Unknown type "StorefrontCatalogInput".');
            if (query.includes('query StorefrontNativeCatalog'))
                return Promise.resolve({
                    search: variables.input?.inStock
                        ? { totalItems: 0, items: [] }
                        : { totalItems: 2, items: products.map(product => ({ productId: product.id })) },
                });
            if (query.includes('query StorefrontProductsByIds'))
                return Promise.resolve({ products: { totalItems: products.length, items: products } });
            throw new Error('unexpected request');
        });
        const api = new CatalogApi({
            request,
            market: { code: 'legacy-stock', currencyCode: 'CNY', locale: 'en' },
            languageCode: 'en',
        } as unknown as ShopApiContext);
        const result = await api.catalog({ inStockOnly: true, take: 1 });
        expect(result.totalItems).toBe(1);
        expect(result.items.map(product => product.id)).toEqual(['0']);
    });
    it('reuses one full snapshot across offsets, isolates currency, and refreshes the first page', async () => {
        const products = ['a', 'b'].map(id => ({
            id,
            name: id,
            createdAt: '2026-01-01',
            variants: [{ priceWithTax: 100, customFields: {} }],
        }));
        const request = vi.fn((query: string) => {
            if (query.includes('query StorefrontCatalog('))
                throw new Error('Unknown type "StorefrontCatalogInput".');
            if (query.includes('query StorefrontNativeCatalog'))
                return Promise.resolve({
                    search: { totalItems: 2, items: products.map(p => ({ productId: p.id })) },
                });
            if (query.includes('query StorefrontProductsByIds'))
                return Promise.resolve({ products: { totalItems: products.length, items: products } });
            throw new Error('unexpected request');
        });
        const ctx = {
            request,
            market: { code: 'test-store', currencyCode: 'CNY', locale: 'en' },
            languageCode: 'en',
        } as unknown as ShopApiContext;
        const api = new CatalogApi(ctx);
        expect((await api.catalog({ take: 1, skip: 0 })).items.map(p => p.id)).toEqual(['a']);
        expect((await api.catalog({ take: 1, skip: 1 })).items.map(p => p.id)).toEqual(['b']);
        const loads = () =>
            request.mock.calls.filter(([query]) => query.includes('query StorefrontProductsByIds')).length;
        expect(loads()).toBe(1);
        await api.catalog({ take: 1, skip: 0 });
        expect(loads()).toBe(2);
        const otherCurrency = new CatalogApi({
            ...ctx,
            market: { ...ctx.market, currencyCode: 'MYR' },
        });
        await otherCurrency.catalog({ take: 1, skip: 1 });
        expect(loads()).toBe(3);
    });
    it('cancels one caller without aborting another caller sharing the same legacy snapshot', async () => {
        let finish!: (value: unknown) => void;
        const pending = new Promise(resolve => {
            finish = resolve;
        });
        const request = vi.fn(async (query: string, _variables?: unknown, signal?: AbortSignal) => {
            if (query.includes('query StorefrontCatalog('))
                throw new Error('Unknown type "StorefrontCatalogInput".');
            if (query.includes('query StorefrontNativeCatalog'))
                return { search: { totalItems: 1, items: [{ productId: 'a' }] } };
            if (query.includes('query StorefrontProductsByIds')) {
                const response = await pending;
                expect(signal?.aborted).toBe(false);
                return response;
            }
            throw new Error('unexpected request');
        });
        const api = new CatalogApi({
            request,
            market: { code: 'cancel-test', currencyCode: 'CNY', locale: 'en' },
            languageCode: 'en',
        } as unknown as ShopApiContext);
        const controller = new AbortController();
        const first = api.catalog({ take: 1 }, controller.signal);
        const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
        await vi.waitFor(() =>
            expect(
                request.mock.calls.some(([query]) => query.includes('query StorefrontProductsByIds')),
            ).toBe(true),
        );
        const second = api.catalog({ take: 1 });
        controller.abort();
        await cancelled;
        finish({
            products: {
                totalItems: 1,
                items: [
                    {
                        id: 'a',
                        name: 'a',
                        createdAt: '2026-01-01',
                        variants: [{ priceWithTax: 100, customFields: {} }],
                    },
                ],
            },
        });
        expect((await second).items.map(p => p.id)).toEqual(['a']);
        expect(
            request.mock.calls.filter(([query]) => query.includes('query StorefrontProductsByIds')),
        ).toHaveLength(1);
    });
    it('uses measured sales to sort rather than silently returning the native name order', async () => {
        const products = ['a', 'b'].map(id => ({
            id,
            name: id,
            createdAt: '2026-01-01',
            variants: [{ priceWithTax: 100, customFields: {} }],
        }));
        const request = vi.fn((query: string) => {
            if (query.includes('query StorefrontCatalog('))
                throw new Error('Unknown type "StorefrontCatalogInput".');
            if (query.includes('query StorefrontNativeCatalog'))
                return Promise.resolve({
                    search: { totalItems: 2, items: products.map(p => ({ productId: p.id })) },
                });
            if (query.includes('query StorefrontProductsByIds'))
                return Promise.resolve({ products: { totalItems: products.length, items: products } });
            if (query.includes('query StorefrontProductSales'))
                return Promise.resolve({ storefrontProductSales: [{ productId: 'b', quantity: 9 }] });
            throw new Error('unexpected request');
        });
        const api = new CatalogApi({
            request,
            market: { code: 'test-sales', currencyCode: 'CNY', locale: 'en' },
            languageCode: 'en',
        } as unknown as ShopApiContext);
        expect((await api.catalog({ sort: 'sales', take: 1 })).items.map(p => p.id)).toEqual(['b']);
        expect((await api.catalog({ sort: 'sales', skip: 1, take: 1 })).items.map(p => p.id)).toEqual(['a']);
        expect(
            request.mock.calls.filter(([query]) => query.includes('query StorefrontProductSales')),
        ).toHaveLength(1);
        await api.catalog({ sort: 'sales', take: 1 });
        expect(
            request.mock.calls.filter(([query]) => query.includes('query StorefrontProductSales')),
        ).toHaveLength(2);
    });
});
