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
        refundedAt: DateTime
        refund: Refund
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
        labelEn: String!
        secret: Boolean!
    }

    type AutoCardField {
        key: String!
        label: String!
        labelEn: String!
        value: String!
        secret: Boolean!
    }

    input AutoCardFieldInput {
        key: String!
        label: String!
        labelEn: String
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
        instructionsZh: String!
        instructionsEn: String!
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
        instructions: String
        instructionsZh: String
        instructionsEn: String
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

const productPackagingTypes = gql`
    type ProductPackagingRule implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        enabled: Boolean!
        autoUnpack: Boolean!
        unitLabel: String!
        packageLabel: String!
        unitsPerPackage: Int!
        unitVariant: ProductVariant!
        packageVariant: ProductVariant!
    }

    extend type Product {
        packaging: ProductPackagingRule
    }
`;

const commerceModeTypes = gql`
    enum StoreCommerceMode {
        DIGITAL_ONLY
        PHYSICAL_ONLY
        HYBRID
    }

    type CommerceModeConflict {
        code: String!
        message: String!
        entityId: ID!
    }

    type StoreCommerceModeConfiguration {
        mode: StoreCommerceMode!
        conflicts: [CommerceModeConflict!]!
    }
`;

const manualDeliveryCommonTypes = gql`
    enum ManualDigitalDeliveryState {
        WAITING_PROCESSING
        DRAFT
        SENDING
        SENT
        EMAIL_FAILED
        MANUAL_REVIEW
        CANCELLED
    }

    type ManualDigitalOrderDelivery implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: ManualDigitalDeliveryState!
        productName: String!
        sku: String!
        quantity: Int!
        expectedAt: DateTime!
        overdue: Boolean!
        attemptCount: Int!
        lastError: String
        sentAt: DateTime
        orderLineId: ID!
    }
`;

const manualDeliveryAdminTypes = gql`
    enum ManualDigitalDeliveryEventType {
        TASK_CREATED
        DRAFT_SAVED
        PUBLISHED
        EMAIL_SENT
        EMAIL_FAILED
        AUTO_RETRY
        MANUAL_RETRY
        MANUAL_REVIEW
        CANCELLED
    }

    input ManualDigitalDeliveryFieldInput {
        key: String!
        label: String!
        value: String!
        secret: Boolean
    }

    input ManualDigitalDeliveryPackageInput {
        fields: [ManualDigitalDeliveryFieldInput!]
        note: String
        attachmentAssetIds: [ID!]
    }

    input SaveManualDigitalDeliveryInput {
        id: ID!
        packages: [ManualDigitalDeliveryPackageInput!]!
    }

    input ManualDigitalDeliveryListOptions {
        skip: Int
        take: Int
        state: ManualDigitalDeliveryState
    }

    type ManualDigitalDeliveryField {
        key: String!
        label: String!
        value: String!
        secret: Boolean!
    }

    type ManualDigitalDeliveryPackage {
        fields: [ManualDigitalDeliveryField!]!
        note: String!
        attachmentAssetIds: [ID!]!
    }

    type ManualDigitalDeliveryEvent implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        type: ManualDigitalDeliveryEventType!
        actorType: String!
        actorId: String
        note: String!
    }

    type ManualDigitalDelivery implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: ManualDigitalDeliveryState!
        recipientEmail: String!
        productName: String!
        sku: String!
        quantity: Int!
        expectedAt: DateTime!
        overdue: Boolean!
        attemptCount: Int!
        lastError: String
        lastDispatchedAt: DateTime
        sentAt: DateTime
        fulfillmentId: String
        order: Order!
        orderLineId: ID!
        packages: [ManualDigitalDeliveryPackage!]!
        events: [ManualDigitalDeliveryEvent!]!
    }

    type ManualDigitalDeliveryList implements PaginatedList {
        items: [ManualDigitalDelivery!]!
        totalItems: Int!
    }
`;

const customerDeliveryEmailTypes = gql`
    type CustomerDeliveryEmail implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        emailAddress: String!
        label: String!
        isDefault: Boolean!
        confirmedAt: DateTime!
    }

    input SaveCustomerDeliveryEmailInput {
        emailAddress: String!
        confirmEmailAddress: String!
        label: String
        isDefault: Boolean
    }

    input SetActiveOrderDeliveryEmailInput {
        contactId: ID
        emailAddress: String
        confirmEmailAddress: String
        label: String
        saveToAddressBook: Boolean
        isDefault: Boolean
    }
`;

export const shopApiExtensions = gql`
    ${afterSalesTypes}
    ${productPackagingTypes}
    ${commerceModeTypes}
    ${manualDeliveryCommonTypes}
    ${customerDeliveryEmailTypes}

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
        manualDigitalDeliveries: [ManualDigitalOrderDelivery!]!
    }

    extend type ProductVariant {
        autoCardAvailableStock: Int
        saleableStockLevel: Int
    }

    extend input StorefrontCartCommandInput {
        deliveryEmail: SetActiveOrderDeliveryEmailInput
    }

    extend type Mutation {
        createStorefrontOrderConfirmationToken: StorefrontOrderConfirmationToken!
        cancelMyAuthorizedOrder(orderId: ID!, reason: String!): Order!
        createAfterSalesRequest(input: CreateAfterSalesRequestInput!): AfterSalesRequest!
        cancelMyAfterSalesRequest(id: ID!): AfterSalesRequest!
        saveMyDeliveryEmail(input: SaveCustomerDeliveryEmailInput!): CustomerDeliveryEmail!
        setMyDefaultDeliveryEmail(id: ID!): CustomerDeliveryEmail!
        deleteMyDeliveryEmail(id: ID!): Boolean!
        setActiveOrderDeliveryEmail(input: SetActiveOrderDeliveryEmailInput!): Order!
    }

    extend type Query {
        activeStoreCommerceMode: StoreCommerceMode!
        storefrontOrderByConfirmationToken(token: String!): Order
        myAfterSalesRequests: [AfterSalesRequest!]!
        myAfterSalesRequest(id: ID!): AfterSalesRequest
        myDeliveryEmails: [CustomerDeliveryEmail!]!
    }
`;

export const adminApiExtensions = gql`
    ${afterSalesTypes}
    ${autoCardAdminTypes}
    ${productPackagingTypes}
    ${commerceModeTypes}
    ${manualDeliveryCommonTypes}
    ${manualDeliveryAdminTypes}

    extend type Order {
        manualDigitalDeliveries: [ManualDigitalOrderDelivery!]!
    }

    extend type ProductVariant {
        autoCardAvailableStock: Int
    }

    type ProductPackagingStockSummary {
        unitStockOnHand: Int!
        unitStockAllocated: Int!
        unitStockAvailable: Int!
        packageStockOnHand: Int!
        packageStockAllocated: Int!
        packageStockAvailable: Int!
        convertibleUnitStock: Int!
    }

    type PackagingUnpackEvent implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        reason: String!
        packagesOpened: Int!
        unitsCreated: Int!
        packageStockBefore: Int!
        packageStockAfter: Int!
        unitStockBefore: Int!
        unitStockAfter: Int!
        stockLocation: StockLocation!
        order: Order
    }

    input UpdateProductPackagingInput {
        productId: ID!
        unitVariantId: ID!
        packageVariantId: ID!
        unitLabel: String!
        packageLabel: String!
        unitsPerPackage: Int!
        enabled: Boolean!
        autoUnpack: Boolean!
    }

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
        search: String
    }

    input TransitionAfterSalesRequestInput {
        id: ID!
        state: AfterSalesState!
        resolution: String!
        approvedAmount: Money
        refundId: ID
    }

    extend type Query {
        myStoreCommerceMode: StoreCommerceModeConfiguration!
        manualDigitalDeliveries(options: ManualDigitalDeliveryListOptions): ManualDigitalDeliveryList!
        manualDigitalDelivery(id: ID!): ManualDigitalDelivery
        afterSalesRequests(options: AfterSalesRequestListOptions): AfterSalesRequestList!
        physicalFulfillmentTodoCount: Int!
        autoCardConfig(productVariantId: ID!): AutoCardConfig
        autoCardPoolItems(productVariantId: ID!, options: AutoCardPoolItemListOptions): AutoCardPoolItemList!
        autoCardDeliveries(options: AutoCardDeliveryListOptions): AutoCardDeliveryList!
        autoCardTodoSummary: AutoCardTodoSummary!
        productPackaging(productId: ID!): ProductPackagingRule
        productPackagingStock(productId: ID!): ProductPackagingStockSummary
        productPackagingUnpackEvents(productId: ID!, take: Int = 20): [PackagingUnpackEvent!]!
    }

    extend type Mutation {
        updateMyStoreCommerceMode(mode: StoreCommerceMode!): StoreCommerceModeConfiguration!
        saveManualDigitalDeliveryDraft(input: SaveManualDigitalDeliveryInput!): ManualDigitalDelivery!
        publishManualDigitalDelivery(input: SaveManualDigitalDeliveryInput!): ManualDigitalDelivery!
        retryManualDigitalDelivery(id: ID!): ManualDigitalDelivery!
        transitionAfterSalesRequest(input: TransitionAfterSalesRequestInput!): AfterSalesRequest!
        updateAutoCardConfig(input: UpdateAutoCardConfigInput!): AutoCardConfig!
        previewAutoCardPoolImport(input: AutoCardImportInput!): AutoCardImportPreview!
        importAutoCardPoolItems(input: AutoCardImportInput!): AutoCardImportResult!
        revealAutoCardPoolItem(id: ID!): [AutoCardField!]!
        setAutoCardPoolItemEnabled(id: ID!, enabled: Boolean!, reason: String): AutoCardPoolItem!
        retryAutoCardDelivery(id: ID!): AutoCardDelivery!
        updateProductPackaging(input: UpdateProductPackagingInput!): ProductPackagingRule!
    }
`;
