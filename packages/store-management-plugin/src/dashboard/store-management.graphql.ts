import type { Asset } from '@vendure/dashboard';
import { gql } from 'graphql-tag';

export const storeTemplatesQuery = gql`
    query StoreProvisioningTemplates {
        channels(options: { take: 100, sort: { code: ASC } }) {
            items {
                id
                code
                defaultLanguageCode
                defaultCurrencyCode
            }
        }
    }
`;

export const provisionStoreMutation = gql`
    mutation ProvisionStore($input: ProvisionStoreInput!) {
        provisionStore(input: $input) {
            sellerId
            channelId
            roleId
            administratorId
            stockLocationId
            profileId
            channelCode
            temporaryPassword
        }
    }
`;

export interface StoreTemplate {
    id: string;
    code: string;
    defaultLanguageCode: string;
    defaultCurrencyCode: string;
}

export interface StoreTemplatesResult {
    channels: {
        items: StoreTemplate[];
    };
}

export interface ProvisionStoreResult {
    provisionStore: {
        sellerId: string;
        channelId: string;
        roleId: string;
        administratorId: string;
        stockLocationId: string;
        profileId: string;
        channelCode: string;
        temporaryPassword: string;
    };
}

export type StoreProfileStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED';

export interface StoreProfileRecord {
    id: string;
    status: StoreProfileStatus;
    isPublished: boolean;
    sortOrder: number;
    descriptionZh: string;
    descriptionEn: string;
    primaryDomain: string | null;
    storefrontUrl: string | null;
    logoAsset: Asset | null;
    channel: {
        id: string;
        code: string;
        seller: { id: string; name: string } | null;
        customFields: {
            storefrontNameZh: string;
            storefrontNameEn: string;
        };
    };
}

export interface StoreProfilesResult {
    storeProfiles: StoreProfileRecord[];
}

export interface UpdateStoreProfileResult {
    updateStoreProfile: StoreProfileRecord;
}

const storeProfileFields = gql`
    fragment StoreManagementProfile on StoreProfile {
        id
        status
        isPublished
        sortOrder
        descriptionZh
        descriptionEn
        primaryDomain
        storefrontUrl
        logoAsset {
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
        channel {
            id
            code
            seller {
                id
                name
            }
            customFields {
                storefrontNameZh
                storefrontNameEn
            }
        }
    }
`;

export const storeProfilesQuery = gql`
    ${storeProfileFields}

    query StoreManagementProfiles {
        storeProfiles {
            ...StoreManagementProfile
        }
    }
`;

export const updateStoreProfileMutation = gql`
    ${storeProfileFields}

    mutation UpdateStoreManagementProfile($input: UpdateStoreProfileInput!) {
        updateStoreProfile(input: $input) {
            ...StoreManagementProfile
        }
    }
`;
