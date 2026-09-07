import { gql } from 'graphql-tag';

import { storefrontRegionSchema } from './storefront-region.schema';

export const storefrontBrandingSchema = gql`
    ${storefrontRegionSchema}
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

export const storefrontPreviewBrandingSchema = gql`
    type StorefrontPreviewBranding {
        channelId: ID!
        name: String!
        backgroundColor: String
        primaryColor: String
        accentColor: String
        highlightColor: String
    }
    extend type Query {
        storefrontPreviewBranding: StorefrontPreviewBranding!
    }
`;
