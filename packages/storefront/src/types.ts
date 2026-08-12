export type MarketCode = 'cn-mainland' | 'my-malaysia';
export type FulfillmentType = 'physical' | 'digital';

export interface Asset {
    id: string;
    preview: string;
}

export interface ProductVariant {
    id: string;
    name: string;
    sku: string;
    priceWithTax: number;
    currencyCode: string;
    stockLevel: 'IN_STOCK' | 'OUT_OF_STOCK';
    customFields: { fulfillmentType: FulfillmentType };
}

export interface Product {
    id: string;
    name: string;
    slug: string;
    description: string;
    featuredAsset: Asset | null;
    variants: ProductVariant[];
}

export interface OrderLine {
    id: string;
    quantity: number;
    linePriceWithTax: number;
    productVariant: ProductVariant & { featuredAsset: Asset | null };
    customFields: { fulfillmentTypeSnapshot: FulfillmentType };
}

export interface CheckoutFulfillment {
    fulfillmentType: 'PHYSICAL' | 'DIGITAL' | 'MIXED';
    containsPhysicalProducts: boolean;
    containsDigitalProducts: boolean;
    requiresShippingAddress: boolean;
    requiresShippingMethod: boolean;
}

export interface Order {
    id: string;
    code: string;
    state: string;
    totalQuantity: number;
    subTotalWithTax: number;
    shippingWithTax: number;
    totalWithTax: number;
    currencyCode: string;
    customer?: { id: string; emailAddress: string } | null;
    lines: OrderLine[];
    checkoutFulfillment: CheckoutFulfillment;
}

export interface ShippingMethod {
    id: string;
    code: string;
    name: string;
    description: string;
    priceWithTax: number;
}

export interface MarketConfig {
    code: MarketCode;
    languageCode: 'zh_Hans' | 'en';
    currencyCode: 'CNY' | 'MYR';
    countryCode: 'CN' | 'MY';
    locale: 'zh-CN' | 'en-MY';
    label: string;
}
