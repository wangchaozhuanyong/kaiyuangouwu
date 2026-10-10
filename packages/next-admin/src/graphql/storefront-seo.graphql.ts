import { gql } from '@apollo/client';
import type {
    StorefrontSeoPayload,
    StorefrontSeoTargetType,
} from '../../../store-management-plugin/src/seo/storefront-seo.contract';

export interface StorefrontSeoIdentity {
    targetType: StorefrontSeoTargetType;
    targetId: string;
    languageCode: string;
}
export interface StorefrontSeoRecord extends StorefrontSeoIdentity {
    id: string | null;
    channelId: string;
    draft: StorefrontSeoPayload;
    published: StorefrontSeoPayload | null;
    version: number;
    publishedVersion: number;
    publishedAt: string | null;
    updatedAt: string | null;
    canWrite: boolean;
}
export interface StorefrontSeoIssue extends StorefrontSeoIdentity {
    code: string;
    severity: string;
    message: string;
}
export interface StorefrontSeoWorkspace {
    channelId: string;
    accessMode: 'LIVE' | 'PREVIEW' | 'CLOSED';
    settings: StorefrontSeoRecord;
    documents: StorefrontSeoRecord[];
    diagnostics: StorefrontSeoIssue[];
}
export interface StorefrontSeoRevision {
    id: string;
    version: number;
    payload: StorefrontSeoPayload | null;
    publishedAt: string;
    publishedBy: string;
}

const RECORD = gql`
    fragment NextAdminStorefrontSeoRecord on StorefrontSeoRecord {
        id
        channelId
        targetType
        targetId
        languageCode
        draft
        published
        version
        publishedVersion
        publishedAt
        updatedAt
        canWrite
    }
`;
export const STOREFRONT_SEO_WORKSPACE = gql`
    ${RECORD}
    query NextAdminStorefrontSeoWorkspace {
        activeChannel {
            id
            code
            token
        }
        storefrontSeoWorkspace {
            channelId
            accessMode
            settings {
                ...NextAdminStorefrontSeoRecord
            }
            documents {
                ...NextAdminStorefrontSeoRecord
            }
            diagnostics {
                code
                severity
                targetType
                targetId
                languageCode
                message
            }
        }
    }
`;
export const STOREFRONT_SEO_RECORD = gql`
    ${RECORD}
    query NextAdminStorefrontSeoRecord($input: StorefrontSeoIdentityInput!) {
        storefrontSeoRecord(input: $input) {
            ...NextAdminStorefrontSeoRecord
        }
    }
`;
export const STOREFRONT_SEO_ENTITY_RECORD = gql`
    ${RECORD}
    query NextAdminStorefrontSeoEntityRecord($input: StorefrontSeoIdentityInput!) {
        activeChannel {
            id
            code
            token
        }
        storefrontSeoRecord(input: $input) {
            ...NextAdminStorefrontSeoRecord
        }
    }
`;
export const STOREFRONT_SEO_HISTORY = gql`
    query NextAdminStorefrontSeoHistory($input: StorefrontSeoIdentityInput!) {
        storefrontSeoHistory(input: $input) {
            id
            version
            payload
            publishedAt
            publishedBy
        }
    }
`;
export const SAVE_STOREFRONT_SEO_DRAFT = gql`
    ${RECORD}
    mutation NextAdminSaveStorefrontSeoDraft($input: SaveStorefrontSeoDraftInput!) {
        saveStorefrontSeoDraft(input: $input) {
            ...NextAdminStorefrontSeoRecord
        }
    }
`;
export const PUBLISH_STOREFRONT_SEO_RECORD = gql`
    ${RECORD}
    mutation NextAdminPublishStorefrontSeoRecord($input: PublishStorefrontSeoRecordInput!) {
        publishStorefrontSeoRecord(input: $input) {
            ...NextAdminStorefrontSeoRecord
        }
    }
`;
export const UNPUBLISH_STOREFRONT_SEO_RECORD = gql`
    ${RECORD}
    mutation NextAdminUnpublishStorefrontSeoRecord($input: PublishStorefrontSeoRecordInput!) {
        unpublishStorefrontSeoRecord(input: $input) {
            ...NextAdminStorefrontSeoRecord
        }
    }
`;
export const RESTORE_STOREFRONT_SEO_REVISION = gql`
    ${RECORD}
    mutation NextAdminRestoreStorefrontSeoRevision($input: RestoreStorefrontSeoRevisionInput!) {
        restoreStorefrontSeoRevision(input: $input) {
            ...NextAdminStorefrontSeoRecord
        }
    }
`;
