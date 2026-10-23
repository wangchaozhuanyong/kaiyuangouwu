import type {
    CollectionSummary,
    DailyRecommendations,
    Product,
    ProductSearchPage,
    ProductSearchSort,
    StorefrontCatalogInput,
} from '../types';

import { storefrontNavigationCollections } from '../../../storefront-content-plugin/src/shared/public-page-data';
import { publicCatalogRequest } from '../catalog-route-query';
import { asListProduct } from '../product-summary';
import { storefrontQueryClient } from '../query-client';

import { BaseDomainApi } from './base-domain-api';
import { productFields, productPackagingFields, productSummaryFields } from './fragments';
import { isMissingStorefrontCatalogSchema } from './helpers';

export { storefrontNavigationCollections } from '../../../storefront-content-plugin/src/shared/public-page-data';

export class CatalogApi extends BaseDomainApi {
    private storefrontCatalogAvailable: boolean | null = null;
    private nativeCatalogApi?: import('./native-catalog').NativeCatalogApi;

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
        if (!ids.length) return [];
        const referenceIds = [...ids];
        signal?.throwIfAborted();
        const reader = await this.nativeReader();
        signal?.throwIfAborted();
        return reader.productsByIds(referenceIds, signal);
    }

    async searchProducts(
        term: string,
        sort: ProductSearchSort = 'recommended',
        skip = 0,
        take = 20,
        collectionId?: string,
        signal?: AbortSignal,
    ): Promise<ProductSearchPage> {
        return this.catalog({ term, sort, skip, take, collectionId }, signal, 'store');
    }

    async catalog(
        input: StorefrontCatalogInput,
        signal?: AbortSignal,
        scope: 'route' | 'store' = 'route',
    ): Promise<ProductSearchPage> {
        if (this.storefrontCatalogAvailable === false) {
            return this.nativeCatalog(input, signal);
        }
        const request = publicCatalogRequest(input, undefined, scope);
        const { fetchPublicPage, seedPublicPage } = await import('../storefront-page-data');
        const pageData = await fetchPublicPage(
            this.languageCode,
            this.market.currencyCode,
            signal,
            request,
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
                    input: request.input,
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
        return (await this.nativeReader()).catalog(input, signal);
    }

    private async nativeReader(): Promise<import('./native-catalog').NativeCatalogApi> {
        if (!this.nativeCatalogApi) {
            const { NativeCatalogApi } = await import('./native-catalog');
            this.nativeCatalogApi ??= new NativeCatalogApi(this.ctx, this);
        }
        return this.nativeCatalogApi;
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
