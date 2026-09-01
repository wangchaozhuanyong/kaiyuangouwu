import type { CurrencyCode, ID } from '@vendure/core';

export type SystemAnnouncementTargetMode = 'ALL' | 'SINGLE' | 'MULTIPLE';
export type StoreCommerceMode = 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomChannelFields {
        commerceMode: StoreCommerceMode;
        storefrontNameZh?: string | null;
        storefrontNameEn?: string | null;
    }
}

export interface CreateSystemAnnouncementInput {
    enabled?: boolean | null;
    priority?: number | null;
    titleZh: string;
    titleEn?: string | null;
    titleEnLocked?: boolean | null;
    contentZh: string;
    contentEn?: string | null;
    contentEnLocked?: boolean | null;
    linkUrl?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    targetMode?: SystemAnnouncementTargetMode | null;
    channelIds?: ID[] | null;
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

export type StoreCouponStackPolicy = 'EXCLUSIVE' | 'STACKABLE';

export type StoreCustomerCouponStatus = 'AVAILABLE' | 'LOCKED' | 'USED' | 'RETURNED' | 'EXPIRED' | 'REVOKED';

export type StoreCouponLedgerEventType =
    'CLAIMED' | 'LOCKED' | 'RELEASED' | 'REDEEMED' | 'RETURNED' | 'EXPIRED' | 'REVOKED' | 'REFUND_SETTLED';

export interface CreateStoreCouponCampaignInput {
    name: string;
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
    claimStartsAt?: Date | null;
    claimEndsAt?: Date | null;
    validityDays?: number | null;
    issueLimit?: number | null;
    perCustomerClaimLimit?: number | null;
    stackPolicy?: StoreCouponStackPolicy | null;
    returnOnCancellation?: boolean | null;
    returnOnFullRefund?: boolean | null;
}

export interface StoreCouponCampaignStats {
    claimedCount: number;
    availableCount: number;
    lockedCount: number;
    usedCount: number;
    returnedCount: number;
    expiredCount: number;
    revokedCount: number;
    redeemedOrderCount: number;
    refundedOrderCount: number;
    discountAmountTotal: number;
    assistedRevenueTotal: number;
    financialTotals: StoreCouponFinancialTotal[];
}

export interface StoreCouponFinancialTotal {
    currencyCode: CurrencyCode;
    discountAmountTotal: number;
    assistedRevenueTotal: number;
}

export interface StoreCouponCampaignView extends StoreCouponCampaignStats {
    id: ID;
    name: string;
    couponCode?: string;
    kind: StoreCouponCampaignKind;
    enabled: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    minimumSpend: number;
    currencyCode: CurrencyCode;
    discountAmount: number | null;
    discountRate: number | null;
    collectionIds: ID[];
    productVariantIds: ID[];
    usageLimit: number | null;
    perCustomerUsageLimit: number | null;
    claimStartsAt: Date | null;
    claimEndsAt: Date | null;
    validityDays: number | null;
    issueLimit: number | null;
    perCustomerClaimLimit: number;
    stackPolicy: StoreCouponStackPolicy;
    returnOnCancellation: boolean;
    returnOnFullRefund: boolean;
    remainingIssueCount: number | null;
    claimed: boolean;
    claimable: boolean;
}

export interface StoreCustomerCouponView {
    id: ID;
    campaignId: ID;
    campaignName: string;
    campaignKind: StoreCouponCampaignKind;
    status: StoreCustomerCouponStatus;
    minimumSpend: number;
    currencyCode: CurrencyCode;
    discountAmount: number | null;
    discountRate: number | null;
    claimedAt: Date;
    validFrom: Date;
    validUntil: Date | null;
    lockedAt: Date | null;
    usedAt: Date | null;
    returnedAt: Date | null;
    expiredAt: Date | null;
    lockedOrderId: ID | null;
    usedOrderId: ID | null;
    returnCount: number;
    usable: boolean;
}

export interface StoreCouponLedgerEntryListOptions {
    skip?: number | null;
    take?: number | null;
    campaignId?: ID | null;
    customerId?: ID | null;
    orderId?: ID | null;
    eventType?: StoreCouponLedgerEventType | null;
}

export interface StoreCouponLedgerEntryView {
    id: ID;
    createdAt: Date;
    eventType: StoreCouponLedgerEventType;
    actorType: string;
    campaignId: ID;
    campaignName: string;
    customerCouponId: ID;
    customerId: ID;
    customerName: string;
    customerEmail: string;
    orderId: ID | null;
    orderCode: string | null;
    refundId: ID | null;
    discountAmount: number | null;
    note: string | null;
}

export interface StoreCouponLedgerEntryList {
    items: StoreCouponLedgerEntryView[];
    totalItems: number;
}

export interface StoreCouponOrderAllocationView {
    id: ID;
    customerCouponId: ID;
    campaignId: ID;
    campaignName: string;
    status: string;
    currencyCode: CurrencyCode;
    discountAmount: number;
    discountAmountWithTax: number;
    refundedAmount: number;
    appliedAt: Date;
    usedAt: Date | null;
    releasedAt: Date | null;
    refundedAt: Date | null;
    refundId: ID | null;
}

export interface StoreCouponUsageRecordView {
    id: ID;
    customerCouponId: ID;
    campaignId: ID;
    campaignName: string;
    campaignKind: StoreCouponCampaignKind;
    status: 'USED' | 'REFUNDED';
    currencyCode: CurrencyCode;
    minimumSpend: number;
    discountAmount: number | null;
    discountRate: number | null;
    savedAmount: number;
    usedAt: Date;
    refundedAt: Date | null;
    orderId: ID;
    orderCode: string;
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

export interface StorePromotionNameView {
    id: ID;
    name: string;
}

export interface StoreCouponCampaignActionResult {
    campaignId: ID;
    affectedCount: number;
}

export interface StoreCouponDailyMetricView {
    date: string;
    currencyCode: CurrencyCode;
    claimedCount: number;
    redeemedCount: number;
    refundedCount: number;
    returnedCount: number;
    expiredCount: number;
    revokedCount: number;
    discountAmountTotal: number;
    assistedRevenueTotal: number;
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
    storefrontNameEn?: string | null;
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
    expectedUpdatedAt: Date;
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
    status?: StoreProfileStatus | null;
    sortOrder?: number | null;
    descriptionZh?: string | null;
    descriptionEn?: string | null;
    internalNote?: string | null;
    logoAssetId?: ID | null;
    currentPassword?: string | null;
}

export interface DeprovisionStoreInput {
    profileId: ID;
    expectedUpdatedAt: Date;
    confirmCode: string;
    currentPassword: string;
}

export interface StoreDeprovisionImpact {
    profileId: ID;
    channelId: ID;
    channelCode: string;
    status: StoreProfileStatus;
    isDefaultChannel: boolean;
    isProvisioningTemplate: boolean;
    isActiveChannel: boolean;
    orderCount: number;
    productCount: number;
    customerCount: number;
    administratorCount: number;
    domainCount: number;
    extensionRecordCount: number;
    sellerWillBeDeleted: boolean;
    roleWillBeDeleted: boolean;
    blockers: string[];
    canDeprovision: boolean;
}

export interface DeprovisionStoreResult {
    channelId: ID;
    channelCode: string;
    deletedAdministratorCount: number;
    deletedRole: boolean;
    deletedSeller: boolean;
}

export interface UpdateMyStoreProfileInput {
    expectedUpdatedAt: Date;
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
    descriptionZh?: string | null;
    descriptionEn?: string | null;
    logoAssetId?: ID | null;
}

export interface StoreCommerceConfiguration {
    channelId: ID;
    channelCode: string;
    updatedAt: Date;
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
    expectedUpdatedAt: Date;
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

export type StoreCurrencyRateMode = 'AUTO' | 'MANUAL';
export type StoreCurrencyRoundingMode = 'CENT' | 'TENTH' | 'WHOLE';
export type StoreUsdtRateScheduleMode = 'INTERVAL' | 'DAILY';

export interface StoreCurrencyConfiguration {
    channelId: ID;
    channelCode: string;
    updatedAt: Date;
    defaultCurrencyCode: CurrencyCode;
    availableCurrencyCodes: CurrencyCode[];
    selectorEnabled: boolean;
    rateMode: StoreCurrencyRateMode;
    cnyToMyrRate: number;
    markupPercent: number;
    roundingMode: StoreCurrencyRoundingMode;
    rateSource: string | null;
    rateUpdatedAt: Date | null;
    pricesUpdatedAt: Date | null;
    syncedPriceCount: number;
    usdtDisplayEnabled: boolean;
    usdtMarkupPercent: number;
    usdtRateScheduleMode: StoreUsdtRateScheduleMode;
    usdtRateIntervalMinutes: number;
    usdtRateDailyTime: string;
    cnyPerUsdtRate: number | null;
    myrPerUsdtRate: number | null;
    usdtRateSource: string | null;
    usdtRateUpdatedAt: Date | null;
    usdtRateNextRunAt: Date;
    usdtRateExpiresAt: Date | null;
    usdtRateAvailable: boolean;
    usdtPaymentConfigured: boolean;
    usdtPaymentNetwork: string;
    usdtReceivingAddressMasked: string | null;
    usdtReceivingAddressFingerprint: string | null;
    usdtWalletReviewStatus: string;
}

export interface UpdateStoreCurrencyConfigurationInput {
    expectedUpdatedAt: Date;
    defaultCurrencyCode: CurrencyCode;
    availableCurrencyCodes: CurrencyCode[];
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
}

export interface StorefrontUsdtCheckoutQuoteView {
    id: ID;
    fiatCurrencyCode: string;
    fiatAmount: number;
    fiatPerUsdtRate: number;
    markupPercent: number;
    usdtAmount: number;
    source: string;
    network: string;
    tokenContractAddress: string;
    receivingAddress: string;
    receivingAddressFingerprint: string;
    paymentStatus: string;
    transactionId: string | null;
    settledAt: Date | null;
    createdAt: Date;
    expiresAt: Date;
}
