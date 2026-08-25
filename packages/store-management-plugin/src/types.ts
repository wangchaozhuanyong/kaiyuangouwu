import type { CurrencyCode, ID } from '@vendure/core';

export interface CreateSystemAnnouncementInput {
    enabled?: boolean | null;
    priority?: number | null;
    titleZh: string;
    titleEn?: string | null;
    contentZh: string;
    contentEn?: string | null;
    linkUrl?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
}

export interface UpdateSystemAnnouncementInput extends CreateSystemAnnouncementInput {
    id: ID;
}

export interface SystemAnnouncementPublicView {
    id: ID;
    title: string;
    content: string;
    linkUrl: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
}

export type StorefrontPromotionContentType = 'HTML' | 'MARKDOWN';

export interface StorefrontPromotionPageView {
    id: ID | null;
    contentType: StorefrontPromotionContentType;
    draftSource: string;
    publishedSource: string | null;
    isCustomized: boolean;
    defaultTemplateVersion: number;
    publishedVersion: number;
    publishedAt: Date | null;
    publicUrl: string | null;
}

export interface UpdateStorefrontPromotionDraftInput {
    contentType: StorefrontPromotionContentType;
    source: string;
}

export interface StorefrontPromotionPluginOptions {
    enabled?: boolean;
    signingSecret?: string;
    secureCookie?: boolean;
    trustProxyHeaders?: boolean;
    bypassHosts?: string[];
}

export type StoreCouponCampaignKind =
    'ORDER_FIXED' | 'ORDER_PERCENTAGE' | 'COLLECTION_PERCENTAGE' | 'PRODUCT_PERCENTAGE';

export interface CreateStoreCouponCampaignInput {
    name: string;
    couponCode: string;
    kind: StoreCouponCampaignKind;
    minimumSpend?: number | null;
    discountAmount?: number | null;
    discountRate?: number | null;
    collectionIds?: ID[] | null;
    productIds?: ID[] | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    usageLimit?: number | null;
    perCustomerUsageLimit?: number | null;
}

export interface StoreCouponCampaignView {
    id: ID;
    name: string;
    couponCode: string;
    kind: StoreCouponCampaignKind;
    enabled: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    minimumSpend: number;
    discountAmount: number | null;
    discountRate: number | null;
    collectionIds: ID[];
    productVariantIds: ID[];
    usageLimit: number | null;
    perCustomerUsageLimit: number | null;
}

export interface StoreFlashSaleVariantPriceInput {
    productVariantId: ID;
    salePrice: number;
}

export interface CreateStoreFlashSaleInput {
    name: string;
    productIds: ID[];
    percentageOff: number;
    variantPrices?: StoreFlashSaleVariantPriceInput[] | null;
    startsAt: Date;
    endsAt: Date;
}

export interface StoreFlashSaleItemView {
    productId: ID;
    productVariantId: ID;
    productName: string;
    variantName: string;
    originalPrice: number;
    salePrice: number;
    currencyCode: CurrencyCode;
    imageUrl: string | null;
}

export interface StoreFlashSaleView {
    id: ID;
    name: string;
    enabled: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    items: StoreFlashSaleItemView[];
}

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
    'PROFILE' | 'DOMAIN' | 'PASSWORD' | 'CATALOG' | 'SUPPORT' | 'PRIVACY' | 'TERMS' | 'SHIPPING' | 'PAYMENT';

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
    internalNote?: string | null;
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
