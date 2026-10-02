import gql from 'graphql-tag';
const reviewTypes = `
    type CustomerServiceReview {
        id: ID!
        createdAt: DateTime! updatedAt: DateTime! channelId: ID! rating: Int!
        tags: [String!]! comment: String! orderCode: String revision: Int! }
`;
export const storeNotificationShopSchema = gql`
    ${reviewTypes}
    input SubmitCustomerServiceReviewInput {
        id: ID
        visitorId: String!
        rating: Int!
        tags: [String!]!
        comment: String!
        orderCode: String
    }
    extend type Query {
        currentCustomerServiceReview(visitorId: String!, orderCode: String): CustomerServiceReview
    }
    extend type Mutation {
        recordStorefrontHeartbeat(visitorId: String!): StorefrontVisitResult!
        submitCustomerServiceReview(input: SubmitCustomerServiceReviewInput!): CustomerServiceReview!
    }
`;
export const storeNotificationAdminSchema = gql`
    ${reviewTypes}
    type StorefrontOnline {
        available: Boolean!
        total: Int
        guests: Int
        customers: Int
    }
    type CustomerServiceReviewList {
        items: [CustomerServiceReview!]!
        totalItems: Int!
    }
    extend type Query {
        storefrontOnline: StorefrontOnline!
        customerServiceReviews(
            skip: Int = 0
            take: Int = 25
            allStores: Boolean = false
        ): CustomerServiceReviewList!
    }
`;
