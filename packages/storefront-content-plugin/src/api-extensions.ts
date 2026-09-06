import { gql } from 'graphql-tag';

const commonTypes = gql`
    enum StorefrontContentBlockType {
        HERO
        NOTICE
        QUICK_LINKS
        CATEGORY_AD
        FEATURED_COLLECTION
        COUPONS
        TRUST_BAR
        CORE_CATEGORIES
        FLASH_SALE
        BEST_SELLERS
        RECOMMENDATIONS
        STORY
        LEGAL
        SUPPORT
        AUTH_LOGIN
        AUTH_REGISTER
        NAVIGATION
        CLIENT_PLUGINS
        CUSTOM
    }

    enum StorefrontContentLayoutVariant {
        AUTO
        HERO_OVERLAY
        TICKER
        ICON_GRID
        CARD_GRID
        PRODUCT_GRID
        RICH_TEXT
        CUSTOM
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
        COUPON
    }

    type StorefrontContentItem implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        enabled: Boolean!
        position: Int!
        imageAsset: Asset
        imageUrl: String
        targetType: StorefrontContentTargetType!
        targetValue: String
        settings: JSON
        label: String!
        description: String!
    }

    type StorefrontContentBlock implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        internalName: String!
        type: StorefrontContentBlockType!
        layoutVariant: StorefrontContentLayoutVariant!
        enabled: Boolean!
        position: Int!
        startsAt: DateTime
        endsAt: DateTime
        imageAsset: Asset
        imageUrl: String
        backgroundColor: String
        textColor: String
        targetType: StorefrontContentTargetType!
        targetValue: String
        settings: JSON
        title: String!
        subtitle: String!
        body: String!
        ctaLabel: String!
        items: [StorefrontContentItem!]!
    }

    type StorefrontVisualPreset {
        channelId: ID!
        presetId: String!
        revision: String!
    }

    type StorefrontContentSettings {
        heroAutoplayIntervalSeconds: Int!
        configuredBlockTypes: [StorefrontContentBlockType!]!
    }
`;

export const shopApiExtensions = gql`
    ${commonTypes}

    extend type Query {
        storefrontVisualPreset: StorefrontVisualPreset!
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
        titleLocked: Boolean
        subtitle: String
        subtitleLocked: Boolean
        body: String
        bodyLocked: Boolean
        ctaLabel: String
        ctaLabelLocked: Boolean
    }

    input StorefrontContentItemTranslationInput {
        languageCode: LanguageCode!
        label: String!
        labelLocked: Boolean
        description: String
        descriptionLocked: Boolean
    }

    input StorefrontContentItemInput {
        id: ID
        enabled: Boolean
        position: Int!
        imageAssetId: ID
        imageUrl: String
        targetType: StorefrontContentTargetType
        targetValue: String
        settings: JSON
        translations: [StorefrontContentItemTranslationInput!]!
    }

    input CreateStorefrontContentBlockInput {
        code: String!
        internalName: String
        type: StorefrontContentBlockType!
        layoutVariant: StorefrontContentLayoutVariant
        enabled: Boolean
        position: Int!
        startsAt: DateTime
        endsAt: DateTime
        imageAssetId: ID
        imageUrl: String
        backgroundColor: String
        textColor: String
        targetType: StorefrontContentTargetType
        targetValue: String
        settings: JSON
        translations: [StorefrontContentBlockTranslationInput!]!
        items: [StorefrontContentItemInput!]
    }

    input UpdateStorefrontContentBlockInput {
        id: ID!
        expectedUpdatedAt: DateTime!
        code: String
        internalName: String
        type: StorefrontContentBlockType
        layoutVariant: StorefrontContentLayoutVariant
        enabled: Boolean
        position: Int
        startsAt: DateTime
        endsAt: DateTime
        imageAssetId: ID
        imageUrl: String
        backgroundColor: String
        textColor: String
        targetType: StorefrontContentTargetType
        targetValue: String
        settings: JSON
        translations: [StorefrontContentBlockTranslationInput!]
        items: [StorefrontContentItemInput!]
    }

    input UpdateStorefrontContentSettingsInput {
        heroAutoplayIntervalSeconds: Int!
    }

    input StorefrontContentBlockVersionInput {
        id: ID!
        expectedUpdatedAt: DateTime!
    }

    input ApplyStorefrontContentChangesInput {
        expectedBlocks: [StorefrontContentBlockVersionInput!]!
        creates: [CreateStorefrontContentBlockInput!]!
        updates: [UpdateStorefrontContentBlockInput!]!
        orderedCodes: [String!]
    }

    extend type Query {
        storefrontVisualPreset: StorefrontVisualPreset!
        storefrontContentBlocks: [StorefrontContentBlock!]!
        storefrontContentBlock(id: ID!): StorefrontContentBlock
        storefrontContentSettings: StorefrontContentSettings!
    }

    input UpdateStorefrontVisualPresetInput {
        channelId: ID!
        presetId: String!
        expectedRevision: String!
    }

    extend type Mutation {
        updateStorefrontVisualPreset(input: UpdateStorefrontVisualPresetInput!): StorefrontVisualPreset!
        createStorefrontContentBlock(input: CreateStorefrontContentBlockInput!): StorefrontContentBlock!
        updateStorefrontContentBlock(input: UpdateStorefrontContentBlockInput!): StorefrontContentBlock!
        applyStorefrontContentChanges(input: ApplyStorefrontContentChangesInput!): [StorefrontContentBlock!]!
        reorderStorefrontContentBlocks(ids: [ID!]!): [StorefrontContentBlock!]!
        deleteStorefrontContentBlock(id: ID!): DeletionResponse!
        updateStorefrontContentSettings(
            input: UpdateStorefrontContentSettingsInput!
        ): StorefrontContentSettings!
    }
`;
