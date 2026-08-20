import { gql } from 'graphql-tag';

const commonTypes = gql`
    enum StoreProfileStatus {
        DRAFT
        ACTIVE
        SUSPENDED
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
    }

    type MerchantInitialPasswordStatus {
        mustChangePassword: Boolean!
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

    extend type Query {
        storeProfiles: [StoreProfile!]!
        myStoreProfile: StoreProfile!
        myStoreCommerceConfiguration: StoreCommerceConfiguration!
        merchantInitialPasswordStatus: MerchantInitialPasswordStatus!
    }

    extend type Mutation {
        provisionStore(input: ProvisionStoreInput!): ProvisionStoreResult!
        updateStoreProfile(input: UpdateStoreProfileInput!): StoreProfile!
        updateMyStoreProfile(input: UpdateMyStoreProfileInput!): StoreProfile!
        updateMyStoreCommerceConfiguration(
            input: UpdateMyStoreCommerceConfigurationInput!
        ): StoreCommerceConfiguration!
        completeInitialPasswordChange(password: String!): MerchantInitialPasswordStatus!
    }
`;
