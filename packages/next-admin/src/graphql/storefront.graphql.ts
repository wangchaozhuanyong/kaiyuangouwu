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
            mimeType
            preview
            source
            width
            height
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
                mimeType
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
            customFields {
                storefrontNameZh
                storefrontNameEn
            }
        }
        storefrontContentSettings {
            heroAutoplayIntervalSeconds
            configuredBlockTypes
        }
        storefrontAuthConfiguration {
            emailPasswordEnabled
            emailAutoRegistrationEnabled
            emailQuickRegistrationEnabled
            googleOverrideEnabled
            storeGoogleEnabled
            storeGoogleClientId
            platformGoogleEnabled
            platformGoogleClientId
            effectiveGoogleEnabled
            effectiveGoogleClientId
            googleConfigurationSource
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

export const UPDATE_STOREFRONT_AUTH_SETTINGS_MUTATION = gql`
    mutation NextAdminUpdateStorefrontAuthSettings($input: UpdateStorefrontAuthSettingsInput!) {
        updateStorefrontAuthSettings(input: $input) {
            emailPasswordEnabled
            emailAutoRegistrationEnabled
            emailQuickRegistrationEnabled
            googleOverrideEnabled
            storeGoogleEnabled
            storeGoogleClientId
            platformGoogleEnabled
            platformGoogleClientId
            effectiveGoogleEnabled
            effectiveGoogleClientId
            googleConfigurationSource
        }
    }
`;

export const UPDATE_STOREFRONT_GOOGLE_PLATFORM_SETTINGS_MUTATION = gql`
    mutation NextAdminUpdateStorefrontGooglePlatformSettings(
        $input: UpdateStorefrontGooglePlatformSettingsInput!
    ) {
        updateStorefrontGooglePlatformSettings(input: $input) {
            emailPasswordEnabled
            emailAutoRegistrationEnabled
            emailQuickRegistrationEnabled
            googleOverrideEnabled
            storeGoogleEnabled
            storeGoogleClientId
            platformGoogleEnabled
            platformGoogleClientId
            effectiveGoogleEnabled
            effectiveGoogleClientId
            googleConfigurationSource
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
            targetMode
            channels {
                id
                code
                customFields {
                    storefrontNameZh
                    storefrontNameEn
                }
            }
            titleZh
            titleEn
            titleEnLocked
            contentZh
            contentEn
            contentEnLocked
            linkUrl
            startsAt
            endsAt
        }
    }
`;

export const SYSTEM_ANNOUNCEMENT_CHANNELS_QUERY = gql`
    query NextAdminSystemAnnouncementChannels {
        channels(options: { take: 1000 }) {
            items {
                id
                code
                customFields {
                    storefrontNameZh
                    storefrontNameEn
                }
            }
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
    | 'ACCOUNT_HERO'
    | 'NAVIGATION'
    | 'CLIENT_PLUGINS'
    | 'CUSTOM';

export type StorefrontLayoutVariant =
    'AUTO' | 'HERO_OVERLAY' | 'TICKER' | 'ICON_GRID' | 'CARD_GRID' | 'PRODUCT_GRID' | 'RICH_TEXT' | 'CUSTOM';

export type StorefrontTargetType =
    'NONE' | 'URL' | 'PRODUCT' | 'COLLECTION' | 'CATEGORY' | 'SEARCH' | 'PAGE' | 'SUPPORT' | 'COUPON';

export interface StorefrontAssetRef {
    mimeType?: string;
    id: string;
    name: string;
    preview: string;
    source: string;
    width?: number;
    height?: number;
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
        customFields?: {
            storefrontNameZh?: string | null;
            storefrontNameEn?: string | null;
        } | null;
    };
    storefrontContentSettings: {
        heroAutoplayIntervalSeconds: number;
        configuredBlockTypes: StorefrontBlockType[];
    };
    storefrontAuthConfiguration: StorefrontAuthConfigurationRecord;
    storefrontContentBlocks: StorefrontContentBlock[];
}

export interface StorefrontAuthConfigurationRecord {
    emailPasswordEnabled: boolean;
    emailAutoRegistrationEnabled: boolean;
    emailQuickRegistrationEnabled: boolean;
    googleOverrideEnabled: boolean;
    storeGoogleEnabled: boolean;
    storeGoogleClientId: string | null;
    platformGoogleEnabled: boolean;
    platformGoogleClientId: string | null;
    effectiveGoogleEnabled: boolean;
    effectiveGoogleClientId: string | null;
    googleConfigurationSource: 'PLATFORM' | 'STORE';
}

export interface SystemAnnouncementRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    enabled: boolean;
    priority: number;
    targetMode: 'ALL' | 'SINGLE' | 'MULTIPLE';
    channels: SystemAnnouncementChannel[];
    titleZh: string;
    titleEn: string;
    titleEnLocked: boolean;
    contentZh: string;
    contentEn: string;
    contentEnLocked: boolean;
    linkUrl: string | null;
    startsAt: string | null;
    endsAt: string | null;
}

export interface SystemAnnouncementChannel {
    id: string;
    code: string;
    customFields?: {
        storefrontNameZh?: string | null;
        storefrontNameEn?: string | null;
    } | null;
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
