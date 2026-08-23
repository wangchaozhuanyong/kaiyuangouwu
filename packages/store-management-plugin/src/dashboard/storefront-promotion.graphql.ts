import { gql } from 'graphql-tag';

const storefrontPromotionFields = gql`
    fragment StorefrontPromotionFields on StorefrontPromotionPage {
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

export const storefrontPromotionPageQuery = gql`
    ${storefrontPromotionFields}
    query StorefrontPromotionPage {
        storefrontPromotionPage {
            ...StorefrontPromotionFields
        }
    }
`;

export const saveStorefrontPromotionDraftMutation = gql`
    ${storefrontPromotionFields}
    mutation SaveStorefrontPromotionDraft($input: UpdateStorefrontPromotionDraftInput!) {
        saveStorefrontPromotionDraft(input: $input) {
            ...StorefrontPromotionFields
        }
    }
`;

export const publishStorefrontPromotionPageMutation = gql`
    ${storefrontPromotionFields}
    mutation PublishStorefrontPromotionPage {
        publishStorefrontPromotionPage {
            ...StorefrontPromotionFields
        }
    }
`;

export const resetStorefrontPromotionPageMutation = gql`
    ${storefrontPromotionFields}
    mutation ResetStorefrontPromotionPage {
        resetStorefrontPromotionPage {
            ...StorefrontPromotionFields
        }
    }
`;

export const previewStorefrontPromotionPageMutation = gql`
    mutation PreviewStorefrontPromotionPage($input: UpdateStorefrontPromotionDraftInput!) {
        previewStorefrontPromotionPage(input: $input)
    }
`;

export type PromotionContentType = 'HTML' | 'MARKDOWN';

export interface StorefrontPromotionRecord {
    id: string | null;
    contentType: PromotionContentType;
    draftSource: string;
    publishedSource: string | null;
    isCustomized: boolean;
    defaultTemplateVersion: number;
    publishedVersion: number;
    publishedAt: string | null;
    publicUrl: string | null;
}

export interface StorefrontPromotionPageResult {
    storefrontPromotionPage: StorefrontPromotionRecord;
}

export interface SaveStorefrontPromotionDraftResult {
    saveStorefrontPromotionDraft: StorefrontPromotionRecord;
}

export interface PublishStorefrontPromotionPageResult {
    publishStorefrontPromotionPage: StorefrontPromotionRecord;
}

export interface ResetStorefrontPromotionPageResult {
    resetStorefrontPromotionPage: StorefrontPromotionRecord;
}

export interface PreviewStorefrontPromotionPageResult {
    previewStorefrontPromotionPage: string;
}
