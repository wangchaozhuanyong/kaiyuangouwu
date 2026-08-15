import type { Asset, ID } from '@vendure/core';

export interface ProvisionStoreAdministratorInput {
    firstName: string;
    lastName: string;
    emailAddress: string;
}

export interface ProvisionStoreInput {
    code: string;
    name: string;
    storefrontNameZh: string;
    storefrontNameEn: string;
    templateChannelId: ID;
    administrator: ProvisionStoreAdministratorInput;
}

export interface ProvisionStoreResult {
    sellerId: ID;
    channelId: ID;
    roleId: ID;
    administratorId: ID;
    stockLocationId: ID;
    profileId: ID;
    channelCode: string;
    temporaryPassword: string;
}

export type StoreProfileStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED';

export interface UpdateStoreProfileInput {
    id: ID;
    status?: StoreProfileStatus | null;
    isPublished?: boolean | null;
    sortOrder?: number | null;
    descriptionZh?: string | null;
    descriptionEn?: string | null;
    logoAssetId?: ID | null;
}

export interface UpdateMyStoreProfileInput {
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
    descriptionZh?: string | null;
    descriptionEn?: string | null;
    logoAssetId?: ID | null;
}

export interface PublicStoreSummary {
    id: ID;
    channelId: ID;
    code: string;
    merchantName: string;
    storefrontNameZh: string;
    storefrontNameEn: string;
    descriptionZh: string;
    descriptionEn: string;
    logo: Asset | null;
    domain: string;
    storefrontUrl: string;
}
