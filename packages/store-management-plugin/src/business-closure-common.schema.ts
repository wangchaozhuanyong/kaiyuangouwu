import { gql } from 'graphql-tag';

export const businessClosureCommonSchema = gql`
    enum DataSubjectRequestType {
        EXPORT
        ACCOUNT_CLOSURE
    }

    enum DataSubjectRequestStatus {
        PENDING
        PROCESSING
        BLOCKED
        FAILED
        FULFILLED
        CANCELLED
    }

    type DataSubjectRequest implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        requestType: DataSubjectRequestType!
        status: DataSubjectRequestStatus!
        requestedAt: DateTime!
        dueAt: DateTime
        nextAttemptAt: DateTime
        lastAttemptAt: DateTime
        attemptCount: Int!
        blockersJson: String
        lastError: String
        resultDigest: String
        resultSummaryJson: String
        completedAt: DateTime
        cancelledAt: DateTime
    }

    type DataSubjectExportPayload {
        request: DataSubjectRequest!
        fileName: String!
        mimeType: String!
        content: String!
        sha256: String!
    }

    enum DataConsentPurpose {
        TERMS
        PRIVACY
        ANALYTICS
    }

    enum DataConsentAction {
        GRANTED
        WITHDRAWN
    }

    type DataConsentRecord implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        purpose: DataConsentPurpose!
        action: DataConsentAction!
        policyVersion: String!
        policyDigest: String!
        locale: String!
        source: String!
        recordedAt: DateTime!
    }

    input StorefrontRegistrationConsentInput {
        termsAccepted: Boolean!
        privacyAcknowledged: Boolean!
        locale: String!
    }

    input StorefrontAnalyticsConsentInput {
        consentId: String!
        granted: Boolean!
        locale: String!
    }

    enum DataRetentionStatus {
        PENDING
        BLOCKED_REFERENCE
        FAILED
        RESTORED
        PURGED
    }

    type DataRetentionRecord implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        resourceType: String!
        resourceKey: String!
        policyCode: String!
        reason: String!
        status: DataRetentionStatus!
        quarantinedAt: DateTime!
        purgeAfter: DateTime!
        nextAttemptAt: DateTime
        legalHold: Boolean!
        legalHoldReason: String
        legalHoldChangedByUserId: ID
        legalHoldChangedAt: DateTime
        attemptCount: Int!
        lastAttemptAt: DateTime
        lastError: String
        completedAt: DateTime
    }

    type CustomerAvatarHistoryEntry {
        id: ID!
        status: DataRetentionStatus!
        quarantinedAt: DateTime!
        purgeAfter: DateTime!
        legalHold: Boolean!
        asset: Asset
    }

    enum StoreUsdtReconciliationActionType {
        RETRY_SETTLEMENT
        CONFIRM_EXTERNAL_REFUND
    }

    input ResolveStoreUsdtPaymentIntentInput {
        id: ID!
        action: StoreUsdtReconciliationActionType!
        reason: String!
        transactionId: String
        usdtAmount: String
        recipientAddress: String
    }

    type StoreUsdtReconciliationAction {
        id: ID!
        channelId: ID!
        intentId: ID!
        orderId: ID!
        action: StoreUsdtReconciliationActionType!
        outcome: String!
        operatorUserId: ID!
        reason: String!
        network: String
        transactionId: String
        usdtAmount: String
        fromAddress: String
        toAddress: String
        blockNumber: Int
        blockTimestamp: DateTime
        createdAt: DateTime!
    }
`;
