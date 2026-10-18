import type { DigitalReceiptContent, DigitalReceiptStatus } from '../digital-receipt-panel';
import type { OrderAdditionalPaymentQuote } from '../order-additional-payment-panel';
import type { ShopAbuseProof } from '../shop-abuse';
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
    DataSubjectVerificationChallenge,
    DataSubjectVerificationInput,
    FraudRiskAppeal,
    FraudRiskCase,
    FulfillmentDeliveryEvidence,
    Order,
    OrderConfirmationToken,
    OrderPage,
    StorefrontRegistrationConsentInput,
    StorefrontUsdtCheckoutQuote,
} from '../types';

import { AuthTransition, browserAuthTransition, type ConfirmLogout } from './auth-transition';
import { CustomerIdentityApi } from './customer-identity';
import { orderFields, orderSummaryFields } from './fragments';
import {
    API_URL,
    createRequestSignal,
    ErrorResult,
    SHOP_API_QUERY_TIMEOUT_MS,
    ShopApiTimeoutError,
} from './helpers';
import { sessionTransport } from './session-transport';

export class AccountApi extends CustomerIdentityApi {
    private readonly authTransition =
        typeof window === 'undefined' ? new AuthTransition() : browserAuthTransition;

    protected override authenticationRequest = async <T>(
        ...args: Parameters<CustomerIdentityApi['ctx']['authenticationRequest']>
    ): Promise<T> => {
        const [query, variables, signal, timeoutMs, resultUnknown, proof] = args;
        const deadline = createRequestSignal(signal, timeoutMs);
        try {
            return await this.authTransition.authenticate(
                dispatch =>
                    this.ctx.authenticationRequest<T>(
                        query,
                        variables,
                        deadline.signal,
                        timeoutMs,
                        resultUnknown,
                        proof,
                        dispatch,
                    ),
                this.languageCode === 'zh_Hans'
                    ? '退出状态未确认，请先核对原会话；本页暂不能开始新的登录'
                    : 'Sign-out is unconfirmed. Check the original session before signing in again.',
                deadline.signal,
                true,
            );
        } catch (error) {
            if (deadline.didTimeout())
                throw new ShopApiTimeoutError(
                    resultUnknown
                        ? '请求超时，提交结果暂时无法确认，请勿更改参数后重复提交'
                        : '请求超时，请检查网络后重试',
                    resultUnknown,
                );
            throw error;
        } finally {
            deadline.cleanup();
        }
    };
    async customerAddresses(signal?: AbortSignal): Promise<CustomerAddress[] | null> {
        const result = await this.request<{
            activeCustomer: { addresses: CustomerAddress[] } | null;
        }>(
            `query StorefrontCustomerAddresses {
            activeCustomer { addresses {
                id fullName phoneNumber streetLine1 streetLine2 city province postalCode
                defaultShippingAddress defaultBillingAddress country { code name }
            } }
        }`,
            undefined,
            signal,
        );
        return result.activeCustomer?.addresses ?? null;
    }

    async customerRecentOrders(signal?: AbortSignal): Promise<NonNullable<ActiveCustomer['orders']> | null> {
        const result = await this.request<{
            activeCustomer: { orders: NonNullable<ActiveCustomer['orders']> } | null;
        }>(
            `query StorefrontCustomerRecentOrders {
            activeCustomer { orders(options: { take: 5, sort: { orderPlacedAt: DESC } }) {
                totalItems items { ${orderSummaryFields} }
            } }
        }`,
            undefined,
            signal,
        );
        return result.activeCustomer?.orders ?? null;
    }

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
        const result = await this.upload<{ setCustomerAvatar: Asset }>(
            `mutation SetCustomerAvatar($file: Upload!) { setCustomerAvatar(file: $file) { id preview } }`,
            {},
            file,
            '头像上传超时，请检查网络后重试',
        );
        return result.setCustomerAvatar;
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

    async requestDataSubjectVerification(
        action: 'EXPORT' | 'ACCOUNT_CLOSURE',
    ): Promise<DataSubjectVerificationChallenge> {
        const result = await this.request<{
            requestMyDataSubjectVerification: DataSubjectVerificationChallenge;
        }>(
            `
            mutation RequestMyDataSubjectVerification($action: DataSubjectAction!) {
                requestMyDataSubjectVerification(action: $action) { mode challengeId nonce clientId expiresAt }
            }
        `,
            { action },
        );
        return result.requestMyDataSubjectVerification;
    }

    async exportPersonalData(
        password: string,
        verification?: DataSubjectVerificationInput,
    ): Promise<DataSubjectExportPayload> {
        const result = await this.request<{ exportMyPersonalData: DataSubjectExportPayload }>(
            `
                mutation ExportMyPersonalData($password: String!, $verification: DataSubjectVerificationInput) {
                    exportMyPersonalData(password: $password, verification: $verification) {
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
            { password, ...(verification ? { verification } : {}) },
        );
        return result.exportMyPersonalData;
    }

    async requestAccountClosure(
        password: string,
        verification?: DataSubjectVerificationInput,
    ): Promise<DataSubjectRequest> {
        const result = await this.request<{ requestMyAccountClosure: DataSubjectRequest }>(
            `
                mutation RequestMyAccountClosure($password: String!, $verification: DataSubjectVerificationInput) {
                    requestMyAccountClosure(password: $password, verification: $verification) {
                        id requestType status requestedAt dueAt nextAttemptAt attemptCount
                        blockersJson lastError resultDigest completedAt cancelledAt
                    }
                }
            `,
            { password, ...(verification ? { verification } : {}) },
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
                completed: { totalItems: number };
            } | null;
        }>(
            `
                query StorefrontOrderCounts {
                    activeCustomer {
                        pending: orders(options: {
                            take: 0
                            filter: { state: { eq: "ArrangingPayment" } }
                        }) { totalItems }
                        shipping: orders(options: {
                            take: 0
                            filter: { state: { in: ["PaymentAuthorized", "PaymentSettled"] } }
                        }) { totalItems }
                        receiving: orders(options: {
                            take: 0
                            filter: { state: { in: ["Shipped", "PartiallyShipped"] } }
                        }) { totalItems }
                        completed: orders(options: {
                            take: 0
                            filter: { state: { eq: "Delivered" } }
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
            completed: result.activeCustomer?.completed.totalItems ?? 0,
        };
    }

    async order(id: string, signal?: AbortSignal, readCurrencyCode?: string): Promise<Order | null> {
        const result = await this.request<{ order: Order | null }>(
            `
                query StorefrontOrder($id: ID!) {
                    order(id: $id) { ${orderFields} }
                }
            `,
            { id },
            signal,
            undefined,
            undefined,
            readCurrencyCode,
        );
        return result.order;
    }

    async digitalDeliveryStatuses(orderId: string, confirmationToken?: string, signal?: AbortSignal) {
        const response = await this.request<{ myDigitalDeliveryContents: DigitalReceiptStatus[] }>(
            `
query ($orderId: ID!, $confirmationToken: String) {
  myDigitalDeliveryContents(
    orderId: $orderId
    confirmationToken: $confirmationToken
  ) {
    orderLineId
    mode
    state
    eligibleQuantity
    readyQuantity
    claimedQuantity
    notificationState
  }
}
`,
            { orderId, confirmationToken },
            signal,
        );
        return response.myDigitalDeliveryContents.map(item => ({
            orderLineId: String(item.orderLineId),
            mode: item.mode,
            state: item.state,
            eligibleQuantity: item.eligibleQuantity,
            readyQuantity: item.readyQuantity,
            claimedQuantity: item.claimedQuantity,
            notificationState: item.notificationState,
        }));
    }

    async claimDigitalDelivery(orderId: string, orderLineId: string, confirmationToken?: string) {
        const response = await this.request<{ claimDigitalDelivery: DigitalReceiptContent }>(
            `
mutation ($orderId: ID!, $orderLineId: ID!, $confirmationToken: String) {
  claimDigitalDelivery(
    orderId: $orderId
    orderLineId: $orderLineId
    confirmationToken: $confirmationToken
  ) {
    orderLineId
    mode
    state
    eligibleQuantity
    readyQuantity
    claimedQuantity
    notificationState
    instructions
    downloadUrl
    packages {
      number
      note
      fields {
        label
        value
      }
      attachments {
        name
        downloadUrl
      }
    }
  }
}
`,
            { orderId, orderLineId, confirmationToken },
        );
        return response.claimDigitalDelivery;
    }

    async orderAdditionalPaymentQuote(orderId: string, confirmationToken?: string, signal?: AbortSignal) {
        const response = await this.request<{ orderAdditionalPaymentQuote: OrderAdditionalPaymentQuote }>(
            `
query ($orderId: ID!, $confirmationToken: String) {
  orderAdditionalPaymentQuote(
    orderId: $orderId
    confirmationToken: $confirmationToken
  ) {
    orderId
    state
    outstandingAmount
    blockedReason
    walletAvailableAmount
    usdtPayment {
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
    methods {
      id
      code
      name
      description
      isEligible
      eligibilityMessage
    }
  }
}
`,
            { orderId, confirmationToken },
            signal,
        );
        return response.orderAdditionalPaymentQuote;
    }

    async addPaymentToModifiedOrder(
        orderId: string,
        method: string,
        expectedAmount: number,
        confirmationToken?: string,
    ): Promise<Order> {
        const response = await this.request<{ addPaymentToModifiedOrder: Order & ErrorResult }>(
            `
mutation ($input: OrderAdditionalPaymentInput!) {
  addPaymentToModifiedOrder(input: $input) {
    __typename
    ... on Order {
      ${orderFields}
    }
    ... on ErrorResult {
      errorCode
      message
    }
  }
}
`,
            { input: { orderId, confirmationToken, expectedAmount, payment: { method, metadata: {} } } },
        );
        this.assertNoError(response.addPaymentToModifiedOrder);
        return response.addPaymentToModifiedOrder;
    }

    async createModifiedOrderUsdtQuote(
        orderId: string,
        expectedAmount: number,
        confirmationToken?: string,
    ): Promise<StorefrontUsdtCheckoutQuote> {
        const response = await this.request<{ createModifiedOrderUsdtQuote: StorefrontUsdtCheckoutQuote }>(
            `
mutation ($input: ModifiedOrderUsdtQuoteInput!) {
  createModifiedOrderUsdtQuote(input: $input) {
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
            { input: { orderId, expectedAmount, confirmationToken } },
        );
        return response.createModifiedOrderUsdtQuote;
    }

    async useModifiedOrderReferralBalance(
        orderId: string,
        expectedAmount: number,
        amount: number,
        idempotencyKey: string,
    ): Promise<Order> {
        const response = await this.request<{ useModifiedOrderReferralBalance: Order }>(
            `mutation($input:ModifiedOrderBalanceInput!){useModifiedOrderReferralBalance(input:$input){${orderFields}}}`,
            { input: { orderId, expectedAmount, amount, idempotencyKey } },
        );
        return response.useModifiedOrderReferralBalance;
    }

    async orderByConfirmationToken(
        token: string,
        signal?: AbortSignal,
        readCurrencyCode?: string,
    ): Promise<Order | null> {
        const result = await this.request<{ storefrontOrderByConfirmationToken: Order | null }>(
            `
                query StorefrontOrderByConfirmationToken($token: String!) {
                    storefrontOrderByConfirmationToken(token: $token) { ${orderFields} }
                }
            `,
            { token },
            signal,
            undefined,
            undefined,
            readCurrencyCode,
        );
        return result.storefrontOrderByConfirmationToken;
    }

    async createOrderConfirmationToken(signal?: AbortSignal): Promise<OrderConfirmationToken> {
        const result = await this.request<{
            createStorefrontOrderConfirmationToken: OrderConfirmationToken;
        }>(
            `
            mutation CreateStorefrontOrderConfirmationToken {
                createStorefrontOrderConfirmationToken {
                    token
                    expiresAt
                }
            }
        `,
            undefined,
            signal,
            20_000,
        );
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

    async login(
        emailAddress: string,
        password: string,
        rememberMe = true,
        proof?: ShopAbuseProof,
    ): Promise<void> {
        const result = await this.authenticationRequest<{ login: ErrorResult }>(
            `
                mutation StorefrontLogin($emailAddress: String!, $password: String!, $rememberMe: Boolean!) {
                    login(username: $emailAddress, password: $password, rememberMe: $rememberMe) {
                        __typename
                        ... on CurrentUser { id identifier }
                        ... on ErrorResult { errorCode message }
                        ... on InvalidCredentialsError { authenticationError }
                    }
                }
            `,
            { emailAddress, password, rememberMe },
            undefined,
            undefined,
            undefined,
            proof,
        );
        this.assertNoError(result.login);
    }

    async authenticateWithGoogle(
        credential: string,
        consent: StorefrontRegistrationConsentInput,
        options: {
            rememberMe?: boolean;
            inviteCode?: string;
            referralSource?: string;
            proof?: ShopAbuseProof;
        } = {},
    ): Promise<void> {
        const result = await this.authenticationRequest<{ authenticate: ErrorResult }>(
            `
                mutation StorefrontGoogleAuthenticate(
                    $credential: String!
                    $termsAccepted: Boolean!
                    $privacyAcknowledged: Boolean!
                    $locale: String!
                    $rememberMe: Boolean!
                    $inviteCode: String
                    $referralSource: String
                ) {
                    authenticate(
                        input: {
                            google: {
                                credential: $credential
                                termsAccepted: $termsAccepted
                                privacyAcknowledged: $privacyAcknowledged
                                locale: $locale
                                inviteCode: $inviteCode
                                referralSource: $referralSource
                            }
                        }
                        rememberMe: $rememberMe
                    ) {
                        __typename
                        ... on CurrentUser { id identifier }
                        ... on ErrorResult { errorCode message }
                        ... on InvalidCredentialsError { authenticationError }
                    }
                }
            `,
            {
                credential,
                ...consent,
                rememberMe: options.rememberMe ?? true,
                inviteCode: options.inviteCode,
                referralSource: options.referralSource,
            },
            undefined,
            undefined,
            undefined,
            options.proof,
        );
        this.assertNoError(result.authenticate);
    }

    async refreshCustomerVerification(
        emailAddress: string,
        signal?: AbortSignal,
        proof?: ShopAbuseProof,
    ): Promise<void> {
        signal?.throwIfAborted();
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
            signal,
            SHOP_API_QUERY_TIMEOUT_MS,
            true,
            undefined,
            proof,
        );
        this.assertNoError(result.refreshCustomerVerification);
    }

    async verifyCustomerAccount(
        token: string,
        password?: string,
        signal?: AbortSignal,
        proof?: ShopAbuseProof,
    ): Promise<void> {
        signal?.throwIfAborted();
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
            signal,
            SHOP_API_QUERY_TIMEOUT_MS,
            true,
            ...(proof ? [proof] : []),
        );
        this.assertNoError(result.verifyCustomerAccount);
    }

    async requestPasswordReset(emailAddress: string, proof?: ShopAbuseProof): Promise<void> {
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
            undefined,
            undefined,
            undefined,
            undefined,
            proof,
        );
        if (result.requestPasswordReset) {
            this.assertNoError(result.requestPasswordReset);
        }
    }

    async resetPassword(token: string, password: string, proof?: ShopAbuseProof): Promise<void> {
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
            undefined,
            undefined,
            undefined,
            proof,
        );
        this.assertNoError(result.resetPassword);
    }

    async logout(): Promise<ConfirmLogout> {
        const receipt = await this.authTransition.logout(
            () =>
                this.ctx.request<{ logout: { success: boolean } }>(
                    `
                mutation StorefrontLogout { logout { success } }
            `,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    true,
                ),
            result => {
                if (result.logout?.success !== true) throw new Error('Sign-out was not confirmed');
                this.clearAuthToken();
            },
            operation => sessionTransport(API_URL, true, undefined, operation),
        );
        return receipt.confirm;
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
