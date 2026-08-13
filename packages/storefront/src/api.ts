import { MarketConfig, Order, Product, ShippingMethod } from './types';

const API_URL = import.meta.env.VITE_SHOP_API_URL ?? '/shop-api';
const SEND_CLIENT_CHANNEL_TOKEN =
    import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING === 'true' ||
    (import.meta.env.DEV && import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING !== 'false');

const orderFields = `
    id
    code
    state
    totalQuantity
    subTotalWithTax
    shippingWithTax
    totalWithTax
    currencyCode
    customer { id emailAddress }
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

interface GraphQlResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}

interface ErrorResult {
    errorCode?: string;
    message?: string;
}

export class ShopApi {
    constructor(private readonly market: MarketConfig) {}

    async products(): Promise<Product[]> {
        const result = await this.request<{ products: { items: Product[] } }>(`
            query StorefrontProducts {
                products(options: { take: 100, sort: { name: ASC } }) {
                    items {
                        id
                        name
                        slug
                        description
                        featuredAsset { id preview }
                        variants {
                            id
                            name
                            sku
                            priceWithTax
                            currencyCode
                            stockLevel
                            customFields { fulfillmentType }
                        }
                    }
                }
            }
        `);
        return result.products.items;
    }

    async activeOrder(): Promise<Order | null> {
        const result = await this.request<{ activeOrder: Order | null }>(`
            query ActiveOrder {
                activeOrder { ${orderFields} }
            }
        `);
        return result.activeOrder;
    }

    async addItem(productVariantId: string): Promise<Order> {
        const result = await this.request<{ addItemToOrder: Order & ErrorResult }>(
            `
                mutation AddItem($productVariantId: ID!) {
                    addItemToOrder(productVariantId: $productVariantId, quantity: 1) {
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { productVariantId },
        );
        return this.assertOrder(result.addItemToOrder);
    }

    async adjustLine(orderLineId: string, quantity: number): Promise<Order> {
        const result = await this.request<{ adjustOrderLine: Order & ErrorResult }>(
            `
                mutation AdjustLine($orderLineId: ID!, $quantity: Int!) {
                    adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity) {
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { orderLineId, quantity },
        );
        return this.assertOrder(result.adjustOrderLine);
    }

    async removeLine(orderLineId: string): Promise<Order> {
        const result = await this.request<{ removeOrderLine: Order & ErrorResult }>(
            `
                mutation RemoveLine($orderLineId: ID!) {
                    removeOrderLine(orderLineId: $orderLineId) {
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { orderLineId },
        );
        return this.assertOrder(result.removeOrderLine);
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

    async transitionToPayment(): Promise<Order> {
        const result = await this.request<{ transitionOrderToState: Order & ErrorResult }>(`
            mutation TransitionToPayment {
                transitionOrderToState(state: "ArrangingPayment") {
                    ... on Order { ${orderFields} }
                    ... on OrderStateTransitionError { errorCode message transitionError }
                }
            }
        `);
        return this.assertOrder(result.transitionOrderToState);
    }

    private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'language-code': this.market.languageCode,
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
        const body = (await response.json()) as GraphQlResponse<T>;
        if (!response.ok || body.errors?.length || !body.data) {
            throw new Error(body.errors?.[0]?.message ?? `Shop API request failed (${response.status})`);
        }
        return body.data;
    }

    private assertOrder(result: Order & ErrorResult): Order {
        this.assertNoError(result);
        return result;
    }

    private assertNoError(result: ErrorResult): void {
        if (result.errorCode) {
            throw new Error(result.message ?? result.errorCode);
        }
    }
}
