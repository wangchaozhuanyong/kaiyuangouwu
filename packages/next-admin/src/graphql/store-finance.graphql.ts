import { gql } from '@apollo/client';

const CURRENCY_CONFIGURATION_FIELDS = gql`
    fragment NextAdminCurrencyConfigurationFields on StoreCurrencyConfiguration {
        channelId
        channelCode
        updatedAt
        defaultCurrencyCode
        availableCurrencyCodes
        selectorEnabled
        rateMode
        cnyToMyrRate
        markupPercent
        roundingMode
        rateSource
        rateUpdatedAt
        usdtDisplayEnabled
        usdtMarkupPercent
        usdtRateScheduleMode
        usdtRateIntervalMinutes
        usdtRateDailyTime
        cnyPerUsdtRate
        myrPerUsdtRate
        usdtRateSource
        usdtRateUpdatedAt
        usdtRateNextRunAt
        usdtRateExpiresAt
        usdtRateAvailable
        usdtPaymentConfigured
        usdtPaymentNetwork
        usdtReceivingAddressMasked
        usdtReceivingAddressFingerprint
        usdtWalletReviewStatus
    }
`;

const USDT_WALLET_FIELDS = gql`
    fragment NextAdminUsdtWalletFields on StoreUsdtWallet {
        channelId
        channelCode
        reviewStatus
        configured
        network
        activeReceivingAddressMasked
        activeReceivingAddressFingerprint
        pendingReceivingAddress
        pendingReceivingAddressFingerprint
        submittedAt
        reviewedAt
        rejectionReason
    }
`;

const PAYMENT_REPORT_FIELDS = gql`
    fragment NextAdminPaymentDetailFields on StorePaymentDetail {
        id
        channelId
        channelCode
        orderId
        orderCode
        paymentMethodCode
        paymentState
        currencyCode
        amount
        refundedAmount
        netAmount
        transactionId
        createdAt
    }
`;

const MANUAL_REFUND_FIELDS = gql`
    fragment NextAdminManualRefundFields on StoreUsdtManualRefund {
        id
        refundId
        channelId
        channelCode
        paymentId
        orderId
        orderCode
        currencyCode
        amount
        usdtAmount
        network
        transactionId
        fromAddress
        toAddress
        blockNumber
        blockTimestamp
        reason
        operatorUserId
        state
        createdAt
    }
`;

export const MY_STORE_FINANCE_QUERY = gql`
    ${CURRENCY_CONFIGURATION_FIELDS}
    ${USDT_WALLET_FIELDS}
    ${PAYMENT_REPORT_FIELDS}
    ${MANUAL_REFUND_FIELDS}
    query NextAdminMyStoreFinance {
        myStoreCurrencyConfiguration {
            ...NextAdminCurrencyConfigurationFields
        }
        myStoreUsdtWallet {
            ...NextAdminUsdtWalletFields
        }
        myStoreUsdtPaymentStats {
            channelId
            channelCode
            totalCount
            pendingCount
            settledCount
            manualReviewCount
            expiredCount
            expectedUsdtTotal
            receivedUsdtTotal
            fiatTotals {
                currencyCode
                amount
            }
        }
        myStoreUsdtPaymentIntents {
            id
            channelId
            channelCode
            orderId
            orderCode
            network
            fiatCurrencyCode
            fiatAmount
            fiatPerUsdtRate
            markupPercent
            rateSource
            receivingAddressMasked
            receivingAddressFingerprint
            baseUsdtAmount
            expectedUsdtAmount
            receivedUsdtAmount
            senderAddressMasked
            status
            transactionId
            failureReason
            createdAt
            expiresAt
            settledAt
            blockNumber
            blockTimestamp
            lastCheckedAt
        }
        myStorePaymentStats {
            channelId
            channelCode
            paymentMethodCode
            currencyCode
            settledCount
            refundCount
            grossAmount
            refundedAmount
            netAmount
        }
        myStorePaymentDetails(options: { take: 100 }) {
            items {
                ...NextAdminPaymentDetailFields
            }
            totalItems
        }
        myStoreUsdtManualRefunds(options: { take: 100 }) {
            items {
                ...NextAdminManualRefundFields
            }
            totalItems
        }
    }
`;

export const UPDATE_MY_STORE_CURRENCY_MUTATION = gql`
    ${CURRENCY_CONFIGURATION_FIELDS}
    mutation NextAdminUpdateMyStoreCurrency($input: UpdateStoreCurrencyConfigurationInput!) {
        updateMyStoreCurrencyConfiguration(input: $input) {
            ...NextAdminCurrencyConfigurationFields
        }
    }
`;

export const REFRESH_MY_STORE_EXCHANGE_RATE_MUTATION = gql`
    ${CURRENCY_CONFIGURATION_FIELDS}
    mutation NextAdminRefreshMyStoreExchangeRate {
        refreshMyStoreExchangeRate {
            ...NextAdminCurrencyConfigurationFields
        }
    }
`;

export const REFRESH_MY_STORE_USDT_RATE_MUTATION = gql`
    ${CURRENCY_CONFIGURATION_FIELDS}
    mutation NextAdminRefreshMyStoreUsdtRate {
        refreshMyStoreUsdtRate {
            ...NextAdminCurrencyConfigurationFields
        }
    }
`;

export const SUBMIT_MY_STORE_USDT_WALLET_MUTATION = gql`
    ${USDT_WALLET_FIELDS}
    mutation NextAdminSubmitMyStoreUsdtWallet($receivingAddress: String!) {
        submitMyStoreUsdtWallet(receivingAddress: $receivingAddress) {
            ...NextAdminUsdtWalletFields
        }
    }
`;

export const RECORD_STORE_USDT_MANUAL_REFUND_MUTATION = gql`
    ${MANUAL_REFUND_FIELDS}
    mutation NextAdminRecordStoreUsdtManualRefund($input: StoreUsdtManualRefundInput!) {
        recordStoreUsdtManualRefund(input: $input) {
            ...NextAdminManualRefundFields
        }
    }
`;

export const PLATFORM_USDT_PAYMENT_MANAGEMENT_QUERY = gql`
    ${USDT_WALLET_FIELDS}
    ${PAYMENT_REPORT_FIELDS}
    ${MANUAL_REFUND_FIELDS}
    query NextAdminPlatformUsdtPaymentManagement(
        $channelId: ID
        $statsOptions: StorePaymentReportOptionsInput
        $paymentOptions: StorePaymentReportOptionsInput
        $refundOptions: StorePaymentReportOptionsInput
    ) {
        storeUsdtWallets {
            ...NextAdminUsdtWalletFields
        }
        storeUsdtPaymentStats(channelId: $channelId) {
            channelId
            channelCode
            totalCount
            pendingCount
            settledCount
            manualReviewCount
            expiredCount
            expectedUsdtTotal
            receivedUsdtTotal
            fiatTotals {
                currencyCode
                amount
            }
        }
        storeUsdtPaymentIntents(channelId: $channelId) {
            id
            channelId
            channelCode
            orderId
            orderCode
            network
            fiatCurrencyCode
            fiatAmount
            fiatPerUsdtRate
            markupPercent
            rateSource
            receivingAddressMasked
            receivingAddressFingerprint
            baseUsdtAmount
            expectedUsdtAmount
            receivedUsdtAmount
            senderAddressMasked
            status
            transactionId
            failureReason
            createdAt
            expiresAt
            settledAt
            blockNumber
            blockTimestamp
            lastCheckedAt
        }
        storePaymentStats(channelId: $channelId, options: $statsOptions) {
            channelId
            channelCode
            paymentMethodCode
            currencyCode
            settledCount
            refundCount
            grossAmount
            refundedAmount
            netAmount
        }
        storePaymentDetails(channelId: $channelId, options: $paymentOptions) {
            items {
                ...NextAdminPaymentDetailFields
            }
            totalItems
        }
        storeUsdtManualRefunds(channelId: $channelId, options: $refundOptions) {
            items {
                ...NextAdminManualRefundFields
            }
            totalItems
        }
    }
`;

export const REVIEW_STORE_USDT_WALLET_MUTATION = gql`
    ${USDT_WALLET_FIELDS}
    mutation NextAdminReviewStoreUsdtWallet($input: ReviewStoreUsdtWalletInput!) {
        reviewStoreUsdtWallet(input: $input) {
            ...NextAdminUsdtWalletFields
        }
    }
`;

export type SupportedCurrency = 'CNY' | 'MYR';
export type CurrencyRateMode = 'AUTO' | 'MANUAL';
export type CurrencyRoundingMode = 'CENT' | 'TENTH' | 'WHOLE';
export type UsdtRateScheduleMode = 'INTERVAL' | 'DAILY';

export interface CurrencyConfigurationRecord {
    channelId: string;
    channelCode: string;
    updatedAt: string;
    defaultCurrencyCode: SupportedCurrency;
    availableCurrencyCodes: SupportedCurrency[];
    selectorEnabled: boolean;
    rateMode: CurrencyRateMode;
    cnyToMyrRate: number;
    markupPercent: number;
    roundingMode: CurrencyRoundingMode;
    rateSource: string | null;
    rateUpdatedAt: string | null;
    usdtDisplayEnabled: boolean;
    usdtMarkupPercent: number;
    usdtRateScheduleMode: UsdtRateScheduleMode;
    usdtRateIntervalMinutes: number;
    usdtRateDailyTime: string;
    cnyPerUsdtRate: number | null;
    myrPerUsdtRate: number | null;
    usdtRateSource: string | null;
    usdtRateUpdatedAt: string | null;
    usdtRateNextRunAt: string;
    usdtRateExpiresAt: string | null;
    usdtRateAvailable: boolean;
    usdtPaymentConfigured: boolean;
    usdtPaymentNetwork: string;
    usdtReceivingAddressMasked: string | null;
    usdtReceivingAddressFingerprint: string | null;
    usdtWalletReviewStatus: string;
}

export interface UsdtWalletRecord {
    channelId: string;
    channelCode: string;
    reviewStatus: 'UNCONFIGURED' | 'PENDING' | 'ACTIVE' | 'REJECTED';
    configured: boolean;
    network: string;
    activeReceivingAddressMasked: string | null;
    activeReceivingAddressFingerprint: string | null;
    pendingReceivingAddress: string | null;
    pendingReceivingAddressFingerprint: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
}

export interface UsdtPaymentStatsRecord {
    channelId: string;
    channelCode: string;
    totalCount: number;
    pendingCount: number;
    settledCount: number;
    manualReviewCount: number;
    expiredCount: number;
    expectedUsdtTotal: number;
    receivedUsdtTotal: number;
    fiatTotals: Array<{ currencyCode: string; amount: number }>;
}

export interface UsdtPaymentIntentRecord {
    id: string;
    channelId: string;
    channelCode: string;
    orderId: string;
    orderCode: string;
    network: string;
    fiatCurrencyCode: string;
    fiatAmount: number;
    fiatPerUsdtRate: number;
    markupPercent: number;
    rateSource: string;
    receivingAddressMasked: string;
    receivingAddressFingerprint: string;
    baseUsdtAmount: number;
    expectedUsdtAmount: number;
    receivedUsdtAmount: number | null;
    senderAddressMasked: string | null;
    status: 'PENDING' | 'SETTLED' | 'MANUAL_REVIEW' | 'EXPIRED';
    transactionId: string | null;
    failureReason: string | null;
    createdAt: string;
    expiresAt: string;
    settledAt: string | null;
    blockNumber: number | null;
    blockTimestamp: string | null;
    lastCheckedAt: string | null;
}

export interface PaymentStatsRecord {
    channelId: string;
    channelCode: string;
    paymentMethodCode: string;
    currencyCode: string;
    settledCount: number;
    refundCount: number;
    grossAmount: number;
    refundedAmount: number;
    netAmount: number;
}

export interface PaymentDetailRecord {
    id: string;
    channelId: string;
    channelCode: string;
    orderId: string;
    orderCode: string;
    paymentMethodCode: string;
    paymentState: string;
    currencyCode: string;
    amount: number;
    refundedAmount: number;
    netAmount: number;
    transactionId: string | null;
    createdAt: string;
}

export interface ManualRefundRecord {
    id: string;
    refundId: string;
    channelId: string;
    channelCode: string;
    paymentId: string;
    orderId: string;
    orderCode: string;
    currencyCode: string;
    amount: number;
    usdtAmount: string;
    network: string;
    transactionId: string;
    fromAddress: string;
    toAddress: string;
    blockNumber: number;
    blockTimestamp: string;
    reason: string;
    operatorUserId: string;
    state: string;
    createdAt: string;
}

export interface FinanceData {
    myStoreCurrencyConfiguration: CurrencyConfigurationRecord;
    myStoreUsdtWallet: UsdtWalletRecord;
    myStoreUsdtPaymentStats: UsdtPaymentStatsRecord;
    myStoreUsdtPaymentIntents: UsdtPaymentIntentRecord[];
    myStorePaymentStats: PaymentStatsRecord[];
    myStorePaymentDetails: { items: PaymentDetailRecord[]; totalItems: number };
    myStoreUsdtManualRefunds: { items: ManualRefundRecord[]; totalItems: number };
}

export interface PlatformFinanceData {
    storeUsdtWallets: UsdtWalletRecord[];
    storeUsdtPaymentStats: UsdtPaymentStatsRecord[];
    storeUsdtPaymentIntents: UsdtPaymentIntentRecord[];
    storePaymentStats: PaymentStatsRecord[];
    storePaymentDetails: { items: PaymentDetailRecord[]; totalItems: number };
    storeUsdtManualRefunds: { items: ManualRefundRecord[]; totalItems: number };
}
