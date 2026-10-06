import type { MediaDescriptor } from './responsive-image';

export interface PublicPageCatalogInput {
    term?: string;
    collectionId?: string;
    sort?: 'RECOMMENDED' | 'SALES' | 'NEWEST' | 'NAME' | 'PRICE_ASC' | 'PRICE_DESC';
    fulfillmentType?: 'PHYSICAL' | 'DIGITAL';
    inStockOnly?: boolean;
    minPriceWithTax?: number;
    maxPriceWithTax?: number;
    skip?: number;
    take?: number;
}
export type PublicPageRequest =
    { kind: 'home' } | { kind: 'catalog'; input: PublicPageCatalogInput } | { kind: 'product'; id: string };

/** Public data only. Neither sessions nor Channel tokens belong in this contract. */
export interface StorefrontPageData<
    Config = unknown,
    Content = unknown,
    Product = unknown,
    Collection = unknown,
> {
    schemaVersion: 1;
    version: string;
    generatedAt: number;
    scope: {
        host: string;
        channelCode: string;
        languageCode: string;
        currencyCode: string;
        priceContext: 'public';
    };
    route: string;
    config: Config;
    content?: Content;
    products?: Product[];
    flashSales?: unknown[];
    catalog?: { items: Product[]; totalItems: number };
    product?: Product | null;
    collections?: Collection[];
    visualPreset?: { presetId: string };
    media: MediaDescriptor[];
    failures: Array<'content' | 'products' | 'collections' | 'visualPreset' | 'flashSales'>;
}

export const STOREFRONT_PAGE_DATA_ELEMENT_ID = 'storefront-public-page-data';

/** An inert JSON script must also escape HTML parser terminators, not only JSON quotes. */
export function serializeStorefrontPageData(data: StorefrontPageData): string {
    return JSON.stringify(data).replace(
        /[<>&\u2028\u2029]/gu,
        value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}
