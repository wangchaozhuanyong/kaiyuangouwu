import type { Asset } from '@vendure/dashboard';
import { gql } from 'graphql-tag';

export const merchantInitialPasswordStatusQuery = gql`
    query MerchantInitialPasswordStatus {
        merchantInitialPasswordStatus {
            mustChangePassword
        }
    }
`;

export const completeInitialPasswordChangeMutation = gql`
    mutation CompleteInitialPasswordChange($password: String!) {
        completeInitialPasswordChange(password: $password) {
            mustChangePassword
        }
    }
`;

const myStoreProfileFields = gql`
    fragment MyStoreProfileFields on StoreProfile {
        id
        status
        isOperational
        descriptionZh
        descriptionEn
        primaryDomain
        storefrontUrl
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

export const myStoreProfileQuery = gql`
    ${myStoreProfileFields}

    query MyStoreProfile {
        myStoreProfile {
            ...MyStoreProfileFields
        }
    }
`;

export const updateMyStoreProfileMutation = gql`
    ${myStoreProfileFields}

    mutation UpdateMyStoreProfile($input: UpdateMyStoreProfileInput!) {
        updateMyStoreProfile(input: $input) {
            ...MyStoreProfileFields
        }
    }
`;

export interface MerchantInitialPasswordStatusResult {
    merchantInitialPasswordStatus: { mustChangePassword: boolean };
}

export interface CompleteInitialPasswordChangeResult {
    completeInitialPasswordChange: { mustChangePassword: boolean };
}

export interface MyStoreProfileRecord {
    id: string;
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
    isOperational: boolean;
    descriptionZh: string;
    descriptionEn: string;
    primaryDomain: string | null;
    storefrontUrl: string | null;
    logoAsset: Asset | null;
    activationReadiness: {
        ready: boolean;
        checks: Array<{ code: string; ready: boolean; message: string; messageEn: string }>;
    };
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

export interface MyStoreProfileResult {
    myStoreProfile: MyStoreProfileRecord;
}

export interface UpdateMyStoreProfileResult {
    updateMyStoreProfile: MyStoreProfileRecord;
}
