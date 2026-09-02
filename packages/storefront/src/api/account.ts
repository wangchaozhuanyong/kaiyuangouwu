import type {
    ActiveCustomer,
    Asset,
    CustomerAddress,
    CustomerAddressInput,
    CustomerAddressUpdateInput,
    CustomerOrderCounts,
    Order,
    OrderConfirmationToken,
    OrderPage,
} from '../types';

import { BaseDomainApi } from './base-domain-api';
import { orderFields, orderSummaryFields } from './fragments';
import {
    API_URL,
    ErrorResult,
    GraphQlResponse,
    SEND_CLIENT_CHANNEL_TOKEN,
    ShopApiTimeoutError,
    createRequestSignal,
} from './helpers';

export class AccountApi extends BaseDomainApi {
    async activeCustomer(signal?: AbortSignal): Promise<ActiveCustomer | null> {
        const result = await this.request<{
            activeCustomer: Omit<ActiveCustomer, 'avatar'> | null;
            myCustomerAvatar?: Asset | null;
        }>(
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
                myCustomerAvatar { id preview }
            }
        `,
            undefined,
            signal,
        );
        return result.activeCustomer
            ? { ...result.activeCustomer, avatar: result.myCustomerAvatar ?? null }
            : null;
    }

    async uploadCustomerAvatar(file: File): Promise<Asset> {
        const operations = {
            query: `mutation SetCustomerAvatar($file: Upload!) {
                setCustomerAvatar(file: $file) { id preview }
            }`,
            variables: { file: null },
        };
        const form = new FormData();
        form.set('operations', JSON.stringify(operations));
        form.set('map', JSON.stringify({ 0: ['variables.file'] }));
        form.set('0', file, file.name);
        const headers: Record<string, string> = { 'language-code': this.languageCode };
        if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
        if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
        const separator = API_URL.includes('?') ? '&' : '?';
        const timeout = createRequestSignal(undefined, 60_000);
        let response: Response;
        let body: GraphQlResponse<{ setCustomerAvatar: Asset }>;
        try {
            response = await fetch(
                `${API_URL}${separator}languageCode=${encodeURIComponent(this.languageCode)}&currencyCode=${encodeURIComponent(this.market.currencyCode)}`,
                { method: 'POST', credentials: 'include', headers, body: form, signal: timeout.signal },
            );
            this.captureAuthToken(response);
            body = (await response.json()) as GraphQlResponse<{ setCustomerAvatar: Asset }>;
        } catch (error) {
            if (timeout.didTimeout()) throw new ShopApiTimeoutError('头像上传超时，请检查网络后重试');
            throw error;
        } finally {
            timeout.cleanup();
        }
        if (!response.ok || body.errors?.length || !body.data) {
            throw new Error(body.errors?.[0]?.message ?? `Avatar upload failed (${response.status})`);
        }
        return body.data.setCustomerAvatar;
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
}
