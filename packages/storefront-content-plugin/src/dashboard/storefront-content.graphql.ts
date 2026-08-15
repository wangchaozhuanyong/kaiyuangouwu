import { gql } from 'graphql-tag';

export const storefrontContentBlocksQuery = gql`
    query StorefrontContentBlocks {
        storefrontContentBlocks {
            id
            createdAt
            updatedAt
            code
            type
            enabled
            position
            startsAt
            endsAt
            imageUrl
            backgroundColor
            textColor
            targetType
            targetValue
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
                imageUrl
                targetType
                targetValue
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
    | 'STORY'
    | 'LEGAL'
    | 'SUPPORT';

export type ContentTargetType =
    | 'NONE'
    | 'URL'
    | 'PRODUCT'
    | 'COLLECTION'
    | 'CATEGORY'
    | 'SEARCH'
    | 'PAGE'
    | 'SUPPORT';

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
    imageUrl: string | null;
    targetType: ContentTargetType;
    targetValue: string | null;
    label?: string;
    description?: string;
    translations: ContentItemTranslation[];
}

export interface ContentBlock {
    id?: string;
    code: string;
    type: ContentBlockType;
    enabled: boolean;
    position: number;
    startsAt: string | null;
    endsAt: string | null;
    imageUrl: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    targetType: ContentTargetType;
    targetValue: string | null;
    title?: string;
    subtitle?: string;
    body?: string;
    ctaLabel?: string;
    translations: ContentBlockTranslation[];
    items: ContentItem[];
}

export interface StorefrontContentBlocksResult {
    storefrontContentBlocks: ContentBlock[];
}
