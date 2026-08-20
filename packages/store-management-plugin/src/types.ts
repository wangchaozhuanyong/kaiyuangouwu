import type { CurrencyCode, ID } from '@vendure/core';

export interface ProvisionStoreAdministratorInput {
    firstName: string;
    lastName: string;
    emailAddress: string;
}

export interface ProvisionStoreInput {
    code: string;
    name: string;
    storefrontNameZh: string;
    storefrontNameEn: string;
    templateChannelId: ID;
    administrator: ProvisionStoreAdministratorInput;
}

export interface ProvisionStoreResult {
    sellerId: ID;
    channelId: ID;
    roleId: ID;
    administratorId: ID;
    stockLocationId: ID;
    profileId: ID;
    channelCode: string;
    temporaryPassword: string;
}

export type StoreProfileStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED';

export type StoreActivationCheckCode =
    | 'PROFILE'
    | 'DOMAIN'
    | 'PASSWORD'
    | 'CATALOG'
    | 'SUPPORT'
    | 'PRIVACY'
    | 'TERMS'
    | 'TAX'
    | 'SHIPPING'
    | 'PAYMENT';

export interface StoreActivationCheck {
    code: StoreActivationCheckCode;
    ready: boolean;
    message: string;
    messageEn: string;
}

export interface StoreActivationReadiness {
    ready: boolean;
    checks: StoreActivationCheck[];
}

export interface UpdateStoreProfileInput {
    id: ID;
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
    status?: StoreProfileStatus | null;
    sortOrder?: number | null;
    descriptionZh?: string | null;
    descriptionEn?: string | null;
    logoAssetId?: ID | null;
}

export interface UpdateMyStoreProfileInput {
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
    descriptionZh?: string | null;
    descriptionEn?: string | null;
    logoAssetId?: ID | null;
}

export interface StoreCommerceConfiguration {
    channelId: ID;
    channelCode: string;
    currencyCode: CurrencyCode;
    pricesIncludeTax: boolean;
    countryCode: string | null;
    taxRate: number;
    taxCategoryName: string | null;
    taxZoneName: string | null;
    shippingZoneName: string | null;
    shippingMethodId: ID | null;
    shippingMethodCode: string;
    shippingMethodNameZh: string;
    shippingMethodNameEn: string;
    shippingDescriptionZh: string;
    shippingDescriptionEn: string;
    baseRate: number;
    freeShippingThreshold: number;
    shippingTaxRate: number;
    shippingPriceIncludesTax: boolean;
    estimateMinDays: number;
    estimateMaxDays: number;
    blockedPostalPrefixes: string;
    ready: boolean;
}

export interface UpdateMyStoreCommerceConfigurationInput {
    pricesIncludeTax: boolean;
    countryCode: string;
    taxRate: number;
    shippingMethodNameZh: string;
    shippingMethodNameEn: string;
    shippingDescriptionZh: string;
    shippingDescriptionEn: string;
    baseRate: number;
    freeShippingThreshold: number;
    shippingTaxRate: number;
    shippingPriceIncludesTax: boolean;
    estimateMinDays: number;
    estimateMaxDays: number;
    blockedPostalPrefixes: string;
}
