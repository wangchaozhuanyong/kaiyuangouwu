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

    extend type Query {
        storeProfiles: [StoreProfile!]!
        myStoreProfile: StoreProfile!
        merchantInitialPasswordStatus: MerchantInitialPasswordStatus!
    }

    extend type Mutation {
        provisionStore(input: ProvisionStoreInput!): ProvisionStoreResult!
        updateStoreProfile(input: UpdateStoreProfileInput!): StoreProfile!
        updateMyStoreProfile(input: UpdateMyStoreProfileInput!): StoreProfile!
        completeInitialPasswordChange(password: String!): MerchantInitialPasswordStatus!
    }
`;
