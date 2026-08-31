import { gql } from 'graphql-tag';

const commonReviewTypes = gql`
    enum StorefrontReviewState {
        PENDING
        APPROVED
        REJECTED
    }

    type StorefrontReview implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: StorefrontReviewState!
        rating: Int!
        title: String!
        body: String!
        customerName: String!
        productName: String!
        sku: String!
        merchantResponse: String
        moderatedAt: DateTime
        orderLineId: ID
        productId: ID
        productVariantId: ID
        verifiedPurchase: Boolean!
    }

    type StorefrontReviewList implements PaginatedList {
        items: [StorefrontReview!]!
        totalItems: Int!
        averageRating: Float!
    }

    type StorefrontReviewCandidate {
        orderLineId: ID!
        orderId: ID!
        orderCode: String!
        orderState: String!
        orderPlacedAt: DateTime
        productId: ID!
        productVariantId: ID!
        productName: String!
        variantName: String!
        sku: String!
        fulfillmentType: String!
    }

    input StorefrontReviewListOptions {
        skip: Int
        take: Int
        state: StorefrontReviewState
        search: String
    }

    input SubmitStorefrontReviewInput {
        orderLineId: ID!
        rating: Int!
        title: String!
        body: String!
    }
`;

export const shopApiExtensions = gql`
    ${commonReviewTypes}

    extend type Query {
        storefrontProductReviews(productId: ID!, options: StorefrontReviewListOptions): StorefrontReviewList!
        myStorefrontReviews: [StorefrontReview!]!
        myStorefrontReviewCandidates: [StorefrontReviewCandidate!]!
    }

    extend type Mutation {
        submitStorefrontReview(input: SubmitStorefrontReviewInput!): StorefrontReview!
    }
`;

export const adminApiExtensions = gql`
    ${commonReviewTypes}

    input ModerateStorefrontReviewInput {
        id: ID!
        state: StorefrontReviewState!
        response: String
    }

    extend type Query {
        storefrontReviews(options: StorefrontReviewListOptions): StorefrontReviewList!
    }

    extend type Mutation {
        moderateStorefrontReview(input: ModerateStorefrontReviewInput!): StorefrontReview!
    }
`;
