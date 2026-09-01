import { gql } from '@apollo/client';

const STORE_USDT_CURRENCY_FIELDS = gql`
    fragment NextAdminStoreUsdtCurrencyFields on StoreCurrencyConfiguration {
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

const STORE_USDT_WALLET_FIELDS = gql`
    fragment NextAdminStoreUsdtWalletFields on StoreUsdtWallet {
        channelId
        channelCode
        reviewStatus
        configured
        network
        activeReceivingAddressMasked
        activeReceivingAddressFingerprint
        pendingReceivingAddress
        pendingReceivingAddressFingerprint
        canReview
        submittedAt
        reviewedAt
        rejectionReason
    }
`;

export const STORE_USDT_SETUP_QUERY = gql`
    ${STORE_USDT_CURRENCY_FIELDS}
    ${STORE_USDT_WALLET_FIELDS}
    query NextAdminStoreUsdtSetup {
        myStoreCurrencyConfiguration {
            ...NextAdminStoreUsdtCurrencyFields
        }
        myStoreUsdtWallet {
            ...NextAdminStoreUsdtWalletFields
        }
    }
`;

export const PLATFORM_USDT_WALLETS_QUERY = gql`
    ${STORE_USDT_WALLET_FIELDS}
    query NextAdminPlatformUsdtWallets {
        storeUsdtWallets {
            ...NextAdminStoreUsdtWalletFields
        }
    }
`;

export const UPDATE_STORE_USDT_CONFIGURATION_MUTATION = gql`
    ${STORE_USDT_CURRENCY_FIELDS}
    mutation NextAdminUpdateStoreUsdtConfiguration($input: UpdateStoreCurrencyConfigurationInput!) {
        updateMyStoreCurrencyConfiguration(input: $input) {
            ...NextAdminStoreUsdtCurrencyFields
        }
    }
`;

export const REFRESH_STORE_USDT_RATE_MUTATION = gql`
    ${STORE_USDT_CURRENCY_FIELDS}
    mutation NextAdminRefreshStoreUsdtRate {
        refreshMyStoreUsdtRate {
            ...NextAdminStoreUsdtCurrencyFields
        }
    }
`;

export const SUBMIT_STORE_USDT_WALLET_MUTATION = gql`
    ${STORE_USDT_WALLET_FIELDS}
    mutation NextAdminSubmitStoreUsdtWallet($receivingAddress: String!) {
        submitMyStoreUsdtWallet(receivingAddress: $receivingAddress) {
            ...NextAdminStoreUsdtWalletFields
        }
    }
`;

export const REVIEW_STORE_USDT_WALLET_MUTATION = gql`
    ${STORE_USDT_WALLET_FIELDS}
    mutation NextAdminReviewStoreUsdtWallet($input: ReviewStoreUsdtWalletInput!) {
        reviewStoreUsdtWallet(input: $input) {
            ...NextAdminStoreUsdtWalletFields
        }
    }
`;

export type StoreCurrencyRateMode = 'AUTO' | 'MANUAL';
export type StoreCurrencyRoundingMode = 'CENT' | 'TENTH' | 'WHOLE';
export type StoreUsdtRateScheduleMode = 'INTERVAL' | 'DAILY';
export type StoreUsdtWalletReviewStatus = 'UNCONFIGURED' | 'PENDING' | 'ACTIVE' | 'REJECTED';

export interface StoreUsdtConfigurationRecord {
    channelId: string;
    channelCode: string;
    updatedAt: string;
    defaultCurrencyCode: string;
    availableCurrencyCodes: string[];
    selectorEnabled: boolean;
    rateMode: StoreCurrencyRateMode;
    cnyToMyrRate: number;
    markupPercent: number;
    roundingMode: StoreCurrencyRoundingMode;
    usdtDisplayEnabled: boolean;
    usdtMarkupPercent: number;
    usdtRateScheduleMode: StoreUsdtRateScheduleMode;
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
    usdtWalletReviewStatus: StoreUsdtWalletReviewStatus;
}

export interface StoreUsdtWalletRecord {
    channelId: string;
    channelCode: string;
    reviewStatus: StoreUsdtWalletReviewStatus;
    configured: boolean;
    network: string;
    activeReceivingAddressMasked: string | null;
    activeReceivingAddressFingerprint: string | null;
    pendingReceivingAddress: string | null;
    pendingReceivingAddressFingerprint: string | null;
    canReview: boolean;
    submittedAt: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
}

export interface StoreUsdtSetupResult {
    myStoreCurrencyConfiguration: StoreUsdtConfigurationRecord;
    myStoreUsdtWallet: StoreUsdtWalletRecord;
}

export interface PlatformUsdtWalletsResult {
    storeUsdtWallets: StoreUsdtWalletRecord[];
}

export interface UpdateStoreUsdtConfigurationResult {
    updateMyStoreCurrencyConfiguration: StoreUsdtConfigurationRecord;
}

export interface RefreshStoreUsdtRateResult {
    refreshMyStoreUsdtRate: StoreUsdtConfigurationRecord;
}

export interface SubmitStoreUsdtWalletResult {
    submitMyStoreUsdtWallet: StoreUsdtWalletRecord;
}

export interface ReviewStoreUsdtWalletResult {
    reviewStoreUsdtWallet: StoreUsdtWalletRecord;
}

export interface StoreUsdtConfigurationDraft {
    usdtDisplayEnabled: boolean;
    usdtMarkupPercent: number;
    usdtRateScheduleMode: StoreUsdtRateScheduleMode;
    usdtRateIntervalMinutes: number;
    usdtRateDailyTime: string;
}
