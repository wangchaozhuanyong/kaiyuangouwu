import { gql } from 'graphql-tag';

const afterSalesTypes = gql`
    enum AfterSalesType {
        REFUND_ONLY
        RETURN_AND_REFUND
    }

    enum AfterSalesState {
        PENDING
        APPROVED
        REJECTED
        CANCELLED
        COMPLETED
    }

    enum AfterSalesReason {
        CHANGED_MIND
        NOT_AS_DESCRIBED
        DAMAGED
        WRONG_ITEM
        DELIVERY_ISSUE
        DIGITAL_CONTENT_ISSUE
        OTHER
    }

    enum AfterSalesActorType {
        CUSTOMER
        ADMIN
        SYSTEM
    }

    type AfterSalesItem implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        orderLineId: ID
        quantity: Int!
        unitPriceWithTax: Money!
        lineAmountWithTax: Money!
        productName: String!
        sku: String!
        fulfillmentType: String!
    }

    type AfterSalesEvent implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: AfterSalesState!
        actorType: AfterSalesActorType!
        actorLabel: String!
        note: String!
    }

    type AfterSalesRequest implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        type: AfterSalesType!
        state: AfterSalesState!
        reason: AfterSalesReason!
        description: String!
        currencyCode: CurrencyCode!
        requestedAmount: Money!
        approvedAmount: Money
        resolution: String
        customerName: String!
        customerEmail: String!
        respondedAt: DateTime
        completedAt: DateTime
        cancelledAt: DateTime
        order: Order!
        items: [AfterSalesItem!]!
        events: [AfterSalesEvent!]!
    }

    input CreateAfterSalesItemInput {
        orderLineId: ID!
        quantity: Int!
    }

    input CreateAfterSalesRequestInput {
        orderId: ID!
        type: AfterSalesType!
        reason: AfterSalesReason!
        description: String!
        items: [CreateAfterSalesItemInput!]!
    }
`;

export const shopApiExtensions = gql`
    ${afterSalesTypes}

    enum CheckoutFulfillmentType {
        PHYSICAL
        DIGITAL
        MIXED
    }

    type CheckoutFulfillmentSummary {
        fulfillmentType: CheckoutFulfillmentType!
        containsPhysicalProducts: Boolean!
        containsDigitalProducts: Boolean!
        requiresShippingAddress: Boolean!
        requiresShippingMethod: Boolean!
    }

    enum DigitalDeliveryStatus {
        READY
        PAYMENT_REQUIRED
        NOT_CONFIGURED
        FILE_MISSING
    }

    type DigitalDelivery {
        orderLineId: ID!
        sku: String!
        name: String!
        status: DigitalDeliveryStatus!
        downloadUrl: String
        expiresAt: DateTime
    }

    type CheckoutShippingSummary {
        methodCode: String!
        methodName: String!
        priceWithTax: Money!
        estimateMinDays: Int
        estimateMaxDays: Int
        freeShippingThreshold: Money
        freeShippingApplied: Boolean!
    }

    extend type Order {
        checkoutFulfillment: CheckoutFulfillmentSummary!
        checkoutShipping: CheckoutShippingSummary
        digitalDeliveries: [DigitalDelivery!]!
    }

    extend type Mutation {
        cancelMyAuthorizedOrder(orderId: ID!, reason: String!): Order!
        createAfterSalesRequest(input: CreateAfterSalesRequestInput!): AfterSalesRequest!
        cancelMyAfterSalesRequest(id: ID!): AfterSalesRequest!
    }

    extend type Query {
        myAfterSalesRequests: [AfterSalesRequest!]!
        myAfterSalesRequest(id: ID!): AfterSalesRequest
    }
`;

export const adminApiExtensions = gql`
    ${afterSalesTypes}

    extend type AfterSalesEvent {
        actorId: String
    }

    type AfterSalesRequestList implements PaginatedList {
        items: [AfterSalesRequest!]!
        totalItems: Int!
    }

    input AfterSalesRequestListOptions {
        skip: Int
        take: Int
        state: AfterSalesState
    }

    input TransitionAfterSalesRequestInput {
        id: ID!
        state: AfterSalesState!
        resolution: String!
        approvedAmount: Money
    }

    extend type Query {
        afterSalesRequests(options: AfterSalesRequestListOptions): AfterSalesRequestList!
    }

    extend type Mutation {
        transitionAfterSalesRequest(input: TransitionAfterSalesRequestInput!): AfterSalesRequest!
    }
`;
