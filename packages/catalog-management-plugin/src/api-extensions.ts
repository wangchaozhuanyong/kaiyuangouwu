import { gql } from 'graphql-tag';

export const adminApiExtensions = gql`
    enum CatalogImportState {
        RECEIVING
        PREVIEW_READY
        QUEUED
        RUNNING
        COMPLETED
        COMPLETED_WITH_ERRORS
        FAILED
        ROLLED_BACK
    }

    enum CatalogImportAction {
        PENDING
        CREATE
        UPDATE
        SKIP_UNCHANGED
        CONFLICT
        WARNING
        ERROR
    }

    enum CatalogImportResolution {
        APPLY
        CREATE_NEW
        UPDATE_EXISTING
        SKIP
    }

    type CatalogImportStockLocation {
        id: ID!
        name: String!
    }

    type CatalogSupplier implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        code: String!
        name: String!
        enabled: Boolean!
        contactName: String
        phone: String
        email: String
        address: String
        notes: String
        linkedVariantCount: Int!
    }

    type CatalogSupplierList implements PaginatedList {
        items: [CatalogSupplier!]!
        totalItems: Int!
    }

    type CatalogSupplierVariant implements Node {
        id: ID!
        productId: ID!
        productName: String!
        name: String!
        sku: String!
        enabled: Boolean!
    }

    type CatalogSupplierVariantList implements PaginatedList {
        items: [CatalogSupplierVariant!]!
        totalItems: Int!
    }

    enum CatalogPurchaseOrderStatus {
        DRAFT
        SUBMITTED
        PARTIALLY_RECEIVED
        RECEIVED
        VARIANCE_REVIEW
        CLOSED
        CANCELLED
    }

    enum CatalogPurchasePaymentStatus {
        UNPAID
        PARTIALLY_PAID
        PAID
        DISPUTED
    }

    type CatalogPurchaseReturnableLot {
        id: ID!
        lotCode: String!
        quantityOnHand: Int!
        expiresAt: DateTime
    }

    type CatalogPurchaseOrderLine implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        variantId: ID!
        variant: ProductVariant!
        orderedQuantity: Int!
        receivedQuantity: Int!
        acceptedQuantity: Int!
        rejectedQuantity: Int!
        returnedQuantity: Int!
        outstandingQuantity: Int!
        returnableQuantity: Int!
        returnableLots: [CatalogPurchaseReturnableLot!]!
        unitCostMicrounits: Float!
        purchaseUnit: String
        packageQuantity: Float!
        notes: String
    }

    type CatalogPurchaseReceiptLine implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        purchaseOrderLineId: ID!
        inventoryLotId: ID
        receivedQuantity: Int!
        acceptedQuantity: Int!
        rejectedQuantity: Int!
        lotCode: String
        manufacturedAt: DateTime
        expiresAt: DateTime
        unitCostMicrounits: Float!
        rejectionReason: String
    }

    type CatalogPurchaseReceipt implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        supplierDeliveryReference: String
        receivedAt: DateTime!
        receivedByUserId: String
        notes: String
        lines: [CatalogPurchaseReceiptLine!]!
    }

    type CatalogPurchaseSupplierReturnLine implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        purchaseOrderLineId: ID!
        inventoryLotId: ID!
        quantity: Int!
        unitCostMicrounits: Float!
        creditMicrounits: Float!
        reason: String!
    }

    type CatalogPurchaseSupplierReturn implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        supplierAcknowledgementReference: String!
        returnedAt: DateTime!
        returnedByUserId: String
        notes: String
        lines: [CatalogPurchaseSupplierReturnLine!]!
    }

    type CatalogPurchaseOrderEvent implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        type: String!
        actorUserId: String
        summary: String!
        details: JSON
    }

    type CatalogPurchaseOrder implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        supplierId: ID!
        supplier: CatalogSupplier!
        stockLocationId: ID!
        stockLocation: StockLocation!
        code: String!
        status: CatalogPurchaseOrderStatus!
        paymentStatus: CatalogPurchasePaymentStatus!
        currencyCode: CurrencyCode!
        totalMicrounits: Float!
        paidMicrounits: Float!
        returnCreditMicrounits: Float!
        outstandingMicrounits: Float!
        expectedAt: DateTime
        submittedAt: DateTime
        closedAt: DateTime
        createdByUserId: String
        submittedByUserId: String
        closedByUserId: String
        notes: String
        closureNote: String
        overdue: Boolean!
        hasVariance: Boolean!
        lines: [CatalogPurchaseOrderLine!]!
        receipts: [CatalogPurchaseReceipt!]!
        supplierReturns: [CatalogPurchaseSupplierReturn!]!
        events: [CatalogPurchaseOrderEvent!]!
    }

    type CatalogPurchaseOrderList implements PaginatedList {
        items: [CatalogPurchaseOrder!]!
        totalItems: Int!
    }

    type CatalogSupplierPerformance {
        supplierId: ID!
        from: DateTime
        to: DateTime
        totalOrders: Int!
        closedOrders: Int!
        orderedQuantity: Int!
        acceptedQuantity: Int!
        rejectedQuantity: Int!
        returnedQuantity: Int!
        varianceOrders: Int!
        disputeOrders: Int!
        onTimeRate: Float
        acceptanceRate: Float
        varianceFreeRate: Float
        disputeFreeRate: Float
        score: Float
    }

    type CatalogImportJob implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        stockLocationId: ID!
        stockLocation: CatalogImportStockLocation!
        currencyCode: CurrencyCode!
        clearBlankFields: Boolean!
        originalFilename: String!
        mimeType: String!
        byteSize: Int!
        fileHash: String!
        sheetName: String
        detectedHeaders: [String!]
        fieldMapping: JSON
        state: CatalogImportState!
        actorId: String
        totalRows: Int!
        receivedRows: Int!
        createdCount: Int!
        updatedCount: Int!
        skippedCount: Int!
        conflictCount: Int!
        warningCount: Int!
        errorCount: Int!
        progress: Int!
        errorMessage: String
        startedAt: DateTime
        completedAt: DateTime
        rolledBackAt: DateTime
    }

    type CatalogImportJobList implements PaginatedList {
        items: [CatalogImportJob!]!
        totalItems: Int!
    }

    type CatalogImportRow implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        jobId: ID!
        rowNumber: Int!
        productKey: String!
        sourceKey: String!
        rowFingerprint: String!
        action: CatalogImportAction!
        resolution: CatalogImportResolution
        targetProductId: ID
        targetVariantId: ID
        normalizedData: JSON!
        beforeSnapshot: JSON
        plannedChanges: JSON
        appliedSnapshot: JSON
        message: String
        appliedAt: DateTime
    }

    type CatalogImportRowList implements PaginatedList {
        items: [CatalogImportRow!]!
        totalItems: Int!
    }

    type CatalogWorkspaceStockLevel {
        stockLocationId: ID!
        stockLocationName: String!
        stockOnHand: Int!
        stockAllocated: Int!
        stockAvailable: Int!
        minimumStock: Int
        maximumStock: Int
    }

    type CatalogInventoryLot implements Node {
        id: ID!
        productVariantId: ID!
        stockLocationId: ID!
        lotCode: String!
        manufacturedAt: DateTime
        expiresAt: DateTime
        quantityOnHand: Int!
        purchaseCostMicrounits: Float
        currencyCode: CurrencyCode!
        state: String!
        daysUntilExpiry: Int
    }

    type CatalogInventoryOperationLine implements Node {
        id: ID!
        variant: ProductVariant!
        stockLocation: StockLocation!
        inventoryLot: CatalogInventoryLot
        quantityDelta: Int!
        previousLotQuantity: Int!
        resultingLotQuantity: Int!
        previousStockOnHand: Int!
        resultingStockOnHand: Int!
        reconciliationMode: String
    }

    type CatalogInventoryOperation implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        type: String!
        status: String!
        actorUserId: String
        reason: String!
        reference: String
        postedAt: DateTime!
        lines: [CatalogInventoryOperationLine!]!
    }

    type CatalogInventoryOperationList implements PaginatedList {
        items: [CatalogInventoryOperation!]!
        totalItems: Int!
    }

    type CatalogInventoryReconciliationItem implements Node {
        id: ID!
        productVariantId: ID!
        variantName: String!
        sku: String!
        stockLocationId: ID!
        stockLocationName: String!
        lotQuantity: Int!
        stockOnHand: Int!
        difference: Int!
        canCreateBaselineLot: Boolean!
    }

    type CatalogInventoryReconciliationList implements PaginatedList {
        items: [CatalogInventoryReconciliationItem!]!
        totalItems: Int!
    }

    type CatalogWorkspaceVariant {
        id: ID!
        name: String!
        enabled: Boolean!
        sku: String!
        barcode: String!
        specification: String!
        saleUnit: String!
        purchaseUnit: String!
        packageQuantity: Float!
        shelfLifeDays: Int
        supplier: CatalogSupplier
        sellingPrice: Money!
        currencyCode: CurrencyCode!
        purchaseCostMicrounits: Float
        grossProfitMicrounits: Float
        margin: Float
        stockLevels: [CatalogWorkspaceStockLevel!]!
        lots: [CatalogInventoryLot!]!
    }

    type CatalogProductWorkspace {
        productId: ID!
        channelId: ID!
        currencyCode: CurrencyCode!
        stockLocations: [CatalogImportStockLocation!]!
        variants: [CatalogWorkspaceVariant!]!
    }

    type CatalogProductCreationContext {
        currencyCode: CurrencyCode!
        stockLocations: [CatalogImportStockLocation!]!
    }

    type CatalogIntegritySummary {
        totalProducts: Int!
        totalVariants: Int!
        productsWithoutVariants: Int!
        variantsWithoutCategory: Int!
        variantsWithoutCost: Int!
    }

    type CatalogExportStockRow {
        stockLocationId: ID!
        stockLocationName: String!
        stockOnHand: Int!
        stockAllocated: Int!
        stockAvailable: Int!
        minimumStock: Int
        maximumStock: Int
    }

    type CatalogExportLotRow {
        id: ID!
        stockLocationId: ID!
        stockLocationName: String!
        lotCode: String!
        manufacturedAt: DateTime
        expiresAt: DateTime
        quantityOnHand: Int!
        purchaseCostMicrounits: Float
        currencyCode: CurrencyCode!
        state: String!
    }

    type CatalogExportRow {
        channelCode: String!
        productId: ID!
        variantId: ID!
        productName: String!
        description: String!
        categories: [String!]!
        importCategory: String
        fulfillmentType: String!
        brand: String
        tags: [String!]!
        productEnabled: Boolean!
        variantEnabled: Boolean!
        systemCreatedAt: DateTime!
        sourceCreatedAt: DateTime
        supplierName: String
        sku: String!
        barcode: String!
        specification: String!
        saleUnit: String!
        purchaseUnit: String!
        packageQuantity: Float!
        shelfLifeDays: Int
        sellingPrice: Money!
        purchaseCostMicrounits: Float
        margin: Float
        currencyCode: CurrencyCode!
        stockLevels: [CatalogExportStockRow!]!
        lots: [CatalogExportLotRow!]!
    }

    type CatalogExportPage {
        items: [CatalogExportRow!]!
        totalItems: Int!
        scannedItems: Int!
    }

    enum CatalogInventoryAlertStatus {
        NORMAL
        LOW_STOCK
        OUT_OF_STOCK
    }

    type CatalogInventoryAlertLocation {
        productVariantId: ID!
        stockLocationId: ID!
        stockLocationName: String!
        stockOnHand: Int!
        stockAllocated: Int!
        stockAvailable: Int!
        replenishmentThreshold: Int!
        usesDefaultThreshold: Boolean!
        status: CatalogInventoryAlertStatus!
    }

    type CatalogInventoryAlertItem {
        productId: ID!
        productName: String!
        variantId: ID!
        variantName: String!
        sku: String!
        stockOnHand: Int!
        stockAllocated: Int!
        stockAvailable: Int!
        status: CatalogInventoryAlertStatus!
        locations: [CatalogInventoryAlertLocation!]!
    }

    type CatalogInventoryAlertOverview {
        defaultReplenishmentThreshold: Int!
        lowStockSkuCount: Int!
        outOfStockSkuCount: Int!
        items: [CatalogInventoryAlertItem!]!
    }

    input UpdateCatalogInventoryThresholdInput {
        productVariantId: ID!
        stockLocationId: ID!
        threshold: Int
    }

    type CatalogInventoryThresholdUpdate {
        productVariantId: ID!
        stockLocationId: ID!
        replenishmentThreshold: Int!
        usesDefaultThreshold: Boolean!
    }

    type CatalogProductSummary {
        productId: ID!
    }

    type CatalogProductSummaryList {
        items: [CatalogProductSummary!]!
        totalItems: Int!
    }

    type CatalogProductOperationsSummary {
        productId: ID!
        variantCount: Int!
        minimumSellingPrice: Money
        maximumSellingPrice: Money
        minimumPurchaseCostMicrounits: Float
        maximumPurchaseCostMicrounits: Float
        minimumMargin: Float
        maximumMargin: Float
        minimumStock: Int
        maximumStock: Int
        lowStock: Boolean!
        missingCostVariants: Int!
    }

    input CatalogProfitReportInput {
        from: DateTime!
        to: DateTime!
        currencyCode: CurrencyCode
        skip: Int
        take: Int
    }

    type CatalogProfitSummary {
        currencyCode: CurrencyCode!
        orderCount: Int!
        quantity: Int!
        settledRevenueMicrounits: Float!
        refundedRevenueMicrounits: Float!
        netRevenueMicrounits: Float!
        shippingRevenueMicrounits: Float!
        productCostMicrounits: Float
        grossProfitMicrounits: Float
        grossMargin: Float
        missingCostOrderCount: Int!
        missingCostLineCount: Int!
        estimatedCostOrderCount: Int!
        estimatedCostLineCount: Int!
        carrierShippingCostMicrounits: Float
        paymentFeeMicrounits: Float
        netProfitMicrounits: Float
        netMargin: Float
        missingCarrierShippingCostOrderCount: Int!
        missingPaymentFeeOrderCount: Int!
        includesCarrierShippingCost: Boolean!
        includesPaymentFees: Boolean!
    }

    type CatalogProfitOrder implements Node {
        id: ID!
        code: String!
        orderPlacedAt: DateTime!
        currencyCode: CurrencyCode!
        quantity: Int!
        settledRevenueMicrounits: Float!
        refundedRevenueMicrounits: Float!
        netRevenueMicrounits: Float!
        shippingRevenueMicrounits: Float!
        productCostMicrounits: Float
        grossProfitMicrounits: Float
        grossMargin: Float
        carrierShippingCostMicrounits: Float
        paymentFeeMicrounits: Float
        netProfitMicrounits: Float
        netMargin: Float
        missingCostLineCount: Int!
        estimatedCostLineCount: Int!
    }

    type CatalogProfitReport {
        summary: CatalogProfitSummary!
        items: [CatalogProfitOrder!]!
        totalItems: Int!
    }

    type CatalogOrderProfitExpense implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        orderId: ID!
        currencyCode: CurrencyCode!
        carrierShippingCostMicrounits: Float
        paymentFeeMicrounits: Float
        source: String!
        sourceReference: String
        note: String
    }

    input SaveCatalogOrderProfitExpenseInput {
        orderId: ID!
        carrierShippingCostMicrounits: Float
        paymentFeeMicrounits: Float
        note: String
        expectedUpdatedAt: DateTime
    }

    input CatalogOrderProfitExpenseImportRowInput {
        rowNumber: Int!
        orderCode: String!
        carrierShippingCostMicrounits: Float
        paymentFeeMicrounits: Float
        note: String
    }

    input ImportCatalogOrderProfitExpensesInput {
        currencyCode: CurrencyCode!
        filename: String!
        fileHash: String!
        rows: [CatalogOrderProfitExpenseImportRowInput!]!
    }

    type CatalogOrderProfitExpenseImportResult {
        totalRows: Int!
        createdCount: Int!
        updatedCount: Int!
    }

    input CatalogImportContextInput {
        channelId: ID!
        stockLocationId: ID!
        currencyCode: CurrencyCode!
        clearBlankFields: Boolean = false
    }

    input CatalogImportSourceInput {
        filename: String!
        mimetype: String!
        byteSize: Int!
        fileHash: String!
        sheetName: String
        detectedHeaders: [String!]!
        fieldMapping: JSON!
        parserVersion: String!
    }

    input BeginCatalogImportInput {
        context: CatalogImportContextInput!
        source: CatalogImportSourceInput!
        totalRows: Int!
    }

    input CatalogNormalizedRowInput {
        rowNumber: Int!
        sourceRecordKey: String
        name: String!
        category: String!
        secondaryCategory: String
        fulfillmentType: String!
        channelCode: String!
        stockLocationCode: String!
        currencyCode: String!
        specification: String!
        primaryUnit: String!
        purchaseUnit: String!
        packageQuantity: Float
        stockOnHand: Int
        stockAdjustmentIdempotencyKey: String
        stockAdjustmentReason: String
        purchaseCost: Float
        sellingPrice: Float
        reportedMargin: Float
        maximumStock: Int
        minimumStock: Int
        brand: String!
        manufacturedAt: String
        shelfLifeDays: Int
        enabled: Boolean
        variantEnabled: Boolean
        description: String!
        tags: [String!]!
        sourceCreatedAt: String
        sku: String!
        barcode: String!
        lotCode: String!
        lotQuantity: Int
        supplier: String!
        providedFields: [String!]!
    }

    input AppendCatalogImportRowsInput {
        jobId: ID!
        rows: [CatalogNormalizedRowInput!]!
    }

    input ResolveCatalogImportRowInput {
        rowId: ID!
        resolution: CatalogImportResolution!
        targetVariantId: ID
    }

    input ResolveCatalogImportRowsInput {
        rowIds: [ID!]!
        resolution: CatalogImportResolution!
    }

    input UpdateCatalogVariantOperationsInput {
        productVariantId: ID!
        stockLocationId: ID!
        sku: String
        enabled: Boolean
        barcode: String
        specification: String
        saleUnit: String
        purchaseUnit: String
        packageQuantity: Float
        shelfLifeDays: Int
        sellingPrice: Money
        purchaseCostMicrounits: Float
        currencyCode: CurrencyCode!
        stockOnHand: Int
        minimumStock: Int
        maximumStock: Int
        supplierId: ID
    }

    input CatalogSupplierListOptions {
        skip: Int
        take: Int
        text: String
        enabled: Boolean
    }

    input CreateCatalogSupplierInput {
        code: String
        name: String!
        enabled: Boolean
        contactName: String
        phone: String
        email: String
        address: String
        notes: String
    }

    input UpdateCatalogSupplierInput {
        id: ID!
        code: String
        name: String
        enabled: Boolean
        contactName: String
        phone: String
        email: String
        address: String
        notes: String
    }

    input SaveCatalogProductInput {
        product: UpdateProductInput!
        variants: [UpdateCatalogVariantOperationsInput!]!
    }

    input ApplyCatalogVariantMatrixInput {
        productId: ID!
        targetOptionGroupIds: [ID!]!
        updateVariants: [UpdateProductVariantInput!]!
        createVariants: [CreateProductVariantInput!]!
    }

    input CreateCatalogInitialVariantInput {
        stockLocationId: ID!
        sku: String!
        enabled: Boolean = true
        barcode: String
        specification: String
        saleUnit: String
        purchaseUnit: String
        packageQuantity: Float!
        shelfLifeDays: Int
        sellingPrice: Money!
        purchaseCostMicrounits: Float!
        stockOnHand: Int!
        minimumStock: Int
        maximumStock: Int
    }

    input CreateCatalogProductInput {
        product: CreateProductInput!
        variant: CreateCatalogInitialVariantInput!
        collectionIds: [ID!]!
    }

    input CreateCatalogProductVariantInput {
        productId: ID!
        stockLocationId: ID!
        name: String!
        sku: String!
        optionIds: [ID!]!
        enabled: Boolean = true
        barcode: String
        specification: String
        saleUnit: String
        purchaseUnit: String
        packageQuantity: Float!
        shelfLifeDays: Int
        sellingPrice: Money!
        purchaseCostMicrounits: Float
        currencyCode: CurrencyCode!
        stockOnHand: Int!
        minimumStock: Int
        maximumStock: Int
    }

    input CatalogProductSummaryFilterInput {
        text: String
        category: String
        brand: String
        enabled: Boolean
        minimumSellingPrice: Money
        maximumSellingPrice: Money
        minimumPurchaseCostMicrounits: Float
        maximumPurchaseCostMicrounits: Float
        minimumMargin: Float
        maximumMargin: Float
        minimumAvailableStock: Int
        maximumAvailableStock: Int
        lowStock: Boolean
        expiringWithinDays: Int
    }

    input SaveCatalogInventoryLotInput {
        id: ID
        productVariantId: ID!
        stockLocationId: ID!
        lotCode: String!
        manufacturedAt: DateTime
        expiresAt: DateTime
        quantityOnHand: Int!
        purchaseCostMicrounits: Float
        currencyCode: CurrencyCode!
        idempotencyKey: String!
        reason: String!
    }

    input AdjustCatalogLegacyInventoryInput {
        productVariantId: ID!
        stockLocationId: ID!
        stockOnHand: Int!
        idempotencyKey: String!
        reason: String!
        reference: String
    }

    input TransferCatalogInventoryLotInput {
        inventoryLotId: ID!
        targetStockLocationId: ID!
        quantity: Int!
        idempotencyKey: String!
        reason: String!
        reference: String
    }

    input ResolveCatalogInventoryReconciliationInput {
        productVariantId: ID!
        stockLocationId: ID!
        expectedDifference: Int!
        mode: String!
        idempotencyKey: String!
        reason: String!
    }

    input CatalogPurchaseOrderListOptions {
        skip: Int
        take: Int
        text: String
        status: CatalogPurchaseOrderStatus
        supplierId: ID
        exceptionsOnly: Boolean
    }

    input CreateCatalogPurchaseOrderLineInput {
        productVariantId: ID!
        orderedQuantity: Int!
        unitCostMicrounits: Float!
        notes: String
    }

    input CreateCatalogPurchaseOrderInput {
        supplierId: ID!
        stockLocationId: ID!
        currencyCode: CurrencyCode!
        code: String
        expectedAt: DateTime
        notes: String
        lines: [CreateCatalogPurchaseOrderLineInput!]!
    }

    input ReceiveCatalogPurchaseOrderLineInput {
        purchaseOrderLineId: ID!
        receivedQuantity: Int!
        acceptedQuantity: Int!
        rejectedQuantity: Int!
        lotCode: String
        manufacturedAt: DateTime
        expiresAt: DateTime
        unitCostMicrounits: Float
        rejectionReason: String
    }

    input ReceiveCatalogPurchaseOrderInput {
        purchaseOrderId: ID!
        idempotencyKey: String!
        supplierDeliveryReference: String
        receivedAt: DateTime
        notes: String
        lines: [ReceiveCatalogPurchaseOrderLineInput!]!
    }

    input RecordCatalogPurchasePaymentInput {
        purchaseOrderId: ID!
        amountMicrounits: Float!
        reference: String!
        note: String
    }

    input ReturnCatalogPurchaseOrderLineInput {
        purchaseOrderLineId: ID!
        inventoryLotId: ID!
        quantity: Int!
        reason: String!
    }

    input ReturnCatalogPurchaseOrderInput {
        purchaseOrderId: ID!
        idempotencyKey: String!
        supplierAcknowledgementReference: String!
        returnedAt: DateTime
        notes: String
        lines: [ReturnCatalogPurchaseOrderLineInput!]!
    }

    type CatalogAssignmentChannel {
        id: ID!
        code: String!
        isDefault: Boolean!
    }

    type CatalogProductChannelAssignment {
        id: ID!
        name: String!
        enabled: Boolean!
        channels: [CatalogAssignmentChannel!]!
    }

    enum CatalogChannelAssignmentFilterMode {
        ALL
        UNASSIGNED
        MULTI
        CHANNEL
    }

    input CatalogChannelAssignmentFilterInput {
        mode: CatalogChannelAssignmentFilterMode = ALL
        channelId: ID
    }

    type CatalogChannelAssignmentCount {
        channelId: ID!
        count: Int!
    }

    type CatalogChannelAssignmentSummary {
        totalItems: Int!
        unassignedItems: Int!
        multiChannelItems: Int!
        channelCounts: [CatalogChannelAssignmentCount!]!
    }

    type CatalogProductChannelAssignmentList {
        items: [CatalogProductChannelAssignment!]!
        totalItems: Int!
        channels: [CatalogAssignmentChannel!]!
        scopeChannel: CatalogAssignmentChannel!
        summary: CatalogChannelAssignmentSummary!
    }

    extend type Query {
        catalogProductChannelAssignments(
            options: ProductListOptions
            assignmentFilter: CatalogChannelAssignmentFilterInput
        ): CatalogProductChannelAssignmentList!
        catalogImportJob(id: ID!): CatalogImportJob!
        catalogImportJobs(skip: Int, take: Int): CatalogImportJobList!
        catalogImportRows(jobId: ID!, action: CatalogImportAction): [CatalogImportRow!]!
        catalogImportRowPage(
            jobId: ID!
            action: CatalogImportAction
            skip: Int
            take: Int
        ): CatalogImportRowList!
        catalogIntegritySummary: CatalogIntegritySummary!
        catalogProductCreationContext: CatalogProductCreationContext!
        catalogProductWorkspace(productId: ID!): CatalogProductWorkspace!
        catalogProductSummaries(
            filter: CatalogProductSummaryFilterInput
            skip: Int
            take: Int
        ): CatalogProductSummaryList!
        catalogProductOperations(productIds: [ID!]!): [CatalogProductOperationsSummary!]!
        catalogOrderProfitExpense(orderId: ID!): CatalogOrderProfitExpense
        catalogProfitReport(input: CatalogProfitReportInput!): CatalogProfitReport!
        catalogProducts(filter: CatalogProductSummaryFilterInput, options: ProductListOptions): ProductList!
        catalogExportRows(skip: Int, take: Int): CatalogExportPage!
        catalogInventoryAlertOverview: CatalogInventoryAlertOverview!
        catalogInventoryOperations(skip: Int, take: Int): CatalogInventoryOperationList!
        catalogInventoryReconciliation: CatalogInventoryReconciliationList!
        catalogSuppliers(options: CatalogSupplierListOptions): CatalogSupplierList!
        catalogSupplier(id: ID!): CatalogSupplier!
        catalogSupplierVariants(supplierId: ID!, skip: Int, take: Int): CatalogSupplierVariantList!
        catalogPurchaseOrders(options: CatalogPurchaseOrderListOptions): CatalogPurchaseOrderList!
        catalogPurchaseOrder(id: ID!): CatalogPurchaseOrder!
        catalogSupplierPerformance(supplierId: ID!, from: DateTime, to: DateTime): CatalogSupplierPerformance!
    }

    extend type Mutation {
        applyCatalogVariantMatrix(input: ApplyCatalogVariantMatrixInput!): Product!
        beginCatalogImport(input: BeginCatalogImportInput!): CatalogImportJob!
        appendCatalogImportRows(input: AppendCatalogImportRowsInput!): CatalogImportJob!
        finalizeCatalogImportPreview(id: ID!): CatalogImportJob!
        resolveCatalogImportRow(input: ResolveCatalogImportRowInput!): CatalogImportRow!
        resolveCatalogImportRows(input: ResolveCatalogImportRowsInput!): CatalogImportJob!
        executeCatalogImport(id: ID!): CatalogImportJob!
        rollbackCatalogImport(id: ID!): CatalogImportJob!
        updateCatalogVariantOperations(input: UpdateCatalogVariantOperationsInput!): CatalogProductWorkspace!
        updateCatalogInventoryThreshold(
            input: UpdateCatalogInventoryThresholdInput!
        ): CatalogInventoryThresholdUpdate!
        createCatalogProductVariant(input: CreateCatalogProductVariantInput!): CatalogProductWorkspace!
        createCatalogProduct(input: CreateCatalogProductInput!): Product!
        saveCatalogProduct(input: SaveCatalogProductInput!): Product!
        saveCatalogInventoryLot(input: SaveCatalogInventoryLotInput!): CatalogInventoryLot!
        adjustCatalogLegacyInventory(input: AdjustCatalogLegacyInventoryInput!): CatalogInventoryOperation!
        transferCatalogInventoryLot(input: TransferCatalogInventoryLotInput!): CatalogInventoryOperation!
        resolveCatalogInventoryReconciliation(
            input: ResolveCatalogInventoryReconciliationInput!
        ): CatalogInventoryOperation!
        saveCatalogOrderProfitExpense(input: SaveCatalogOrderProfitExpenseInput!): CatalogOrderProfitExpense!
        importCatalogOrderProfitExpenses(
            input: ImportCatalogOrderProfitExpensesInput!
        ): CatalogOrderProfitExpenseImportResult!
        createCatalogSupplier(input: CreateCatalogSupplierInput!): CatalogSupplier!
        updateCatalogSupplier(input: UpdateCatalogSupplierInput!): CatalogSupplier!
        createCatalogPurchaseOrder(input: CreateCatalogPurchaseOrderInput!): CatalogPurchaseOrder!
        submitCatalogPurchaseOrder(id: ID!): CatalogPurchaseOrder!
        receiveCatalogPurchaseOrder(input: ReceiveCatalogPurchaseOrderInput!): CatalogPurchaseOrder!
        closeCatalogPurchaseOrder(id: ID!, note: String): CatalogPurchaseOrder!
        cancelCatalogPurchaseOrder(id: ID!, note: String): CatalogPurchaseOrder!
        recordCatalogPurchasePayment(input: RecordCatalogPurchasePaymentInput!): CatalogPurchaseOrder!
        disputeCatalogPurchasePayment(id: ID!, note: String!): CatalogPurchaseOrder!
        returnCatalogPurchaseOrder(input: ReturnCatalogPurchaseOrderInput!): CatalogPurchaseOrder!
    }
`;
