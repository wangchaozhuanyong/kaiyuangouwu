import { gql } from 'graphql-tag';

export const storefrontBrandingSchema = gql`
    type StorefrontBranding {
        logoAssetId: ID
        logoOnLightAssetId: ID
        logoOnDarkAssetId: ID
        logoUrl: String
        logoOnLightUrl: String
        logoOnDarkUrl: String
        name: String!
        description: String!
        tagline: String!
        backgroundColor: String
        primaryColor: String
        accentColor: String
        highlightColor: String
        legalEntityName: String
        legalRegistrationCountry: String
        supportEmail: String
        privacyEmail: String
    }
`;
