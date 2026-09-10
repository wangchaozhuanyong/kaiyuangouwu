import { gql } from 'graphql-tag';

export const adminApiExtensions = gql`
    enum IcloudAccountStatus {
        ACTIVE
        DISABLED
        AUTH_ERROR
        SYNCING
    }

    enum IcloudVirtualEmailStatus {
        ACTIVE
        DISABLED
    }

    type IcloudPrimaryAccountView implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        email: String!
        note: String
        status: IcloudAccountStatus!
        imapHost: String!
        imapPort: Int!
        masterQueryCode: String
        codeExpiresAt: DateTime
        codeResetIntervalDays: Int!
        remainingDays: Int
        lastQueriedAt: DateTime
        lastQueriedIp: String
        lastSyncedAt: DateTime
        lastSyncError: String
        virtualEmailCount: Int!
    }

    type IcloudVirtualEmailView implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        primaryAccountId: ID!
        primaryAccountEmail: String
        aliasEmail: String!
        note: String
        status: IcloudVirtualEmailStatus!
        buyerQueryCode: String!
        codeExpiresAt: DateTime
        codeResetIntervalDays: Int!
        remainingDays: Int
        lastQueriedAt: DateTime
        lastQueriedIp: String
        mailCount: Int!
        lastMailReceivedAt: DateTime
    }

    type IcloudReceivedMailView implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        primaryAccountId: ID!
        virtualEmailId: ID
        messageId: String!
        fromAddress: String!
        fromName: String!
        subject: String!
        bodyHtml: String
        bodyText: String
        extractedCode: String
        receivedAt: DateTime!
        isRead: Boolean!
        isStarred: Boolean!
    }

    type IcloudTestConnectionResult {
        success: Boolean!
        message: String!
    }

    type IcloudSyncResult {
        success: Boolean!
        syncedCount: Int!
        error: String
    }

    type IcloudBatchCreateResult {
        createdCount: Int!
        skippedCount: Int!
        errors: [String!]!
    }

    input CreateIcloudPrimaryAccountInput {
        email: String!
        appPassword: String!
        note: String
        imapHost: String
        imapPort: Int
        codeResetIntervalDays: Int
        masterQueryCode: String
    }

    input UpdateIcloudPrimaryAccountInput {
        id: ID!
        email: String
        appPassword: String
        note: String
        status: IcloudAccountStatus
        imapHost: String
        imapPort: Int
        codeResetIntervalDays: Int
        masterQueryCode: String
    }

    input CreateIcloudVirtualEmailInput {
        primaryAccountId: ID!
        aliasEmail: String!
        note: String
        buyerQueryCode: String
        codeResetIntervalDays: Int
    }

    input BatchCreateIcloudVirtualEmailsInput {
        primaryAccountId: ID!
        rawInput: String!
        codeResetIntervalDays: Int
    }

    input UpdateIcloudVirtualEmailInput {
        id: ID!
        aliasEmail: String
        note: String
        status: IcloudVirtualEmailStatus
        buyerQueryCode: String
        codeResetIntervalDays: Int
    }

    extend type Query {
        icloudPrimaryAccounts: [IcloudPrimaryAccountView!]!
        icloudPrimaryAccount(id: ID!): IcloudPrimaryAccountView
        icloudVirtualEmails(primaryAccountId: ID): [IcloudVirtualEmailView!]!
        icloudVirtualEmail(id: ID!): IcloudVirtualEmailView
        icloudReceivedMails(
            virtualEmailId: ID
            primaryAccountId: ID
            unassignedOnly: Boolean
            limit: Int
        ): [IcloudReceivedMailView!]!
    }

    extend type Mutation {
        createIcloudPrimaryAccount(input: CreateIcloudPrimaryAccountInput!): IcloudPrimaryAccountView!
        updateIcloudPrimaryAccount(input: UpdateIcloudPrimaryAccountInput!): IcloudPrimaryAccountView!
        deleteIcloudPrimaryAccount(id: ID!): Boolean!
        testIcloudConnection(id: ID!): IcloudTestConnectionResult!
        syncIcloudAccount(id: ID!): IcloudSyncResult!
        resetIcloudMasterCode(id: ID!): IcloudPrimaryAccountView!

        createIcloudVirtualEmail(input: CreateIcloudVirtualEmailInput!): IcloudVirtualEmailView!
        batchCreateIcloudVirtualEmails(input: BatchCreateIcloudVirtualEmailsInput!): IcloudBatchCreateResult!
        updateIcloudVirtualEmail(input: UpdateIcloudVirtualEmailInput!): IcloudVirtualEmailView!
        deleteIcloudVirtualEmail(id: ID!): Boolean!
        resetIcloudVirtualEmailCode(id: ID!): IcloudVirtualEmailView!

        reassignIcloudMail(mailId: ID!, virtualEmailId: ID!): IcloudReceivedMailView!
        deleteIcloudMail(mailId: ID!): Boolean!
    }
`;

export const shopApiExtensions = gql`
    type IcloudPublicMailItem {
        id: ID!
        fromAddress: String!
        fromName: String!
        subject: String!
        receivedAt: DateTime!
        extractedCode: String
        bodyText: String
        bodyHtml: String
        targetEmail: String!
    }

    type IcloudVirtualEmailSummary {
        id: ID!
        aliasEmail: String!
        note: String
    }

    type IcloudPublicMailQueryResult {
        success: Boolean!
        message: String
        targetType: String
        aliasEmail: String
        primaryEmail: String
        codeExpiresAt: DateTime
        remainingDays: Int
        totalEmails: Int!
        items: [IcloudPublicMailItem!]!
        virtualEmailsList: [IcloudVirtualEmailSummary!]
    }

    extend type Query {
        icloudQueryMails(queryCode: String!): IcloudPublicMailQueryResult!
    }
`;
