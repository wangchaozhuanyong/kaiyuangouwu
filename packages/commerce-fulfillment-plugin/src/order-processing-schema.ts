import { gql } from 'graphql-tag';

export const orderProcessingSchema = gql`
    type OrderProcessingAction {
        code: String!
        label: String!
        enabled: Boolean!
        reason: String
        targetId: ID
    }
    type OrderProcessingLine {
        orderLineId: ID!
        productName: String!
        sku: String!
        fulfillmentType: String!
        digitalDeliveryMode: String
        quantity: Int!
        requiredQuantity: Int!
        refundableQuantity: Int!
        deliveredQuantity: Int!
        pendingQuantity: Int!
        pendingDispatchQuantity: Int!
        status: String!
        notificationStatus: String!
        claimStatus: String!
        claimedQuantity: Int
        taskId: ID
        recipientEmail: String
    }
    type OrderProcessingPhysicalLine {
        orderLineId: ID!
        quantity: Int!
    }
    type OrderPaymentCapability {
        paymentId: ID!
        canRefund: Boolean!
        refundBlockedReason: String
        canCancel: Boolean!
        refundableAmount: Money!
        refundSettlementMode: String!
    }
    type OrderProcessingSummary {
        orderId: ID!
        businessState: String!
        kind: String!
        paymentStatus: String!
        paymentLabel: String!
        fulfillmentStatus: String!
        fulfillmentLabel: String!
        afterSalesStatus: String!
        afterSalesLabel: String!
        isTestOrder: Boolean!
        needsProcessing: Boolean!
        hasException: Boolean!
        canManage: Boolean!
        blockedReason: String
        settledAmount: Money!
        pendingRefundAmount: Money!
        refundedAmount: Money!
        refundableAmount: Money!
        outstandingAmount: Money!
        refundableShippingAmount: Money!
        remainingDigitalQuantity: Int!
        remainingPhysicalQuantity: Int!
        remainingPhysicalLines: [OrderProcessingPhysicalLine!]!
        canRefund: Boolean!
        refundBlockedReason: String
        nextAction: OrderProcessingAction
        lines: [OrderProcessingLine!]!
        paymentCapabilities: [OrderPaymentCapability!]!
    }
    input OrderProcessingListOptions {
        category: String
        skip: Int
        take: Int
        term: String
        sortBy: String
        sortOrder: String
    }
    type OrderProcessingCounts {
        pending: Int!
        digital: Int!
        physical: Int!
        exceptions: Int!
        afterSales: Int!
    }
    type OrderProcessingList implements PaginatedList {
        items: [Order!]!
        totalItems: Int!
    }
    input PrepareFulfillmentShipmentInput {
        fulfillmentId: ID!
        carrier: String!
        trackingCode: String!
    }
    extend type Order {
        processingSummary: OrderProcessingSummary!
    }
    extend type Query {
        processingOrders(options: OrderProcessingListOptions): OrderProcessingList!
        orderProcessingCounts: OrderProcessingCounts!
    }
    extend type Mutation {
        finishOrderModification(orderId: ID!): Order!
        prepareFulfillmentShipment(input: PrepareFulfillmentShipmentInput!): Fulfillment!
    }
`;
