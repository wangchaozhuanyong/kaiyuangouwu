import {
    ActiveCustomer,
    CollectionSummary,
    CustomerAddress,
    MarketConfig,
    Order,
    Product,
    ShippingMethod,
    StorefrontCart,
    StorefrontCheckoutSession,
    VendureLanguageCode,
} from './types';

const API_URL = import.meta.env.VITE_SHOP_API_URL ?? '/shop-api';
const SEND_CLIENT_CHANNEL_TOKEN =
    import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING === 'true' ||
    (import.meta.env.DEV && import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING !== 'false');

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
    constructor(
        private readonly market: MarketConfig,
        private readonly languageCode: VendureLanguageCode = market.defaultLanguageCode,
    ) {}

    async products(): Promise<Product[]> {
        const result = await this.request<{ products: { items: Product[] } }>(`
            query StorefrontProducts {
                products(options: { take: 100, sort: { name: ASC } }) {
                    items {
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
                    }
                }
            }
        `);
        return result.products.items;
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
                    orders(options: { take: 30, sort: { orderPlacedAt: DESC } }) {
                        totalItems
                        items { ${orderFields} }
                    }
                }
            }
        `);
        return result.activeCustomer;
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

    async logout(): Promise<void> {
        await this.request<{ logout: { success: boolean } }>(`
            mutation StorefrontLogout { logout { success } }
        `);
    }

    async createAddress(input: Record<string, unknown>): Promise<CustomerAddress> {
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

    async addItem(
        productVariantId: string,
        expectedRevision: number,
    ): Promise<StorefrontCart> {
        const result = await this.request<{ addStorefrontCartItem: StorefrontCart & ErrorResult }>(
            `
                mutation AddStorefrontCartItem($productVariantId: ID!, $expectedRevision: Int!) {
                    addStorefrontCartItem(
                        input: { productVariantId: $productVariantId, quantity: 1 }
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { productVariantId, expectedRevision },
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

    async setAllLinesSelected(
        selected: boolean,
        expectedRevision: number,
    ): Promise<StorefrontCart> {
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

    async setShippingAddress(input: Record<string, string>): Promise<void> {
        const result = await this.request<{ setOrderShippingAddress: ErrorResult }>(
            `
                mutation SetShippingAddress($input: CreateAddressInput!) {
                    setOrderShippingAddress(input: $input) {
                        ... on Order { id }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input },
        );
        this.assertNoError(result.setOrderShippingAddress);
    }

    async eligibleShippingMethods(): Promise<ShippingMethod[]> {
        const result = await this.request<{ eligibleShippingMethods: ShippingMethod[] }>(`
            query EligibleShippingMethods {
                eligibleShippingMethods { id code name description priceWithTax }
            }
        `);
        return result.eligibleShippingMethods;
    }

    async setShippingMethod(id: string): Promise<void> {
        const result = await this.request<{ setOrderShippingMethod: ErrorResult }>(
            `
                mutation SetShippingMethod($id: [ID!]!) {
                    setOrderShippingMethod(shippingMethodId: $id) {
                        ... on Order { id }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { id: [id] },
        );
        this.assertNoError(result.setOrderShippingMethod);
    }

    private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'language-code': this.languageCode,
        };
        if (SEND_CLIENT_CHANNEL_TOKEN) {
            headers['vendure-token'] = this.market.code;
        }
        const response = await fetch(API_URL, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ query, variables }),
        });
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

    private assertNoError(result: ErrorResult): void {
        if (result.errorCode) {
            throw new ShopApiError(result.errorCode, result.message ?? result.errorCode);
        }
    }
}
