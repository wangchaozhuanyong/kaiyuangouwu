import { gql } from 'graphql-tag';

export const customerServiceFeedbackCommonSchema = gql`
    type CustomerServiceFeedback {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        customerId: ID!
        orderId: ID
        orderCode: String
        rating: Int!
        tags: [String!]!
        comment: String
    }

    input SubmitCustomerServiceFeedbackInput {
        orderCode: String
        rating: Int!
        tags: [String!]!
        comment: String
    }
`;

export const customerServiceFeedbackShopSchema = gql`
    extend type Query {
        myCustomerServiceFeedback(orderCode: String): CustomerServiceFeedback
    }

    extend type Mutation {
        submitMyCustomerServiceFeedback(input: SubmitCustomerServiceFeedbackInput!): CustomerServiceFeedback!
    }
`;

export const customerServiceFeedbackAdminSchema = gql`
    type CustomerServiceFeedbackList {
        items: [CustomerServiceFeedback!]!
        totalItems: Int!
    }

    extend type Query {
        customerServiceFeedbacks(skip: Int = 0, take: Int = 50): CustomerServiceFeedbackList!
    }
`;
