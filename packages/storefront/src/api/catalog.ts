import type {
    CollectionSummary,
    Product,
    ProductSearchPage,
    ProductSearchSort,
    StorefrontCatalogInput,
} from '../types';

import { BaseDomainApi } from './base-domain-api';
import { productFields, productPackagingFields } from './fragments';
import {
    isMissingStorefrontCatalogSchema,
    matchesCatalogFilters,
    sortNativeCatalogProducts,
} from './helpers';

const NATIVE_CATALOG_BATCH_SIZE = 100;
const STOREFRONT_CATALOG_MAX_TAKE = 48;

export class CatalogApi extends BaseDomainApi {
    private storefrontCatalogAvailable: boolean | null = null;

    async products(take = 16, signal?: AbortSignal): Promise<Product[]> {
        const result = await this.request<{ products: { items: Product[] } }>(
            `
            query StorefrontProducts($options: ProductListOptions) {
                products(options: $options) {
                    items { ${productFields} }
                }
            }
        `,
            { options: { take, sort: { name: 'ASC' } } },
            signal,
        );
        return result.products.items;
    }

    async product(id: string, signal?: AbortSignal): Promise<Product | null> {
        const result = await this.request<{ product: Product | null }>(
            `
                query StorefrontProduct($id: ID!) {
                    product(id: $id) {
                        ${productFields}
                        ${productPackagingFields}
                    }
                }
            `,
            { id },
            signal,
        );
        return result.product;
    }

    async productsByIds(ids: string[], signal?: AbortSignal): Promise<Product[]> {
        const uniqueIds = [...new Set(ids)];
        if (!uniqueIds.length) return [];
        const result = await this.request<{ products: { items: Product[] } }>(
            `
                query StorefrontProductsByIds($options: ProductListOptions) {
                    products(options: $options) {
                        items { ${productFields} }
                    }
                }
            `,
            {
                options: {
                    take: uniqueIds.length,
                    filter: { id: { in: uniqueIds } },
                },
            },
            signal,
        );
        const productsById = new Map(result.products.items.map(product => [product.id, product]));
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
        try {
            const result = await this.request<{ storefrontCatalog: ProductSearchPage }>(
                `
                    query StorefrontCatalog($input: StorefrontCatalogInput!) {
                        storefrontCatalog(input: $input) {
                            totalItems
                            items { ${productFields} }
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
            return page;
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
                        ...(input.inStockOnly ? { inStock: true } : {}),
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
        const filteredProducts = products.filter(product => matchesCatalogFilters(product, input));
        const sortedProducts = sortNativeCatalogProducts(filteredProducts, input, this.market.locale);
        const skip = Math.max(0, Math.trunc(input.skip ?? 0));
        const take = Math.min(STOREFRONT_CATALOG_MAX_TAKE, Math.max(1, Math.trunc(input.take ?? 12)));
        return {
            items: sortedProducts.slice(skip, skip + take),
            totalItems: sortedProducts.length,
        };
    }

    async productSales(productIds: string[]): Promise<Record<string, number>> {
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
            );
            for (const item of result.storefrontProductSales) {
                quantities[item.productId] = item.quantity;
            }
        }

        return quantities;
    }

    async collections(signal?: AbortSignal): Promise<CollectionSummary[]> {
        const result = await this.request<{ collections: { items: CollectionSummary[] } }>(
            `
            query StorefrontCollections {
                collections(options: { take: 50, topLevelOnly: true, sort: { position: ASC } }) {
                    items {
                        id
                        name
                        slug
                        description
                        position
                        parentId
                        featuredAsset { id preview }
                        children {
                            id
                            name
                            slug
                            description
                            position
                            parentId
                            featuredAsset { id preview }
                        }
                    }
                }
            }
        `,
            undefined,
            signal,
        );
        return result.collections.items;
    }
}
