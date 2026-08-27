import type { Asset } from '@vendure/dashboard';
import { gql } from 'graphql-tag';

export const storefrontContentBlocksQuery = gql`
    query StorefrontContentBlocks {
        storefrontContentSettings {
            heroAutoplayIntervalSeconds
            configuredBlockTypes
        }
        storefrontContentBlocks {
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
                createdAt
                updatedAt
                languageCode
                name
                fileSize
                mimeType
                type
                preview
                source
                width
                height
                focalPoint {
                    x
                    y
                }
                translations {
                    id
                    languageCode
                    name
                }
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
                    createdAt
                    updatedAt
                    languageCode
                    name
                    fileSize
                    mimeType
                    type
                    preview
                    source
                    width
                    height
                    focalPoint {
                        x
                        y
                    }
                    translations {
                        id
                        languageCode
                        name
                    }
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
    }
`;

export const storefrontClientPluginCollectionsQuery = gql`
    query StorefrontClientPluginCollections {
        collections(options: { take: 200, sort: { name: ASC } }) {
            items {
                id
                name
                parentId
            }
        }
    }
`;

export const storefrontContentTargetProductQuery = gql`
    query StorefrontContentTargetProduct($id: ID!) {
        product(id: $id) {
            id
            name
            slug
            featuredAsset {
                id
                preview
            }
        }
    }
`;

export const createStorefrontContentBlockMutation = gql`
    mutation CreateStorefrontContentBlock($input: CreateStorefrontContentBlockInput!) {
        createStorefrontContentBlock(input: $input) {
            id
        }
    }
`;

export const updateStorefrontContentBlockMutation = gql`
    mutation UpdateStorefrontContentBlock($input: UpdateStorefrontContentBlockInput!) {
        updateStorefrontContentBlock(input: $input) {
            id
        }
    }
`;

export const updateStorefrontContentSettingsMutation = gql`
    mutation UpdateStorefrontContentSettings($input: UpdateStorefrontContentSettingsInput!) {
        updateStorefrontContentSettings(input: $input) {
            heroAutoplayIntervalSeconds
        }
    }
`;

export const reorderStorefrontContentBlocksMutation = gql`
    mutation ReorderStorefrontContentBlocks($ids: [ID!]!) {
        reorderStorefrontContentBlocks(ids: $ids) {
            id
            position
        }
    }
`;

export const deleteStorefrontContentBlockMutation = gql`
    mutation DeleteStorefrontContentBlock($id: ID!) {
        deleteStorefrontContentBlock(id: $id) {
            result
            message
        }
    }
`;

export type ContentBlockType =
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

export type ContentLayoutVariant =
    'AUTO' | 'HERO_OVERLAY' | 'TICKER' | 'ICON_GRID' | 'CARD_GRID' | 'PRODUCT_GRID' | 'RICH_TEXT' | 'CUSTOM';

export type ContentTargetType =
    'NONE' | 'URL' | 'PRODUCT' | 'COLLECTION' | 'CATEGORY' | 'SEARCH' | 'PAGE' | 'SUPPORT' | 'COUPON';

export interface ContentBlockTranslation {
    id?: string;
    languageCode: 'zh_Hans' | 'en';
    title: string;
    subtitle: string;
    body: string;
    ctaLabel: string;
}

export interface ContentItemTranslation {
    id?: string;
    languageCode: 'zh_Hans' | 'en';
    label: string;
    description: string;
}

export interface ContentItem {
    id?: string;
    enabled: boolean;
    position: number;
    imageAsset: Asset | null;
    imageAssetId?: string | null;
    imageUrl: string | null;
    targetType: ContentTargetType;
    targetValue: string | null;
    settings: Record<string, unknown> | null;
    label?: string;
    description?: string;
    translations: ContentItemTranslation[];
}

export interface ContentBlock {
    id?: string;
    code: string;
    internalName: string;
    type: ContentBlockType;
    layoutVariant: ContentLayoutVariant;
    enabled: boolean;
    position: number;
    startsAt: string | null;
    endsAt: string | null;
    imageAsset: Asset | null;
    imageAssetId?: string | null;
    imageUrl: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    targetType: ContentTargetType;
    targetValue: string | null;
    settings: Record<string, unknown> | null;
    title?: string;
    subtitle?: string;
    body?: string;
    ctaLabel?: string;
    translations: ContentBlockTranslation[];
    items: ContentItem[];
}

export interface StorefrontContentBlocksResult {
    storefrontContentSettings: {
        heroAutoplayIntervalSeconds: number;
        configuredBlockTypes: ContentBlockType[];
    };
    storefrontContentBlocks: ContentBlock[];
}

export interface StorefrontClientPluginCollection {
    id: string;
    name: string;
    parentId: string;
}

export interface StorefrontClientPluginCollectionsResult {
    collections: {
        items: StorefrontClientPluginCollection[];
    };
}

export interface StorefrontContentTargetProductResult {
    product: {
        id: string;
        name: string;
        slug: string;
        featuredAsset: { id: string; preview: string } | null;
    } | null;
}
