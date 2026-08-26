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
        failed: Int!
        nextOffset: Int!
        hasMore: Boolean!
        errors: [String!]!
    }

    extend type Query {
        contentTranslationAudit(channelId: ID): ContentTranslationAudit!
        contentTranslationStaleCount: Int!
    }

    extend type Mutation {
        translateCustomerContent(segments: [ContentTranslationSegmentInput!]!): ContentTranslationResult!
        backfillCustomerContentTranslations(
            entityType: String
            limit: Int = 100
            offset: Int = 0
        ): ContentTranslationBackfillResult!
    }
`;
