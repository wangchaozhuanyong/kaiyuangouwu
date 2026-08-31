import { gql } from '@apollo/client';

const STOREFRONT_BLOCK_FIELDS = gql`
    fragment NextAdminStorefrontBlockFields on StorefrontContentBlock {
        id
        createdAt
        updatedAt
        code
        internalName
        type
        layoutVariant
        enabled
        position
        startsAt
        endsAt
        imageAsset {
            id
            name
            preview
            source
        }
        imageUrl
        backgroundColor
        textColor
        targetType
        targetValue
        settings
        title
        subtitle
        body
        ctaLabel
        translations {
            id
            languageCode
            title
            subtitle
            body
            ctaLabel
        }
        items {
            id
            enabled
            position
            imageAsset {
                id
                name
                preview
                source
            }
            imageUrl
            targetType
            targetValue
            settings
            label
            description
            translations {
                id
                languageCode
                label
                description
            }
        }
    }
`;

export const STOREFRONT_CONTENT_QUERY = gql`
    ${STOREFRONT_BLOCK_FIELDS}
    query NextAdminStorefrontContent {
        activeChannel {
            id
            code
            token
            defaultLanguageCode
            availableLanguageCodes
        }
        storefrontContentSettings {
            heroAutoplayIntervalSeconds
            configuredBlockTypes
        }
        storefrontContentBlocks {
            ...NextAdminStorefrontBlockFields
        }
    }
`;

export const CREATE_STOREFRONT_BLOCK_MUTATION = gql`
    ${STOREFRONT_BLOCK_FIELDS}
    mutation NextAdminCreateStorefrontBlock($input: CreateStorefrontContentBlockInput!) {
        createStorefrontContentBlock(input: $input) {
            ...NextAdminStorefrontBlockFields
        }
    }
`;

export const UPDATE_STOREFRONT_BLOCK_MUTATION = gql`
    ${STOREFRONT_BLOCK_FIELDS}
    mutation NextAdminUpdateStorefrontBlock($input: UpdateStorefrontContentBlockInput!) {
        updateStorefrontContentBlock(input: $input) {
            ...NextAdminStorefrontBlockFields
        }
    }
`;

export const REORDER_STOREFRONT_BLOCKS_MUTATION = gql`
    mutation NextAdminReorderStorefrontBlocks($ids: [ID!]!) {
        reorderStorefrontContentBlocks(ids: $ids) {
            id
            position
            updatedAt
        }
    }
`;

export const DELETE_STOREFRONT_BLOCK_MUTATION = gql`
    mutation NextAdminDeleteStorefrontBlock($id: ID!) {
        deleteStorefrontContentBlock(id: $id) {
            result
            message
        }
    }
`;

export const UPDATE_STOREFRONT_SETTINGS_MUTATION = gql`
    mutation NextAdminUpdateStorefrontSettings($input: UpdateStorefrontContentSettingsInput!) {
        updateStorefrontContentSettings(input: $input) {
            heroAutoplayIntervalSeconds
            configuredBlockTypes
        }
    }
`;

export const STOREFRONT_PLUGIN_COLLECTIONS_QUERY = gql`
    query NextAdminStorefrontPluginCollections(
        $options: CollectionListOptions
        $selectedOptions: CollectionListOptions
    ) {
        collections(options: $options) {
            items {
                id
                name
                parentId
            }
            totalItems
        }
        selectedCollections: collections(options: $selectedOptions) {
            items {
                id
                name
                parentId
            }
            totalItems
        }
    }
`;

export const STOREFRONT_EDITOR_OPTIONS_QUERY = gql`
    query NextAdminStorefrontEditorOptions($productOptions: ProductListOptions) {
        products(options: $productOptions) {
            items {
                id
                name
                slug
                featuredAsset {
                    id
                    preview
                }
            }
            totalItems
        }
    }
`;

export const SYSTEM_ANNOUNCEMENTS_QUERY = gql`
    query NextAdminSystemAnnouncements {
        systemAnnouncements {
            id
            createdAt
            updatedAt
            enabled
            priority
            titleZh
            titleEn
            contentZh
            contentEn
            linkUrl
            startsAt
            endsAt
        }
    }
`;

export const CREATE_SYSTEM_ANNOUNCEMENT_MUTATION = gql`
    mutation NextAdminCreateSystemAnnouncement($input: CreateSystemAnnouncementInput!) {
        createSystemAnnouncement(input: $input) {
            id
            updatedAt
        }
    }
`;

export const UPDATE_SYSTEM_ANNOUNCEMENT_MUTATION = gql`
    mutation NextAdminUpdateSystemAnnouncement($input: UpdateSystemAnnouncementInput!) {
        updateSystemAnnouncement(input: $input) {
            id
            enabled
            updatedAt
        }
    }
`;

export const DELETE_SYSTEM_ANNOUNCEMENT_MUTATION = gql`
    mutation NextAdminDeleteSystemAnnouncement($id: ID!) {
        deleteSystemAnnouncement(id: $id) {
            result
            message
        }
    }
`;

const PROMOTION_PAGE_FIELDS = gql`
    fragment NextAdminPromotionPageFields on StorefrontPromotionPage {
        id
        contentType
        draftSource
        publishedSource
        isCustomized
        defaultTemplateVersion
        publishedVersion
        publishedAt
        publicUrl
    }
`;

export const STOREFRONT_PROMOTION_PAGE_QUERY = gql`
    ${PROMOTION_PAGE_FIELDS}
    query NextAdminStorefrontPromotionPage {
        storefrontPromotionPage {
            ...NextAdminPromotionPageFields
        }
    }
`;

export const SAVE_STOREFRONT_PROMOTION_DRAFT_MUTATION = gql`
    ${PROMOTION_PAGE_FIELDS}
    mutation NextAdminSaveStorefrontPromotionDraft($input: UpdateStorefrontPromotionDraftInput!) {
        saveStorefrontPromotionDraft(input: $input) {
            ...NextAdminPromotionPageFields
        }
    }
`;

export const PREVIEW_STOREFRONT_PROMOTION_PAGE_MUTATION = gql`
    mutation NextAdminPreviewStorefrontPromotionPage($input: UpdateStorefrontPromotionDraftInput!) {
        previewStorefrontPromotionPage(input: $input)
    }
`;

export const PUBLISH_STOREFRONT_PROMOTION_PAGE_MUTATION = gql`
    ${PROMOTION_PAGE_FIELDS}
    mutation NextAdminPublishStorefrontPromotionPage {
        publishStorefrontPromotionPage {
            ...NextAdminPromotionPageFields
        }
    }
`;

export const RESET_STOREFRONT_PROMOTION_PAGE_MUTATION = gql`
    ${PROMOTION_PAGE_FIELDS}
    mutation NextAdminResetStorefrontPromotionPage {
        resetStorefrontPromotionPage {
            ...NextAdminPromotionPageFields
        }
    }
`;

export type StorefrontLanguageCode = 'zh_Hans' | 'en';

export type StorefrontBlockType =
    | 'HERO'
    | 'NOTICE'
    | 'QUICK_LINKS'
    | 'CATEGORY_AD'
    | 'FEATURED_COLLECTION'
    | 'COUPONS'
    | 'TRUST_BAR'
    | 'CORE_CATEGORIES'
    | 'FLASH_SALE'
    | 'BEST_SELLERS'
    | 'RECOMMENDATIONS'
    | 'STORY'
    | 'LEGAL'
    | 'SUPPORT'
    | 'AUTH_LOGIN'
    | 'AUTH_REGISTER'
    | 'NAVIGATION'
    | 'CLIENT_PLUGINS'
    | 'CUSTOM';

export type StorefrontLayoutVariant =
    'AUTO' | 'HERO_OVERLAY' | 'TICKER' | 'ICON_GRID' | 'CARD_GRID' | 'PRODUCT_GRID' | 'RICH_TEXT' | 'CUSTOM';

export type StorefrontTargetType =
    'NONE' | 'URL' | 'PRODUCT' | 'COLLECTION' | 'CATEGORY' | 'SEARCH' | 'PAGE' | 'SUPPORT' | 'COUPON';

export interface StorefrontAssetRef {
    id: string;
    name: string;
    preview: string;
    source: string;
}

export interface StorefrontBlockTranslation {
    id?: string;
    languageCode: StorefrontLanguageCode;
    title: string;
    subtitle: string;
    body: string;
    ctaLabel: string;
}

export interface StorefrontItemTranslation {
    id?: string;
    languageCode: StorefrontLanguageCode;
    label: string;
    description: string;
}

export interface StorefrontContentItem {
    id?: string;
    enabled: boolean;
    position: number;
    imageAsset: StorefrontAssetRef | null;
    imageAssetId?: string | null;
    imageUrl: string | null;
    targetType: StorefrontTargetType;
    targetValue: string | null;
    settings: Record<string, unknown> | null;
    label?: string;
    description?: string;
    translations: StorefrontItemTranslation[];
}

export interface StorefrontContentBlock {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    code: string;
    internalName: string;
    type: StorefrontBlockType;
    layoutVariant: StorefrontLayoutVariant;
    enabled: boolean;
    position: number;
    startsAt: string | null;
    endsAt: string | null;
    imageAsset: StorefrontAssetRef | null;
    imageAssetId?: string | null;
    imageUrl: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    targetType: StorefrontTargetType;
    targetValue: string | null;
    settings: Record<string, unknown> | null;
    title?: string;
    subtitle?: string;
    body?: string;
    ctaLabel?: string;
    translations: StorefrontBlockTranslation[];
    items: StorefrontContentItem[];
}

export interface StorefrontContentResult {
    activeChannel: {
        id: string;
        code: string;
        token: string;
        defaultLanguageCode: string;
        availableLanguageCodes: string[];
    };
    storefrontContentSettings: {
        heroAutoplayIntervalSeconds: number;
        configuredBlockTypes: StorefrontBlockType[];
    };
    storefrontContentBlocks: StorefrontContentBlock[];
}

export interface SystemAnnouncementRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    enabled: boolean;
    priority: number;
    titleZh: string;
    titleEn: string;
    contentZh: string;
    contentEn: string;
    linkUrl: string | null;
    startsAt: string | null;
    endsAt: string | null;
}

export interface StorefrontPromotionRecord {
    id: string | null;
    contentType: 'HTML' | 'MARKDOWN';
    draftSource: string;
    publishedSource: string | null;
    isCustomized: boolean;
    defaultTemplateVersion: number;
    publishedVersion: number;
    publishedAt: string | null;
    publicUrl: string | null;
}
