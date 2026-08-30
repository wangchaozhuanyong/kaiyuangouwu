import { gql } from 'graphql-tag';

const storeCurrencyConfigurationFields = gql`
    fragment StoreCurrencyConfigurationFields on StoreCurrencyConfiguration {
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

const storeUsdtWalletFields = gql`
    fragment StoreUsdtWalletFields on StoreUsdtWallet {
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

const storeUsdtManualRefundFields = gql`
    fragment StoreUsdtManualRefundFields on StoreUsdtManualRefund {
        id
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
        blockNumber
        reason
        operatorUserId
        state
        createdAt
    }
`;

export const myStoreCurrencyConfigurationQuery = gql`
    ${storeCurrencyConfigurationFields}
    ${storeUsdtWalletFields}
    ${storeUsdtManualRefundFields}
    query MyStoreCurrencyConfiguration {
        myStoreCurrencyConfiguration {
            ...StoreCurrencyConfigurationFields
        }
        myStoreUsdtWallet {
            ...StoreUsdtWalletFields
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
        myStorePaymentDetails {
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
        myStoreUsdtManualRefunds {
            ...StoreUsdtManualRefundFields
        }
    }
`;

export const submitMyStoreUsdtWalletMutation = gql`
    ${storeUsdtWalletFields}
    mutation SubmitMyStoreUsdtWallet($receivingAddress: String!) {
        submitMyStoreUsdtWallet(receivingAddress: $receivingAddress) {
            ...StoreUsdtWalletFields
        }
    }
`;

export const recordStoreUsdtManualRefundMutation = gql`
    ${storeUsdtManualRefundFields}
    mutation RecordStoreUsdtManualRefund($input: StoreUsdtManualRefundInput!) {
        recordStoreUsdtManualRefund(input: $input) {
            ...StoreUsdtManualRefundFields
        }
    }
`;

export const updateMyStoreCurrencyConfigurationMutation = gql`
    ${storeCurrencyConfigurationFields}
    mutation UpdateMyStoreCurrencyConfiguration($input: UpdateStoreCurrencyConfigurationInput!) {
        updateMyStoreCurrencyConfiguration(input: $input) {
            ...StoreCurrencyConfigurationFields
        }
    }
`;

export const refreshMyStoreExchangeRateMutation = gql`
    ${storeCurrencyConfigurationFields}
    mutation RefreshMyStoreExchangeRate {
        refreshMyStoreExchangeRate {
            ...StoreCurrencyConfigurationFields
        }
    }
`;

export const refreshMyStoreUsdtRateMutation = gql`
    ${storeCurrencyConfigurationFields}
    mutation RefreshMyStoreUsdtRate {
        refreshMyStoreUsdtRate {
            ...StoreCurrencyConfigurationFields
        }
    }
`;

export type CurrencyRateMode = 'AUTO' | 'MANUAL';
export type CurrencyRoundingMode = 'CENT' | 'TENTH' | 'WHOLE';
export type UsdtRateScheduleMode = 'INTERVAL' | 'DAILY';

export interface StoreCurrencyConfigurationRecord {
    channelId: string;
    channelCode: string;
    updatedAt: string;
    defaultCurrencyCode: 'CNY' | 'MYR';
    availableCurrencyCodes: Array<'CNY' | 'MYR'>;
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

export interface StoreUsdtWalletRecord {
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

export interface StoreUsdtPaymentStatsRecord {
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

export interface MyStoreCurrencyConfigurationResult {
    myStoreCurrencyConfiguration: StoreCurrencyConfigurationRecord;
    myStoreUsdtWallet: StoreUsdtWalletRecord;
    myStoreUsdtPaymentStats: StoreUsdtPaymentStatsRecord;
    myStoreUsdtPaymentIntents: StoreUsdtPaymentIntentRecord[];
    myStorePaymentStats: StorePaymentStatsRecord[];
    myStorePaymentDetails: StorePaymentDetailRecord[];
    myStoreUsdtManualRefunds: StoreUsdtManualRefundRecord[];
}

export interface StorePaymentStatsRecord {
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

export interface StorePaymentDetailRecord {
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

export interface StoreUsdtManualRefundRecord {
    id: string;
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
    blockNumber: number;
    reason: string;
    operatorUserId: string;
    state: string;
    createdAt: string;
}

export interface RecordStoreUsdtManualRefundResult {
    recordStoreUsdtManualRefund: StoreUsdtManualRefundRecord;
}

export interface StoreUsdtManualRefundMutationInput {
    paymentId: string;
    amount: number;
    usdtAmount: string;
    transactionId: string;
    reason: string;
}

export interface StoreUsdtPaymentIntentRecord {
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

export interface SubmitMyStoreUsdtWalletResult {
    submitMyStoreUsdtWallet: StoreUsdtWalletRecord;
}

export interface UpdateStoreCurrencyConfigurationResult {
    updateMyStoreCurrencyConfiguration: StoreCurrencyConfigurationRecord;
}

export interface RefreshStoreExchangeRateResult {
    refreshMyStoreExchangeRate: StoreCurrencyConfigurationRecord;
}

export interface RefreshStoreUsdtRateResult {
    refreshMyStoreUsdtRate: StoreCurrencyConfigurationRecord;
}
