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
        isPublished: Boolean!
        sortOrder: Int!
        descriptionZh: String!
        descriptionEn: String!
        logoAsset: Asset
        primaryDomain: String
        storefrontUrl: String
    }

    input UpdateStoreProfileInput {
        id: ID!
        status: StoreProfileStatus
        isPublished: Boolean
        sortOrder: Int
        descriptionZh: String
        descriptionEn: String
        logoAssetId: ID
    }

    extend type Query {
        storeProfiles: [StoreProfile!]!
    }

    extend type Mutation {
        provisionStore(input: ProvisionStoreInput!): ProvisionStoreResult!
        updateStoreProfile(input: UpdateStoreProfileInput!): StoreProfile!
    }
`;

export const shopApiExtensions = gql`
    ${commonTypes}

    type AvailableStore implements Node {
        id: ID!
        channelId: ID!
        code: String!
        merchantName: String!
        storefrontNameZh: String!
        storefrontNameEn: String!
        descriptionZh: String!
        descriptionEn: String!
        logo: Asset
        domain: String!
        storefrontUrl: String!
    }

    extend type Query {
        availableStores: [AvailableStore!]!
    }
`;
