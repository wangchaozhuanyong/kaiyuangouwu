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
        logoAsset: Asset
        primaryDomain: String
        storefrontUrl: String
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

    extend type Query {
        storeProfiles: [StoreProfile!]!
        myStoreProfile: StoreProfile!
        myStoreCommerceConfiguration: StoreCommerceConfiguration!
        merchantInitialPasswordStatus: MerchantInitialPasswordStatus!
        storefrontPromotionPage: StorefrontPromotionPage!
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
    }
`;
