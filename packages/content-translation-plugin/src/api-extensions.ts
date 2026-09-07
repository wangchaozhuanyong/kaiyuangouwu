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
        counts: [ContentTranslationStatusCount!]!
        states: [ContentTranslationStateRecord!]!
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
        contentTranslationAudit(channelId: ID): ContentTranslationAudit!
        contentTranslationStaleCount: Int!
    }

    type ContentTranslationRetryResult {
        queued: Int!
    }

    extend type Mutation {
        retryCustomerContentTranslations(ids: [ID!]!): ContentTranslationRetryResult!
        translateCustomerContent(segments: [ContentTranslationSegmentInput!]!): ContentTranslationResult!
        backfillCustomerContentTranslations(
            entityType: String
            limit: Int = 100
            offset: Int = 0
        ): ContentTranslationBackfillResult!
    }
`;
