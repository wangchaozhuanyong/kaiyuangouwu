import type {
    ActiveCustomer,
    Asset,
    CustomerAddress,
    CustomerAddressInput,
    CustomerAddressUpdateInput,
    CustomerAvatarHistoryEntry,
    CustomerOrderCounts,
    DataSubjectExportPayload,
    DataSubjectRequest,
    FraudRiskAppeal,
    FraudRiskCase,
    FulfillmentDeliveryEvidence,
    Order,
    OrderConfirmationToken,
    OrderPage,
    StorefrontRegistrationConsentInput,
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
        const headers: Record<string, string> = {
            'language-code': this.languageCode,
            'Apollo-Require-Preflight': 'true',
        };
        if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
        if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
        const separator = API_URL.includes('?') ? '&' : '?';
        const timeout = createRequestSignal(undefined, 60_000);
        const captureAuthToken = this.createAuthTokenCapture();
        let response: Response;
        let body: GraphQlResponse<{ setCustomerAvatar: Asset }>;
        try {
            response = await fetch(
                `${API_URL}${separator}languageCode=${encodeURIComponent(this.languageCode)}&currencyCode=${encodeURIComponent(this.market.currencyCode)}`,
                { method: 'POST', credentials: 'include', headers, body: form, signal: timeout.signal },
            );
            captureAuthToken(response);
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

    async customerAvatarHistory(signal?: AbortSignal): Promise<CustomerAvatarHistoryEntry[]> {
        const result = await this.request<{ myCustomerAvatarHistory: CustomerAvatarHistoryEntry[] }>(
            `
                query CustomerAvatarHistory {
                    myCustomerAvatarHistory {
                        id
                        status
                        quarantinedAt
                        purgeAfter
                        legalHold
                        asset { id preview }
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.myCustomerAvatarHistory;
    }

    async restoreCustomerAvatar(retentionId: string): Promise<Asset> {
        const result = await this.request<{ restoreCustomerAvatar: Asset }>(
            `
                mutation RestoreCustomerAvatar($retentionId: ID!) {
                    restoreCustomerAvatar(retentionId: $retentionId) { id preview }
                }
            `,
            { retentionId },
        );
        return result.restoreCustomerAvatar;
    }

    async removeCustomerAvatar(): Promise<boolean> {
        const result = await this.request<{ removeCustomerAvatar: boolean }>(`
            mutation RemoveCustomerAvatar {
                removeCustomerAvatar
            }
        `);
        return result.removeCustomerAvatar;
    }

    async dataSubjectRequests(signal?: AbortSignal): Promise<DataSubjectRequest[]> {
        const result = await this.request<{ myDataSubjectRequests: DataSubjectRequest[] }>(
            `
                query MyDataSubjectRequests {
                    myDataSubjectRequests {
                        id
                        requestType
                        status
                        requestedAt
                        dueAt
                        nextAttemptAt
                        attemptCount
                        blockersJson
                        lastError
                        resultDigest
                        completedAt
                        cancelledAt
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.myDataSubjectRequests;
    }

    async exportPersonalData(password: string): Promise<DataSubjectExportPayload> {
        const result = await this.request<{ exportMyPersonalData: DataSubjectExportPayload }>(
            `
                mutation ExportMyPersonalData($password: String!) {
                    exportMyPersonalData(password: $password) {
                        fileName
                        mimeType
                        content
                        sha256
                        request {
                            id requestType status requestedAt dueAt nextAttemptAt attemptCount
                            blockersJson lastError resultDigest completedAt cancelledAt
                        }
                    }
                }
            `,
            { password },
        );
        return result.exportMyPersonalData;
    }

    async requestAccountClosure(password: string): Promise<DataSubjectRequest> {
        const result = await this.request<{ requestMyAccountClosure: DataSubjectRequest }>(
            `
                mutation RequestMyAccountClosure($password: String!) {
                    requestMyAccountClosure(password: $password) {
                        id requestType status requestedAt dueAt nextAttemptAt attemptCount
                        blockersJson lastError resultDigest completedAt cancelledAt
                    }
                }
            `,
            { password },
        );
        return result.requestMyAccountClosure;
    }

    async cancelAccountClosure(): Promise<DataSubjectRequest> {
        const result = await this.request<{ cancelMyAccountClosure: DataSubjectRequest }>(`
            mutation CancelMyAccountClosure {
                cancelMyAccountClosure {
                    id requestType status requestedAt dueAt nextAttemptAt attemptCount
                    blockersJson lastError resultDigest completedAt cancelledAt
                }
            }
        `);
        return result.cancelMyAccountClosure;
    }

    async fraudRiskCases(signal?: AbortSignal): Promise<FraudRiskCase[]> {
        const result = await this.request<{ myFraudRiskCases: FraudRiskCase[] }>(
            `
                query MyFraudRiskCases {
                    myFraudRiskCases {
                        id createdAt caseCode orderId status severity dueAt decidedAt
                        appeals { id createdAt status reason reviewedAt }
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.myFraudRiskCases;
    }

    async appealFraudRiskCase(id: string, reason: string): Promise<FraudRiskAppeal> {
        const result = await this.request<{ appealMyFraudRiskCase: FraudRiskAppeal }>(
            `
                mutation AppealMyFraudRiskCase($input: AppealFraudRiskCaseInput!) {
                    appealMyFraudRiskCase(input: $input) {
                        id createdAt status reason reviewedAt
                    }
                }
            `,
            { input: { id, reason, idempotencyKey: crypto.randomUUID() } },
        );
        return result.appealMyFraudRiskCase;
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

    async confirmFulfillmentDelivery(fulfillmentId: string): Promise<FulfillmentDeliveryEvidence> {
        const result = await this.request<{
            confirmMyFulfillmentDelivery: FulfillmentDeliveryEvidence;
        }>(
            `
                mutation ConfirmMyFulfillmentDelivery($input: ConfirmFulfillmentDeliveryInput!) {
                    confirmMyFulfillmentDelivery(input: $input) {
                        id status carrier trackingCode exceptionReason proofReference
                        shippedAt deliveredAt nextActionDueAt overdue
                        events { id createdAt status actorType actorLabel note }
                    }
                }
            `,
            { input: { fulfillmentId, idempotencyKey: `customer-delivered-${fulfillmentId}` } },
        );
        return result.confirmMyFulfillmentDelivery;
    }

    async login(emailAddress: string, password: string): Promise<void> {
        const result = await this.authenticationRequest<{ login: ErrorResult }>(
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

    async authenticateWithGoogle(
        credential: string,
        consent: StorefrontRegistrationConsentInput,
    ): Promise<void> {
        const result = await this.request<{ authenticate: ErrorResult }>(
            `
                mutation StorefrontGoogleAuthenticate(
                    $credential: String!
                    $termsAccepted: Boolean!
                    $privacyAcknowledged: Boolean!
                    $locale: String!
                ) {
                    authenticate(
                        input: {
                            google: {
                                credential: $credential
                                termsAccepted: $termsAccepted
                                privacyAcknowledged: $privacyAcknowledged
                                locale: $locale
                            }
                        }
                        rememberMe: true
                    ) {
                        __typename
                        ... on CurrentUser { id identifier }
                        ... on ErrorResult { errorCode message }
                        ... on InvalidCredentialsError { authenticationError }
                    }
                }
            `,
            { credential, ...consent },
        );
        this.assertNoError(result.authenticate);
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
        const result = await this.authenticationRequest<{ verifyCustomerAccount: ErrorResult }>(
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
        const result = await this.authenticationRequest<{ resetPassword: ErrorResult }>(
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
