import type { ID } from '@vendure/core';

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
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
    status?: StoreProfileStatus | null;
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
