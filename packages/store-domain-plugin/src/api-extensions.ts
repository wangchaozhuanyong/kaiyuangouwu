import { gql } from 'graphql-tag';

export const adminApiExtensions = gql`
    enum StoreDomainStatus {
        PENDING
        ACTIVE
    }

    type StoreDomain implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        domain: String!
        channel: Channel!
        isPrimary: Boolean!
        status: StoreDomainStatus!
        verificationToken: String!
        verificationRecordName: String!
        verificationRecordValue: String!
        verifiedAt: DateTime
        lastVerificationError: String
    }

    type StoreDomainConfiguration {
        cnameTarget: String!
        routingMode: String!
    }

    type StoreDomainVerificationResult {
        success: Boolean!
        message: String!
        domain: StoreDomain!
    }

    input CreateStoreDomainInput {
        channelId: ID!
        domain: String!
        isPrimary: Boolean
    }

    extend type Query {
        storeDomains(channelId: ID!): [StoreDomain!]!
        storeDomainConfiguration: StoreDomainConfiguration!
    }

    extend type Mutation {
        createStoreDomain(input: CreateStoreDomainInput!): StoreDomain!
        verifyStoreDomain(id: ID!): StoreDomainVerificationResult!
        setPrimaryStoreDomain(id: ID!): StoreDomain!
        deleteStoreDomain(id: ID!): DeletionResponse!
    }
`;
