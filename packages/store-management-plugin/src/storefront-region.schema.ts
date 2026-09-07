import { gql } from 'graphql-tag';

export const storefrontRegionSchema = gql`
    type StorefrontProvinceOption {
        code: String!
        name: String!
        countryCode: String!
    }
`;
