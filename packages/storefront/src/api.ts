import {
    ActiveCustomer,
    CollectionSummary,
    CustomerAddress,
    CustomerAddressInput,
    CustomerAddressUpdateInput,
    CustomerOrderCounts,
    MarketConfig,
    Order,
    OrderPage,
    Product,
    ProductSearchPage,
    ProductSearchSort,
    RegisterCustomerInput,
    ShippingMethod,
    StorefrontCart,
    StorefrontCheckoutSession,
    StorefrontConfig,
    StorefrontContentBlock,
    VendureLanguageCode,
} from './types';

const API_URL = import.meta.env.VITE_SHOP_API_URL ?? '/shop-api';
const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const AUTH_TOKEN_STORAGE_PREFIX = 'vendure-shop-auth-token';
const SEND_CLIENT_CHANNEL_TOKEN =
    import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING === 'true' ||
    (import.meta.env.DEV && import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING !== 'false');

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
        stockLevel
        featuredAsset { id preview }
        product { featuredAsset { id preview } }
        customFields { fulfillmentType }
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
    discounts { description amountWithTax }
    couponCodes
    customFields { customerNote }
    fulfillments {
        id
        state
        method
        trackingCode
        createdAt
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
            stockLevel
            featuredAsset { id preview }
            product { featuredAsset { id preview } }
            customFields { fulfillmentType }
        }
        customFields { fulfillmentTypeSnapshot }
    }
    checkoutFulfillment {
        fulfillmentType
        containsPhysicalProducts
        containsDigitalProducts
        requiresShippingAddress
        requiresShippingMethod
    }
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
            stockLevel
            featuredAsset { id preview }
            product { featuredAsset { id preview } }
            customFields { fulfillmentType }
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
    ) {
        super(message);
        this.name = 'ShopApiError';
    }
}

export class ShopApi {
    private readonly authTokenStorageKey: string | null;
    private authToken: string | null;

    constructor(
        private readonly market: MarketConfig,
        private readonly languageCode: VendureLanguageCode = market.defaultLanguageCode,
    ) {
        this.authTokenStorageKey = authTokenStorageKey(market.code);
        this.authToken = readSessionAuthToken(this.authTokenStorageKey);
    }

    async storefrontConfig(): Promise<StorefrontConfig> {
        const result = await this.request<{ activeChannel: StorefrontConfig }>(`
            query StorefrontConfig {
                activeChannel {
                    code
                    customFields {
                        storefrontNameZh
                        storefrontNameEn
                    }
                }
            }
        `);
        return result.activeChannel;
    }

    async storefrontContent(): Promise<StorefrontContentBlock[]> {
        const result = await this.request<{ storefrontContent: StorefrontContentBlock[] }>(`
            query StorefrontContent {
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
        `);
        return result.storefrontContent;
    }

    async products(): Promise<Product[]> {
        const result = await this.request<{ products: { items: Product[] } }>(`
            query StorefrontProducts {
                products(options: { take: 100, sort: { name: ASC } }) {
                    items { ${productFields} }
                }
            }
        `);
        return result.products.items;
    }

    async product(id: string): Promise<Product | null> {
        const result = await this.request<{ product: Product | null }>(
            `
                query StorefrontProduct($id: ID!) {
                    product(id: $id) { ${productFields} }
                }
            `,
            { id },
        );
        return result.product;
    }

    async productsByIds(ids: string[]): Promise<Product[]> {
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
    ): Promise<ProductSearchPage> {
        const searchSort =
            sort === 'name'
                ? { name: 'ASC' }
                : sort === 'price-asc'
                  ? { price: 'ASC' }
                  : sort === 'price-desc'
                    ? { price: 'DESC' }
                    : null;
        const searchResult = await this.request<{
            search: { totalItems: number; items: Array<{ productId: string }> };
        }>(
            `
                query StorefrontSearch($input: SearchInput!) {
                    search(input: $input) {
                        totalItems
                        items { productId }
                    }
                }
            `,
            {
                input: {
                    ...(term ? { term } : {}),
                    ...(collectionId ? { collectionId } : {}),
                    groupByProduct: true,
                    skip,
                    take,
                    sort: searchSort,
                },
            },
        );
        const productIds = [...new Set(searchResult.search.items.map(item => item.productId))];
        if (!productIds.length) {
            return { items: [], totalItems: searchResult.search.totalItems };
        }
        const productResult = await this.request<{ products: { items: Product[] } }>(
            `
                query StorefrontSearchProducts($options: ProductListOptions) {
                    products(options: $options) {
                        items { ${productFields} }
                    }
                }
            `,
            {
                options: {
                    take: productIds.length,
                    filter: { id: { in: productIds } },
                },
            },
        );
        const productsById = new Map(productResult.products.items.map(product => [product.id, product]));
        return {
            items: productIds.flatMap(productId => {
                const product = productsById.get(productId);
                return product ? [product] : [];
            }),
            totalItems: searchResult.search.totalItems,
        };
    }

    async searchAllProducts(
        term: string,
        sort: ProductSearchSort = 'recommended',
        collectionId?: string,
    ): Promise<Product[]> {
        const pageSize = 100;
        const productsById = new Map<string, Product>();
        let totalItems = 0;

        do {
            const skip = productsById.size;
            const page = await this.searchProducts(term, sort, skip, pageSize, collectionId);
            totalItems = page.totalItems;
            const previousSize = productsById.size;
            for (const product of page.items) {
                productsById.set(product.id, product);
            }
            if (!page.items.length || productsById.size === previousSize) break;
        } while (productsById.size < totalItems);

        return [...productsById.values()];
    }

    async collections(): Promise<CollectionSummary[]> {
        const result = await this.request<{ collections: { items: CollectionSummary[] } }>(`
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
        `);
        return result.collections.items;
    }

    async activeCustomer(): Promise<ActiveCustomer | null> {
        const result = await this.request<{ activeCustomer: ActiveCustomer | null }>(`
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
                        items { ${orderFields} }
                    }
                }
            }
        `);
        return result.activeCustomer;
    }

    async customerOrders(skip = 0, take = 10, states?: string[], code?: string): Promise<OrderPage> {
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
                            items { ${orderFields} }
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
        );
        return result.activeCustomer?.orders ?? { items: [], totalItems: 0 };
    }

    async customerOrderCounts(): Promise<CustomerOrderCounts> {
        const result = await this.request<{
            activeCustomer: {
                pending: { totalItems: number };
                shipping: { totalItems: number };
                receiving: { totalItems: number };
            } | null;
        }>(`
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
        `);
        return {
            pending: result.activeCustomer?.pending.totalItems ?? 0,
            shipping: result.activeCustomer?.shipping.totalItems ?? 0,
            receiving: result.activeCustomer?.receiving.totalItems ?? 0,
        };
    }

    async order(id: string): Promise<Order | null> {
        const result = await this.request<{ order: Order | null }>(
            `
                query StorefrontOrder($id: ID!) {
                    order(id: $id) { ${orderFields} }
                }
            `,
            { id },
        );
        return result.order;
    }

    async login(emailAddress: string, password: string): Promise<void> {
        const result = await this.request<{ login: ErrorResult }>(
            `
                mutation StorefrontLogin($emailAddress: String!, $password: String!) {
                    login(username: $emailAddress, password: $password, rememberMe: true) {
                        __typename
                        ... on CurrentUser { id identifier }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { emailAddress, password },
        );
        this.assertNoError(result.login);
    }

    async registerCustomerAccount(input: RegisterCustomerInput): Promise<void> {
        const result = await this.request<{ registerCustomerAccount: ErrorResult }>(
            `
                mutation RegisterStorefrontCustomer($input: RegisterCustomerInput!) {
                    registerCustomerAccount(input: $input) {
                        __typename
                        ... on Success { success }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input },
        );
        this.assertNoError(result.registerCustomerAccount);
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

    async verifyCustomerAccount(token: string): Promise<void> {
        const result = await this.request<{ verifyCustomerAccount: ErrorResult }>(
            `
                mutation VerifyStorefrontCustomer($token: String!) {
                    verifyCustomerAccount(token: $token) {
                        __typename
                        ... on CurrentUser { id identifier }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { token },
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

    async cart(): Promise<StorefrontCart> {
        const result = await this.request<{ storefrontCart: StorefrontCart }>(`
            query StorefrontCart {
                storefrontCart { ${cartFields} }
            }
        `);
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
                eligibleShippingMethods { id code name description priceWithTax }
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

    private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
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
        const requestUrl = `${API_URL}${languageSeparator}languageCode=${encodeURIComponent(this.languageCode)}`;
        const response = await fetch(requestUrl, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ query, variables }),
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
            throw new ShopApiError(result.errorCode, result.message ?? result.errorCode);
        }
    }
}
