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

const autoCardAdminTypes = gql`
    enum AutoCardPoolItemState {
        AVAILABLE
        ASSIGNED
        DISABLED
    }

    enum AutoCardDeliveryState {
        WAITING_STOCK
        ALLOCATED
        RETRYING
        SENT
        MANUAL_REVIEW
    }

    enum AutoCardDeliveryEventType {
        WAITING_STOCK
        ALLOCATED
        EMAIL_QUEUED
        EMAIL_FAILED
        EMAIL_SENT
        MANUAL_RETRY
        MANUAL_REVIEW
    }

    type AutoCardFieldDefinition {
        key: String!
        label: String!
        secret: Boolean!
    }

    type AutoCardField {
        key: String!
        label: String!
        value: String!
        secret: Boolean!
    }

    input AutoCardFieldInput {
        key: String!
        label: String!
        secret: Boolean!
    }

    type AutoCardConfig implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        productVariant: ProductVariant!
        enabled: Boolean!
        formatName: String!
        delimiter: String!
        fields: [AutoCardFieldDefinition!]!
        instructions: String!
        lowStockThreshold: Int!
        availableCount: Int!
        assignedCount: Int!
        disabledCount: Int!
        waitingDeliveryCount: Int!
    }

    input UpdateAutoCardConfigInput {
        productVariantId: ID!
        enabled: Boolean!
        formatName: String!
        delimiter: String!
        fields: [AutoCardFieldInput!]!
        instructions: String!
        lowStockThreshold: Int!
    }

    input AutoCardImportInput {
        productVariantId: ID!
        rawText: String!
    }

    type AutoCardImportError {
        lineNumber: Int!
        message: String!
    }

    type AutoCardImportPreviewRow {
        lineNumber: Int!
        fields: [AutoCardField!]!
    }

    type AutoCardImportPreview {
        validCount: Int!
        invalidCount: Int!
        rows: [AutoCardImportPreviewRow!]!
        errors: [AutoCardImportError!]!
    }

    type AutoCardImportResult {
        importedCount: Int!
        duplicateCount: Int!
        availableCount: Int!
    }

    type AutoCardPoolItem implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: AutoCardPoolItemState!
        sequence: Int!
        assignedAt: DateTime
        disabledReason: String
        deliveryId: ID
        maskedFields: [AutoCardField!]!
    }

    type AutoCardPoolItemList implements PaginatedList {
        items: [AutoCardPoolItem!]!
        totalItems: Int!
    }

    input AutoCardPoolItemListOptions {
        skip: Int
        take: Int
        state: AutoCardPoolItemState
    }

    type AutoCardDeliveryEvent implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        type: AutoCardDeliveryEventType!
        actorType: String!
        actorId: String
        note: String!
    }

    type AutoCardDelivery implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: AutoCardDeliveryState!
        recipientEmail: String!
        productName: String!
        sku: String!
        quantity: Int!
        attemptCount: Int!
        lastError: String
        lastDispatchedAt: DateTime
        sentAt: DateTime
        fulfillmentId: String
        order: Order!
        orderLineId: ID!
        poolItems: [AutoCardPoolItem!]!
        events: [AutoCardDeliveryEvent!]!
    }

    type AutoCardDeliveryList implements PaginatedList {
        items: [AutoCardDelivery!]!
        totalItems: Int!
    }

    type AutoCardTodoSummary {
        lowStockSkuCount: Int!
        waitingStockDeliveryCount: Int!
        manualReviewCount: Int!
    }

    input AutoCardDeliveryListOptions {
        skip: Int
        take: Int
        state: AutoCardDeliveryState
        productVariantId: ID
        orderId: ID
    }
`;

export const shopApiExtensions = gql`
    ${afterSalesTypes}

    enum AutoCardDeliveryState {
        WAITING_STOCK
        ALLOCATED
        RETRYING
        SENT
        MANUAL_REVIEW
    }

    type AutoCardOrderDelivery implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: AutoCardDeliveryState!
        productName: String!
        sku: String!
        quantity: Int!
        attemptCount: Int!
        sentAt: DateTime
        orderLineId: ID!
    }

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

    type StorefrontOrderConfirmationToken {
        token: String!
        expiresAt: DateTime!
    }

    extend type Order {
        checkoutFulfillment: CheckoutFulfillmentSummary!
        checkoutShipping: CheckoutShippingSummary
        digitalDeliveries: [DigitalDelivery!]!
        autoCardDeliveries: [AutoCardOrderDelivery!]!
    }

    extend type ProductVariant {
        autoCardAvailableStock: Int
    }

    extend type Mutation {
        createStorefrontOrderConfirmationToken: StorefrontOrderConfirmationToken!
        cancelMyAuthorizedOrder(orderId: ID!, reason: String!): Order!
        createAfterSalesRequest(input: CreateAfterSalesRequestInput!): AfterSalesRequest!
        cancelMyAfterSalesRequest(id: ID!): AfterSalesRequest!
    }

    extend type Query {
        storefrontOrderByConfirmationToken(token: String!): Order
        myAfterSalesRequests: [AfterSalesRequest!]!
        myAfterSalesRequest(id: ID!): AfterSalesRequest
    }
`;

export const adminApiExtensions = gql`
    ${afterSalesTypes}
    ${autoCardAdminTypes}

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
        states: [AfterSalesState!]
    }

    input TransitionAfterSalesRequestInput {
        id: ID!
        state: AfterSalesState!
        resolution: String!
        approvedAmount: Money
    }

    extend type Query {
        afterSalesRequests(options: AfterSalesRequestListOptions): AfterSalesRequestList!
        physicalFulfillmentTodoCount: Int!
        autoCardConfig(productVariantId: ID!): AutoCardConfig
        autoCardPoolItems(productVariantId: ID!, options: AutoCardPoolItemListOptions): AutoCardPoolItemList!
        autoCardDeliveries(options: AutoCardDeliveryListOptions): AutoCardDeliveryList!
        autoCardTodoSummary: AutoCardTodoSummary!
    }

    extend type Mutation {
        transitionAfterSalesRequest(input: TransitionAfterSalesRequestInput!): AfterSalesRequest!
        updateAutoCardConfig(input: UpdateAutoCardConfigInput!): AutoCardConfig!
        previewAutoCardPoolImport(input: AutoCardImportInput!): AutoCardImportPreview!
        importAutoCardPoolItems(input: AutoCardImportInput!): AutoCardImportResult!
        revealAutoCardPoolItem(id: ID!): [AutoCardField!]!
        setAutoCardPoolItemEnabled(id: ID!, enabled: Boolean!, reason: String): AutoCardPoolItem!
        retryAutoCardDelivery(id: ID!): AutoCardDelivery!
    }
`;
