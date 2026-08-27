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
    }
`;

export const myStoreCurrencyConfigurationQuery = gql`
    ${storeCurrencyConfigurationFields}
    query MyStoreCurrencyConfiguration {
        myStoreCurrencyConfiguration {
            ...StoreCurrencyConfigurationFields
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

export type CurrencyRateMode = 'AUTO' | 'MANUAL';
export type CurrencyRoundingMode = 'CENT' | 'TENTH' | 'WHOLE';

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
}

export interface MyStoreCurrencyConfigurationResult {
    myStoreCurrencyConfiguration: StoreCurrencyConfigurationRecord;
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
