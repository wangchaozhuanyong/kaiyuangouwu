import { gql } from 'graphql-tag';

export const customerProductActivityShopSchema = gql`
    type CustomerProductVisit {
        productId: ID!
        visitedAt: DateTime!
    }

    type CustomerProductActivity {
        favoriteProductIds: [ID!]!
        recentProductVisits: [CustomerProductVisit!]!
    }

    extend type Query {
        myCustomerProductActivity: CustomerProductActivity!
    }

    extend type Mutation {
        setMyFavoriteProduct(productId: ID!, favorite: Boolean!): CustomerProductActivity!
        removeMyFavoriteProducts(productIds: [ID!]!): CustomerProductActivity!
        clearMyFavoriteProducts: CustomerProductActivity!
        recordMyProductVisit(productId: ID!): CustomerProductActivity!
        clearMyProductVisits: CustomerProductActivity!
    }
`;
