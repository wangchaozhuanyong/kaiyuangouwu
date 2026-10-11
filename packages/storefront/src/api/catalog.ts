import type {
    CollectionSummary,
    DailyRecommendations,
    Product,
    ProductSearchPage,
    ProductSearchSort,
    StorefrontCatalogInput,
} from '../types';

import { storefrontNavigationCollections } from '../../../storefront-content-plugin/src/shared/public-page-data';
import { asListProduct } from '../product-summary';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryClient,
    storefrontQueryKeys,
} from '../query-client';

import { BaseDomainApi } from './base-domain-api';
import { productFields, productPackagingFields, productSummaryFields } from './fragments';
import {
    isMissingStorefrontCatalogSchema,
    matchesCatalogFilters,
    sortNativeCatalogProducts,
} from './helpers';

export { storefrontNavigationCollections } from '../../../storefront-content-plugin/src/shared/public-page-data';

const NATIVE_CATALOG_BATCH_SIZE = 100;
const STOREFRONT_CATALOG_MAX_TAKE = 48;

function awaitCatalogSnapshot<T>(snapshot: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return snapshot;
    if (signal.aborted) return Promise.reject(new DOMException('The request was aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('The request was aborted', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        snapshot.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

export class CatalogApi extends BaseDomainApi {
    private storefrontCatalogAvailable: boolean | null = null;

    async products(take = 16, signal?: AbortSignal): Promise<Product[]> {
        const result = await this.request<{ products: { items: Product[] } }>(
            `
            query StorefrontProducts($options: ProductListOptions) {
                products(options: $options) {
                    items { ${productSummaryFields} }
                }
            }
        `,
            { options: { take, sort: { name: 'ASC' } } },
            signal,
        );
        return result.products.items.map(asListProduct);
    }

    async product(id: string, signal?: AbortSignal): Promise<Product | null> {
        const { fetchPublicPage, seedPublicPage } = await import('../storefront-page-data');
        const page = await fetchPublicPage(
            this.languageCode,
            this.market.currencyCode,
            signal,
            {
                kind: 'product',
                id,
            },
            this.market.code,
        );
        if (page) {
            seedPublicPage(storefrontQueryClient, page);
            if (page.product === undefined) throw new Error('Public product response is missing its detail');
            return page.product;
        }
        const result = await this.request<{ product: Product | null }>(
            `
                query StorefrontProduct($id: ID!) {
                    product(id: $id) {
                        ${productFields}
                        ${productPackagingFields}
                        variants { storeCouponCollectionIds }
                    }
                }
            `,
            { id },
            signal,
        );
        if (result.product === undefined) throw new Error('Product response is missing its detail');
        return result.product;
    }

    async productsByIds(ids: string[], signal?: AbortSignal): Promise<Product[]> {
        const uniqueIds = [...new Set(ids)];
        if (!uniqueIds.length) return [];
        const products: Product[] = [];
        for (let offset = 0; offset < uniqueIds.length; offset += NATIVE_CATALOG_BATCH_SIZE) {
            const batch = uniqueIds.slice(offset, offset + NATIVE_CATALOG_BATCH_SIZE);
            const result = await this.request<{ products: { items: Product[]; totalItems: number } }>(
                `
                query StorefrontProductsByIds($options: ProductListOptions) {
                    products(options: $options) {
                        totalItems
                        items { ${productFields} }
                    }
                }
            `,
                {
                    options: {
                        take: batch.length,
                        filter: { id: { in: batch } },
                    },
                },
                signal,
            );
            if (
                !Array.isArray(result.products?.items) ||
                result.products.items.length !== result.products.totalItems
            )
                throw new Error('Product references response is incomplete');
            products.push(...result.products.items);
        }
        const productsById = new Map(products.map(product => [product.id, product]));
        return uniqueIds.flatMap(id => {
            const product = productsById.get(id);
            return product ? [product] : [];
        });
    }

    async searchProducts(
        term: string,
        sort: ProductSearchSort = 'recommended',
        skip = 0,
        take = 20,
        collectionId?: string,
        signal?: AbortSignal,
    ): Promise<ProductSearchPage> {
        return this.catalog({ term, sort, skip, take, collectionId }, signal);
    }

    async catalog(input: StorefrontCatalogInput, signal?: AbortSignal): Promise<ProductSearchPage> {
        if (this.storefrontCatalogAvailable === false) {
            return this.nativeCatalog(input, signal);
        }
        const sortMap: Record<ProductSearchSort, string> = {
            recommended: 'RECOMMENDED',
            sales: 'SALES',
            newest: 'NEWEST',
            name: 'NAME',
            'price-asc': 'PRICE_ASC',
            'price-desc': 'PRICE_DESC',
        };
        const { fetchPublicPage, seedPublicPage } = await import('../storefront-page-data');
        const pageData = await fetchPublicPage(
            this.languageCode,
            this.market.currencyCode,
            signal,
            {
                kind: 'catalog',
                path:
                    typeof window !== 'undefined' &&
                    /^(?:\/(?:zh|en))?\/search\/?$/u.test(window.location.pathname)
                        ? '/search'
                        : '/category',
                input: {
                    ...input,
                    sort: sortMap[input.sort ?? 'recommended'] as 'RECOMMENDED',
                    fulfillmentType: input.fulfillmentType?.toUpperCase() as
                        'PHYSICAL' | 'DIGITAL' | undefined,
                },
            },
            this.market.code,
        );
        if (pageData) {
            seedPublicPage(storefrontQueryClient, pageData, true, false);
            if (!pageData.catalog) throw new Error('Public catalog response is missing its results');
            return { ...pageData.catalog, items: pageData.catalog.items.map(asListProduct) };
        }
        try {
            const result = await this.request<{ storefrontCatalog: ProductSearchPage }>(
                `
                    query StorefrontCatalog($input: StorefrontCatalogInput!) {
                        storefrontCatalog(input: $input) {
                            totalItems
                            items { ${productSummaryFields} }
                        }
                    }
                `,
                {
                    input: {
                        ...(input.term ? { term: input.term } : {}),
                        ...(input.collectionId ? { collectionId: input.collectionId } : {}),
                        sort: sortMap[input.sort ?? 'recommended'],
                        ...(input.fulfillmentType
                            ? { fulfillmentType: input.fulfillmentType.toUpperCase() }
                            : {}),
                        inStockOnly: input.inStockOnly === true,
                        ...(input.minPriceWithTax != null ? { minPriceWithTax: input.minPriceWithTax } : {}),
                        ...(input.maxPriceWithTax != null ? { maxPriceWithTax: input.maxPriceWithTax } : {}),
                        skip: input.skip ?? 0,
                        take: input.take ?? 12,
                    },
                },
                signal,
            );
            const page = result.storefrontCatalog;
            if (!page || !Array.isArray(page.items) || !Number.isFinite(page.totalItems)) {
                throw new Error('Shop API returned an invalid storefront catalog response');
            }
            this.storefrontCatalogAvailable = true;
            return { ...page, items: page.items.map(asListProduct) };
        } catch (error) {
            if (!isMissingStorefrontCatalogSchema(error)) throw error;
            this.storefrontCatalogAvailable = false;
            return this.nativeCatalog(input, signal);
        }
    }

    private async nativeCatalog(
        input: StorefrontCatalogInput,
        signal?: AbortSignal,
    ): Promise<ProductSearchPage> {
        if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError');
        const products = await awaitCatalogSnapshot(
            storefrontQueryClient.fetchQuery({
                queryKey: [
                    ...storefrontQueryKeys.scope(storefrontQueryKeys.market(this.market), this.languageCode),
                    'native-catalog',
                    {
                        term: input.term?.trim() ?? '',
                        collectionId: input.collectionId ?? null,
                        inStockOnly: input.inStockOnly === true,
                    },
                ],
                queryFn: ({ signal: querySignal }) => this.loadNativeCatalog(input, querySignal),
                // A first-page refresh obtains a new snapshot; later offsets reuse that snapshot.
                staleTime: (input.skip ?? 0) > 0 ? PUBLIC_QUERY_STALE_TIME : 0,
                gcTime: PUBLIC_QUERY_GC_TIME,
                meta: publicQueryMeta(),
            }),
            signal,
        );
        if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError');
        const filteredProducts = products.filter(product => matchesCatalogFilters(product, input));
        let sortedProducts = sortNativeCatalogProducts(filteredProducts, input, this.market.locale);
        if (input.sort === 'sales') {
            const productIds = products.map(product => product.id);
            const sales = await awaitCatalogSnapshot(
                storefrontQueryClient.fetchQuery({
                    queryKey: [
                        ...storefrontQueryKeys.scope(
                            storefrontQueryKeys.market(this.market),
                            this.languageCode,
                        ),
                        'native-catalog-sales',
                        productIds,
                    ],
                    queryFn: ({ signal: querySignal }) => this.productSales(productIds, querySignal),
                    staleTime: (input.skip ?? 0) > 0 ? PUBLIC_QUERY_STALE_TIME : 0,
                    gcTime: PUBLIC_QUERY_GC_TIME,
                    meta: publicQueryMeta(),
                }),
                signal,
            );
            sortedProducts = [...filteredProducts].sort(
                (left, right) =>
                    (sales[right.id] ?? 0) - (sales[left.id] ?? 0) ||
                    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
                    left.id.localeCompare(right.id),
            );
        }
        const skip = Math.max(0, Math.trunc(input.skip ?? 0));
        const take = Math.min(STOREFRONT_CATALOG_MAX_TAKE, Math.max(1, Math.trunc(input.take ?? 12)));
        return {
            items: sortedProducts.slice(skip, skip + take),
            totalItems: sortedProducts.length,
        };
    }

    private async loadNativeCatalog(input: StorefrontCatalogInput, signal?: AbortSignal): Promise<Product[]> {
        const productIds: string[] = [];
        const seenProductIds = new Set<string>();
        let searchSkip = 0;
        let nativeTotalItems = Number.POSITIVE_INFINITY;

        while (searchSkip < nativeTotalItems) {
            const result = await this.request<{
                search: { totalItems: number; items: Array<{ productId: string }> };
            }>(
                `
                    query StorefrontNativeCatalog($input: SearchInput!) {
                        search(input: $input) {
                            totalItems
                            items { productId }
                        }
                    }
                `,
                {
                    input: {
                        ...(input.term?.trim() ? { term: input.term.trim() } : {}),
                        ...(input.collectionId ? { collectionId: input.collectionId } : {}),
                        groupByProduct: true,
                        // Legacy index stock can lag behind live auto-card inventory.
                        // Filter hydrated variants before slicing the cached result.
                        skip: searchSkip,
                        take: NATIVE_CATALOG_BATCH_SIZE,
                    },
                },
                signal,
            );
            nativeTotalItems = result.search.totalItems;
            for (const item of result.search.items) {
                if (seenProductIds.has(item.productId)) continue;
                seenProductIds.add(item.productId);
                productIds.push(item.productId);
            }
            if (!result.search.items.length) break;
            searchSkip += result.search.items.length;
        }

        const products: Product[] = [];
        for (let offset = 0; offset < productIds.length; offset += NATIVE_CATALOG_BATCH_SIZE) {
            products.push(
                ...(await this.productsByIds(
                    productIds.slice(offset, offset + NATIVE_CATALOG_BATCH_SIZE),
                    signal,
                )),
            );
        }
        return products;
    }

    async dailyRecommendations(signal?: AbortSignal): Promise<DailyRecommendations> {
        const result = await this.request<{ storefrontDailyRecommendations: DailyRecommendations }>(
            `query StorefrontDailyRecommendations {
                storefrontDailyRecommendations { businessDate expiresAt items { ${productSummaryFields} } }
            }`,
            undefined,
            signal,
        );
        return {
            ...result.storefrontDailyRecommendations,
            items: result.storefrontDailyRecommendations.items.map(asListProduct),
        };
    }

    async productSales(productIds: string[], signal?: AbortSignal): Promise<Record<string, number>> {
        const uniqueProductIds = [...new Set(productIds)];
        const quantities: Record<string, number> = {};
        const batchSize = 100;

        for (let offset = 0; offset < uniqueProductIds.length; offset += batchSize) {
            const batch = uniqueProductIds.slice(offset, offset + batchSize);
            const result = await this.request<{
                storefrontProductSales: Array<{ productId: string; quantity: number }>;
            }>(
                `
                    query StorefrontProductSales($productIds: [ID!]!) {
                        storefrontProductSales(productIds: $productIds) {
                            productId
                            quantity
                        }
                    }
                `,
                { productIds: batch },
                signal,
            );
            for (const item of result.storefrontProductSales) {
                quantities[item.productId] = item.quantity;
            }
        }

        return quantities;
    }

    async collections(signal?: AbortSignal): Promise<CollectionSummary[]> {
        const items: CollectionSummary[] = [];
        let totalItems = Infinity;
        while (items.length < totalItems) {
            const result = await this.request<{
                collections: { items: CollectionSummary[]; totalItems?: number };
            }>(
                `
            query StorefrontCollections($skip: Int!) {
                collections(options: { take: 100, skip: $skip, topLevelOnly: true, sort: { position: ASC } }) {
                    totalItems
                    items {
                        id
                        name
                        slug
                        description
                        position
                        parentId
                        productVariantCount
                        featuredAsset { id preview }
                        children {
                            id
                            name
                            slug
                            description
                            position
                            parentId
                            productVariantCount
                            featuredAsset { id preview }
                        }
                    }
                }
            }
        `,
                { skip: items.length },
                signal,
            );
            const page = result.collections?.items ?? [];
            items.push(...page);
            totalItems = result.collections?.totalItems ?? items.length;
            if (!page.length) break;
        }
        return storefrontNavigationCollections(
            items
                .slice()
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .map(item => ({
                    ...item,
                    children: (item.children ?? [])
                        .slice()
                        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
                })),
        );
    }
}
