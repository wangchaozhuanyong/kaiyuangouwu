import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    enum ContentTranslationFormat {
        TEXT
        HTML
    }

    input ContentTranslationSegmentInput {
        key: String!
        text: String!
        format: ContentTranslationFormat
    }

    type ContentTranslationSegmentResult {
        key: String!
        text: String!
    }

    type ContentTranslationResult {
        configured: Boolean!
        provider: String!
        translations: [ContentTranslationSegmentResult!]!
    }

    type ContentTranslationStatusCount {
        status: String!
        count: Int!
    }

    type ContentTranslationStateRecord {
        id: ID!
        channelId: String
        entityType: String!
        entityId: String!
        fieldPath: String!
        sourceLanguageCode: String!
        targetLanguageCode: String!
        status: String!
        origin: String!
        locked: Boolean!
        error: String
        updatedAt: DateTime!
        revision: Int!
        attempts: Int!
        nextAttemptAt: DateTime
        lastErrorCode: String
    }

    type ContentTranslationAudit {
        configured: Boolean!
        provider: String!
        total: Int!
        filteredTotal: Int!
        counts: [ContentTranslationStatusCount!]!
        states: [ContentTranslationStateRecord!]!
    }

    type ContentTranslationReview {
        state: ContentTranslationStateRecord!
        sourceText: String!
        targetText: String!
        sourceHash: String!
        translatedHash: String!
        format: String!
        canConfirm: Boolean!
        reason: String
        editPath: String
    }

    input ConfirmCustomerContentTranslationReviewInput {
        id: ID!
        revision: Int!
        sourceHash: String!
        translatedHash: String!
    }

    type ContentTranslationRecoveryRecord {
        id: ID!
        entityId: String!
        fieldPath: String!
        revision: Int!
        sourceHash: String!
        translatedHash: String
        eligible: Boolean!
        reason: String!
    }

    type ContentTranslationRecoveryPreview {
        total: Int!
        records: [ContentTranslationRecoveryRecord!]!
    }

    input RecoverCustomerContentTranslationInput {
        id: ID!
        revision: Int!
        sourceHash: String!
        translatedHash: String
    }

    type ContentTranslationRecoveryOutcome {
        id: ID!
        reason: String!
    }

    type ContentTranslationRecoveryResult {
        queued: Int!
        skipped: Int!
        records: [ContentTranslationRecoveryOutcome!]!
    }

    input ContentTranslationAuditOptions {
        skip: Int
        take: Int
        search: String
        status: String
        entityType: String
    }

    type ContentTranslationBackfillResult {
        total: Int!
        scanned: Int!
        processed: Int!
        queued: Int!
        skipped: Int!
        failed: Int!
        nextOffset: Int!
        hasMore: Boolean!
        skippedRecords: [String!]!
        errors: [String!]!
    }

    extend type Query {
        contentTranslationAudit(
            channelId: ID
            options: ContentTranslationAuditOptions
        ): ContentTranslationAudit!
        contentTranslationStaleCount: Int!
        contentTranslationReview(id: ID!): ContentTranslationReview!
        contentTranslationRecoveryPreview(
            limit: Int = 100
            offset: Int = 0
        ): ContentTranslationRecoveryPreview!
    }

    type ContentTranslationRetryResult {
        queued: Int!
    }

    extend type Mutation {
        confirmCustomerContentTranslationReview(
            input: ConfirmCustomerContentTranslationReviewInput!
        ): ContentTranslationStateRecord!
        recoverCustomerContentTranslations(
            inputs: [RecoverCustomerContentTranslationInput!]!
        ): ContentTranslationRecoveryResult!
        retryCustomerContentTranslations(ids: [ID!]!): ContentTranslationRetryResult!
        translateCustomerContent(segments: [ContentTranslationSegmentInput!]!): ContentTranslationResult!
        backfillCustomerContentTranslations(
            entityType: String
            limit: Int = 100
            offset: Int = 0
        ): ContentTranslationBackfillResult!
    }
`;
