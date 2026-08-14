export type MarketCode = 'cn-mainland' | 'my-malaysia';
export type StorefrontLanguage = 'zh' | 'en';
export type VendureLanguageCode = 'zh_Hans' | 'en';
export type FulfillmentType = 'physical' | 'digital';

export interface Asset {
    id: string;
    preview: string;
}

export interface CollectionSummary {
    id: string;
    name: string;
    slug: string;
    description: string;
    position: number;
    parentId: string;
    featuredAsset: Asset | null;
    children?: CollectionSummary[] | null;
}

export interface ProductVariant {
    id: string;
    name: string;
    sku: string;
    priceWithTax: number;
    currencyCode: string;
    stockLevel: 'IN_STOCK' | 'OUT_OF_STOCK';
    featuredAsset: Asset | null;
    product: { featuredAsset: Asset | null };
    customFields: { fulfillmentType: FulfillmentType };
}

export interface Product {
    id: string;
    createdAt: string;
    name: string;
    slug: string;
    description: string;
    featuredAsset: Asset | null;
    assets: Asset[];
    collections: Array<Pick<CollectionSummary, 'id' | 'name' | 'slug' | 'parentId'>>;
    variants: ProductVariant[];
}

export interface OrderLine {
    id: string;
    quantity: number;
    linePriceWithTax: number;
    productVariant: ProductVariant;
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
    orderPlacedAt?: string | null;
    totalQuantity: number;
    subTotalWithTax: number;
    shippingWithTax: number;
    totalWithTax: number;
    currencyCode: string;
    customer?: { id: string; emailAddress: string } | null;
    lines: OrderLine[];
    discounts: Array<{ description: string; amountWithTax: number }>;
    checkoutFulfillment?: CheckoutFulfillment;
}

export interface CustomerAddress {
    id: string;
    fullName: string | null;
    phoneNumber: string | null;
    streetLine1: string;
    streetLine2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    defaultShippingAddress: boolean | null;
    defaultBillingAddress: boolean | null;
    country: { code: string; name: string };
}

export interface ActiveCustomer {
    id: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber: string | null;
    addresses: CustomerAddress[] | null;
    orders: { items: Order[]; totalItems: number };
}

export type StorefrontCartState = 'OPEN' | 'PAYMENT_PENDING';
export type StorefrontCartSelectionState = 'NONE' | 'PARTIAL' | 'ALL';

export interface StorefrontCartLine {
    id: string;
    quantity: number;
    selected: boolean;
    available: boolean;
    productVariant: ProductVariant | null;
}

export interface StorefrontCart {
    id: string;
    revision: number;
    state: StorefrontCartState;
    projectedRevision: number | null;
    totalQuantity: number;
    selectedLineCount: number;
    selectedQuantity: number;
    selectionState: StorefrontCartSelectionState;
    lines: StorefrontCartLine[];
    checkoutOrder: Order | null;
}

export interface StorefrontCartCheckout {
    id: string;
    cartRevision: number;
    state: 'PREPARED' | 'PLACED' | 'ABANDONED';
    completedAt: string | null;
}

export interface StorefrontCheckoutSession {
    cart: StorefrontCart;
    order: Order;
    checkout: StorefrontCartCheckout | null;
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
    defaultLanguageCode: VendureLanguageCode;
    currencyCode: 'CNY' | 'MYR';
    countryCode: 'CN' | 'MY';
    locale: 'zh-CN' | 'en-MY';
    label: string;
}

export interface StorefrontConfig {
    code: string;
    customFields: {
        storefrontNameZh?: string | null;
        storefrontNameEn?: string | null;
    };
}
