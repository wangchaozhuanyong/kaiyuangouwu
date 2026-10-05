import { gql } from 'graphql-tag';
export const digitalReceiptShopSchema = gql`
    type DigitalReceiptField {
        label: String!
        value: String!
    }
    type DigitalReceiptAttachment {
        name: String!
        downloadUrl: String!
    }
    type DigitalReceiptPackage {
        number: Int!
        note: String!
        fields: [DigitalReceiptField!]!
        attachments: [DigitalReceiptAttachment!]!
    }
    type DigitalDeliveryContent {
        orderLineId: ID!
        mode: String!
        state: String!
        instructions: String!
        packages: [DigitalReceiptPackage!]!
        downloadUrl: String
        eligibleQuantity: Int!
        readyQuantity: Int!
        claimedQuantity: Int!
        notificationState: String!
    }
    extend type Mutation {
        claimDigitalDelivery(
            orderId: ID!
            orderLineId: ID!
            confirmationToken: String
        ): DigitalDeliveryContent!
    }
    extend type Query {
        myDigitalDeliveryContents(orderId: ID!, confirmationToken: String): [DigitalDeliveryContent!]!
    }
`;
