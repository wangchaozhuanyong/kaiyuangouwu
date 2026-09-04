import { gql } from 'graphql-tag';

export const adminApiExtensions = gql`
    enum StoreDomainStatus {
        PENDING
        ACTIVE
    }

    enum StoreDomainProvisioningMode {
        MANUAL
        CLOUDFLARE_SAAS
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
        provisioningMode: StoreDomainProvisioningMode!
        dnsManaged: Boolean!
        providerHostnameStatus: String
        providerSslStatus: String
        lastProvisionedAt: DateTime
    }

    type StoreDomainConfiguration {
        cnameTarget: String!
        routingMode: String!
        automationMode: StoreDomainProvisioningMode!
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

    type StoreDomainTransferImpact {
        domain: StoreDomain!
        sourceChannel: Channel!
        targetChannel: Channel!
        sourceReplacementDomain: String
        targetPrimaryDomain: String
        preservesVerification: Boolean!
        canTransfer: Boolean!
        blocker: String
    }

    input TransferStoreDomainInput {
        id: ID!
        targetChannelId: ID!
        expectedUpdatedAt: DateTime!
    }

    extend type Query {
        storeDomains(channelId: ID!): [StoreDomain!]!
        storeDomainConfiguration: StoreDomainConfiguration!
        storeDomainTransferImpact(id: ID!, targetChannelId: ID!): StoreDomainTransferImpact!
    }

    extend type Mutation {
        createStoreDomain(input: CreateStoreDomainInput!): StoreDomain!
        verifyStoreDomain(id: ID!): StoreDomainVerificationResult!
        setPrimaryStoreDomain(id: ID!): StoreDomain!
        deleteStoreDomain(id: ID!): DeletionResponse!
        transferStoreDomain(input: TransferStoreDomainInput!): StoreDomain!
    }
`;
