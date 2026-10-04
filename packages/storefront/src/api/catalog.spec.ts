import { afterEach, describe, expect, it, vi } from 'vitest';

import { storefrontQueryClient } from '../query-client';
import { CollectionSummary } from '../types';

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
                return Promise.resolve({ products: { items: products } });
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
                return Promise.resolve({ products: { items: products } });
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
                return Promise.resolve({ products: { items: products } });
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
