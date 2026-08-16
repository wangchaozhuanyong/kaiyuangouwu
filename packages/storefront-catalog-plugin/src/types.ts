export type StorefrontCatalogSort = 'RECOMMENDED' | 'SALES' | 'NEWEST' | 'NAME' | 'PRICE_ASC' | 'PRICE_DESC';

export type StorefrontCatalogFulfillmentType = 'PHYSICAL' | 'DIGITAL';

export interface StorefrontCatalogInput {
    term?: string | null;
    collectionId?: string | number | null;
    sort?: StorefrontCatalogSort | null;
    fulfillmentType?: StorefrontCatalogFulfillmentType | null;
    inStockOnly?: boolean | null;
    minPriceWithTax?: number | null;
    maxPriceWithTax?: number | null;
    skip?: number | null;
    take?: number | null;
}

export interface NormalizedStorefrontCatalogInput {
    term?: string;
    collectionId?: string | number;
    sort: StorefrontCatalogSort;
    fulfillmentType?: StorefrontCatalogFulfillmentType;
    inStockOnly: boolean;
    minPriceWithTax?: number;
    maxPriceWithTax?: number;
    skip: number;
    take: number;
}
