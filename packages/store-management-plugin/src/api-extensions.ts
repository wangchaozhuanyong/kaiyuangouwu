import { gql } from 'graphql-tag';

import { storeCustomerCouponSchema } from './promotion/store-coupon-api.schema';
import { storeProfileInputSchema } from './store-profile-input.schema';
import { storefrontBrandingSchema, storefrontPreviewBrandingSchema } from './storefront-branding.schema';
import { trafficAdminSchema, trafficShopSchema } from './traffic/traffic-api.schema';

const referralPosterFields = `
        design: JSON
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        enabled: Boolean!
        position: Int!
        layoutVariant: String!
        posterBackgroundAsset: Asset
        shareBackgroundAsset: Asset
        titleZh: String!
        titleEn: String!
        headlineZh: String!
        headlineEn: String!
        rewardTextZh: String!
        rewardTextEn: String!
        siteIntroZh: String!
        siteIntroEn: String!
        serviceTextZh: String!
        serviceTextEn: String!
        featureOneTitleZh: String!
        featureOneTitleEn: String!
        featureOneTextZh: String!
        featureOneTextEn: String!
        featureTwoTitleZh: String!
        featureTwoTitleEn: String!
        featureTwoTextZh: String!
        featureTwoTextEn: String!
        featureThreeTitleZh: String!
        featureThreeTitleEn: String!
        featureThreeTextZh: String!
        featureThreeTextEn: String!
        qrEyebrowZh: String!
        qrEyebrowEn: String!
        qrTitleZh: String!
        qrTitleEn: String!
        qrDescriptionZh: String!
        qrDescriptionEn: String!
        sceneOneZh: String!
        sceneOneEn: String!
        sceneTwoZh: String!
        sceneTwoEn: String!
        sceneThreeZh: String!
        sceneThreeEn: String!
        sceneFourZh: String!
        sceneFourEn: String!
        ctaTextZh: String!
        ctaTextEn: String!
        footerTitleZh: String!
        footerTitleEn: String!
        footerTextZh: String!
        footerTextEn: String!
        foregroundColor: String!
        accentColor: String!
        overlayOpacity: Int!
`;

const commonTypes = gql`
    enum DataSubjectRequestType {
        EXPORT
        ACCOUNT_CLOSURE
    }

    enum DataSubjectRequestStatus {
        PENDING
        PROCESSING
        BLOCKED
        FAILED
        FULFILLED
        CANCELLED
    }

    type DataSubjectRequest implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        requestType: DataSubjectRequestType!
        status: DataSubjectRequestStatus!
        requestedAt: DateTime!
        dueAt: DateTime
        nextAttemptAt: DateTime
        lastAttemptAt: DateTime
        attemptCount: Int!
        blockersJson: String
        lastError: String
        resultDigest: String
        resultSummaryJson: String
        completedAt: DateTime
        cancelledAt: DateTime
    }

    type DataSubjectExportPayload {
        request: DataSubjectRequest!
        fileName: String!
        mimeType: String!
        content: String!
        sha256: String!
    }

    enum DataConsentPurpose {
        TERMS
        PRIVACY
        ANALYTICS
    }

    enum DataConsentAction {
        GRANTED
        WITHDRAWN
    }

    type DataConsentRecord implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        purpose: DataConsentPurpose!
        action: DataConsentAction!
        policyVersion: String!
        policyDigest: String!
        locale: String!
        source: String!
        recordedAt: DateTime!
    }

    input StorefrontRegistrationConsentInput {
        termsAccepted: Boolean!
        privacyAcknowledged: Boolean!
        locale: String!
    }

    input StorefrontAnalyticsConsentInput {
        consentId: String!
        granted: Boolean!
        locale: String!
    }

    enum DataRetentionStatus {
        PENDING
        BLOCKED_REFERENCE
        FAILED
        RESTORED
        PURGED
    }

    type DataRetentionRecord implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        resourceType: String!
        resourceKey: String!
        policyCode: String!
        reason: String!
        status: DataRetentionStatus!
        quarantinedAt: DateTime!
        purgeAfter: DateTime!
        nextAttemptAt: DateTime
        legalHold: Boolean!
        legalHoldReason: String
        legalHoldChangedByUserId: ID
        legalHoldChangedAt: DateTime
        attemptCount: Int!
        lastAttemptAt: DateTime
        lastError: String
        completedAt: DateTime
    }

    type CustomerAvatarHistoryEntry {
        id: ID!
        status: DataRetentionStatus!
        quarantinedAt: DateTime!
        purgeAfter: DateTime!
        legalHold: Boolean!
        asset: Asset
    }

    enum StoreProfileStatus {
        DRAFT
        ACTIVE
        SUSPENDED
    }

    enum StorefrontPromotionContentType {
        HTML
        MARKDOWN
    }

    enum StoreCouponCampaignKind {
        ORDER_FIXED
        ORDER_PERCENTAGE
        COLLECTION_PERCENTAGE
        PRODUCT_PERCENTAGE
    }

    enum StoreCouponStackPolicy {
        EXCLUSIVE
        STACKABLE
    }

    enum StoreCustomerCouponStatus {
        AVAILABLE
        LOCKED
        USED
        RETURNED
        EXPIRED
        REVOKED
    }

    enum StoreCurrencyRateMode {
        AUTO
        MANUAL
    }

    enum StoreCurrencyRoundingMode {
        CENT
        TENTH
        WHOLE
    }

    enum StoreUsdtRateScheduleMode {
        INTERVAL
        DAILY
    }

    type StoreCurrencyConfiguration {
        channelId: ID!
        channelCode: String!
        updatedAt: DateTime!
        defaultCurrencyCode: CurrencyCode!
        availableCurrencyCodes: [CurrencyCode!]!
        selectorEnabled: Boolean!
        rateMode: StoreCurrencyRateMode!
        cnyToMyrRate: Float!
        markupPercent: Float!
        roundingMode: StoreCurrencyRoundingMode!
        rateSource: String
        rateUpdatedAt: DateTime
        pricesUpdatedAt: DateTime
        syncedPriceCount: Int!
        usdtDisplayEnabled: Boolean!
        usdtMarkupPercent: Float!
        usdtRateScheduleMode: StoreUsdtRateScheduleMode!
        usdtRateIntervalMinutes: Int!
        usdtRateDailyTime: String!
        cnyPerUsdtRate: Float
        myrPerUsdtRate: Float
        usdtRateSource: String
        usdtRateUpdatedAt: DateTime
        usdtRateNextRunAt: DateTime!
        usdtRateExpiresAt: DateTime
        usdtRateAvailable: Boolean!
        usdtPaymentConfigured: Boolean!
        usdtPaymentNetwork: String!
        usdtReceivingAddressMasked: String
        usdtReceivingAddressFingerprint: String
        usdtWalletReviewStatus: String!
    }

    type StorefrontUsdtCheckoutQuote {
        id: ID!
        fiatCurrencyCode: String!
        fiatAmount: Money!
        fiatPerUsdtRate: Float!
        markupPercent: Float!
        usdtAmount: Float!
        source: String!
        network: String!
        tokenContractAddress: String!
        receivingAddress: String!
        receivingAddressFingerprint: String!
        paymentStatus: String!
        transactionId: String
        settledAt: DateTime
        createdAt: DateTime!
        expiresAt: DateTime!
    }

    type StoreUsdtPaymentIntent {
        id: ID!
        channelId: ID!
        channelCode: String!
        orderId: ID!
        orderCode: String!
        network: String!
        fiatCurrencyCode: String!
        fiatAmount: Money!
        fiatPerUsdtRate: Float!
        markupPercent: Float!
        rateSource: String!
        receivingAddressMasked: String!
        receivingAddressFingerprint: String!
        baseUsdtAmount: Float!
        expectedUsdtAmount: Float!
        receivedUsdtAmount: Float
        senderAddressMasked: String
        status: String!
        transactionId: String
        failureReason: String
        createdAt: DateTime!
        expiresAt: DateTime!
        settledAt: DateTime
        blockNumber: Int
        blockTimestamp: DateTime
        lastCheckedAt: DateTime
        manualReviewCode: String
        resolvedAt: DateTime
        resolvedByUserId: ID
        resolutionActionId: ID
    }

    type StoreUsdtWallet {
        channelId: ID!
        channelCode: String!
        reviewStatus: String!
        configured: Boolean!
        network: String!
        activeReceivingAddressMasked: String
        activeReceivingAddressFingerprint: String
        pendingReceivingAddress: String
        pendingReceivingAddressFingerprint: String
        canReview: Boolean!
        submittedAt: DateTime
        reviewedAt: DateTime
        rejectionReason: String
    }

    type StoreUsdtFiatTotal {
        currencyCode: String!
        amount: Money!
    }

    type StoreUsdtChannelPaymentStats {
        channelId: ID!
        channelCode: String!
        totalCount: Int!
        pendingCount: Int!
        settledCount: Int!
        manualReviewCount: Int!
        expiredCount: Int!
        resolvedCount: Int!
        expectedUsdtTotal: Float!
        receivedUsdtTotal: Float!
        fiatTotals: [StoreUsdtFiatTotal!]!
    }

    type StorePaymentMethodStats {
        channelId: ID!
        channelCode: String!
        paymentMethodCode: String!
        currencyCode: CurrencyCode!
        settledCount: Int!
        refundCount: Int!
        grossAmount: Money!
        refundedAmount: Money!
        netAmount: Money!
    }

    type StorePaymentDetail {
        id: ID!
        channelId: ID!
        channelCode: String!
        orderId: ID!
        orderCode: String!
        paymentMethodCode: String!
        paymentState: String!
        currencyCode: CurrencyCode!
        amount: Money!
        refundedAmount: Money!
        netAmount: Money!
        transactionId: String
        createdAt: DateTime!
    }

    input StorePaymentReportOptionsInput {
        from: DateTime
        to: DateTime
        skip: Int
        take: Int
    }

    type StorePaymentDetailList {
        items: [StorePaymentDetail!]!
        totalItems: Int!
    }

    input StoreUsdtManualRefundInput {
        paymentId: ID!
        amount: Money!
        usdtAmount: String!
        recipientAddress: String!
        transactionId: String!
        reason: String!
    }

    type StoreUsdtManualRefund {
        id: ID!
        refundId: ID!
        channelId: ID!
        channelCode: String!
        paymentId: ID!
        orderId: ID!
        orderCode: String!
        currencyCode: CurrencyCode!
        amount: Money!
        usdtAmount: String!
        network: String!
        transactionId: String!
        fromAddress: String!
        toAddress: String!
        blockNumber: Int!
        blockTimestamp: DateTime!
        reason: String!
        operatorUserId: ID!
        state: String!
        createdAt: DateTime!
    }

    type StoreUsdtManualRefundList {
        items: [StoreUsdtManualRefund!]!
        totalItems: Int!
    }

    enum StoreUsdtReconciliationActionType {
        RETRY_SETTLEMENT
        CONFIRM_EXTERNAL_REFUND
    }

    input ResolveStoreUsdtPaymentIntentInput {
        id: ID!
        action: StoreUsdtReconciliationActionType!
        reason: String!
        transactionId: String
        usdtAmount: String
        recipientAddress: String
    }

    type StoreUsdtReconciliationAction {
        id: ID!
        channelId: ID!
        intentId: ID!
        orderId: ID!
        action: StoreUsdtReconciliationActionType!
        outcome: String!
        operatorUserId: ID!
        reason: String!
        network: String
        transactionId: String
        usdtAmount: String
        fromAddress: String
        toAddress: String
        blockNumber: Int
        blockTimestamp: DateTime
        createdAt: DateTime!
    }

    input ReviewStoreUsdtWalletInput {
        channelId: ID!
        approved: Boolean!
        rejectionReason: String
    }

    ${storeCustomerCouponSchema}

    type StoreCouponUsageRecord {
        id: ID!
        customerCouponId: ID!
        campaignId: ID!
        campaignName: String!
        campaignKind: StoreCouponCampaignKind!
        status: String!
        currencyCode: CurrencyCode!
        minimumSpend: Money!
        discountAmount: Money
        discountRate: Float
        savedAmount: Money!
        usedAt: DateTime!
        refundedAt: DateTime
        orderId: ID!
        orderCode: String!
    }

    type ReferralProgram {
        channelId: ID!
        updatedAt: DateTime
        enabled: Boolean!
        rewardRate: Float!
        releaseDelayDays: Int!
        currencyCode: CurrencyCode!
        minimumOrderAmount: Money!
        maxRewardPerOrder: Money
        allowBalanceSpend: Boolean!
        attributionWindowDays: Int!
        defaultPosterTemplate: String!
        posterTemplates: [String!]!
        posterTemplateConfigs: [ReferralPosterTemplate!]!
        systemPosterTemplateConfigs: [ReferralSystemPosterTemplate!]!
    }

    type ReferralPosterTemplate implements Node {
        id: ID!
        ${referralPosterFields}
    }

    type ReferralSystemPosterTemplate {
        id: String!
        ${referralPosterFields}
    }

    type ReferralWallet implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        currencyCode: CurrencyCode!
        availableBalance: Money!
        pendingBalance: Money!
        reservedBalance: Money!
    }

    type ReferralLedgerEntry implements Node {
        id: ID!
        createdAt: DateTime!
        eventType: String!
        currencyCode: CurrencyCode!
        availableDelta: Money!
        pendingDelta: Money!
        reservedDelta: Money!
        availableAfter: Money!
        pendingAfter: Money!
        reservedAfter: Money!
        orderId: ID
        refundId: ID
        withdrawalId: ID
        actorType: String!
        note: String
        customerName: String
        customerEmail: String
    }
`;

export const adminApiExtensions = gql`
    ${storefrontPreviewBrandingSchema}
    ${trafficAdminSchema}
    ${commonTypes}
    ${storeProfileInputSchema}

    input ProvisionStoreAdministratorInput {
        firstName: String!
        lastName: String!
        emailAddress: String!
    }

    input ProvisionStoreInput {
        code: String!
        name: String!
        storefrontNameZh: String!
        storefrontNameEn: String
        templateChannelId: ID!
        administrator: ProvisionStoreAdministratorInput!
    }

    type ProvisionStoreResult {
        sellerId: ID!
        channelId: ID!
        roleId: ID!
        administratorId: ID!
        stockLocationId: ID!
        profileId: ID!
        channelCode: String!
        temporaryPassword: String!
    }

    type StoreProfile implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channel: Channel!
        status: StoreProfileStatus!
        sortOrder: Int!
        descriptionZh: String!
        descriptionEn: String!
        internalNote: String
        logoAsset: Asset
        logoOnLightAsset: Asset
        logoOnDarkAsset: Asset
        taglineZh: String
        taglineEn: String
        brandBackgroundColor: String
        brandPrimaryColor: String
        brandAccentColor: String
        brandHighlightColor: String
        legalEntityName: String
        legalRegistrationCountry: String
        supportEmail: String
        privacyEmail: String
        primaryDomain: String
        storefrontUrl: String
        isOperational: Boolean!
        activationReadiness: StoreActivationReadiness!
    }

    type MerchantInitialPasswordStatus {
        mustChangePassword: Boolean!
    }

    type StoreActivationCheck {
        code: String!
        ready: Boolean!
        message: String!
        messageEn: String!
    }

    type StoreActivationReadiness {
        ready: Boolean!
        checks: [StoreActivationCheck!]!
    }

    type StoreDeprovisionImpact {
        profileId: ID!
        channelId: ID!
        channelCode: String!
        status: StoreProfileStatus!
        isDefaultChannel: Boolean!
        isProvisioningTemplate: Boolean!
        isActiveChannel: Boolean!
        orderCount: Int!
        productCount: Int!
        customerCount: Int!
        administratorCount: Int!
        domainCount: Int!
        extensionRecordCount: Int!
        sellerWillBeDeleted: Boolean!
        roleWillBeDeleted: Boolean!
        blockers: [String!]!
        canDeprovision: Boolean!
    }

    input DeprovisionStoreInput {
        profileId: ID!
        expectedUpdatedAt: DateTime!
        confirmCode: String!
        currentPassword: String!
    }

    type DeprovisionStoreResult {
        channelId: ID!
        channelCode: String!
        deletedAdministratorCount: Int!
        deletedRole: Boolean!
        deletedSeller: Boolean!
    }

    type StoreCommerceConfiguration {
        channelId: ID!
        channelCode: String!
        updatedAt: DateTime!
        currencyCode: CurrencyCode!
        pricesIncludeTax: Boolean!
        countryCode: String
        taxRate: Float!
        taxCategoryName: String
        taxZoneName: String
        shippingZoneName: String
        shippingMethodId: ID
        shippingMethodCode: String!
        shippingMethodNameZh: String!
        shippingMethodNameEn: String!
        shippingDescriptionZh: String!
        shippingDescriptionEn: String!
        baseRate: Money!
        freeShippingThreshold: Money!
        shippingTaxRate: Float!
        shippingPriceIncludesTax: Boolean!
        estimateMinDays: Int!
        estimateMaxDays: Int!
        blockedPostalPrefixes: String!
        ready: Boolean!
    }

    input UpdateMyStoreCommerceConfigurationInput {
        expectedUpdatedAt: DateTime!
        pricesIncludeTax: Boolean!
        countryCode: String!
        taxRate: Float!
        shippingMethodNameZh: String!
        shippingMethodNameEn: String!
        shippingDescriptionZh: String!
        shippingDescriptionEn: String!
        baseRate: Money!
        freeShippingThreshold: Money!
        shippingTaxRate: Float!
        shippingPriceIncludesTax: Boolean!
        estimateMinDays: Int!
        estimateMaxDays: Int!
        blockedPostalPrefixes: String!
    }

    input UpdateStoreCurrencyConfigurationInput {
        expectedUpdatedAt: DateTime!
        defaultCurrencyCode: CurrencyCode!
        availableCurrencyCodes: [CurrencyCode!]!
        selectorEnabled: Boolean!
        rateMode: StoreCurrencyRateMode!
        cnyToMyrRate: Float!
        markupPercent: Float!
        roundingMode: StoreCurrencyRoundingMode!
        usdtDisplayEnabled: Boolean!
        usdtMarkupPercent: Float!
        usdtRateScheduleMode: StoreUsdtRateScheduleMode!
        usdtRateIntervalMinutes: Int!
        usdtRateDailyTime: String!
    }

    enum SystemAnnouncementTargetMode {
        ALL
        SINGLE
        MULTIPLE
    }

    type SystemAnnouncement implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        enabled: Boolean!
        priority: Int!
        targetMode: SystemAnnouncementTargetMode!
        channels: [Channel!]!
        titleZh: String!
        titleEn: String!
        titleEnLocked: Boolean!
        contentZh: String!
        contentEn: String!
        contentEnLocked: Boolean!
        linkUrl: String
        startsAt: DateTime
        endsAt: DateTime
    }

    input CreateSystemAnnouncementInput {
        enabled: Boolean
        priority: Int
        titleZh: String!
        titleEn: String
        titleEnLocked: Boolean
        contentZh: String!
        contentEn: String
        contentEnLocked: Boolean
        linkUrl: String
        startsAt: DateTime
        endsAt: DateTime
        targetMode: SystemAnnouncementTargetMode
        channelIds: [ID!]
    }

    input UpdateSystemAnnouncementInput {
        id: ID!
        enabled: Boolean
        priority: Int
        titleZh: String!
        titleEn: String
        titleEnLocked: Boolean
        contentZh: String!
        contentEn: String
        contentEnLocked: Boolean
        linkUrl: String
        startsAt: DateTime
        endsAt: DateTime
        targetMode: SystemAnnouncementTargetMode
        channelIds: [ID!]
    }

    type StorefrontPromotionPage {
        id: ID
        contentType: StorefrontPromotionContentType!
        draftSource: String!
        publishedSource: String
        isCustomized: Boolean!
        defaultTemplateVersion: Int!
        publishedVersion: Int!
        publishedAt: DateTime
        publicUrl: String
    }

    input UpdateStorefrontPromotionDraftInput {
        contentType: StorefrontPromotionContentType!
        source: String!
    }

    type StoreCouponCampaign {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        couponCode: String!
        kind: StoreCouponCampaignKind!
        enabled: Boolean!
        startsAt: DateTime
        endsAt: DateTime
        minimumSpend: Money!
        currencyCode: CurrencyCode!
        discountAmount: Money
        discountRate: Float
        collectionIds: [ID!]!
        productVariantIds: [ID!]!
        usageLimit: Int
        perCustomerUsageLimit: Int
        claimStartsAt: DateTime
        claimEndsAt: DateTime
        validityDays: Int
        issueLimit: Int
        perCustomerClaimLimit: Int!
        stackPolicy: StoreCouponStackPolicy!
        returnOnCancellation: Boolean!
        returnOnFullRefund: Boolean!
        archivedAt: DateTime
        remainingIssueCount: Int
        claimedCount: Int!
        availableCount: Int!
        lockedCount: Int!
        usedCount: Int!
        returnedCount: Int!
        expiredCount: Int!
        revokedCount: Int!
        redeemedOrderCount: Int!
        refundedOrderCount: Int!
        discountAmountTotal: Money!
        assistedRevenueTotal: Money!
        financialTotals: [StoreCouponFinancialTotal!]!
    }

    type StoreCouponFinancialTotal {
        currencyCode: CurrencyCode!
        discountAmountTotal: Money!
        assistedRevenueTotal: Money!
    }

    input CreateStoreCouponCampaignInput {
        name: String!
        kind: StoreCouponCampaignKind!
        minimumSpend: Money
        discountAmount: Money
        discountRate: Float
        collectionIds: [ID!]
        productIds: [ID!]
        startsAt: DateTime
        endsAt: DateTime
        usageLimit: Int
        perCustomerUsageLimit: Int
        claimStartsAt: DateTime
        claimEndsAt: DateTime
        validityDays: Int
        issueLimit: Int
        perCustomerClaimLimit: Int
        stackPolicy: StoreCouponStackPolicy
        returnOnCancellation: Boolean
        returnOnFullRefund: Boolean
    }

    enum StoreCouponLedgerEventType {
        CLAIMED
        LOCKED
        RELEASED
        REDEEMED
        RETURNED
        EXPIRED
        REVOKED
        REFUND_SETTLED
        CORRECTED
    }

    type StoreCouponLedgerEntry implements Node {
        id: ID!
        createdAt: DateTime!
        eventType: StoreCouponLedgerEventType!
        actorType: String!
        campaignId: ID!
        campaignName: String!
        customerCouponId: ID!
        customerId: ID!
        customerName: String!
        customerEmail: String!
        orderId: ID
        orderCode: String
        refundId: ID
        discountAmount: Money
        note: String
    }

    type StoreCouponLedgerEntryList implements PaginatedList {
        items: [StoreCouponLedgerEntry!]!
        totalItems: Int!
    }

    input StoreCouponLedgerEntryListOptions {
        skip: Int
        take: Int
        campaignId: ID
        customerId: ID
        orderId: ID
        eventType: StoreCouponLedgerEventType
    }

    type StoreCouponDailyMetric {
        date: String!
        currencyCode: CurrencyCode!
        claimedCount: Int!
        redeemedCount: Int!
        refundedCount: Int!
        returnedCount: Int!
        expiredCount: Int!
        revokedCount: Int!
        discountAmountTotal: Money!
        assistedRevenueTotal: Money!
    }

    type StoreCouponOrderAllocation {
        id: ID!
        customerCouponId: ID!
        campaignId: ID!
        campaignName: String!
        status: String!
        currencyCode: CurrencyCode!
        discountAmount: Money!
        discountAmountWithTax: Money!
        refundedAmount: Money!
        appliedAt: DateTime!
        usedAt: DateTime
        releasedAt: DateTime
        refundedAt: DateTime
        refundId: ID
    }

    input StoreFlashSaleVariantPriceInput {
        productVariantId: ID!
        salePrice: Money!
    }

    input CreateStoreFlashSaleInput {
        name: String!
        productIds: [ID!]!
        percentageOff: Float!
        variantPrices: [StoreFlashSaleVariantPriceInput!]
        startsAt: DateTime!
        endsAt: DateTime!
    }

    type StoreFlashSaleItem {
        productId: ID!
        productVariantId: ID!
        productName: String!
        variantName: String!
        originalPrice: Money!
        salePrice: Money!
        currencyCode: CurrencyCode!
        imageUrl: String
    }

    type StoreFlashSale {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        enabled: Boolean!
        startsAt: DateTime
        endsAt: DateTime
        items: [StoreFlashSaleItem!]!
    }

    type StorePromotionToggleResult {
        id: ID!
        enabled: Boolean!
    }

    type StorePromotionNameResult {
        id: ID!
        name: String!
    }

    type StoreCouponCampaignActionResult {
        campaignId: ID!
        affectedCount: Int!
        skippedCount: Int
        failedCount: Int
        outcomes: [StoreCouponActionOutcome!]
    }

    type StoreCouponActionOutcome {
        couponId: ID!
        status: String!
        reason: String!
    }

    input UpdateReferralProgramInput {
        expectedUpdatedAt: DateTime!
        enabled: Boolean!
        rewardRate: Float!
        releaseDelayDays: Int!
        minimumOrderAmount: Money!
        maxRewardPerOrder: Money
        allowBalanceSpend: Boolean!
        attributionWindowDays: Int!
        defaultPosterTemplate: String!
        posterTemplates: [String!]
    }

    input CreateReferralPosterTemplateInput {
        expectedUpdatedAt: DateTime
        name: String!
        enabled: Boolean!
        position: Int!
        layoutVariant: String!
        posterBackgroundAssetId: ID
        shareBackgroundAssetId: ID
        titleZh: String!
        titleEn: String
        headlineZh: String!
        headlineEn: String
        rewardTextZh: String!
        rewardTextEn: String
        siteIntroZh: String!
        siteIntroEn: String
        serviceTextZh: String!
        serviceTextEn: String
        featureOneTitleZh: String
        featureOneTitleEn: String
        featureOneTextZh: String
        featureOneTextEn: String
        featureTwoTitleZh: String
        featureTwoTitleEn: String
        featureTwoTextZh: String
        featureTwoTextEn: String
        featureThreeTitleZh: String
        featureThreeTitleEn: String
        featureThreeTextZh: String
        featureThreeTextEn: String
        qrEyebrowZh: String
        qrEyebrowEn: String
        qrTitleZh: String
        qrTitleEn: String
        qrDescriptionZh: String
        qrDescriptionEn: String
        sceneOneZh: String
        sceneOneEn: String
        sceneTwoZh: String
        sceneTwoEn: String
        sceneThreeZh: String
        sceneThreeEn: String
        sceneFourZh: String
        sceneFourEn: String
        ctaTextZh: String
        ctaTextEn: String
        footerTitleZh: String
        footerTitleEn: String
        footerTextZh: String
        footerTextEn: String
        foregroundColor: String!
        accentColor: String!
        overlayOpacity: Int!
    }

    input UpdateReferralPosterTemplateInput {
        id: ID!
        expectedUpdatedAt: DateTime!
        name: String!
        position: Int!
        layoutVariant: String!
        posterBackgroundAssetId: ID
        shareBackgroundAssetId: ID
        titleZh: String!
        titleEn: String
        headlineZh: String!
        headlineEn: String
        rewardTextZh: String!
        rewardTextEn: String
        siteIntroZh: String!
        siteIntroEn: String
        serviceTextZh: String!
        serviceTextEn: String
        featureOneTitleZh: String
        featureOneTitleEn: String
        featureOneTextZh: String
        featureOneTextEn: String
        featureTwoTitleZh: String
        featureTwoTitleEn: String
        featureTwoTextZh: String
        featureTwoTextEn: String
        featureThreeTitleZh: String
        featureThreeTitleEn: String
        featureThreeTextZh: String
        featureThreeTextEn: String
        qrEyebrowZh: String
        qrEyebrowEn: String
        qrTitleZh: String
        qrTitleEn: String
        qrDescriptionZh: String
        qrDescriptionEn: String
        sceneOneZh: String
        sceneOneEn: String
        sceneTwoZh: String
        sceneTwoEn: String
        sceneThreeZh: String
        sceneThreeEn: String
        sceneFourZh: String
        sceneFourEn: String
        ctaTextZh: String
        ctaTextEn: String
        footerTitleZh: String
        footerTitleEn: String
        footerTextZh: String
        footerTextEn: String
        foregroundColor: String!
        accentColor: String!
        overlayOpacity: Int!
    }

    type ReferralRelationshipAdmin implements Node {
        id: ID!
        createdAt: DateTime!
        inviterCustomerId: ID!
        inviterName: String!
        inviterEmail: String!
        inviteeCustomerId: ID!
        inviteeName: String!
        inviteeEmail: String!
        inviteCodeSnapshot: String!
        source: String!
        boundAt: DateTime!
        firstPaidOrderAt: DateTime
    }

    type ReferralRelationshipAdminList implements PaginatedList {
        items: [ReferralRelationshipAdmin!]!
        totalItems: Int!
    }

    type ReferralInviterSummary {
        customerId: ID!
        customerName: String!
        customerEmail: String!
        inviteCode: String!
        invitedCount: Int!
        purchasedInviteeCount: Int!
    }

    type ReferralInviterSummaryList {
        items: [ReferralInviterSummary!]!
        totalItems: Int!
    }

    type ReferralLedgerAdminList implements PaginatedList {
        items: [ReferralLedgerEntry!]!
        totalItems: Int!
    }

    type ReferralRewardAdmin implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        orderId: ID!
        orderCode: String!
        inviterCustomerId: ID!
        inviterName: String!
        inviterEmail: String!
        inviteeCustomerId: ID!
        inviteeName: String!
        inviteeEmail: String!
        currencyCode: CurrencyCode!
        rewardRate: Float!
        eligibleAmount: Money!
        rewardAmount: Money!
        releasedAmount: Money!
        clawedBackAmount: Money!
        settledRefundTotal: Money!
        settledEligibleRefundTotal: Money!
        orderTotalWithTax: Money!
        status: String!
        earnedAt: DateTime!
        availableAt: DateTime!
        releasedAt: DateTime
    }

    type ReferralRewardAdminList implements PaginatedList {
        items: [ReferralRewardAdmin!]!
        totalItems: Int!
    }

    type ReferralSalesMetric {
        currencyCode: CurrencyCode!
        sales: Money!
    }

    type ReferralTodayMetrics {
        businessDate: String!
        visitorCount: Int
        newCustomerCount: Int!
        consumerCount: Int!
        firstTimeConsumerCount: Int!
        returningConsumerCount: Int!
        orderCount: Int!
        todayInvitedCount: Int!
        todayInvitedPurchaserCount: Int!
        salesByCurrency: [ReferralSalesMetric!]!
    }

    type ReferralBalanceAuditItem {
        walletId: ID!
        customerId: ID!
        customerName: String!
        customerEmail: String!
        currencyCode: CurrencyCode!
        actualAvailableBalance: Money!
        actualPendingBalance: Money!
        actualReservedBalance: Money!
        ledgerAvailableBalance: Money!
        ledgerPendingBalance: Money!
        ledgerReservedBalance: Money!
        availableDifference: Money!
        pendingDifference: Money!
        reservedDifference: Money!
    }

    type ReferralBalanceAuditResult {
        auditedWallets: Int!
        items: [ReferralBalanceAuditItem!]!
    }

    type ReferralWithdrawal implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        customerId: ID!
        customerName: String!
        customerEmail: String!
        currencyCode: CurrencyCode!
        amount: Money!
        status: String!
        payoutMethod: String!
        payoutAccountMasked: String!
        externalReference: String
        note: String
        requestedByAdministratorId: ID
        processedByAdministratorId: ID
        approvedAt: DateTime
        paidAt: DateTime
        rejectedAt: DateTime
        cancelledAt: DateTime
    }

    type ReferralWithdrawalList implements PaginatedList {
        items: [ReferralWithdrawal!]!
        totalItems: Int!
    }

    input CreateReferralWithdrawalInput {
        customerId: ID!
        currencyCode: CurrencyCode!
        amount: Money!
        payoutMethod: String!
        payoutAccountMasked: String!
        note: String
    }

    input ProcessReferralWithdrawalInput {
        id: ID!
        status: String!
        externalReference: String
        note: String
    }

    enum CustomerOperationsSegment {
        NEW
        LEAD
        ACTIVE
        LOYAL
        VIP
        AT_RISK
        DORMANT
    }

    enum CustomerChurnRisk {
        NONE
        LOW
        MEDIUM
        HIGH
    }

    enum CustomerFollowUpStatus {
        OPEN
        COMPLETED
        DISMISSED
    }

    enum CustomerFollowUpPriority {
        P1
        P2
        P3
    }

    enum CustomerFollowUpOutcome {
        CONTACTED
        RESOLVED
        NO_RESPONSE
        DO_NOT_CONTACT
        NOT_NEEDED
    }

    enum CustomerFollowUpAction {
        RESCHEDULE
        COMPLETE
        DISMISS
    }

    type CustomerCurrencyMetric {
        currencyCode: CurrencyCode!
        orderCount: Int!
        grossRevenue: Money!
        refundTotal: Money!
        netLifetimeValue: Money!
        averageOrderValue: Money!
    }

    type CustomerOperationsProfile implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        customer: Customer!
        segment: CustomerOperationsSegment!
        churnRisk: CustomerChurnRisk!
        recencyScore: Int!
        frequencyScore: Int!
        monetaryScore: Int!
        recencyDays: Int
        orderCount: Int!
        currencyCode: CurrencyCode!
        grossRevenue: Money!
        refundTotal: Money!
        netLifetimeValue: Money!
        averageOrderValue: Money!
        currencyMetrics: [CustomerCurrencyMetric!]!
        serviceInteractionCount: Int!
        afterSalesCount: Int!
        openAfterSalesCount: Int!
        lastOrderAt: DateTime
        lastServiceAt: DateTime
        nextFollowUpAt: DateTime
        doNotContact: Boolean!
        reasons: [String!]!
        evaluationVersion: String!
        lastEvaluatedAt: DateTime!
    }

    type CustomerOperationsProfileList implements PaginatedList {
        items: [CustomerOperationsProfile!]!
        totalItems: Int!
    }

    type CustomerFollowUpEvent implements Node {
        id: ID!
        createdAt: DateTime!
        eventType: String!
        actorType: String!
        actorLabel: String!
        note: String!
        payloadJson: String
    }

    type CustomerFollowUp implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        customer: Customer!
        profile: CustomerOperationsProfile!
        status: CustomerFollowUpStatus!
        source: String!
        priority: CustomerFollowUpPriority!
        reasonCode: String!
        title: String!
        note: String!
        dueAt: DateTime!
        ownerUserId: ID
        outcomeCode: CustomerFollowUpOutcome
        outcomeNote: String
        completedAt: DateTime
        completedByUserId: ID
        overdue: Boolean!
        events: [CustomerFollowUpEvent!]!
    }

    type CustomerFollowUpList implements PaginatedList {
        items: [CustomerFollowUp!]!
        totalItems: Int!
    }

    input CustomerOperationsProfileListOptions {
        segment: CustomerOperationsSegment
        churnRisk: CustomerChurnRisk
        followUpDue: Boolean
        search: String
        skip: Int
        take: Int
    }

    input CustomerFollowUpListOptions {
        status: CustomerFollowUpStatus
        overdue: Boolean
        priority: CustomerFollowUpPriority
        customerId: ID
        skip: Int
        take: Int
    }

    input CreateCustomerFollowUpInput {
        customerId: ID!
        priority: CustomerFollowUpPriority!
        dueAt: DateTime!
        title: String!
        note: String!
        idempotencyKey: String!
    }

    input UpdateCustomerFollowUpInput {
        id: ID!
        action: CustomerFollowUpAction!
        dueAt: DateTime
        outcomeCode: CustomerFollowUpOutcome
        note: String!
        idempotencyKey: String!
    }

    enum GovernedConfigNamespace {
        FRAUD_RULES
        REPORT_SCHEDULE
    }

    enum GovernedConfigStatus {
        DRAFT
        ACTIVE
        RETIRED
        REJECTED
    }

    enum GovernanceApprovalStatus {
        PENDING
        APPROVED
        REJECTED
        CANCELLED
        EXPIRED
    }

    type GovernedConfigVersion implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        namespace: GovernedConfigNamespace!
        version: Int!
        status: GovernedConfigStatus!
        payloadJson: String!
        payloadHash: String!
        createdByUserId: ID!
        activatedAt: DateTime
        retiredAt: DateTime
    }

    type GovernanceApprovalRequest implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        configVersion: GovernedConfigVersion!
        status: GovernanceApprovalStatus!
        requestedByUserId: ID!
        requestReason: String!
        expiresAt: DateTime!
        reviewedByUserId: ID
        reviewReason: String
        reviewedAt: DateTime
        idempotencyKey: String!
    }

    type GovernanceAuditEntry implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        sequence: Int!
        eventType: String!
        resourceType: String!
        resourceId: String!
        actorType: String!
        actorUserId: ID
        actorLabel: String!
        reason: String!
        payloadJson: String!
        payloadHash: String!
        previousHash: String
        entryHash: String!
        idempotencyKey: String!
    }

    type GovernanceAuditEntryList implements PaginatedList {
        items: [GovernanceAuditEntry!]!
        totalItems: Int!
    }

    type GovernanceAuditIntegrity {
        valid: Boolean!
        checkedEntries: Int!
        brokenAt: Int
    }

    type GovernanceReportSnapshot implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        businessDate: String!
        windowStartedAt: DateTime!
        windowEndedAt: DateTime!
        metricsJson: String!
        digest: String!
        auditIntegrityValid: Boolean!
        anomalyCount: Int!
    }

    input SubmitGovernedConfigInput {
        namespace: GovernedConfigNamespace!
        payloadJson: String!
        reason: String!
        idempotencyKey: String!
    }

    enum GovernanceApprovalDecision {
        APPROVE
        REJECT
    }

    input ReviewGovernanceApprovalInput {
        id: ID!
        decision: GovernanceApprovalDecision!
        reason: String!
        idempotencyKey: String!
    }

    enum FraudRiskCaseStatus {
        OPEN
        IN_REVIEW
        APPROVED
        REJECTED
        APPEALED
        CLOSED
    }

    enum FraudRiskSeverity {
        P1
        P2
        P3
    }

    type FraudRiskCaseEvent implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        eventType: String!
        actorType: String!
        actorUserId: ID
        note: String!
        payloadJson: String
        idempotencyKey: String!
    }

    type FraudRiskAppeal implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        status: String!
        reason: String!
        response: String
        reviewedByUserId: ID
        reviewedAt: DateTime
    }

    type FraudRiskCase implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        caseCode: String!
        subjectType: String!
        subjectId: String!
        orderId: ID
        customerId: ID
        status: FraudRiskCaseStatus!
        severity: FraudRiskSeverity!
        riskScore: Int!
        ruleVersion: String!
        subjectDigest: String!
        signalsJson: String!
        recommendedAction: String!
        dueAt: DateTime!
        ownerUserId: ID
        decisionCode: String
        decisionReason: String
        decidedByUserId: ID
        decidedAt: DateTime
        events: [FraudRiskCaseEvent!]!
        appeals: [FraudRiskAppeal!]!
    }

    type FraudRiskCaseList implements PaginatedList {
        items: [FraudRiskCase!]!
        totalItems: Int!
    }

    input FraudRiskCaseListOptions {
        status: FraudRiskCaseStatus
        severity: FraudRiskSeverity
        overdue: Boolean
        skip: Int
        take: Int
    }

    enum FraudRiskReviewAction {
        CLAIM
        RELEASE
        BLOCK
    }

    input ReviewFraudRiskCaseInput {
        id: ID!
        action: FraudRiskReviewAction!
        reason: String!
        idempotencyKey: String!
    }

    input AppealFraudRiskCaseInput {
        id: ID!
        reason: String!
        idempotencyKey: String!
    }

    extend type Query {
        storeProvisioningTemplates: [Channel!]!
        storeProfiles: [StoreProfile!]!
        storeDeprovisionImpact(profileId: ID!): StoreDeprovisionImpact!
        myStoreProfile: StoreProfile!
        myStoreCommerceConfiguration: StoreCommerceConfiguration!
        myStoreCurrencyConfiguration: StoreCurrencyConfiguration!
        myStoreUsdtWallet: StoreUsdtWallet!
        myStoreUsdtPaymentIntents: [StoreUsdtPaymentIntent!]!
        myStoreUsdtPaymentStats: StoreUsdtChannelPaymentStats!
        myStorePaymentStats(options: StorePaymentReportOptionsInput): [StorePaymentMethodStats!]!
        myStorePaymentDetails(options: StorePaymentReportOptionsInput): StorePaymentDetailList!
        myStoreUsdtManualRefunds(options: StorePaymentReportOptionsInput): StoreUsdtManualRefundList!
        storeUsdtWallets: [StoreUsdtWallet!]!
        storeUsdtPaymentIntents(channelId: ID): [StoreUsdtPaymentIntent!]!
        storeUsdtPaymentStats(channelId: ID): [StoreUsdtChannelPaymentStats!]!
        storePaymentStats(channelId: ID, options: StorePaymentReportOptionsInput): [StorePaymentMethodStats!]!
        storePaymentDetails(channelId: ID, options: StorePaymentReportOptionsInput): StorePaymentDetailList!
        storeUsdtManualRefunds(
            channelId: ID
            options: StorePaymentReportOptionsInput
        ): StoreUsdtManualRefundList!
        storeUsdtReconciliationActions(channelId: ID): [StoreUsdtReconciliationAction!]!
        merchantInitialPasswordStatus: MerchantInitialPasswordStatus!
        storefrontPromotionPage: StorefrontPromotionPage!
        storeCouponCampaigns: [StoreCouponCampaign!]!
        storeCouponRepairPreview(campaignId: ID!): JSON!
        storeCouponClosureRepairPreview(campaignId: ID!): JSON!
        storeCouponLedger(options: StoreCouponLedgerEntryListOptions): StoreCouponLedgerEntryList!
        storeCouponDailyReport(from: DateTime!, to: DateTime!, campaignId: ID): [StoreCouponDailyMetric!]!
        storeFlashSales: [StoreFlashSale!]!
        systemAnnouncements: [SystemAnnouncement!]!
        referralProgram: ReferralProgram!
        referralRelationships(skip: Int, take: Int): ReferralRelationshipAdminList!
        referralInviterSummaries(skip: Int, take: Int): ReferralInviterSummaryList!
        referralLedger(skip: Int, take: Int): ReferralLedgerAdminList!
        referralRewards(skip: Int, take: Int): ReferralRewardAdminList!
        referralWithdrawals(skip: Int, take: Int): ReferralWithdrawalList!
        referralCustomerWallets(customerId: ID!): [ReferralWallet!]!
        referralTodayMetrics: ReferralTodayMetrics!
        storefrontTraffic(days: Int = 7): StorefrontTrafficReport!
        marketingAttributionReport(input: MarketingAttributionReportInput!): MarketingAttributionReport!
        referralBalanceAudit: ReferralBalanceAuditResult!
        dataRetentionRecords: [DataRetentionRecord!]!
        dataSubjectRequests: [DataSubjectRequest!]!
        dataConsentRecords: [DataConsentRecord!]!
        customerOperationsProfile(customerId: ID!): CustomerOperationsProfile!
        customerOperationsProfiles(
            options: CustomerOperationsProfileListOptions
        ): CustomerOperationsProfileList!
        customerFollowUps(options: CustomerFollowUpListOptions): CustomerFollowUpList!
        governanceApprovals(status: GovernanceApprovalStatus): [GovernanceApprovalRequest!]!
        governedConfigVersions(namespace: GovernedConfigNamespace): [GovernedConfigVersion!]!
        governanceAuditEntries(skip: Int, take: Int): GovernanceAuditEntryList!
        governanceAuditIntegrity: GovernanceAuditIntegrity!
        governanceReports: [GovernanceReportSnapshot!]!
        fraudRiskCases(options: FraudRiskCaseListOptions): FraudRiskCaseList!
    }

    extend type Mutation {
        provisionStore(input: ProvisionStoreInput!): ProvisionStoreResult!
        updateStoreProfile(input: UpdateStoreProfileInput!): StoreProfile!
        suspendStore(profileId: ID!, expectedUpdatedAt: DateTime!, currentPassword: String!): StoreProfile!
        deprovisionStore(input: DeprovisionStoreInput!): DeprovisionStoreResult!
        updateMyStoreProfile(input: UpdateMyStoreProfileInput!): StoreProfile!
        updateMyStoreCommerceConfiguration(
            input: UpdateMyStoreCommerceConfigurationInput!
        ): StoreCommerceConfiguration!
        updateMyStoreCurrencyConfiguration(
            input: UpdateStoreCurrencyConfigurationInput!
        ): StoreCurrencyConfiguration!
        refreshMyStoreExchangeRate: StoreCurrencyConfiguration!
        syncMyStoreCurrencyPrices: StoreCurrencyConfiguration!
        refreshMyStoreUsdtRate: StoreCurrencyConfiguration!
        submitMyStoreUsdtWallet(receivingAddress: String!): StoreUsdtWallet!
        reviewStoreUsdtWallet(input: ReviewStoreUsdtWalletInput!): StoreUsdtWallet!
        recordStoreUsdtManualRefund(input: StoreUsdtManualRefundInput!): StoreUsdtManualRefund!
        resolveStoreUsdtPaymentIntent(input: ResolveStoreUsdtPaymentIntentInput!): StoreUsdtPaymentIntent!
        completeInitialPasswordChange(password: String!): MerchantInitialPasswordStatus!
        saveStorefrontPromotionDraft(input: UpdateStorefrontPromotionDraftInput!): StorefrontPromotionPage!
        publishStorefrontPromotionPage: StorefrontPromotionPage!
        resetStorefrontPromotionPage: StorefrontPromotionPage!
        previewStorefrontPromotionPage(input: UpdateStorefrontPromotionDraftInput!): String!
        createStoreCouponCampaign(input: CreateStoreCouponCampaignInput!): StoreCouponCampaign!
        repairStoreCouponCampaign(campaignId: ID!, fingerprint: String!, password: String!): JSON!
        repairStoreCouponClosure(campaignId: ID!, fingerprint: String!, password: String!): JSON!
        createStoreFlashSale(input: CreateStoreFlashSaleInput!): StoreFlashSale!
        setStorePromotionEnabled(id: ID!, enabled: Boolean!, password: String!): StorePromotionToggleResult!
        updateStorePromotionName(id: ID!, name: String!): StorePromotionNameResult!
        stopStoreCouponIssuance(id: ID!, password: String!): StoreCouponCampaign!
        archiveStoreCouponCampaign(id: ID!, password: String!): StoreCouponCampaign!
        revokeStoreCouponCampaignOutstanding(
            id: ID!
            password: String!
            reason: String
        ): StoreCouponCampaignActionResult!
        deleteStorePromotion(id: ID!, password: String!): DeletionResponse!
        grantStoreCoupon(campaignId: ID!, customerId: ID!): StoreCustomerCoupon!
        revokeStoreCustomerCoupon(id: ID!, reason: String): StoreCustomerCoupon!
        createSystemAnnouncement(input: CreateSystemAnnouncementInput!): SystemAnnouncement!
        updateSystemAnnouncement(input: UpdateSystemAnnouncementInput!): SystemAnnouncement!
        deleteSystemAnnouncement(id: ID!): DeletionResponse!
        updateReferralProgram(input: UpdateReferralProgramInput!): ReferralProgram!
        createReferralPosterTemplate(input: CreateReferralPosterTemplateInput!): ReferralPosterTemplate!
        updateReferralPosterTemplate(input: UpdateReferralPosterTemplateInput!): ReferralPosterTemplate!
        deleteReferralPosterTemplate(id: ID!): DeletionResponse!
        setReferralPosterTemplateEnabled(
            id: ID!
            enabled: Boolean!
            expectedUpdatedAt: DateTime!
        ): ReferralProgram!
        createReferralWithdrawal(input: CreateReferralWithdrawalInput!): ReferralWithdrawal!
        processReferralWithdrawal(input: ProcessReferralWithdrawalInput!): ReferralWithdrawal!
        adjustReferralBalance(
            customerId: ID!
            currencyCode: CurrencyCode!
            amount: Money!
            reason: String!
        ): ReferralWallet!
        setDataRetentionLegalHold(id: ID!, enabled: Boolean!, reason: String): DataRetentionRecord!
        retryDataRetentionRecord(id: ID!): DataRetentionRecord!
        retryDataSubjectRequest(id: ID!): DataSubjectRequest!
        refreshCustomerOperationsProfile(customerId: ID!): CustomerOperationsProfile!
        createCustomerFollowUp(input: CreateCustomerFollowUpInput!): CustomerFollowUp!
        updateCustomerFollowUp(input: UpdateCustomerFollowUpInput!): CustomerFollowUp!
        recordMarketingCampaignCost(input: RecordMarketingCampaignCostInput!): MarketingCampaignCost!
        submitGovernedConfig(input: SubmitGovernedConfigInput!): GovernanceApprovalRequest!
        reviewGovernanceApproval(input: ReviewGovernanceApprovalInput!): GovernanceApprovalRequest!
        reviewFraudRiskCase(input: ReviewFraudRiskCaseInput!): FraudRiskCase!
    }

    extend type Order {
        storeCouponAllocations: [StoreCouponOrderAllocation!]!
    }
`;

export const shopApiExtensions = gql`
    ${trafficShopSchema}
    ${commonTypes}
    ${storefrontBrandingSchema}

    extend type ProductVariant {
        storeCouponCollectionIds: [ID!]!
    }

    type StoreFlashSaleItem {
        productId: ID!
        productVariantId: ID!
        productName: String!
        variantName: String!
        originalPrice: Money!
        salePrice: Money!
        currencyCode: CurrencyCode!
        imageUrl: String
    }

    type StoreFlashSale {
        id: ID!
        enabled: Boolean!
        startsAt: DateTime
        endsAt: DateTime
        items: [StoreFlashSaleItem!]!
    }

    type StorefrontCoupon {
        id: ID!
        name: String!
        kind: StoreCouponCampaignKind!
        startsAt: DateTime
        endsAt: DateTime
        minimumSpend: Money!
        currencyCode: CurrencyCode!
        discountAmount: Money
        discountRate: Float
        collectionIds: [ID!]!
        productVariantIds: [ID!]!
        claimStartsAt: DateTime
        claimEndsAt: DateTime
        validityDays: Int
        remainingIssueCount: Int
        claimed: Boolean!
        claimable: Boolean!
    }

    type StorefrontSystemAnnouncement {
        id: ID!
        title: String!
        content: String!
        linkUrl: String
        startsAt: DateTime
        endsAt: DateTime
    }

    type ReferralInvitee {
        id: ID!
        displayName: String!
        boundAt: DateTime!
        firstPaidOrderAt: DateTime
    }

    type ReferralRewardSummary {
        currencyCode: CurrencyCode!
        grossReward: Money!
        clawedBackReward: Money!
    }

    type MyReferralOverview {
        enabled: Boolean!
        rewardRate: Float!
        releaseDelayDays: Int!
        inviteCode: String!
        wallets: [ReferralWallet!]!
        invitedCount: Int!
        purchasedInviteeCount: Int!
        rewardSummaries: [ReferralRewardSummary!]!
        invitees: [ReferralInvitee!]!
        ledger: [ReferralLedgerEntry!]!
    }

    type ReferralBalancePaymentResult {
        order: Order!
        wallet: ReferralWallet!
        amount: Money!
    }

    type StorefrontVisitResult {
        recorded: Boolean!
    }

    extend type Query {
        storefrontBranding: StorefrontBranding!
        availableStorefrontProvinces: [StorefrontProvinceOption!]!
        myCustomerAvatar: Asset
        myCustomerAvatarHistory: [CustomerAvatarHistoryEntry!]!
        myDataSubjectRequests: [DataSubjectRequest!]!
        myDataConsentRecords: [DataConsentRecord!]!
        storefrontCurrencyConfiguration: StoreCurrencyConfiguration!
        activeStorefrontCoupons: [StorefrontCoupon!]!
        myStorefrontCoupons: [StoreCustomerCoupon!]!
        myStorefrontCouponsPage(options: StoreCouponPageOptions): StoreCustomerCouponList!
        myStorefrontCouponUsageRecords: [StoreCouponUsageRecord!]!
        myStorefrontCouponUsageRecordsPage(options: StoreCouponPageOptions): StoreCouponUsageRecordList!
        activeStorefrontFlashSales: [StoreFlashSale!]!
        activeSystemAnnouncements: [StorefrontSystemAnnouncement!]!
        referralProgram: ReferralProgram!
        validateReferralInviteCode(code: String!): Boolean!
        myReferralOverview: MyReferralOverview!
        myFraudRiskCases: [FraudRiskCase!]!
    }

    enum StorefrontCartCouponAction {
        APPLY
        REMOVE
        BEST
        APPLY_CODE
        REMOVE_CODE
    }
    input StorefrontCartCouponCommandInput {
        action: StorefrontCartCouponAction!
        couponId: ID
        code: String
    }
    extend input StorefrontCartCommandInput {
        coupon: StorefrontCartCouponCommandInput
    }
    extend type Mutation {
        setCustomerAvatar(file: Upload!): Asset!
        restoreCustomerAvatar(retentionId: ID!): Asset!
        removeCustomerAvatar: Boolean!
        exportMyPersonalData(password: String!): DataSubjectExportPayload!
        requestMyAccountClosure(password: String!): DataSubjectRequest!
        cancelMyAccountClosure: DataSubjectRequest!
        recordStorefrontAnalyticsConsent(input: StorefrontAnalyticsConsentInput!): DataConsentRecord!
        setStorefrontPaymentCurrency(currencyCode: String!): Order!
        createStorefrontUsdtCheckoutQuote: StorefrontUsdtCheckoutQuote!
        claimStorefrontCoupon(campaignId: ID!): StoreCustomerCoupon!
        applyStorefrontCoupon(id: ID!): StoreCustomerCoupon!
        applyBestStorefrontCoupon: StoreCustomerCoupon
        removeStorefrontCoupon(id: ID!): StoreCustomerCoupon!
        registerCustomerWithReferral(
            input: RegisterCustomerInput!
            consent: StorefrontRegistrationConsentInput!
            inviteCode: String
            source: String
        ): RegisterCustomerAccountResult!
        useMyReferralBalance(amount: Money!): ReferralBalancePaymentResult!
        recordStorefrontVisit(visitorId: String): StorefrontVisitResult!
        recordStorefrontPageView(input: StorefrontPageViewInput!): StorefrontVisitResult!
        appealMyFraudRiskCase(input: AppealFraudRiskCaseInput!): FraudRiskAppeal!
    }
`;
