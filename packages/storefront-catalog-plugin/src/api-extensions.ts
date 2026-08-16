import { gql } from 'graphql-tag';

export const shopApiExtensions = gql`
    enum StorefrontCatalogSort {
        RECOMMENDED
        SALES
        NEWEST
        NAME
        PRICE_ASC
        PRICE_DESC
    }

    enum StorefrontCatalogFulfillmentType {
        PHYSICAL
        DIGITAL
    }

    input StorefrontCatalogInput {
        term: String
        collectionId: ID
        sort: StorefrontCatalogSort! = RECOMMENDED
        fulfillmentType: StorefrontCatalogFulfillmentType
        inStockOnly: Boolean! = false
        minPriceWithTax: Int
        maxPriceWithTax: Int
        skip: Int! = 0
        take: Int! = 12
    }

    type StorefrontCatalogPage {
        items: [Product!]!
        totalItems: Int!
    }

    type StorefrontProductSales {
        productId: ID!
        quantity: Int!
    }

    extend type Query {
        storefrontCatalog(input: StorefrontCatalogInput!): StorefrontCatalogPage!
        storefrontProductSales(productIds: [ID!]!): [StorefrontProductSales!]!
    }
`;
