import { gql } from 'graphql-tag';

const commonTypes = gql`
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
        orderId: ID!
        orderCode: String!
        network: String!
        expectedUsdtAmount: Float!
        status: String!
        transactionId: String
        failureReason: String
        createdAt: DateTime!
        expiresAt: DateTime!
        settledAt: DateTime
    }

    type StoreCustomerCoupon {
        id: ID!
        campaignId: ID!
        campaignName: String!
        campaignKind: StoreCouponCampaignKind!
        status: StoreCustomerCouponStatus!
        minimumSpend: Money!
        discountAmount: Money
        discountRate: Float
        claimedAt: DateTime!
        validFrom: DateTime!
        validUntil: DateTime
        lockedAt: DateTime
        usedAt: DateTime
        returnedAt: DateTime
        expiredAt: DateTime
        lockedOrderId: ID
        usedOrderId: ID
        returnCount: Int!
        usable: Boolean!
    }

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
        minimumOrderAmount: Money!
        maxRewardPerOrder: Money
        allowBalanceSpend: Boolean!
        attributionWindowDays: Int!
        defaultPosterTemplate: String!
        posterTemplates: [String!]!
        posterTemplateConfigs: [ReferralPosterTemplate!]!
    }

    type ReferralPosterTemplate implements Node {
        id: ID!
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
        foregroundColor: String!
        accentColor: String!
        overlayOpacity: Int!
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
    ${commonTypes}

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

    input UpdateStoreProfileInput {
        id: ID!
        expectedUpdatedAt: DateTime!
        storefrontNameZh: String
        storefrontNameEn: String
        status: StoreProfileStatus
        sortOrder: Int
        descriptionZh: String
        descriptionEn: String
        internalNote: String
        logoAssetId: ID
    }

    input UpdateMyStoreProfileInput {
        expectedUpdatedAt: DateTime!
        storefrontNameZh: String
        storefrontNameEn: String
        descriptionZh: String
        descriptionEn: String
        logoAssetId: ID
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

    type SystemAnnouncement implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        enabled: Boolean!
        priority: Int!
        titleZh: String!
        titleEn: String!
        contentZh: String!
        contentEn: String!
        linkUrl: String
        startsAt: DateTime
        endsAt: DateTime
    }

    input CreateSystemAnnouncementInput {
        enabled: Boolean
        priority: Int
        titleZh: String!
        titleEn: String
        contentZh: String!
        contentEn: String
        linkUrl: String
        startsAt: DateTime
        endsAt: DateTime
    }

    input UpdateSystemAnnouncementInput {
        id: ID!
        enabled: Boolean
        priority: Int
        titleZh: String!
        titleEn: String
        contentZh: String!
        contentEn: String
        linkUrl: String
        startsAt: DateTime
        endsAt: DateTime
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
        name: String!
        couponCode: String!
        kind: StoreCouponCampaignKind!
        enabled: Boolean!
        startsAt: DateTime
        endsAt: DateTime
        minimumSpend: Money!
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

    input StoreCouponLedgerListOptions {
        skip: Int
        take: Int
        campaignId: ID
        customerId: ID
        orderId: ID
        eventType: StoreCouponLedgerEventType
    }

    type StoreCouponDailyMetric {
        date: String!
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
    }

    input CreateReferralPosterTemplateInput {
        name: String!
        enabled: Boolean!
        position: Int!
        layoutVariant: String!
        posterBackgroundAssetId: ID
        shareBackgroundAssetId: ID
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
        foregroundColor: String!
        accentColor: String!
        overlayOpacity: Int!
    }

    input UpdateReferralPosterTemplateInput {
        id: ID!
        name: String!
        enabled: Boolean!
        position: Int!
        layoutVariant: String!
        posterBackgroundAssetId: ID
        shareBackgroundAssetId: ID
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
        visitorCount: Int!
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

    extend type Query {
        storeProvisioningTemplates: [Channel!]!
        storeProfiles: [StoreProfile!]!
        myStoreProfile: StoreProfile!
        myStoreCommerceConfiguration: StoreCommerceConfiguration!
        myStoreCurrencyConfiguration: StoreCurrencyConfiguration!
        myStoreUsdtPaymentIntents: [StoreUsdtPaymentIntent!]!
        merchantInitialPasswordStatus: MerchantInitialPasswordStatus!
        storefrontPromotionPage: StorefrontPromotionPage!
        storeCouponCampaigns: [StoreCouponCampaign!]!
        storeCouponLedger(options: StoreCouponLedgerListOptions): StoreCouponLedgerEntryList!
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
        referralBalanceAudit: ReferralBalanceAuditResult!
    }

    extend type Mutation {
        provisionStore(input: ProvisionStoreInput!): ProvisionStoreResult!
        updateStoreProfile(input: UpdateStoreProfileInput!): StoreProfile!
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
        completeInitialPasswordChange(password: String!): MerchantInitialPasswordStatus!
        saveStorefrontPromotionDraft(input: UpdateStorefrontPromotionDraftInput!): StorefrontPromotionPage!
        publishStorefrontPromotionPage: StorefrontPromotionPage!
        resetStorefrontPromotionPage: StorefrontPromotionPage!
        previewStorefrontPromotionPage(input: UpdateStorefrontPromotionDraftInput!): String!
        createStoreCouponCampaign(input: CreateStoreCouponCampaignInput!): StoreCouponCampaign!
        createStoreFlashSale(input: CreateStoreFlashSaleInput!): StoreFlashSale!
        setStorePromotionEnabled(id: ID!, enabled: Boolean!, password: String!): StorePromotionToggleResult!
        updateStorePromotionName(id: ID!, name: String!): StorePromotionNameResult!
        stopStoreCouponIssuance(id: ID!, password: String!): StoreCouponCampaign!
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
        createReferralWithdrawal(input: CreateReferralWithdrawalInput!): ReferralWithdrawal!
        processReferralWithdrawal(input: ProcessReferralWithdrawalInput!): ReferralWithdrawal!
        adjustReferralBalance(
            customerId: ID!
            currencyCode: CurrencyCode!
            amount: Money!
            reason: String!
        ): ReferralWallet!
    }

    extend type Order {
        storeCouponAllocations: [StoreCouponOrderAllocation!]!
    }
`;

export const shopApiExtensions = gql`
    ${commonTypes}

    type StorefrontBranding {
        logoUrl: String
        name: String!
        description: String!
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
        discountAmount: Money
        discountRate: Float
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
        storefrontCurrencyConfiguration: StoreCurrencyConfiguration!
        activeStorefrontCoupons: [StorefrontCoupon!]!
        myStorefrontCoupons: [StoreCustomerCoupon!]!
        myStorefrontCouponUsageRecords: [StoreCouponUsageRecord!]!
        activeStorefrontFlashSales: [StoreFlashSale!]!
        activeSystemAnnouncements: [StorefrontSystemAnnouncement!]!
        referralProgram: ReferralProgram!
        validateReferralInviteCode(code: String!): Boolean!
        myReferralOverview: MyReferralOverview!
    }

    extend type Mutation {
        createStorefrontUsdtCheckoutQuote: StorefrontUsdtCheckoutQuote!
        claimStorefrontCoupon(campaignId: ID!): StoreCustomerCoupon!
        applyStorefrontCoupon(id: ID!): StoreCustomerCoupon!
        removeStorefrontCoupon(id: ID!): StoreCustomerCoupon!
        registerCustomerWithReferral(
            input: RegisterCustomerInput!
            inviteCode: String
            source: String
        ): RegisterCustomerAccountResult!
        useMyReferralBalance(amount: Money!): ReferralBalancePaymentResult!
        recordStorefrontVisit(visitorId: String): StorefrontVisitResult!
    }
`;
