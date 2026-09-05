import { gql } from 'graphql-tag';

export const storeProfileInputSchema = gql`
    input UpdateStoreProfileInput {
        id: ID!
        expectedUpdatedAt: DateTime!
        storefrontNameZh: String
        storefrontNameEn: String
        storefrontNameEnLocked: Boolean
        status: StoreProfileStatus
        sortOrder: Int
        descriptionZh: String
        descriptionEn: String
        descriptionEnLocked: Boolean
        internalNote: String
        logoAssetId: ID
        logoOnLightAssetId: ID
        logoOnDarkAssetId: ID
        taglineZh: String
        taglineEn: String
        taglineEnLocked: Boolean
        brandBackgroundColor: String
        brandPrimaryColor: String
        brandAccentColor: String
        brandHighlightColor: String
        legalEntityName: String
        legalRegistrationCountry: String
        supportEmail: String
        privacyEmail: String
        currentPassword: String
    }

    input UpdateMyStoreProfileInput {
        expectedUpdatedAt: DateTime!
        storefrontNameZh: String
        storefrontNameEn: String
        storefrontNameEnLocked: Boolean
        descriptionZh: String
        descriptionEn: String
        descriptionEnLocked: Boolean
        logoAssetId: ID
        logoOnLightAssetId: ID
        logoOnDarkAssetId: ID
        taglineZh: String
        taglineEn: String
        taglineEnLocked: Boolean
        brandBackgroundColor: String
        brandPrimaryColor: String
        brandAccentColor: String
        brandHighlightColor: String
        legalEntityName: String
        legalRegistrationCountry: String
        supportEmail: String
        privacyEmail: String
    }
`;
