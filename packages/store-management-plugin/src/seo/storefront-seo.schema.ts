import { gql } from 'graphql-tag';

export const storefrontSeoAdminSchema = gql`
    enum StorefrontSeoTargetType {
        SETTINGS
        HOME
        PRODUCT
        COLLECTION
        PAGE
        ARTICLE
    }
    type StorefrontSeoRecord {
        id: ID
        channelId: String!
        targetType: StorefrontSeoTargetType!
        targetId: String!
        languageCode: String!
        draft: JSON!
        published: JSON
        version: Int!
        publishedVersion: Int!
        publishedAt: DateTime
        updatedAt: DateTime
        canWrite: Boolean!
    }
    type StorefrontSeoRevision {
        id: ID!
        version: Int!
        payload: JSON
        publishedAt: DateTime!
        publishedBy: String!
    }
    type StorefrontSeoIssue {
        code: String!
        severity: String!
        targetType: StorefrontSeoTargetType!
        targetId: String!
        languageCode: String!
        message: String!
    }
    type StorefrontSeoWorkspace {
        channelId: String!
        accessMode: String!
        settings: StorefrontSeoRecord!
        documents: [StorefrontSeoRecord!]!
        diagnostics: [StorefrontSeoIssue!]!
    }
    input StorefrontSeoIdentityInput {
        targetType: StorefrontSeoTargetType!
        targetId: String!
        languageCode: String!
    }
    input SaveStorefrontSeoDraftInput {
        targetType: StorefrontSeoTargetType!
        targetId: String!
        languageCode: String!
        expectedVersion: Int!
        draft: JSON!
    }
    input PublishStorefrontSeoRecordInput {
        targetType: StorefrontSeoTargetType!
        targetId: String!
        languageCode: String!
        expectedVersion: Int!
    }
    input RestoreStorefrontSeoRevisionInput {
        targetType: StorefrontSeoTargetType!
        targetId: String!
        languageCode: String!
        expectedVersion: Int!
        revision: Int!
    }
    extend type Query {
        storefrontSeoWorkspace: StorefrontSeoWorkspace!
        storefrontSeoRecord(input: StorefrontSeoIdentityInput!): StorefrontSeoRecord!
        storefrontSeoHistory(input: StorefrontSeoIdentityInput!): [StorefrontSeoRevision!]!
    }
    extend type Mutation {
        saveStorefrontSeoDraft(input: SaveStorefrontSeoDraftInput!): StorefrontSeoRecord!
        publishStorefrontSeoRecord(input: PublishStorefrontSeoRecordInput!): StorefrontSeoRecord!
        unpublishStorefrontSeoRecord(input: PublishStorefrontSeoRecordInput!): StorefrontSeoRecord!
        restoreStorefrontSeoRevision(input: RestoreStorefrontSeoRevisionInput!): StorefrontSeoRecord!
    }
`;
