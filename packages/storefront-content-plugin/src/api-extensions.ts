import { gql } from 'graphql-tag';

const commonTypes = gql`
    enum StorefrontContentBlockType {
        HERO
        NOTICE
        QUICK_LINKS
        CATEGORY_AD
        FEATURED_COLLECTION
        STORY
        LEGAL
        SUPPORT
    }

    enum StorefrontContentTargetType {
        NONE
        URL
        PRODUCT
        COLLECTION
        CATEGORY
        SEARCH
        PAGE
        SUPPORT
    }

    type StorefrontContentItem implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        enabled: Boolean!
        position: Int!
        imageUrl: String
        targetType: StorefrontContentTargetType!
        targetValue: String
        label: String!
        description: String!
    }

    type StorefrontContentBlock implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        type: StorefrontContentBlockType!
        enabled: Boolean!
        position: Int!
        startsAt: DateTime
        endsAt: DateTime
        imageUrl: String
        backgroundColor: String
        textColor: String
        targetType: StorefrontContentTargetType!
        targetValue: String
        title: String!
        subtitle: String!
        body: String!
        ctaLabel: String!
        items: [StorefrontContentItem!]!
    }

    type StorefrontContentSettings {
        heroAutoplayIntervalSeconds: Int!
    }
`;

export const shopApiExtensions = gql`
    ${commonTypes}

    extend type Query {
        storefrontContent: [StorefrontContentBlock!]!
        storefrontContentSettings: StorefrontContentSettings!
    }
`;

export const adminApiExtensions = gql`
    ${commonTypes}

    type StorefrontContentBlockTranslation {
        id: ID!
        languageCode: LanguageCode!
        title: String!
        subtitle: String!
        body: String!
        ctaLabel: String!
    }

    type StorefrontContentItemTranslation {
        id: ID!
        languageCode: LanguageCode!
        label: String!
        description: String!
    }

    extend type StorefrontContentBlock {
        translations: [StorefrontContentBlockTranslation!]!
    }

    extend type StorefrontContentItem {
        translations: [StorefrontContentItemTranslation!]!
    }

    input StorefrontContentBlockTranslationInput {
        languageCode: LanguageCode!
        title: String!
        subtitle: String
        body: String
        ctaLabel: String
    }

    input StorefrontContentItemTranslationInput {
        languageCode: LanguageCode!
        label: String!
        description: String
    }

    input StorefrontContentItemInput {
        id: ID
        enabled: Boolean
        position: Int!
        imageUrl: String
        targetType: StorefrontContentTargetType
        targetValue: String
        translations: [StorefrontContentItemTranslationInput!]!
    }

    input CreateStorefrontContentBlockInput {
        code: String!
        type: StorefrontContentBlockType!
        enabled: Boolean
        position: Int!
        startsAt: DateTime
        endsAt: DateTime
        imageUrl: String
        backgroundColor: String
        textColor: String
        targetType: StorefrontContentTargetType
        targetValue: String
        translations: [StorefrontContentBlockTranslationInput!]!
        items: [StorefrontContentItemInput!]
    }

    input UpdateStorefrontContentBlockInput {
        id: ID!
        code: String
        type: StorefrontContentBlockType
        enabled: Boolean
        position: Int
        startsAt: DateTime
        endsAt: DateTime
        imageUrl: String
        backgroundColor: String
        textColor: String
        targetType: StorefrontContentTargetType
        targetValue: String
        translations: [StorefrontContentBlockTranslationInput!]
        items: [StorefrontContentItemInput!]
    }

    input UpdateStorefrontContentSettingsInput {
        heroAutoplayIntervalSeconds: Int!
    }

    extend type Query {
        storefrontContentBlocks: [StorefrontContentBlock!]!
        storefrontContentBlock(id: ID!): StorefrontContentBlock
        storefrontContentSettings: StorefrontContentSettings!
    }

    extend type Mutation {
        createStorefrontContentBlock(input: CreateStorefrontContentBlockInput!): StorefrontContentBlock!
        updateStorefrontContentBlock(input: UpdateStorefrontContentBlockInput!): StorefrontContentBlock!
        reorderStorefrontContentBlocks(ids: [ID!]!): [StorefrontContentBlock!]!
        deleteStorefrontContentBlock(id: ID!): DeletionResponse!
        updateStorefrontContentSettings(
            input: UpdateStorefrontContentSettingsInput!
        ): StorefrontContentSettings!
    }
`;
