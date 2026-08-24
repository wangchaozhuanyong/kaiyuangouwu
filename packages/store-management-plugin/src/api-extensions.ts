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
        storefrontNameEn: String!
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
        storefrontNameZh: String
        storefrontNameEn: String
        descriptionZh: String
        descriptionEn: String
        logoAssetId: ID
    }

    type StoreCommerceConfiguration {
        channelId: ID!
        channelCode: String!
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
    }

    input CreateStoreCouponCampaignInput {
        name: String!
        couponCode: String!
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

    extend type Query {
        storeProvisioningTemplates: [Channel!]!
        storeProfiles: [StoreProfile!]!
        myStoreProfile: StoreProfile!
        myStoreCommerceConfiguration: StoreCommerceConfiguration!
        merchantInitialPasswordStatus: MerchantInitialPasswordStatus!
        storefrontPromotionPage: StorefrontPromotionPage!
        storeCouponCampaigns: [StoreCouponCampaign!]!
        storeFlashSales: [StoreFlashSale!]!
        systemAnnouncements: [SystemAnnouncement!]!
    }

    extend type Mutation {
        provisionStore(input: ProvisionStoreInput!): ProvisionStoreResult!
        updateStoreProfile(input: UpdateStoreProfileInput!): StoreProfile!
        updateMyStoreProfile(input: UpdateMyStoreProfileInput!): StoreProfile!
        updateMyStoreCommerceConfiguration(
            input: UpdateMyStoreCommerceConfigurationInput!
        ): StoreCommerceConfiguration!
        completeInitialPasswordChange(password: String!): MerchantInitialPasswordStatus!
        saveStorefrontPromotionDraft(input: UpdateStorefrontPromotionDraftInput!): StorefrontPromotionPage!
        publishStorefrontPromotionPage: StorefrontPromotionPage!
        resetStorefrontPromotionPage: StorefrontPromotionPage!
        previewStorefrontPromotionPage(input: UpdateStorefrontPromotionDraftInput!): String!
        createStoreCouponCampaign(input: CreateStoreCouponCampaignInput!): StoreCouponCampaign!
        createStoreFlashSale(input: CreateStoreFlashSaleInput!): StoreFlashSale!
        setStorePromotionEnabled(id: ID!, enabled: Boolean!): StorePromotionToggleResult!
        deleteStorePromotion(id: ID!): DeletionResponse!
        createSystemAnnouncement(input: CreateSystemAnnouncementInput!): SystemAnnouncement!
        updateSystemAnnouncement(input: UpdateSystemAnnouncementInput!): SystemAnnouncement!
        deleteSystemAnnouncement(id: ID!): DeletionResponse!
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
        name: String!
        enabled: Boolean!
        startsAt: DateTime
        endsAt: DateTime
        items: [StoreFlashSaleItem!]!
    }

    type StorefrontCoupon {
        id: ID!
        name: String!
        couponCode: String!
        kind: StoreCouponCampaignKind!
        startsAt: DateTime
        endsAt: DateTime
        minimumSpend: Money!
        discountAmount: Money
        discountRate: Float
    }

    type StorefrontSystemAnnouncement {
        id: ID!
        title: String!
        content: String!
        linkUrl: String
        startsAt: DateTime
        endsAt: DateTime
    }

    extend type Query {
        storefrontBranding: StorefrontBranding!
        activeStorefrontCoupons: [StorefrontCoupon!]!
        activeStorefrontFlashSales: [StoreFlashSale!]!
        activeSystemAnnouncements: [StorefrontSystemAnnouncement!]!
    }
`;
