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

const brandAssetFields = gql`
    fragment MyStoreProfileBrandAssetFields on Asset {
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
`;

const myStoreProfileFields = gql`
    fragment MyStoreProfileFields on StoreProfile {
        id
        updatedAt
        status
        isOperational
        descriptionZh
        descriptionEn
        taglineZh
        taglineEn
        brandBackgroundColor
        brandPrimaryColor
        brandAccentColor
        brandHighlightColor
        legalEntityName
        legalRegistrationCountry
        supportEmail
        privacyEmail
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
            ...MyStoreProfileBrandAssetFields
        }
        logoOnLightAsset {
            ...MyStoreProfileBrandAssetFields
        }
        logoOnDarkAsset {
            ...MyStoreProfileBrandAssetFields
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
    ${brandAssetFields}
    ${myStoreProfileFields}

    query MyStoreProfile {
        myStoreProfile {
            ...MyStoreProfileFields
        }
        myStoreGovernanceChanges {
            id
            requestType
            status
            maskedSummary
            reviewReason
            submittedAt
        }
    }
`;

export const updateMyStoreProfileMutation = gql`
    ${brandAssetFields}
    ${myStoreProfileFields}

    mutation UpdateMyStoreProfile($input: UpdateMyStoreProfileInput!) {
        updateMyStoreProfile(input: $input) {
            ...MyStoreProfileFields
        }
    }
`;

export const submitStoreGovernanceChangeMutation = gql`
    mutation SubmitStoreGovernanceChange($input: SubmitStoreGovernanceChangeInput!) {
        submitStoreGovernanceChange(input: $input) {
            id
            requestType
            status
            maskedSummary
            reviewReason
            submittedAt
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
    updatedAt: string;
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
    isOperational: boolean;
    descriptionZh: string;
    descriptionEn: string;
    taglineZh: string | null;
    taglineEn: string | null;
    brandBackgroundColor: string | null;
    brandPrimaryColor: string | null;
    brandAccentColor: string | null;
    brandHighlightColor: string | null;
    legalEntityName: string | null;
    legalRegistrationCountry: string | null;
    supportEmail: string | null;
    privacyEmail: string | null;
    primaryDomain: string | null;
    storefrontUrl: string | null;
    logoAsset: Asset | null;
    logoOnLightAsset: Asset | null;
    logoOnDarkAsset: Asset | null;
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
    myStoreGovernanceChanges: StoreGovernanceChangeRecord[];
}

export interface UpdateMyStoreProfileResult {
    updateMyStoreProfile: MyStoreProfileRecord;
}

export interface StoreGovernanceChangeRecord {
    id: string;
    requestType: 'LEGAL_IDENTITY' | 'PAYOUT_ACCOUNT' | 'PAYMENT_CONFIGURATION' | 'USDT_WALLET';
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    maskedSummary: Record<string, unknown>;
    reviewReason: string | null;
    submittedAt: string;
}

export interface SubmitStoreGovernanceChangeResult {
    submitStoreGovernanceChange: StoreGovernanceChangeRecord;
}
