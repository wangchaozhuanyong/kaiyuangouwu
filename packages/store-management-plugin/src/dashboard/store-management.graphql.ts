import type { Asset } from '@vendure/dashboard';
import { gql } from 'graphql-tag';

export const storeTemplatesQuery = gql`
    query StoreProvisioningTemplates {
        storeProvisioningTemplates {
            id
            code
            defaultLanguageCode
            defaultCurrencyCode
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
    storeProvisioningTemplates: StoreTemplate[];
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

export interface StoreActivationReadiness {
    ready: boolean;
    checks: Array<{ code: string; ready: boolean; message: string; messageEn: string }>;
}

export interface StoreProfileRecord {
    id: string;
    updatedAt: string;
    status: StoreProfileStatus;
    sortOrder: number;
    descriptionZh: string;
    descriptionEn: string;
    internalNote: string | null;
    primaryDomain: string | null;
    storefrontUrl: string | null;
    isOperational: boolean;
    logoAsset: Asset | null;
    activationReadiness: StoreActivationReadiness;
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
        updatedAt
        status
        sortOrder
        descriptionZh
        descriptionEn
        internalNote
        primaryDomain
        storefrontUrl
        isOperational
        activationReadiness {
            ready
            checks {
                code
                ready
                message
                messageEn
            }
        }
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
