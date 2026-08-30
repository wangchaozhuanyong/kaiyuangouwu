import { productAvailability } from './product-availability';
import {
    ActiveCustomer,
    AfterSalesRequest,
    CollectionSummary,
    CreateAfterSalesRequestInput,
    CreateImageGenerationInput,
    CustomerAddress,
    CustomerAddressInput,
    CustomerAddressUpdateInput,
    CustomerOrderCounts,
    ImageGenerationJob,
    ImageModelQuotaStatus,
    ImageModelRecommendation,
    ImagePrivateAssetView,
    ImagePromptOptimizationResult,
    ImagePromptQuotaStatus,
    ImageReferenceMode,
    ImageStudioConfig,
    ImageStudioWallet,
    MarketConfig,
    MyReferralOverview,
    Order,
    OrderConfirmationToken,
    OrderPage,
    PaymentMethod,
    Product,
    ProductSearchPage,
    ProductSearchSort,
    ReferralBalancePaymentResult,
    ReferralProgram,
    RegisterCustomerInput,
    ShippingMethod,
    StoreCouponUsageRecord,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontCatalogInput,
    StorefrontCheckoutSession,
    StorefrontConfig,
    StorefrontContentBlock,
    StorefrontContentResponse,
    StorefrontCouponCampaign,
    StorefrontCurrencyConfiguration,
    StorefrontFlashSale,
    StorefrontReview,
    StorefrontReviewCandidate,
    StorefrontReviewList,
    StorefrontSystemAnnouncement,
    StorefrontUsdtCheckoutQuote,
    SubmitStorefrontReviewInput,
    VendureLanguageCode,
} from './types';

const API_URL = String(import.meta.env.VITE_SHOP_API_URL ?? '/shop-api');
const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const AUTH_TOKEN_STORAGE_PREFIX = 'vendure-shop-auth-token';
const NATIVE_CATALOG_BATCH_SIZE = 100;
const STOREFRONT_CATALOG_MAX_TAKE = 48;
const SEND_CLIENT_CHANNEL_TOKEN =
    import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING === 'true' ||
    (import.meta.env.DEV && import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING !== 'false');

interface StorefrontContentQueryResult {
    storefrontContent: StorefrontContentBlock[];
    activeStorefrontCoupons?: StorefrontCouponCampaign[];
    activeStorefrontFlashSales?: StorefrontFlashSale[];
    activeSystemAnnouncements?: StorefrontSystemAnnouncement[];
    storefrontContentSettings?: {
        heroAutoplayIntervalSeconds: number;
        configuredBlockTypes?: Array<StorefrontContentBlock['type']>;
    };
}

function isStorefrontContentSchemaCompatibilityError(error: unknown): boolean {
    return (
        error instanceof Error &&
        /cannot query field|unknown (?:field|argument)|is not defined by type/iu.test(error.message)
    );
}

const productFields = `
    id
    createdAt
    name
    slug
    description
    featuredAsset { id preview }
    assets { id preview }
    collections { id name slug parentId }
    variants {
        id
        name
        sku
        priceWithTax
        currencyCode
        saleableStockLevel
        autoCardAvailableStock
        featuredAsset { id preview }
        product { id name featuredAsset { id preview } }
        customFields { fulfillmentType digitalDeliveryMode }
    }
`;

const orderFields = `
    id
    code
    state
    orderPlacedAt
    totalQuantity
    subTotalWithTax
    shippingWithTax
    totalWithTax
    currencyCode
    customer { id emailAddress }
    payments { id method amount state }
    discounts { description amountWithTax }
    taxSummary { description taxRate taxBase taxTotal }
    couponCodes
    customFields { customerNote deliveryEmail }
    fulfillments {
        id
        state
        method
        trackingCode
        createdAt
        updatedAt
    }
    digitalDeliveries {
        orderLineId
        sku
        name
        status
        downloadUrl
        expiresAt
    }
    autoCardDeliveries {
        id
        createdAt
        updatedAt
        state
        productName
        sku
        quantity
        attemptCount
        sentAt
        orderLineId
    }
    lines {
        id
        quantity
        linePriceWithTax
        proratedUnitPriceWithTax
        productVariant {
            id
            name
            sku
            priceWithTax
            currencyCode
            saleableStockLevel
            autoCardAvailableStock
            featuredAsset { id preview }
            product { id name featuredAsset { id preview } }
            customFields { fulfillmentType digitalDeliveryMode }
        }
        customFields { fulfillmentTypeSnapshot digitalDeliveryModeSnapshot }
    }
    checkoutFulfillment {
        fulfillmentType
        containsPhysicalProducts
        containsDigitalProducts
        requiresShippingAddress
        requiresShippingMethod
    }
    checkoutShipping {
        methodCode
        methodName
        priceWithTax
        estimateMinDays
        estimateMaxDays
        freeShippingThreshold
        freeShippingApplied
    }
`;

const customerCouponFields = `
    id
    campaignId
    campaignName
    campaignKind
    status
    minimumSpend
    currencyCode
    discountAmount
    discountRate
    claimedAt
    validFrom
    validUntil
    lockedAt
    usedAt
    returnedAt
    expiredAt
    lockedOrderId
    usedOrderId
    returnCount
    usable
`;

const referralWalletFields = `
    id
    createdAt
    updatedAt
    currencyCode
    availableBalance
    pendingBalance
    reservedBalance
`;

const imageGenerationJobFields = `
    id
    createdAt
    updatedAt
    state
    modelCodeSnapshot
    modelNameSnapshot
    officialModelIdSnapshot
    originalPrompt
    finalPrompt
    promptSkillHash
    referenceMode
    aspectRatio
    resolution
    quantity
    unitPriceSnapshot
    reservedAmount
    expectedChargeAmount
    freeQuantityReserved
    freeQuantityCaptured
    paidQuantityReserved
    capturedAmount
    releasedAmount
    currencyCode
    termsVersion
    errorMessage
    completedAt
    referenceAsset { id originalName mimeType byteSize width height expiresAt previewUrl }
    outputs { id outputIndex state attemptCount errorMessage completedAt refundedAt billingMode chargeAmount imageUrl downloadUrl }
`;

// Keep paginated order queries below the production complexity limit. Full order
// details are fetched separately by id when a customer opens an order.
const orderSummaryFields = `
    id
    code
    state
    orderPlacedAt
    totalQuantity
    totalWithTax
    currencyCode
    fulfillments {
        state
        method
        trackingCode
        updatedAt
    }
    lines {
        id
        quantity
        linePriceWithTax
        productVariant {
            id
            name
            sku
            priceWithTax
            currencyCode
            saleableStockLevel
            autoCardAvailableStock
            featuredAsset { id preview }
            product { id name featuredAsset { id preview } }
            customFields { fulfillmentType digitalDeliveryMode }
        }
        customFields { fulfillmentTypeSnapshot digitalDeliveryModeSnapshot }
    }
    checkoutFulfillment { containsDigitalProducts }
    checkoutShipping { methodName }
`;

const afterSalesFields = `
    id
    createdAt
    updatedAt
    code
    type
    state
    reason
    description
    currencyCode
    requestedAmount
    approvedAmount
    resolution
    respondedAt
    completedAt
    cancelledAt
    order { id code state }
    items {
        id
        orderLineId
        quantity
        unitPriceWithTax
        lineAmountWithTax
        productName
        sku
        fulfillmentType
    }
    events {
        id
        createdAt
        state
        actorType
        actorLabel
        note
    }
`;

const storefrontReviewFields = `
    id
    createdAt
    updatedAt
    state
    rating
    title
    body
    customerName
    productName
    sku
    merchantResponse
    moderatedAt
    orderLineId
    productId
    productVariantId
    verifiedPurchase
`;

const cartFields = `
    id
    revision
    state
    projectedRevision
    totalQuantity
    selectedLineCount
    selectedQuantity
    selectionState
    lines {
        id
        quantity
        selected
        available
        productVariant {
            id
            name
            sku
            priceWithTax
            currencyCode
            saleableStockLevel
            autoCardAvailableStock
            featuredAsset { id preview }
            product { id name featuredAsset { id preview } }
            customFields { fulfillmentType digitalDeliveryMode }
        }
    }
    checkoutOrder { ${orderFields} }
`;

const cartResultFields = `
    __typename
    ... on StorefrontCart { ${cartFields} }
    ... on ErrorResult { errorCode message }
`;

const checkoutResultFields = `
    __typename
    ... on StorefrontCheckoutSession {
        cart { ${cartFields} }
        order { ${orderFields} }
        checkout { id cartRevision state completedAt }
    }
    ... on ErrorResult { errorCode message }
`;

interface GraphQlResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}

interface ErrorResult {
    __typename?: string;
    errorCode?: string;
    message?: string;
    authenticationError?: string;
}

function authTokenStorageKey(marketCode: string): string | null {
    if (typeof window === 'undefined') return null;
    const apiUrl = new URL(API_URL, window.location.href);
    if (apiUrl.origin === window.location.origin) return null;
    return `${AUTH_TOKEN_STORAGE_PREFIX}:${apiUrl.origin}${apiUrl.pathname}:${marketCode}`;
}

function readSessionAuthToken(storageKey: string | null): string | null {
    if (!storageKey) return null;
    try {
        return sessionStorage.getItem(storageKey);
    } catch {
        return null;
    }
}

export class ShopApiError extends Error {
    constructor(
        readonly errorCode: string,
        message: string,
        readonly authenticationError?: string,
    ) {
        super(message);
        this.name = 'ShopApiError';
    }
}

function isMissingStorefrontCatalogSchema(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
        error.message.includes('Unknown type "StorefrontCatalogInput"') ||
        error.message.includes('Cannot query field "storefrontCatalog"')
    );
}

function catalogVariants(product: Product, input: StorefrontCatalogInput): Product['variants'] {
    if (!input.fulfillmentType) return product.variants;
    return product.variants.filter(variant => variant.customFields.fulfillmentType === input.fulfillmentType);
}

function minimumCatalogPrice(product: Product, input: StorefrontCatalogInput): number {
    const prices = catalogVariants(product, input).map(variant => variant.priceWithTax);
    return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

function matchesCatalogFilters(product: Product, input: StorefrontCatalogInput): boolean {
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
        return sorted.sort(
            (left, right) =>
                (minimumCatalogPrice(left, input) - minimumCatalogPrice(right, input)) * direction,
        );
    }
    return sorted.sort((left, right) => left.name.localeCompare(right.name, locale));
}

export class ShopApi {
    private readonly authTokenStorageKey: string | null;
    private authToken: string | null;
    private storefrontCatalogAvailable: boolean | null = null;

    constructor(
        private readonly market: MarketConfig,
        private readonly languageCode: VendureLanguageCode = market.defaultLanguageCode,
    ) {
        this.authTokenStorageKey = authTokenStorageKey(market.code);
        this.authToken = readSessionAuthToken(this.authTokenStorageKey);
    }

    async storefrontConfig(signal?: AbortSignal): Promise<StorefrontConfig> {
        const result = await this.request<{
            activeChannel: Omit<StorefrontConfig, 'availableCountries' | 'logoUrl' | 'description'>;
            availableCountries: StorefrontConfig['availableCountries'];
            storefrontBranding: { logoUrl: string | null; description: string };
            storefrontCurrencyConfiguration: StorefrontCurrencyConfiguration;
        }>(
            `
            query StorefrontConfig {
                activeChannel {
                    code
                    defaultLanguageCode
                    defaultCurrencyCode
                    customFields {
                        storefrontNameZh
                        storefrontNameEn
                    }
                }
                availableCountries {
                    code
                    name
                }
                storefrontBranding {
                    logoUrl
                    description
                }
                storefrontCurrencyConfiguration {
                    defaultCurrencyCode
                    availableCurrencyCodes
                    selectorEnabled
                    cnyToMyrRate
                    rateUpdatedAt
                    usdtDisplayEnabled
                    usdtMarkupPercent
                    cnyPerUsdtRate
                    myrPerUsdtRate
                    usdtRateSource
                    usdtRateUpdatedAt
                    usdtRateAvailable
                }
            }
        `,
            undefined,
            signal,
        );
        return {
            ...result.activeChannel,
            availableCountries: result.availableCountries,
            logoUrl: result.storefrontBranding?.logoUrl ?? null,
            description: result.storefrontBranding?.description ?? '',
            currencyConfiguration: result.storefrontCurrencyConfiguration,
        };
    }

    async storefrontContent(signal?: AbortSignal): Promise<StorefrontContentResponse> {
        let result: StorefrontContentQueryResult;
        try {
            result = await this.request<StorefrontContentQueryResult>(
                `
            query StorefrontContent {
                storefrontContentSettings {
                    heroAutoplayIntervalSeconds
                    configuredBlockTypes
                }
                activeStorefrontCoupons {
                    id
                    name
                    kind
                    startsAt
                    endsAt
                    claimStartsAt
                    claimEndsAt
                    validityDays
                    minimumSpend
                    currencyCode
                    discountAmount
                    discountRate
                    remainingIssueCount
                    claimed
                    claimable
                }
                activeStorefrontFlashSales {
                    id
                    startsAt
                    endsAt
                    items {
                        productId
                        productVariantId
                        productName
                        variantName
                        originalPrice
                        salePrice
                        currencyCode
                        imageUrl
                    }
                }
                activeSystemAnnouncements {
                    id
                    title
                    content
                    linkUrl
                    startsAt
                    endsAt
                }
                storefrontContent {
                    id
                    code
                    internalName
                    type
                    layoutVariant
                    enabled
                    position
                    startsAt
                    endsAt
                    imageUrl
                    backgroundColor
                    textColor
                    targetType
                    targetValue
                    settings
                    title
                    subtitle
                    body
                    ctaLabel
                    items {
                        id
                        enabled
                        position
                        imageUrl
                        targetType
                        targetValue
                        settings
                        label
                        description
                    }
                }
            }
        `,
                undefined,
                signal,
            );
        } catch (error) {
            if (!isStorefrontContentSchemaCompatibilityError(error)) {
                throw error;
            }
            result = await this.request<StorefrontContentQueryResult>(
                `
                query StorefrontContentLegacy {
                    storefrontContentSettings {
                        heroAutoplayIntervalSeconds
                    }
                    storefrontContent {
                        id
                        code
                        type
                        enabled
                        position
                        startsAt
                        endsAt
                        imageUrl
                        backgroundColor
                        textColor
                        targetType
                        targetValue
                        title
                        subtitle
                        body
                        ctaLabel
                        items {
                            id
                            enabled
                            position
                            imageUrl
                            targetType
                            targetValue
                            label
                            description
                        }
                    }
                }
            `,
                undefined,
                signal,
            );
        }
        return {
            blocks: result.storefrontContent,
            coupons: result.activeStorefrontCoupons ?? [],
            flashSales: result.activeStorefrontFlashSales ?? [],
            systemAnnouncements: result.activeSystemAnnouncements ?? [],
            settings: {
                heroAutoplayIntervalSeconds:
                    result.storefrontContentSettings?.heroAutoplayIntervalSeconds ?? 5,
                configuredBlockTypes: result.storefrontContentSettings?.configuredBlockTypes ?? [],
            },
        };
    }

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
                    product(id: $id) { ${productFields} }
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
            this.storefrontCatalogAvailable = true;
            return result.storefrontCatalog;
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

    async activeCustomer(signal?: AbortSignal): Promise<ActiveCustomer | null> {
        const result = await this.request<{ activeCustomer: ActiveCustomer | null }>(
            `
            query StorefrontCustomer {
                activeCustomer {
                    id
                    firstName
                    lastName
                    emailAddress
                    phoneNumber
                    addresses {
                        id
                        fullName
                        phoneNumber
                        streetLine1
                        streetLine2
                        city
                        province
                        postalCode
                        defaultShippingAddress
                        defaultBillingAddress
                        country { code name }
                    }
                    orders(options: { take: 5, sort: { orderPlacedAt: DESC } }) {
                        totalItems
                        items { ${orderSummaryFields} }
                    }
                }
            }
        `,
            undefined,
            signal,
        );
        return result.activeCustomer;
    }

    async customerOrders(
        skip = 0,
        take = 10,
        states?: string[],
        code?: string,
        signal?: AbortSignal,
    ): Promise<OrderPage> {
        const filters = [
            states?.length ? { state: { in: states } } : null,
            code?.trim() ? { code: { contains: code.trim() } } : null,
        ].filter((filter): filter is NonNullable<typeof filter> => filter !== null);
        const result = await this.request<{
            activeCustomer: { orders: OrderPage } | null;
        }>(
            `
                query StorefrontOrders($options: OrderListOptions) {
                    activeCustomer {
                        orders(options: $options) {
                            totalItems
                            items { ${orderSummaryFields} }
                        }
                    }
                }
            `,
            {
                options: {
                    skip,
                    take,
                    sort: { orderPlacedAt: 'DESC' },
                    ...(filters.length === 1
                        ? { filter: filters[0] }
                        : filters.length > 1
                          ? { filter: { _and: filters } }
                          : {}),
                },
            },
            signal,
        );
        return result.activeCustomer?.orders ?? { items: [], totalItems: 0 };
    }

    async customerOrderCounts(signal?: AbortSignal): Promise<CustomerOrderCounts> {
        const result = await this.request<{
            activeCustomer: {
                pending: { totalItems: number };
                shipping: { totalItems: number };
                receiving: { totalItems: number };
            } | null;
        }>(
            `
                query StorefrontOrderCounts {
                    activeCustomer {
                        pending: orders(options: {
                            take: 0
                            filter: { state: { in: ["AddingItems", "ArrangingPayment"] } }
                        }) { totalItems }
                        shipping: orders(options: {
                            take: 0
                            filter: { state: { in: ["PaymentAuthorized", "PaymentSettled"] } }
                        }) { totalItems }
                        receiving: orders(options: {
                            take: 0
                            filter: { state: { in: ["Shipped", "PartiallyShipped"] } }
                        }) { totalItems }
                    }
                }
            `,
            undefined,
            signal,
        );
        return {
            pending: result.activeCustomer?.pending.totalItems ?? 0,
            shipping: result.activeCustomer?.shipping.totalItems ?? 0,
            receiving: result.activeCustomer?.receiving.totalItems ?? 0,
        };
    }

    async order(id: string, signal?: AbortSignal): Promise<Order | null> {
        const result = await this.request<{ order: Order | null }>(
            `
                query StorefrontOrder($id: ID!) {
                    order(id: $id) { ${orderFields} }
                }
            `,
            { id },
            signal,
        );
        return result.order;
    }

    async orderByConfirmationToken(token: string, signal?: AbortSignal): Promise<Order | null> {
        const result = await this.request<{ storefrontOrderByConfirmationToken: Order | null }>(
            `
                query StorefrontOrderByConfirmationToken($token: String!) {
                    storefrontOrderByConfirmationToken(token: $token) { ${orderFields} }
                }
            `,
            { token },
            signal,
        );
        return result.storefrontOrderByConfirmationToken;
    }

    async createOrderConfirmationToken(): Promise<OrderConfirmationToken> {
        const result = await this.request<{
            createStorefrontOrderConfirmationToken: OrderConfirmationToken;
        }>(`
            mutation CreateStorefrontOrderConfirmationToken {
                createStorefrontOrderConfirmationToken {
                    token
                    expiresAt
                }
            }
        `);
        return result.createStorefrontOrderConfirmationToken;
    }

    async cancelMyAuthorizedOrder(orderId: string, reason: string): Promise<Order> {
        const result = await this.request<{ cancelMyAuthorizedOrder: Order }>(
            `
                mutation CancelMyAuthorizedOrder($orderId: ID!, $reason: String!) {
                    cancelMyAuthorizedOrder(orderId: $orderId, reason: $reason) { ${orderFields} }
                }
            `,
            { orderId, reason },
        );
        return result.cancelMyAuthorizedOrder;
    }

    async afterSalesRequests(signal?: AbortSignal): Promise<AfterSalesRequest[]> {
        const result = await this.request<{ myAfterSalesRequests: AfterSalesRequest[] }>(
            `
                query MyAfterSalesRequests {
                    myAfterSalesRequests { ${afterSalesFields} }
                }
            `,
            undefined,
            signal,
        );
        return result.myAfterSalesRequests;
    }

    async createAfterSalesRequest(input: CreateAfterSalesRequestInput): Promise<AfterSalesRequest> {
        const result = await this.request<{ createAfterSalesRequest: AfterSalesRequest }>(
            `
                mutation CreateAfterSalesRequest($input: CreateAfterSalesRequestInput!) {
                    createAfterSalesRequest(input: $input) { ${afterSalesFields} }
                }
            `,
            { input },
        );
        return result.createAfterSalesRequest;
    }

    async cancelAfterSalesRequest(id: string): Promise<AfterSalesRequest> {
        const result = await this.request<{ cancelMyAfterSalesRequest: AfterSalesRequest }>(
            `
                mutation CancelMyAfterSalesRequest($id: ID!) {
                    cancelMyAfterSalesRequest(id: $id) { ${afterSalesFields} }
                }
            `,
            { id },
        );
        return result.cancelMyAfterSalesRequest;
    }

    async productReviews(productId: string, signal?: AbortSignal): Promise<StorefrontReviewList> {
        const result = await this.request<{ storefrontProductReviews: StorefrontReviewList }>(
            `
                query StorefrontProductReviews($productId: ID!) {
                    storefrontProductReviews(productId: $productId, options: { take: 20 }) {
                        totalItems
                        averageRating
                        items { ${storefrontReviewFields} }
                    }
                }
            `,
            { productId },
            signal,
        );
        return result.storefrontProductReviews;
    }

    async myReviews(signal?: AbortSignal): Promise<StorefrontReview[]> {
        const result = await this.request<{ myStorefrontReviews: StorefrontReview[] }>(
            `
                query MyStorefrontReviews {
                    myStorefrontReviews { ${storefrontReviewFields} }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontReviews;
    }

    async reviewCandidates(signal?: AbortSignal): Promise<StorefrontReviewCandidate[]> {
        const result = await this.request<{ myStorefrontReviewCandidates: StorefrontReviewCandidate[] }>(
            `
                query MyStorefrontReviewCandidates {
                    myStorefrontReviewCandidates {
                        orderLineId
                        orderId
                        orderCode
                        orderState
                        orderPlacedAt
                        productId
                        productVariantId
                        productName
                        variantName
                        sku
                        fulfillmentType
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontReviewCandidates;
    }

    async submitReview(input: SubmitStorefrontReviewInput): Promise<StorefrontReview> {
        const result = await this.request<{ submitStorefrontReview: StorefrontReview }>(
            `
                mutation SubmitStorefrontReview($input: SubmitStorefrontReviewInput!) {
                    submitStorefrontReview(input: $input) { ${storefrontReviewFields} }
                }
            `,
            { input },
        );
        return result.submitStorefrontReview;
    }

    async login(emailAddress: string, password: string): Promise<void> {
        const result = await this.request<{ login: ErrorResult }>(
            `
                mutation StorefrontLogin($emailAddress: String!, $password: String!) {
                    login(username: $emailAddress, password: $password, rememberMe: true) {
                        __typename
                        ... on CurrentUser { id identifier }
                        ... on ErrorResult { errorCode message }
                        ... on InvalidCredentialsError { authenticationError }
                    }
                }
            `,
            { emailAddress, password },
        );
        this.assertNoError(result.login);
    }

    async referralProgram(signal?: AbortSignal): Promise<ReferralProgram> {
        const result = await this.request<{ referralProgram: ReferralProgram }>(
            `
                query StorefrontReferralProgram {
                    referralProgram {
                        channelId
                        enabled
                        rewardRate
                        releaseDelayDays
                        currencyCode
                        minimumOrderAmount
                        maxRewardPerOrder
                        allowBalanceSpend
                        attributionWindowDays
                        defaultPosterTemplate
                        posterTemplates
                        posterTemplateConfigs {
                            id
                            name
                            enabled
                            position
                            layoutVariant
                            posterBackgroundAsset {
                                id
                                preview
                                source
                                width
                                height
                            }
                            shareBackgroundAsset {
                                id
                                preview
                                source
                                width
                                height
                            }
                            titleZh
                            titleEn
                            headlineZh
                            headlineEn
                            rewardTextZh
                            rewardTextEn
                            siteIntroZh
                            siteIntroEn
                            serviceTextZh
                            serviceTextEn
                            featureOneTitleZh
                            featureOneTitleEn
                            featureOneTextZh
                            featureOneTextEn
                            featureTwoTitleZh
                            featureTwoTitleEn
                            featureTwoTextZh
                            featureTwoTextEn
                            featureThreeTitleZh
                            featureThreeTitleEn
                            featureThreeTextZh
                            featureThreeTextEn
                            qrEyebrowZh
                            qrEyebrowEn
                            qrTitleZh
                            qrTitleEn
                            qrDescriptionZh
                            qrDescriptionEn
                            sceneOneZh
                            sceneOneEn
                            sceneTwoZh
                            sceneTwoEn
                            sceneThreeZh
                            sceneThreeEn
                            sceneFourZh
                            sceneFourEn
                            ctaTextZh
                            ctaTextEn
                            footerTitleZh
                            footerTitleEn
                            footerTextZh
                            footerTextEn
                            foregroundColor
                            accentColor
                            overlayOpacity
                        }
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.referralProgram;
    }

    async validateReferralInviteCode(code: string, signal?: AbortSignal): Promise<boolean> {
        const result = await this.request<{ validateReferralInviteCode: boolean }>(
            `
                query ValidateReferralInviteCode($code: String!) {
                    validateReferralInviteCode(code: $code)
                }
            `,
            { code },
            signal,
        );
        return result.validateReferralInviteCode;
    }

    async myReferralOverview(signal?: AbortSignal): Promise<MyReferralOverview> {
        const result = await this.request<{ myReferralOverview: MyReferralOverview }>(
            `
                query MyStorefrontReferralOverview {
                    myReferralOverview {
                        enabled
                        rewardRate
                        releaseDelayDays
                        inviteCode
                        wallets { ${referralWalletFields} }
                        invitedCount
                        purchasedInviteeCount
                        rewardSummaries { currencyCode grossReward clawedBackReward }
                        invitees { id displayName boundAt firstPaidOrderAt }
                        ledger {
                            id
                            createdAt
                            eventType
                            currencyCode
                            availableDelta
                            pendingDelta
                            reservedDelta
                            availableAfter
                            pendingAfter
                            reservedAfter
                            orderId
                            refundId
                            withdrawalId
                            actorType
                            note
                        }
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.myReferralOverview;
    }

    async registerCustomerAccount(
        input: RegisterCustomerInput,
        inviteCode?: string,
        source?: 'LINK' | 'POSTER' | 'CODE',
    ): Promise<void> {
        const result = await this.request<{ registerCustomerWithReferral: ErrorResult }>(
            `
                mutation RegisterStorefrontCustomer(
                    $input: RegisterCustomerInput!
                    $inviteCode: String
                    $source: String
                ) {
                    registerCustomerWithReferral(input: $input, inviteCode: $inviteCode, source: $source) {
                        __typename
                        ... on Success { success }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input, inviteCode: inviteCode || null, source: source ?? null },
        );
        this.assertNoError(result.registerCustomerWithReferral);
    }

    async useReferralBalance(amount: number): Promise<ReferralBalancePaymentResult> {
        const result = await this.request<{ useMyReferralBalance: ReferralBalancePaymentResult }>(
            `
                mutation UseStorefrontReferralBalance($amount: Money!) {
                    useMyReferralBalance(amount: $amount) {
                        amount
                        wallet { ${referralWalletFields} }
                        order { ${orderFields} }
                    }
                }
            `,
            { amount },
        );
        return result.useMyReferralBalance;
    }

    async imageStudioConfig(signal?: AbortSignal): Promise<ImageStudioConfig> {
        const result = await this.request<{ imageStudioConfig: ImageStudioConfig }>(
            `
                query ImageStudioConfig {
                    imageStudioConfig {
                        enabled promptOptimizationEnabled promptRateLimitPerMinute promptDailyFreeLimit promptDailyFreeUnlimited
                        paidPromptOptimizationEnabled paidPromptOptimizationPrice paidPromptOptimizationCurrencyCode
                        defaultModelCode termsVersion termsZh termsEn
                        outputRetentionDays referenceRetentionHours maxReferenceBytes maxReferencePixels maxQuantity
                        models {
                            id code displayNameZh displayNameEn descriptionZh descriptionEn officialModelId
                            unitPrice unitPrice2K unitPrice4K currencyCode position isDefault healthStatus freeImageEnabled dailyFreeImageLimit
                            dailyFreeImageUnlimited paidAfterFreeEnabled dailyGenerationSafetyLimit
                            resolutionOptions { resolution unitPrice supportedAspectRatios }
                        }
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.imageStudioConfig;
    }

    async imageStudioBalance(signal?: AbortSignal): Promise<number> {
        const result = await this.request<{ imageStudioBalance: number }>(
            `query ImageStudioBalance { imageStudioBalance }`,
            undefined,
            signal,
        );
        return result.imageStudioBalance;
    }

    async imageStudioWallet(signal?: AbortSignal): Promise<ImageStudioWallet> {
        const result = await this.request<{ imageStudioWallet: ImageStudioWallet }>(
            `query ImageStudioWallet {
                imageStudioWallet { availableBalance currencyCode }
            }`,
            undefined,
            signal,
        );
        return result.imageStudioWallet;
    }

    async imagePromptQuotaStatus(signal?: AbortSignal): Promise<ImagePromptQuotaStatus> {
        const result = await this.request<{ imagePromptQuotaStatus: ImagePromptQuotaStatus }>(
            `query ImagePromptQuotaStatus {
                imagePromptQuotaStatus {
                    paidEnabled paidPrice currencyCode
                    minute { limit unlimited reserved consumed remaining windowEndsAt }
                    daily { limit unlimited reserved consumed remaining windowEndsAt }
                }
            }`,
            undefined,
            signal,
        );
        return result.imagePromptQuotaStatus;
    }

    async imageModelQuotaStatus(signal?: AbortSignal): Promise<ImageModelQuotaStatus[]> {
        const result = await this.request<{ imageModelQuotaStatus: ImageModelQuotaStatus[] }>(
            `query ImageModelQuotaStatus {
                imageModelQuotaStatus {
                    modelCode freeImageEnabled paidAfterFreeEnabled unitPrice currencyCode
                    free { limit unlimited reserved consumed remaining windowEndsAt }
                    safety { limit unlimited reserved consumed remaining windowEndsAt }
                }
            }`,
            undefined,
            signal,
        );
        return result.imageModelQuotaStatus;
    }

    async optimizeImagePrompt(
        prompt: string,
        referenceMode: ImageReferenceMode,
        quote?: { expectedPrice?: number | null; currencyCode?: string | null; idempotencyKey?: string },
    ): Promise<ImagePromptOptimizationResult> {
        const result = await this.request<{ optimizeImagePrompt: ImagePromptOptimizationResult }>(
            `
                mutation OptimizeImagePrompt($input: OptimizeImagePromptInput!) {
                    optimizeImagePrompt(input: $input) {
                        originalPrompt optimizedPrompt promptSpec source recommendedModelCode recommendationReason promptSkillHash
                        billingMode chargedAmount currencyCode inputTokens outputTokens totalTokens actualCostMicrounits costCurrency
                        promptQuota {
                            paidEnabled paidPrice currencyCode
                            minute { limit unlimited reserved consumed remaining windowEndsAt }
                            daily { limit unlimited reserved consumed remaining windowEndsAt }
                        }
                    }
                }
            `,
            { input: { prompt, referenceMode, ...quote } },
        );
        return result.optimizeImagePrompt;
    }

    async recommendImageModel(
        prompt: string,
        referenceMode: ImageReferenceMode,
    ): Promise<ImageModelRecommendation> {
        const result = await this.request<{ recommendImageModel: ImageModelRecommendation }>(
            `
                query RecommendImageModel($input: OptimizeImagePromptInput!) {
                    recommendImageModel(input: $input) {
                        modelCode modelName officialModelId unitPrice currencyCode reason promptSkillHash
                    }
                }
            `,
            { input: { prompt, referenceMode } },
        );
        return result.recommendImageModel;
    }

    async uploadImageReference(file: File, termsAccepted: boolean): Promise<ImagePrivateAssetView> {
        const operations = {
            query: `mutation UploadImageReference($file: Upload!, $termsAccepted: Boolean!) {
                uploadImageReference(file: $file, termsAccepted: $termsAccepted) {
                    id originalName mimeType byteSize width height expiresAt previewUrl
                }
            }`,
            variables: { file: null, termsAccepted },
        };
        const form = new FormData();
        form.set('operations', JSON.stringify(operations));
        form.set('map', JSON.stringify({ 0: ['variables.file'] }));
        form.set('0', file, file.name);
        const headers: Record<string, string> = { 'language-code': this.languageCode };
        if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
        if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
        const separator = API_URL.includes('?') ? '&' : '?';
        const response = await fetch(
            `${API_URL}${separator}languageCode=${encodeURIComponent(this.languageCode)}&currencyCode=${encodeURIComponent(this.market.currencyCode)}`,
            { method: 'POST', credentials: 'include', headers, body: form },
        );
        this.captureAuthToken(response);
        const body = (await response.json()) as GraphQlResponse<{
            uploadImageReference: ImagePrivateAssetView;
        }>;
        if (!response.ok || body.errors?.length || !body.data) {
            throw new Error(body.errors?.[0]?.message ?? `Reference upload failed (${response.status})`);
        }
        return body.data.uploadImageReference;
    }

    async createImageGeneration(input: CreateImageGenerationInput): Promise<ImageGenerationJob> {
        const result = await this.request<{ createImageGeneration: ImageGenerationJob }>(
            `mutation CreateImageGeneration($input: CreateImageGenerationInput!) {
                createImageGeneration(input: $input) { ${imageGenerationJobFields} }
            }`,
            { input },
        );
        return result.createImageGeneration;
    }

    async myImageGenerationJob(id: string, signal?: AbortSignal): Promise<ImageGenerationJob> {
        const result = await this.request<{ myImageGenerationJob: ImageGenerationJob }>(
            `query MyImageGenerationJob($id: ID!) { myImageGenerationJob(id: $id) { ${imageGenerationJobFields} } }`,
            { id },
            signal,
        );
        return result.myImageGenerationJob;
    }

    async myImageGenerationJobs(skip = 0, take = 20, signal?: AbortSignal) {
        const result = await this.request<{
            myImageGenerationJobs: { items: ImageGenerationJob[]; totalItems: number };
        }>(
            `query MyImageGenerationJobs($skip: Int, $take: Int) {
                myImageGenerationJobs(skip: $skip, take: $take) { totalItems items { ${imageGenerationJobFields} } }
            }`,
            { skip, take },
            signal,
        );
        return result.myImageGenerationJobs;
    }

    async cancelQueuedImageGeneration(id: string): Promise<ImageGenerationJob> {
        const result = await this.request<{ cancelQueuedImageGeneration: ImageGenerationJob }>(
            `mutation CancelImageGeneration($id: ID!) { cancelQueuedImageGeneration(id: $id) { ${imageGenerationJobFields} } }`,
            { id },
        );
        return result.cancelQueuedImageGeneration;
    }

    async deleteMyGeneratedImage(outputId: string): Promise<boolean> {
        const result = await this.request<{ deleteMyGeneratedImage: boolean }>(
            `mutation DeleteMyGeneratedImage($outputId: ID!) { deleteMyGeneratedImage(outputId: $outputId) }`,
            { outputId },
        );
        return result.deleteMyGeneratedImage;
    }

    async deleteMyImageGenerationJob(id: string): Promise<boolean> {
        const result = await this.request<{ deleteMyImageGenerationJob: boolean }>(
            `mutation DeleteMyImageGenerationJob($id: ID!) { deleteMyImageGenerationJob(id: $id) }`,
            { id },
        );
        return result.deleteMyImageGenerationJob;
    }

    async recordStorefrontVisit(): Promise<boolean> {
        const result = await this.request<{ recordStorefrontVisit: { recorded: boolean } }>(
            `
                mutation RecordStorefrontVisit {
                    recordStorefrontVisit { recorded }
                }
            `,
        );
        return result.recordStorefrontVisit.recorded;
    }

    async refreshCustomerVerification(emailAddress: string): Promise<void> {
        const result = await this.request<{ refreshCustomerVerification: ErrorResult }>(
            `
                mutation RefreshStorefrontCustomerVerification($emailAddress: String!) {
                    refreshCustomerVerification(emailAddress: $emailAddress) {
                        __typename
                        ... on Success { success }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { emailAddress },
        );
        this.assertNoError(result.refreshCustomerVerification);
    }

    async verifyCustomerAccount(token: string, password?: string): Promise<void> {
        const result = await this.request<{ verifyCustomerAccount: ErrorResult }>(
            `
                mutation VerifyStorefrontCustomer($token: String!, $password: String) {
                    verifyCustomerAccount(token: $token, password: $password) {
                        __typename
                        ... on CurrentUser { id identifier }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { token, ...(password === undefined ? {} : { password }) },
        );
        this.assertNoError(result.verifyCustomerAccount);
    }

    async requestPasswordReset(emailAddress: string): Promise<void> {
        const result = await this.request<{ requestPasswordReset: ErrorResult | null }>(
            `
                mutation RequestStorefrontPasswordReset($emailAddress: String!) {
                    requestPasswordReset(emailAddress: $emailAddress) {
                        __typename
                        ... on Success { success }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { emailAddress },
        );
        if (result.requestPasswordReset) {
            this.assertNoError(result.requestPasswordReset);
        }
    }

    async resetPassword(token: string, password: string): Promise<void> {
        const result = await this.request<{ resetPassword: ErrorResult }>(
            `
                mutation ResetStorefrontPassword($token: String!, $password: String!) {
                    resetPassword(token: $token, password: $password) {
                        __typename
                        ... on CurrentUser { id identifier }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { token, password },
        );
        this.assertNoError(result.resetPassword);
    }

    async logout(): Promise<void> {
        await this.request<{ logout: { success: boolean } }>(`
            mutation StorefrontLogout { logout { success } }
        `);
        this.clearAuthToken();
    }

    async createAddress(input: CustomerAddressInput): Promise<CustomerAddress> {
        const result = await this.request<{ createCustomerAddress: CustomerAddress }>(
            `
                mutation CreateStorefrontAddress($input: CreateAddressInput!) {
                    createCustomerAddress(input: $input) {
                        id
                        fullName
                        phoneNumber
                        streetLine1
                        streetLine2
                        city
                        province
                        postalCode
                        defaultShippingAddress
                        defaultBillingAddress
                        country { code name }
                    }
                }
            `,
            { input },
        );
        return result.createCustomerAddress;
    }

    async updateAddress(input: CustomerAddressUpdateInput): Promise<CustomerAddress> {
        const result = await this.request<{ updateCustomerAddress: CustomerAddress }>(
            `
                mutation UpdateStorefrontAddress($input: UpdateAddressInput!) {
                    updateCustomerAddress(input: $input) {
                        id
                        fullName
                        phoneNumber
                        streetLine1
                        streetLine2
                        city
                        province
                        postalCode
                        defaultShippingAddress
                        defaultBillingAddress
                        country { code name }
                    }
                }
            `,
            { input },
        );
        return result.updateCustomerAddress;
    }

    async deleteAddress(id: string): Promise<void> {
        await this.request<{ deleteCustomerAddress: { success: boolean } }>(
            `mutation DeleteStorefrontAddress($id: ID!) { deleteCustomerAddress(id: $id) { success } }`,
            { id },
        );
    }

    async cart(signal?: AbortSignal): Promise<StorefrontCart> {
        const result = await this.request<{ storefrontCart: StorefrontCart }>(
            `
            query StorefrontCart {
                storefrontCart { ${cartFields} }
            }
        `,
            undefined,
            signal,
        );
        return result.storefrontCart;
    }

    async addItem(productVariantId: string, expectedRevision: number, quantity = 1): Promise<StorefrontCart> {
        const result = await this.request<{ addStorefrontCartItem: StorefrontCart & ErrorResult }>(
            `
                mutation AddStorefrontCartItem(
                    $productVariantId: ID!
                    $quantity: Int!
                    $expectedRevision: Int!
                ) {
                    addStorefrontCartItem(
                        input: { productVariantId: $productVariantId, quantity: $quantity }
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { productVariantId, quantity, expectedRevision },
        );
        return this.assertCart(result.addStorefrontCartItem);
    }

    async setLineQuantity(
        lineId: string,
        quantity: number,
        expectedRevision: number,
    ): Promise<StorefrontCart> {
        const result = await this.request<{
            setStorefrontCartLineQuantity: StorefrontCart & ErrorResult;
        }>(
            `
                mutation SetStorefrontCartLineQuantity(
                    $lineId: ID!
                    $quantity: Int!
                    $expectedRevision: Int!
                ) {
                    setStorefrontCartLineQuantity(
                        lineId: $lineId
                        quantity: $quantity
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { lineId, quantity, expectedRevision },
        );
        return this.assertCart(result.setStorefrontCartLineQuantity);
    }

    async removeLines(lineIds: string[], expectedRevision: number): Promise<StorefrontCart> {
        const result = await this.request<{ removeStorefrontCartLines: StorefrontCart & ErrorResult }>(
            `
                mutation RemoveStorefrontCartLines($lineIds: [ID!]!, $expectedRevision: Int!) {
                    removeStorefrontCartLines(
                        lineIds: $lineIds
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { lineIds, expectedRevision },
        );
        return this.assertCart(result.removeStorefrontCartLines);
    }

    async setLinesSelected(
        lineIds: string[],
        selected: boolean,
        expectedRevision: number,
    ): Promise<StorefrontCart> {
        const result = await this.request<{
            setStorefrontCartLinesSelected: StorefrontCart & ErrorResult;
        }>(
            `
                mutation SetStorefrontCartLinesSelected(
                    $lineIds: [ID!]!
                    $selected: Boolean!
                    $expectedRevision: Int!
                ) {
                    setStorefrontCartLinesSelected(
                        lineIds: $lineIds
                        selected: $selected
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { lineIds, selected, expectedRevision },
        );
        return this.assertCart(result.setStorefrontCartLinesSelected);
    }

    async setAllLinesSelected(selected: boolean, expectedRevision: number): Promise<StorefrontCart> {
        const result = await this.request<{
            setAllStorefrontCartLinesSelected: StorefrontCart & ErrorResult;
        }>(
            `
                mutation SetAllStorefrontCartLinesSelected(
                    $selected: Boolean!
                    $expectedRevision: Int!
                ) {
                    setAllStorefrontCartLinesSelected(
                        selected: $selected
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { selected, expectedRevision },
        );
        return this.assertCart(result.setAllStorefrontCartLinesSelected);
    }

    async beginCheckout(expectedRevision: number): Promise<StorefrontCheckoutSession> {
        const result = await this.request<{
            beginStorefrontCheckout: StorefrontCheckoutSession & ErrorResult;
        }>(
            `
                mutation BeginStorefrontCheckout($expectedRevision: Int!) {
                    beginStorefrontCheckout(expectedRevision: $expectedRevision) {
                        ${checkoutResultFields}
                    }
                }
            `,
            { expectedRevision },
        );
        return this.assertCheckoutSession(result.beginStorefrontCheckout);
    }

    async preparePayment(expectedRevision: number): Promise<StorefrontCheckoutSession> {
        const result = await this.request<{
            prepareStorefrontCartPayment: StorefrontCheckoutSession & ErrorResult;
        }>(
            `
                mutation PrepareStorefrontCartPayment($expectedRevision: Int!) {
                    prepareStorefrontCartPayment(expectedRevision: $expectedRevision) {
                        ${checkoutResultFields}
                    }
                }
            `,
            { expectedRevision },
        );
        return this.assertCheckoutSession(result.prepareStorefrontCartPayment);
    }

    async reopenCart(expectedRevision: number): Promise<StorefrontCart> {
        const result = await this.request<{ reopenStorefrontCart: StorefrontCart & ErrorResult }>(
            `
                mutation ReopenStorefrontCart($expectedRevision: Int!) {
                    reopenStorefrontCart(expectedRevision: $expectedRevision) {
                        ${cartResultFields}
                    }
                }
            `,
            { expectedRevision },
        );
        return this.assertCart(result.reopenStorefrontCart);
    }

    async myCoupons(signal?: AbortSignal): Promise<StoreCustomerCoupon[]> {
        const result = await this.request<{ myStorefrontCoupons: StoreCustomerCoupon[] }>(
            `
                query MyStorefrontCoupons {
                    myStorefrontCoupons { ${customerCouponFields} }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontCoupons;
    }

    async myCouponUsageRecords(signal?: AbortSignal): Promise<StoreCouponUsageRecord[]> {
        const result = await this.request<{
            myStorefrontCouponUsageRecords: StoreCouponUsageRecord[];
        }>(
            `
                query MyStorefrontCouponUsageRecords {
                    myStorefrontCouponUsageRecords {
                        id
                        customerCouponId
                        campaignId
                        campaignName
                        campaignKind
                        status
                        currencyCode
                        minimumSpend
                        discountAmount
                        discountRate
                        savedAmount
                        usedAt
                        refundedAt
                        orderId
                        orderCode
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontCouponUsageRecords;
    }

    async claimCoupon(campaignId: string): Promise<StoreCustomerCoupon> {
        const result = await this.request<{ claimStorefrontCoupon: StoreCustomerCoupon }>(
            `
                mutation ClaimStorefrontCoupon($campaignId: ID!) {
                    claimStorefrontCoupon(campaignId: $campaignId) { ${customerCouponFields} }
                }
            `,
            { campaignId },
        );
        return result.claimStorefrontCoupon;
    }

    async applyCustomerCoupon(id: string): Promise<StoreCustomerCoupon> {
        const result = await this.request<{ applyStorefrontCoupon: StoreCustomerCoupon }>(
            `
                mutation ApplyOwnedStorefrontCoupon($id: ID!) {
                    applyStorefrontCoupon(id: $id) { ${customerCouponFields} }
                }
            `,
            { id },
        );
        return result.applyStorefrontCoupon;
    }

    async removeCustomerCoupon(id: string): Promise<StoreCustomerCoupon> {
        const result = await this.request<{ removeStorefrontCoupon: StoreCustomerCoupon }>(
            `
                mutation RemoveOwnedStorefrontCoupon($id: ID!) {
                    removeStorefrontCoupon(id: $id) { ${customerCouponFields} }
                }
            `,
            { id },
        );
        return result.removeStorefrontCoupon;
    }

    async applyCouponCode(couponCode: string): Promise<Order> {
        const result = await this.request<{ applyCouponCode: Order & ErrorResult }>(
            `
                mutation ApplyStorefrontCoupon($couponCode: String!) {
                    applyCouponCode(couponCode: $couponCode) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { couponCode },
        );
        return this.assertOrder(result.applyCouponCode);
    }

    async removeCouponCode(couponCode: string): Promise<Order> {
        const result = await this.request<{ removeCouponCode: Order | null }>(
            `
                mutation RemoveStorefrontCoupon($couponCode: String!) {
                    removeCouponCode(couponCode: $couponCode) { ${orderFields} }
                }
            `,
            { couponCode },
        );
        if (!result.removeCouponCode) {
            throw new Error('The coupon could not be removed from the active order.');
        }
        return result.removeCouponCode;
    }

    async setOrderNote(customerNote: string): Promise<Order> {
        const result = await this.request<{ setOrderCustomFields: Order & ErrorResult }>(
            `
                mutation SetStorefrontOrderNote($input: UpdateOrderInput!) {
                    setOrderCustomFields(input: $input) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input: { customFields: { customerNote } } },
        );
        return this.assertOrder(result.setOrderCustomFields);
    }

    async setDeliveryEmail(deliveryEmail: string): Promise<Order> {
        const result = await this.request<{ setOrderCustomFields: Order & ErrorResult }>(
            `
                mutation SetStorefrontDeliveryEmail($input: UpdateOrderInput!) {
                    setOrderCustomFields(input: $input) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input: { customFields: { deliveryEmail } } },
        );
        return this.assertOrder(result.setOrderCustomFields);
    }

    async setCustomer(input: Record<string, string>): Promise<void> {
        const result = await this.request<{ setCustomerForOrder: ErrorResult }>(
            `
                mutation SetCustomer($input: CreateCustomerInput!) {
                    setCustomerForOrder(input: $input) {
                        ... on Order { id }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input },
        );
        this.assertNoError(result.setCustomerForOrder);
    }

    async setShippingAddress(input: CustomerAddressInput): Promise<Order> {
        const result = await this.request<{ setOrderShippingAddress: Order & ErrorResult }>(
            `
                mutation SetShippingAddress($input: CreateAddressInput!) {
                    setOrderShippingAddress(input: $input) {
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input },
        );
        return this.assertOrder(result.setOrderShippingAddress);
    }

    async eligibleShippingMethods(): Promise<ShippingMethod[]> {
        const result = await this.request<{ eligibleShippingMethods: ShippingMethod[] }>(`
            query EligibleShippingMethods {
                eligibleShippingMethods { id code name description priceWithTax metadata }
            }
        `);
        return result.eligibleShippingMethods;
    }

    async setShippingMethod(id: string): Promise<Order> {
        const result = await this.request<{ setOrderShippingMethod: Order & ErrorResult }>(
            `
                mutation SetShippingMethod($id: [ID!]!) {
                    setOrderShippingMethod(shippingMethodId: $id) {
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { id: [id] },
        );
        return this.assertOrder(result.setOrderShippingMethod);
    }

    async setCurrencyForOrder(currencyCode: string): Promise<Order> {
        const result = await this.request<{ setCurrencyCodeForOrder: Order & ErrorResult }>(
            `
                mutation SetStorefrontOrderCurrency($currencyCode: CurrencyCode!) {
                    setCurrencyCodeForOrder(currencyCode: $currencyCode) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { currencyCode },
        );
        return this.assertOrder(result.setCurrencyCodeForOrder);
    }

    async eligiblePaymentMethods(signal?: AbortSignal): Promise<PaymentMethod[]> {
        const result = await this.request<{ eligiblePaymentMethods: PaymentMethod[] }>(
            `
            query EligibleStorefrontPaymentMethods {
                eligiblePaymentMethods {
                    id
                    code
                    name
                    description
                    isEligible
                    eligibilityMessage
                }
            }
        `,
            undefined,
            signal,
        );
        return result.eligiblePaymentMethods.filter(
            method => method.code !== 'referral-balance' && method.code !== 'referral-balance-payment',
        );
    }

    async createUsdtCheckoutQuote(signal?: AbortSignal): Promise<StorefrontUsdtCheckoutQuote> {
        const result = await this.request<{
            createStorefrontUsdtCheckoutQuote: StorefrontUsdtCheckoutQuote;
        }>(
            `
                mutation CreateStorefrontUsdtCheckoutQuote {
                    createStorefrontUsdtCheckoutQuote {
                        id
                        fiatCurrencyCode
                        fiatAmount
                        fiatPerUsdtRate
                        markupPercent
                        usdtAmount
                        source
                        network
                        tokenContractAddress
                        receivingAddress
                        receivingAddressFingerprint
                        paymentStatus
                        transactionId
                        settledAt
                        createdAt
                        expiresAt
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.createStorefrontUsdtCheckoutQuote;
    }

    async addPaymentToOrder(method: string, metadata: Record<string, unknown> = {}): Promise<Order> {
        const result = await this.request<{ addPaymentToOrder: Order & ErrorResult }>(
            `
                mutation AddStorefrontPayment($input: PaymentInput!) {
                    addPaymentToOrder(input: $input) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input: { method, metadata } },
        );
        return this.assertOrder(result.addPaymentToOrder);
    }

    private async request<T>(
        query: string,
        variables?: Record<string, unknown>,
        signal?: AbortSignal,
    ): Promise<T> {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'language-code': this.languageCode,
        };
        if (SEND_CLIENT_CHANNEL_TOKEN) {
            headers['vendure-token'] = this.market.code;
        }
        if (this.authToken) {
            headers.authorization = `Bearer ${this.authToken}`;
        }
        const languageSeparator = API_URL.includes('?') ? '&' : '?';
        const requestUrl =
            `${API_URL}${languageSeparator}languageCode=${encodeURIComponent(this.languageCode)}` +
            `&currencyCode=${encodeURIComponent(this.market.currencyCode)}`;
        const response = await fetch(requestUrl, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ query, variables }),
            signal,
        });
        this.captureAuthToken(response);
        const rawBody = await response.text();
        let body: GraphQlResponse<T>;
        try {
            body = JSON.parse(rawBody) as GraphQlResponse<T>;
        } catch {
            throw new Error(
                rawBody.trim()
                    ? `Shop API returned an invalid response (${response.status})`
                    : `Shop API did not respond (${response.status})`,
            );
        }
        if (!response.ok || body.errors?.length || !body.data) {
            throw new Error(body.errors?.[0]?.message ?? `Shop API request failed (${response.status})`);
        }
        return body.data;
    }

    private captureAuthToken(response: Response): void {
        const authToken = response.headers.get(AUTH_TOKEN_HEADER)?.trim();
        if (!authToken) return;
        this.authToken = authToken;
        if (!this.authTokenStorageKey) return;
        try {
            sessionStorage.setItem(this.authTokenStorageKey, authToken);
        } catch {
            // The in-memory token still preserves the session for this page lifetime.
        }
    }

    private clearAuthToken(): void {
        this.authToken = null;
        if (!this.authTokenStorageKey) return;
        try {
            sessionStorage.removeItem(this.authTokenStorageKey);
        } catch {
            // Storage can be unavailable in privacy-restricted browser contexts.
        }
    }

    private assertCart(result: StorefrontCart & ErrorResult): StorefrontCart {
        this.assertNoError(result);
        return result;
    }

    private assertCheckoutSession(
        result: StorefrontCheckoutSession & ErrorResult,
    ): StorefrontCheckoutSession {
        this.assertNoError(result);
        return result;
    }

    private assertOrder(result: Order & ErrorResult): Order {
        this.assertNoError(result);
        return result;
    }

    private assertNoError(result: ErrorResult): void {
        if (result.errorCode) {
            throw new ShopApiError(
                result.errorCode,
                result.message ?? result.errorCode,
                result.authenticationError,
            );
        }
    }
}
