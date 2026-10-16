import type { Product, ProductSearchPage, StorefrontCatalogInput } from '../types';
import type { CatalogApi } from './catalog';
import type { ShopApiContext } from './client-context';

import { productAvailability } from '../product-availability';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryClient,
    storefrontQueryKeys,
} from '../query-client';

import { BaseDomainApi } from './base-domain-api';

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

/** Legacy-schema compatibility only; normal public aggregates never download this reader. */
export class NativeCatalogApi extends BaseDomainApi {
    constructor(
        ctx: ShopApiContext,
        private readonly source: Pick<CatalogApi, 'productsByIds' | 'productSales'>,
    ) {
        super(ctx);
    }
    async catalog(input: StorefrontCatalogInput, signal?: AbortSignal): Promise<ProductSearchPage> {
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
                    queryFn: ({ signal: querySignal }) => this.source.productSales(productIds, querySignal),
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
                ...(await this.source.productsByIds(
                    productIds.slice(offset, offset + NATIVE_CATALOG_BATCH_SIZE),
                    signal,
                )),
            );
        }
        return products;
    }
}

function catalogVariants(product: Product, input: StorefrontCatalogInput): Product['variants'] {
    if (!input.fulfillmentType) return product.variants;
    return product.variants.filter(variant => variant.customFields.fulfillmentType === input.fulfillmentType);
}

function minimumCatalogPrice(product: Product, input: StorefrontCatalogInput): number {
    if (product.customFields?.pricingMode === 'QUOTE_ONLY') return Number.POSITIVE_INFINITY;
    const prices = catalogVariants(product, input).map(variant => variant.priceWithTax);
    return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

function matchesCatalogFilters(product: Product, input: StorefrontCatalogInput): boolean {
    if (
        product.customFields?.pricingMode === 'QUOTE_ONLY' &&
        (input.minPriceWithTax != null || input.maxPriceWithTax != null)
    )
        return false;
    const variants = catalogVariants(product, input);
    if (!variants.length) return false;
    if (input.inStockOnly && !variants.some(variant => !productAvailability(variant).soldOut)) {
        return false;
    }
    const minimumPrice = Math.min(...variants.map(variant => variant.priceWithTax));
    if (input.minPriceWithTax != null && minimumPrice < input.minPriceWithTax) return false;
    if (input.maxPriceWithTax != null && minimumPrice > input.maxPriceWithTax) return false;
    return true;
}

function sortNativeCatalogProducts(
    products: Product[],
    input: StorefrontCatalogInput,
    locale: string,
): Product[] {
    const sorted = [...products];
    if (input.sort === 'sales') return sorted;
    if (input.sort === 'newest') {
        return sorted.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    }
    if (input.sort === 'price-asc' || input.sort === 'price-desc') {
        const direction = input.sort === 'price-asc' ? 1 : -1;
        return sorted.sort((left, right) => {
            const quoteDifference =
                Number(left.customFields?.pricingMode === 'QUOTE_ONLY') -
                Number(right.customFields?.pricingMode === 'QUOTE_ONLY');
            if (quoteDifference) return quoteDifference;
            return (minimumCatalogPrice(left, input) - minimumCatalogPrice(right, input)) * direction;
        });
    }
    return sorted.sort((left, right) => left.name.localeCompare(right.name, locale));
}
