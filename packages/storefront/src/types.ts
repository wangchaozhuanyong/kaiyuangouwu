export type MarketCode = string;
export type StorefrontLanguage = 'zh' | 'en';
export type VendureLanguageCode = 'zh_Hans' | 'en';
export type FulfillmentType = 'physical' | 'digital';
export type DigitalDeliveryMode = 'manual_service' | 'file_download' | 'auto_card';
export type DigitalStockPolicy = 'pool_derived' | 'limited' | 'unlimited';
export type RefundPolicy = 'MERCHANT_REVIEW' | 'SEVEN_DAY_NO_REASON' | 'NON_REFUNDABLE';
export type StoreCommerceMode = 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';

export interface Asset {
    id: string;
    preview: string;
}

export interface CollectionSummary {
    id: string;
    name: string;
    slug: string;
    description: string;
    position: number;
    parentId: string;
    featuredAsset: Asset | null;
    children?: CollectionSummary[] | null;
}

export interface ProductVariant {
    id: string;
    name: string;
    sku: string;
    priceWithTax: number;
    currencyCode: string;
    /** Legacy Vendure stock label retained for cached/test compatibility. */
    stockLevel?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
    /** Exact saleable quantity after allocations and the out-of-stock threshold, or null when untracked. */
    saleableStockLevel?: number | null;
    featuredAsset: Asset | null;
    product: { id: string; name: string; featuredAsset: Asset | null };
    autoCardAvailableStock?: number | null;
    customFields: {
        fulfillmentType: FulfillmentType;
        digitalDeliveryMode?: DigitalDeliveryMode | null;
        digitalStockPolicy?: DigitalStockPolicy | null;
    };
}

export interface ProductPackaging {
    id: string;
    enabled: boolean;
    autoUnpack: boolean;
    unitLabel: string;
    packageLabel: string;
    unitsPerPackage: number;
    unitVariant: Pick<ProductVariant, 'id' | 'name' | 'sku'>;
    packageVariant: Pick<ProductVariant, 'id' | 'name' | 'sku'>;
}

export interface Product {
    id: string;
    createdAt: string;
    name: string;
    slug: string;
    description: string;
    featuredAsset: Asset | null;
    assets: Asset[];
    collections: Array<Pick<CollectionSummary, 'id' | 'name' | 'slug' | 'parentId'>>;
    variants: ProductVariant[];
    packaging?: ProductPackaging | null;
    customFields?: {
        fulfillmentType: FulfillmentType;
        refundPolicy: RefundPolicy;
        manualDeliverySlaMinutes: number;
    };
}

export type ProductSearchSort = 'recommended' | 'sales' | 'newest' | 'name' | 'price-asc' | 'price-desc';

export interface ProductSearchPage {
    items: Product[];
    totalItems: number;
}

export interface StorefrontCatalogInput {
    term?: string;
    collectionId?: string;
    sort?: ProductSearchSort;
    fulfillmentType?: FulfillmentType;
    inStockOnly?: boolean;
    minPriceWithTax?: number;
    maxPriceWithTax?: number;
    skip?: number;
    take?: number;
}

export interface OrderLine {
    id: string;
    quantity: number;
    linePriceWithTax: number;
    proratedUnitPriceWithTax: number;
    productVariant: ProductVariant;
    customFields: {
        fulfillmentTypeSnapshot: FulfillmentType;
        digitalDeliveryModeSnapshot?: DigitalDeliveryMode | null;
        refundPolicySnapshot?: RefundPolicy | null;
        manualDeliverySlaMinutesSnapshot?: number | null;
    };
}

export interface CustomerDeliveryEmail {
    id: string;
    emailAddress: string;
    label: string;
    isDefault: boolean;
    confirmedAt: string;
}

export interface ManualDigitalOrderDelivery {
    id: string;
    state:
        'WAITING_PROCESSING' | 'DRAFT' | 'SENDING' | 'SENT' | 'EMAIL_FAILED' | 'MANUAL_REVIEW' | 'CANCELLED';
    productName: string;
    sku: string;
    quantity: number;
    expectedAt: string;
    overdue: boolean;
    attemptCount: number;
    lastError?: string | null;
    sentAt?: string | null;
    orderLineId: string;
}

export type AfterSalesType = 'REFUND_ONLY' | 'RETURN_AND_REFUND';
export type AfterSalesState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';
export type AfterSalesReason =
    | 'CHANGED_MIND'
    | 'NOT_AS_DESCRIBED'
    | 'DAMAGED'
    | 'WRONG_ITEM'
    | 'DELIVERY_ISSUE'
    | 'DIGITAL_CONTENT_ISSUE'
    | 'OTHER';

export interface AfterSalesItem {
    id: string;
    orderLineId?: string | null;
    quantity: number;
    unitPriceWithTax: number;
    lineAmountWithTax: number;
    productName: string;
    sku: string;
    fulfillmentType: FulfillmentType;
}

export interface AfterSalesEvent {
    id: string;
    createdAt: string;
    state: AfterSalesState;
    actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
    actorLabel: string;
    note: string;
}

export interface AfterSalesRequest {
    id: string;
    createdAt: string;
    updatedAt: string;
    code: string;
    type: AfterSalesType;
    state: AfterSalesState;
    reason: AfterSalesReason;
    description: string;
    currencyCode: string;
    requestedAmount: number;
    approvedAmount?: number | null;
    resolution?: string | null;
    respondedAt?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
    order: Pick<Order, 'id' | 'code' | 'state'>;
    items: AfterSalesItem[];
    events: AfterSalesEvent[];
}

export interface CreateAfterSalesRequestInput {
    orderId: string;
    type: AfterSalesType;
    reason: AfterSalesReason;
    description: string;
    items: Array<{ orderLineId: string; quantity: number }>;
}

export type StorefrontReviewState = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface StorefrontReview {
    id: string;
    createdAt: string;
    updatedAt: string;
    state: StorefrontReviewState;
    rating: number;
    title: string;
    body: string;
    customerName: string;
    productName: string;
    sku: string;
    merchantResponse?: string | null;
    moderatedAt?: string | null;
    orderLineId?: string | null;
    productId?: string | null;
    productVariantId?: string | null;
    verifiedPurchase: boolean;
}

export interface StorefrontReviewList {
    items: StorefrontReview[];
    totalItems: number;
    averageRating: number;
}

export interface StorefrontReviewCandidate {
    orderLineId: string;
    orderId: string;
    orderCode: string;
    orderState: string;
    orderPlacedAt?: string | null;
    productId: string;
    productVariantId: string;
    productName: string;
    variantName: string;
    sku: string;
    fulfillmentType: FulfillmentType;
}

export interface SubmitStorefrontReviewInput {
    orderLineId: string;
    rating: number;
    title: string;
    body: string;
}

export interface CheckoutFulfillment {
    fulfillmentType: 'PHYSICAL' | 'DIGITAL' | 'MIXED';
    containsPhysicalProducts: boolean;
    containsDigitalProducts: boolean;
    requiresShippingAddress: boolean;
    requiresShippingMethod: boolean;
}

export interface OrderFulfillment {
    id: string;
    state: string;
    method: string;
    trackingCode?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DigitalDelivery {
    orderLineId: string;
    sku: string;
    name: string;
    status: 'READY' | 'PAYMENT_REQUIRED' | 'NOT_CONFIGURED' | 'FILE_MISSING';
    downloadUrl?: string | null;
    expiresAt?: string | null;
}

export type AutoCardDeliveryState = 'WAITING_STOCK' | 'ALLOCATED' | 'RETRYING' | 'SENT' | 'MANUAL_REVIEW';

export interface AutoCardOrderDelivery {
    id: string;
    createdAt: string;
    updatedAt: string;
    state: AutoCardDeliveryState;
    productName: string;
    sku: string;
    quantity: number;
    attemptCount: number;
    sentAt?: string | null;
    orderLineId: string;
}

export interface OrderConfirmationToken {
    token: string;
    expiresAt: string;
}

export interface OrderTaxSummary {
    description: string;
    taxRate: number;
    taxBase: number;
    taxTotal: number;
}

export interface CheckoutShipping {
    methodCode: string;
    methodName: string;
    priceWithTax: number;
    estimateMinDays?: number | null;
    estimateMaxDays?: number | null;
    freeShippingThreshold?: number | null;
    freeShippingApplied: boolean;
}

export interface Order {
    id: string;
    code: string;
    state: string;
    orderPlacedAt?: string | null;
    totalQuantity: number;
    subTotalWithTax: number;
    shippingWithTax: number;
    totalWithTax: number;
    currencyCode: string;
    customer?: { id: string; emailAddress: string } | null;
    payments?: Array<{
        id: string;
        method: string;
        amount: number;
        state: string;
    }>;
    lines: OrderLine[];
    discounts: Array<{ description: string; amountWithTax: number }>;
    taxSummary: OrderTaxSummary[];
    couponCodes: string[];
    customFields: {
        customerNote?: string | null;
        deliveryEmail?: string | null;
        deliveryEmailContactId?: string | null;
    };
    fulfillments?: OrderFulfillment[] | null;
    digitalDeliveries?: DigitalDelivery[] | null;
    autoCardDeliveries?: AutoCardOrderDelivery[] | null;
    manualDigitalDeliveries?: ManualDigitalOrderDelivery[] | null;
    checkoutFulfillment?: CheckoutFulfillment;
    checkoutShipping?: CheckoutShipping | null;
}

export interface OrderSummaryLine {
    id: string;
    quantity: number;
    linePriceWithTax: number;
    productVariant: ProductVariant;
    customFields: {
        fulfillmentTypeSnapshot: FulfillmentType;
        digitalDeliveryModeSnapshot?: DigitalDeliveryMode | null;
    };
}

export interface OrderSummary {
    id: string;
    code: string;
    state: string;
    orderPlacedAt?: string | null;
    totalQuantity: number;
    totalWithTax: number;
    currencyCode: string;
    lines: OrderSummaryLine[];
    fulfillments?: Array<Pick<OrderFulfillment, 'state' | 'method' | 'trackingCode' | 'updatedAt'>> | null;
    checkoutFulfillment?: Pick<CheckoutFulfillment, 'containsDigitalProducts'>;
    checkoutShipping?: Pick<CheckoutShipping, 'methodName'> | null;
}

export interface OrderPage {
    items: OrderSummary[];
    totalItems: number;
}

export interface CustomerOrderCounts {
    pending: number;
    shipping: number;
    receiving: number;
}

export interface CustomerAddress {
    id: string;
    fullName: string | null;
    phoneNumber: string | null;
    streetLine1: string;
    streetLine2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    defaultShippingAddress: boolean | null;
    defaultBillingAddress: boolean | null;
    country: { code: string; name: string };
}

export interface CustomerAddressInput {
    fullName: string;
    phoneNumber: string;
    streetLine1: string;
    streetLine2?: string;
    city: string;
    province: string;
    postalCode: string;
    countryCode: string;
    defaultShippingAddress?: boolean;
    defaultBillingAddress?: boolean;
}

export interface CustomerAddressUpdateInput extends CustomerAddressInput {
    id: string;
}

export interface RegisterCustomerInput {
    emailAddress: string;
    firstName: string;
    lastName: string;
    password: string;
}

export interface ReferralProgram {
    channelId: string;
    enabled: boolean;
    rewardRate: number;
    releaseDelayDays: number;
    currencyCode?: string;
    minimumOrderAmount: number;
    maxRewardPerOrder?: number | null;
    allowBalanceSpend: boolean;
    attributionWindowDays: number;
    defaultPosterTemplate: string;
    posterTemplates: string[];
    posterTemplateConfigs?: ReferralPosterTemplate[];
}

export interface ReferralPosterAsset {
    id: string;
    preview: string;
    source: string;
    width: number;
    height: number;
}

export interface ReferralPosterTemplate {
    id: string;
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: string;
    posterBackgroundAsset: ReferralPosterAsset | null;
    shareBackgroundAsset: ReferralPosterAsset | null;
    titleZh: string;
    titleEn: string;
    headlineZh: string;
    headlineEn: string;
    rewardTextZh: string;
    rewardTextEn: string;
    siteIntroZh: string;
    siteIntroEn: string;
    serviceTextZh: string;
    serviceTextEn: string;
    featureOneTitleZh: string;
    featureOneTitleEn: string;
    featureOneTextZh: string;
    featureOneTextEn: string;
    featureTwoTitleZh: string;
    featureTwoTitleEn: string;
    featureTwoTextZh: string;
    featureTwoTextEn: string;
    featureThreeTitleZh: string;
    featureThreeTitleEn: string;
    featureThreeTextZh: string;
    featureThreeTextEn: string;
    qrEyebrowZh: string;
    qrEyebrowEn: string;
    qrTitleZh: string;
    qrTitleEn: string;
    qrDescriptionZh: string;
    qrDescriptionEn: string;
    sceneOneZh: string;
    sceneOneEn: string;
    sceneTwoZh: string;
    sceneTwoEn: string;
    sceneThreeZh: string;
    sceneThreeEn: string;
    sceneFourZh: string;
    sceneFourEn: string;
    ctaTextZh: string;
    ctaTextEn: string;
    footerTitleZh: string;
    footerTitleEn: string;
    footerTextZh: string;
    footerTextEn: string;
    foregroundColor: string;
    accentColor: string;
    overlayOpacity: number;
}

export interface ReferralWallet {
    id: string;
    createdAt: string;
    updatedAt: string;
    currencyCode: string;
    availableBalance: number;
    pendingBalance: number;
    reservedBalance: number;
}

export interface ReferralRewardSummary {
    currencyCode: string;
    grossReward: number;
    clawedBackReward: number;
}

export interface ReferralInvitee {
    id: string;
    displayName: string;
    boundAt: string;
    firstPaidOrderAt?: string | null;
}

export interface ReferralLedgerEntry {
    id: string;
    createdAt: string;
    eventType: string;
    currencyCode: string;
    availableDelta: number;
    pendingDelta: number;
    reservedDelta: number;
    availableAfter: number;
    pendingAfter: number;
    reservedAfter: number;
    orderId?: string | null;
    refundId?: string | null;
    withdrawalId?: string | null;
    actorType: string;
    note?: string | null;
}

export interface MyReferralOverview {
    enabled: boolean;
    rewardRate: number;
    releaseDelayDays: number;
    inviteCode: string;
    wallets: ReferralWallet[];
    invitedCount: number;
    purchasedInviteeCount: number;
    rewardSummaries: ReferralRewardSummary[];
    invitees: ReferralInvitee[];
    ledger: ReferralLedgerEntry[];
}

export interface ReferralBalancePaymentResult {
    order: Order;
    wallet: ReferralWallet;
    amount: number;
}

export interface ActiveCustomer {
    id: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber: string | null;
    addresses: CustomerAddress[] | null;
    orders: { items: OrderSummary[]; totalItems: number };
}

export type StorefrontCartState = 'OPEN' | 'PAYMENT_PENDING';
export type StorefrontCartSelectionState = 'NONE' | 'PARTIAL' | 'ALL';

export interface StorefrontCartLine {
    id: string;
    quantity: number;
    selected: boolean;
    available: boolean;
    productVariant: ProductVariant | null;
}

export interface StorefrontCart {
    id: string;
    revision: number;
    state: StorefrontCartState;
    projectedRevision: number | null;
    totalQuantity: number;
    selectedLineCount: number;
    selectedQuantity: number;
    selectionState: StorefrontCartSelectionState;
    lines: StorefrontCartLine[];
    checkoutOrder: Order | null;
}

export interface StorefrontCartCheckout {
    id: string;
    cartRevision: number;
    state: 'PREPARED' | 'PLACED' | 'ABANDONED';
    completedAt: string | null;
}

export interface StorefrontCheckoutSession {
    cart: StorefrontCart;
    order: Order;
    checkout: StorefrontCartCheckout | null;
}

export interface ShippingMethod {
    id: string;
    code: string;
    name: string;
    description: string;
    priceWithTax: number;
    metadata?: {
        physicalSubtotalWithTax?: number;
        physicalQuantity?: number;
        freeShippingThreshold?: number;
        freeShippingApplied?: boolean;
        estimateMinDays?: number;
        estimateMaxDays?: number;
    } | null;
}

export interface PaymentMethod {
    id: string;
    code: string;
    name: string;
    description: string;
    isEligible: boolean;
    eligibilityMessage: string | null;
}

export interface MarketConfig {
    code: MarketCode;
    defaultLanguageCode: VendureLanguageCode;
    currencyCode: string;
    countryCode: string;
    locale: string;
    label: string;
}

export interface StorefrontConfig {
    code: string;
    defaultLanguageCode: string;
    defaultCurrencyCode: string;
    availableCountries: Array<{
        code: string;
        name: string;
    }>;
    logoUrl?: string | null;
    description?: string | null;
    currencyConfiguration?: StorefrontCurrencyConfiguration;
    customFields: {
        storefrontNameZh?: string | null;
        storefrontNameEn?: string | null;
    };
}

export interface StorefrontCurrencyConfiguration {
    defaultCurrencyCode: string;
    availableCurrencyCodes: string[];
    selectorEnabled: boolean;
    cnyToMyrRate: number;
    rateUpdatedAt?: string | null;
    usdtDisplayEnabled: boolean;
    usdtMarkupPercent: number;
    cnyPerUsdtRate: number | null;
    myrPerUsdtRate: number | null;
    usdtRateSource: string | null;
    usdtRateUpdatedAt: string | null;
    usdtRateAvailable: boolean;
}

export interface StorefrontUsdtCheckoutQuote {
    id: string;
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
    paymentStatus: 'PENDING' | 'SETTLED' | 'MANUAL_REVIEW' | 'EXPIRED';
    transactionId: string | null;
    settledAt: string | null;
    createdAt: string;
    expiresAt: string;
}

export type StorefrontContentBlockType =
    | 'HERO'
    | 'NOTICE'
    | 'QUICK_LINKS'
    | 'CATEGORY_AD'
    | 'FEATURED_COLLECTION'
    | 'COUPONS'
    | 'TRUST_BAR'
    | 'CORE_CATEGORIES'
    | 'FLASH_SALE'
    | 'BEST_SELLERS'
    | 'RECOMMENDATIONS'
    | 'STORY'
    | 'LEGAL'
    | 'SUPPORT'
    | 'AUTH_LOGIN'
    | 'AUTH_REGISTER'
    | 'NAVIGATION'
    | 'CLIENT_PLUGINS'
    | 'CUSTOM';

export type StorefrontContentLayoutVariant =
    'AUTO' | 'HERO_OVERLAY' | 'TICKER' | 'ICON_GRID' | 'CARD_GRID' | 'PRODUCT_GRID' | 'RICH_TEXT' | 'CUSTOM';

export type StorefrontContentTargetType =
    'NONE' | 'URL' | 'PRODUCT' | 'COLLECTION' | 'CATEGORY' | 'SEARCH' | 'PAGE' | 'SUPPORT' | 'COUPON';

export interface StorefrontContentItem {
    id: string;
    enabled: boolean;
    position: number;
    imageUrl: string | null;
    targetType: StorefrontContentTargetType;
    targetValue: string | null;
    settings?: Record<string, unknown> | null;
    label: string;
    description: string;
}

export interface StorefrontContentBlock {
    id: string;
    code: string;
    internalName?: string;
    type: StorefrontContentBlockType;
    layoutVariant?: StorefrontContentLayoutVariant;
    enabled: boolean;
    position: number;
    startsAt: string | null;
    endsAt: string | null;
    imageUrl: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    targetType: StorefrontContentTargetType;
    targetValue: string | null;
    settings?: Record<string, unknown> | null;
    title: string;
    subtitle: string;
    body: string;
    ctaLabel: string;
    items: StorefrontContentItem[];
}

export interface StorefrontContentSettings {
    heroAutoplayIntervalSeconds: number;
    configuredBlockTypes?: StorefrontContentBlockType[];
}

export type StorefrontCouponCampaignKind =
    'ORDER_FIXED' | 'ORDER_PERCENTAGE' | 'COLLECTION_PERCENTAGE' | 'PRODUCT_PERCENTAGE';

export interface StorefrontCouponCampaign {
    id: string;
    name: string;
    kind: StorefrontCouponCampaignKind;
    startsAt: string | null;
    endsAt: string | null;
    claimStartsAt: string | null;
    claimEndsAt: string | null;
    validityDays: number | null;
    minimumSpend: number;
    currencyCode?: string;
    discountAmount: number | null;
    discountRate: number | null;
    remainingIssueCount: number | null;
    claimed: boolean;
    claimable: boolean;
}

export type StoreCustomerCouponStatus = 'AVAILABLE' | 'LOCKED' | 'USED' | 'RETURNED' | 'EXPIRED' | 'REVOKED';

export interface StoreCustomerCoupon {
    id: string;
    campaignId: string;
    campaignName: string;
    campaignKind: StorefrontCouponCampaignKind;
    status: StoreCustomerCouponStatus;
    minimumSpend: number;
    currencyCode?: string;
    discountAmount: number | null;
    discountRate: number | null;
    claimedAt: string;
    validFrom: string;
    validUntil: string | null;
    lockedAt: string | null;
    usedAt: string | null;
    returnedAt: string | null;
    expiredAt: string | null;
    lockedOrderId: string | null;
    usedOrderId: string | null;
    returnCount: number;
    usable: boolean;
}

export interface StoreCouponUsageRecord {
    id: string;
    customerCouponId: string;
    campaignId: string;
    campaignName: string;
    campaignKind: StorefrontCouponCampaignKind;
    status: 'USED' | 'REFUNDED';
    currencyCode: string;
    minimumSpend: number;
    discountAmount: number | null;
    discountRate: number | null;
    savedAmount: number;
    usedAt: string;
    refundedAt: string | null;
    orderId: string;
    orderCode: string;
}

export interface StorefrontFlashSaleItem {
    productId: string;
    productVariantId: string;
    productName: string;
    variantName: string;
    originalPrice: number;
    salePrice: number;
    currencyCode: string;
    imageUrl: string | null;
}

export interface StorefrontFlashSale {
    id: string;
    startsAt: string | null;
    endsAt: string | null;
    items: StorefrontFlashSaleItem[];
}

export interface StorefrontSystemAnnouncement {
    id: string;
    title: string;
    content: string;
    linkUrl: string | null;
    startsAt: string | null;
    endsAt: string | null;
}

export interface StorefrontContentResponse {
    blocks: StorefrontContentBlock[];
    settings: StorefrontContentSettings;
    coupons: StorefrontCouponCampaign[];
    flashSales: StorefrontFlashSale[];
    systemAnnouncements: StorefrontSystemAnnouncement[];
}

export type ImageReferenceMode = 'NONE' | 'STYLE' | 'COMPOSITION' | 'IDENTITY' | 'PRODUCT' | 'EDIT';
export type ImageResolution = '1K' | '2K' | '4K';
export type ImageGenerationState =
    'QUEUED' | 'RUNNING' | 'PARTIAL_SUCCESS' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
export type ImageOutputState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';

export interface ImageStudioModel {
    id: string;
    code: string;
    displayNameZh: string;
    displayNameEn: string;
    descriptionZh: string;
    descriptionEn: string;
    officialModelId: string;
    unitPrice: number;
    unitPrice2K: number;
    unitPrice4K: number;
    resolutionOptions: Array<{
        resolution: ImageResolution;
        unitPrice: number;
        supportedAspectRatios: string[];
    }>;
    currencyCode: string;
    position: number;
    isDefault: boolean;
    healthStatus: string;
    freeImageEnabled: boolean;
    dailyFreeImageLimit: number;
    dailyFreeImageUnlimited: boolean;
    paidAfterFreeEnabled: boolean;
    dailyGenerationSafetyLimit: number;
}

export interface ImageStudioConfig {
    enabled: boolean;
    promptOptimizationEnabled: boolean;
    promptOptimizerModelIds: string[];
    promptRateLimitPerMinute: number;
    promptDailyFreeLimit: number;
    promptDailyFreeUnlimited: boolean;
    paidPromptOptimizationEnabled: boolean;
    paidPromptOptimizationPrice: number;
    paidPromptOptimizationCurrencyCode: string;
    defaultModelCode: string;
    termsVersion: string;
    termsZh: string;
    termsEn: string;
    outputRetentionDays: number;
    referenceRetentionHours: number;
    maxReferenceBytes: number;
    maxReferencePixels: number;
    maxQuantity: number;
    models: ImageStudioModel[];
}

export interface ImageStudioWallet {
    availableBalance: number;
    currencyCode: string;
}

export interface ImagePrivateAssetView {
    id: string;
    originalName: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    expiresAt: string;
    previewUrl?: string | null;
}

export interface ImageGenerationOutput {
    id: string;
    outputIndex: number;
    state: ImageOutputState;
    attemptCount: number;
    errorMessage?: string | null;
    failureCode?: string | null;
    completedAt?: string | null;
    refundedAt?: string | null;
    billingMode: string;
    chargeAmount: number;
    width?: number | null;
    height?: number | null;
    imageUrl?: string | null;
    downloadUrl?: string | null;
}

export interface ImageGenerationJob {
    id: string;
    createdAt: string;
    updatedAt: string;
    state: ImageGenerationState;
    modelCodeSnapshot: string;
    modelNameSnapshot: string;
    officialModelIdSnapshot: string;
    originalPrompt: string;
    finalPrompt: string;
    promptSkillHash: string;
    referenceMode: ImageReferenceMode;
    referenceAsset?: ImagePrivateAssetView | null;
    aspectRatio: string;
    resolution: ImageResolution;
    quantity: number;
    unitPriceSnapshot: number;
    reservedAmount: number;
    expectedChargeAmount: number;
    freeQuantityReserved: number;
    freeQuantityCaptured: number;
    paidQuantityReserved: number;
    capturedAmount: number;
    releasedAmount: number;
    currencyCode: string;
    termsVersion: string;
    errorMessage?: string | null;
    completedAt?: string | null;
    outputs: ImageGenerationOutput[];
}

export interface ImagePromptOptimizationResult {
    originalPrompt: string;
    optimizedPrompt: string;
    promptSpec: Record<string, unknown>;
    source: 'MODEL' | 'FALLBACK';
    optimizerModelId?: string | null;
    recommendedModelCode: string;
    recommendationReason: string;
    promptSkillHash: string;
    billingMode: string;
    chargedAmount: number;
    currencyCode: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    actualCostMicrounits?: number | null;
    costCurrency?: string | null;
    promptQuota: ImagePromptQuotaStatus;
}

export interface ImageQuotaWindowStatus {
    limit: number;
    unlimited: boolean;
    reserved: number;
    consumed: number;
    remaining: number;
    windowEndsAt: string;
}

export interface ImagePromptQuotaStatus {
    minute: ImageQuotaWindowStatus;
    daily: ImageQuotaWindowStatus;
    paidEnabled: boolean;
    paidPrice: number;
    currencyCode: string;
}

export interface ImageModelQuotaStatus {
    modelCode: string;
    freeImageEnabled: boolean;
    paidAfterFreeEnabled: boolean;
    unitPrice: number;
    currencyCode: string;
    free: ImageQuotaWindowStatus;
    safety: ImageQuotaWindowStatus;
}

export interface ImageModelRecommendation {
    modelCode: string;
    modelName: string;
    officialModelId: string;
    unitPrice: number;
    currencyCode: string;
    reason: string;
    promptSkillHash: string;
}

export interface CreateImageGenerationInput {
    modelCode: string;
    prompt: string;
    optimizedPrompt?: string | null;
    referenceAssetId?: string | null;
    referenceAssetIds?: string[] | null;
    referenceMode?: ImageReferenceMode | null;
    referenceInstruction?: string | null;
    aspectRatio: string;
    resolution: ImageResolution;
    quantity: number;
    expectedUnitPrice: number;
    expectedChargeAmount: number;
    currencyCode: string;
    idempotencyKey: string;
    termsAccepted: boolean;
}
