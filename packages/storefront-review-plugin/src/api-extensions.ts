import { gql } from 'graphql-tag';

const commonReviewTypes = gql`
    enum StorefrontReviewState {
        PENDING
        APPROVED
        REJECTED
    }

    type StorefrontReviewImage {
        id: ID!
        preview: String!
    }

    type StorefrontReview implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: StorefrontReviewState!
        rating: Int!
        title: String!
        body: String!
        images: [StorefrontReviewImage!]!
        customerName: String!
        anonymous: Boolean!
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

    type StorefrontReviewSettings {
        enabled: Boolean!
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
        imageUrl: String
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
        anonymous: Boolean
    }
`;

export const shopApiExtensions = gql`
    ${commonReviewTypes}

    extend type Query {
        storefrontReviewSettings: StorefrontReviewSettings!
        storefrontProductReviews(productId: ID!, options: StorefrontReviewListOptions): StorefrontReviewList!
        myStorefrontReviews: [StorefrontReview!]!
        myStorefrontReviewCandidates(options: StorefrontReviewListOptions): [StorefrontReviewCandidate!]!
    }

    extend type Mutation {
        submitStorefrontReview(input: SubmitStorefrontReviewInput!, files: [Upload!]): StorefrontReview!
    }
`;

export const adminApiExtensions = gql`
    ${commonReviewTypes}

    extend type StorefrontReview {
        customerId: ID
    }

    input ModerateStorefrontReviewInput {
        id: ID!
        state: StorefrontReviewState!
        response: String
    }

    input UpdateStorefrontReviewSettingsInput {
        enabled: Boolean!
    }

    extend type Query {
        storefrontReviewSettings: StorefrontReviewSettings!
        storefrontReviews(options: StorefrontReviewListOptions): StorefrontReviewList!
    }

    extend type Mutation {
        updateStorefrontReviewSettings(input: UpdateStorefrontReviewSettingsInput!): StorefrontReviewSettings!
        moderateStorefrontReview(input: ModerateStorefrontReviewInput!): StorefrontReview!
    }
`;
