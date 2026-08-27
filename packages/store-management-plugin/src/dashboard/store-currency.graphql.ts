import { gql } from 'graphql-tag';

const storeCurrencyConfigurationFields = gql`
    fragment StoreCurrencyConfigurationFields on StoreCurrencyConfiguration {
        channelId
        channelCode
        defaultCurrencyCode
        availableCurrencyCodes
        selectorEnabled
        rateMode
        cnyToMyrRate
        markupPercent
        roundingMode
        rateSource
        rateUpdatedAt
        pricesUpdatedAt
        syncedPriceCount
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
    }
`;

export const myStoreCurrencyConfigurationQuery = gql`
    ${storeCurrencyConfigurationFields}
    query MyStoreCurrencyConfiguration {
        myStoreCurrencyConfiguration {
            ...StoreCurrencyConfigurationFields
        }
        myStoreUsdtPaymentIntents {
            id
            orderId
            orderCode
            network
            expectedUsdtAmount
            status
            transactionId
            failureReason
            createdAt
            expiresAt
            settledAt
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

export const syncMyStoreCurrencyPricesMutation = gql`
    ${storeCurrencyConfigurationFields}
    mutation SyncMyStoreCurrencyPrices {
        syncMyStoreCurrencyPrices {
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
    defaultCurrencyCode: 'CNY' | 'MYR';
    availableCurrencyCodes: Array<'CNY' | 'MYR'>;
    selectorEnabled: boolean;
    rateMode: CurrencyRateMode;
    cnyToMyrRate: number;
    markupPercent: number;
    roundingMode: CurrencyRoundingMode;
    rateSource: string | null;
    rateUpdatedAt: string | null;
    pricesUpdatedAt: string | null;
    syncedPriceCount: number;
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
}

export interface MyStoreCurrencyConfigurationResult {
    myStoreCurrencyConfiguration: StoreCurrencyConfigurationRecord;
    myStoreUsdtPaymentIntents: StoreUsdtPaymentIntentRecord[];
}

export interface StoreUsdtPaymentIntentRecord {
    id: string;
    orderId: string;
    orderCode: string;
    network: string;
    expectedUsdtAmount: number;
    status: 'PENDING' | 'SETTLED' | 'MANUAL_REVIEW' | 'EXPIRED';
    transactionId: string | null;
    failureReason: string | null;
    createdAt: string;
    expiresAt: string;
    settledAt: string | null;
}

export interface UpdateStoreCurrencyConfigurationResult {
    updateMyStoreCurrencyConfiguration: StoreCurrencyConfigurationRecord;
}

export interface RefreshStoreExchangeRateResult {
    refreshMyStoreExchangeRate: StoreCurrencyConfigurationRecord;
}

export interface SyncStoreCurrencyPricesResult {
    syncMyStoreCurrencyPrices: StoreCurrencyConfigurationRecord;
}

export interface RefreshStoreUsdtRateResult {
    refreshMyStoreUsdtRate: StoreCurrencyConfigurationRecord;
}
