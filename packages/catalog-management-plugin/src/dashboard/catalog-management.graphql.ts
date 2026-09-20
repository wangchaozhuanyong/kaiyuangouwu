import { gql } from 'graphql-tag';

const importJobFields = gql`
    fragment CatalogImportJobFields on CatalogImportJob {
        id
        createdAt
        updatedAt
        channelId
        stockLocationId
        stockLocation {
            id
            name
        }
        currencyCode
        clearBlankFields
        originalFilename
        byteSize
        fileHash
        sheetName
        detectedHeaders
        fieldMapping
        state
        totalRows
        receivedRows
        createdCount
        updatedCount
        skippedCount
        conflictCount
        warningCount
        errorCount
        progress
        errorMessage
        completedAt
        rolledBackAt
    }
`;

export const stockLocationsQuery = gql`
    query CatalogImportStockLocations {
        stockLocations(options: { take: 100 }) {
            items {
                id
                name
            }
        }
    }
`;

export const beginCatalogImportMutation = gql`
    ${importJobFields}
    mutation BeginCatalogImport($input: BeginCatalogImportInput!) {
        beginCatalogImport(input: $input) {
            ...CatalogImportJobFields
        }
    }
`;

export const appendCatalogImportRowsMutation = gql`
    ${importJobFields}
    mutation AppendCatalogImportRows($input: AppendCatalogImportRowsInput!) {
        appendCatalogImportRows(input: $input) {
            ...CatalogImportJobFields
        }
    }
`;

export const finalizeCatalogImportPreviewMutation = gql`
    ${importJobFields}
    mutation FinalizeCatalogImportPreview($id: ID!) {
        finalizeCatalogImportPreview(id: $id) {
            ...CatalogImportJobFields
        }
    }
`;

export const catalogImportJobQuery = gql`
    ${importJobFields}
    query CatalogImportJob($id: ID!) {
        catalogImportJob(id: $id) {
            ...CatalogImportJobFields
        }
    }
`;

export const catalogImportJobsQuery = gql`
    ${importJobFields}
    query CatalogImportJobs($skip: Int, $take: Int) {
        catalogImportJobs(skip: $skip, take: $take) {
            items {
                ...CatalogImportJobFields
            }
            totalItems
        }
    }
`;

export const catalogImportRowsQuery = gql`
    query CatalogImportRows($jobId: ID!, $action: CatalogImportAction) {
        catalogImportRows(jobId: $jobId, action: $action) {
            id
            rowNumber
            action
            resolution
            targetProductId
            targetVariantId
            normalizedData
            plannedChanges
            message
            appliedAt
        }
    }
`;

export const resolveCatalogImportRowMutation = gql`
    mutation ResolveCatalogImportRow($input: ResolveCatalogImportRowInput!) {
        resolveCatalogImportRow(input: $input) {
            id
            action
            resolution
            targetProductId
            targetVariantId
            message
        }
    }
`;

export const resolveCatalogImportRowsMutation = gql`
    ${importJobFields}
    mutation ResolveCatalogImportRows($input: ResolveCatalogImportRowsInput!) {
        resolveCatalogImportRows(input: $input) {
            ...CatalogImportJobFields
        }
    }
`;

export const executeCatalogImportMutation = gql`
    ${importJobFields}
    mutation ExecuteCatalogImport($id: ID!) {
        executeCatalogImport(id: $id) {
            ...CatalogImportJobFields
        }
    }
`;

export const rollbackCatalogImportMutation = gql`
    ${importJobFields}
    mutation RollbackCatalogImport($id: ID!) {
        rollbackCatalogImport(id: $id) {
            ...CatalogImportJobFields
        }
    }
`;

export const catalogProductWorkspaceQuery = gql`
    query CatalogProductWorkspace($productId: ID!) {
        catalogProductWorkspace(productId: $productId) {
            productId
            channelId
            currencyCode
            stockLocations {
                id
                name
            }
            variants {
                id
                name
                enabled
                sku
                barcode
                specification
                saleUnit
                purchaseUnit
                packageQuantity
                shelfLifeDays
                supplier {
                    id
                    code
                    name
                    enabled
                }
                sellingPrice
                currencyCode
                purchaseCostMicrounits
                grossProfitMicrounits
                margin
                stockLevels {
                    stockLocationId
                    stockLocationName
                    stockOnHand
                    stockAllocated
                    stockAvailable
                    minimumStock
                    maximumStock
                }
                lots {
                    id
                    productVariantId
                    stockLocationId
                    lotCode
                    manufacturedAt
                    expiresAt
                    quantityOnHand
                    purchaseCostMicrounits
                    currencyCode
                    state
                    daysUntilExpiry
                }
            }
        }
    }
`;

export const catalogProductVariantCreationContextQuery = gql`
    query CatalogProductVariantCreationContext($productId: ID!) {
        product(id: $productId) {
            id
            name
            translations {
                languageCode
                name
            }
            optionGroups {
                id
                name
                options {
                    id
                    name
                }
            }
        }
    }
`;

export const createCatalogProductVariantMutation = gql`
    mutation CreateCatalogProductVariant($input: CreateCatalogProductVariantInput!) {
        createCatalogProductVariant(input: $input) {
            productId
        }
    }
`;

export const catalogExportRowsQuery = gql`
    query CatalogExportRows($skip: Int, $take: Int) {
        catalogExportRows(skip: $skip, take: $take) {
            totalItems
            scannedItems
            items {
                productId
                variantId
                productName
                description
                categories
                importCategory
                fulfillmentType
                channelCode
                brand
                tags
                productEnabled
                variantEnabled
                systemCreatedAt
                sourceCreatedAt
                supplierName
                sku
                barcode
                specification
                saleUnit
                purchaseUnit
                packageQuantity
                shelfLifeDays
                sellingPrice
                purchaseCostMicrounits
                margin
                currencyCode
                stockLevels {
                    stockLocationId
                    stockLocationName
                    stockOnHand
                    stockAllocated
                    stockAvailable
                    minimumStock
                    maximumStock
                }
                lots {
                    id
                    stockLocationId
                    stockLocationName
                    lotCode
                    manufacturedAt
                    expiresAt
                    quantityOnHand
                    purchaseCostMicrounits
                    currencyCode
                    state
                }
            }
        }
    }
`;

export const catalogIntegritySummaryQuery = gql`
    query CatalogIntegritySummary {
        catalogIntegritySummary {
            totalProducts
            totalVariants
            productsWithoutVariants
            variantsWithoutCategory
            variantsWithoutCost
        }
    }
`;

export const updateCatalogVariantOperationsMutation = gql`
    mutation UpdateCatalogVariantOperations($input: UpdateCatalogVariantOperationsInput!) {
        updateCatalogVariantOperations(input: $input) {
            productId
        }
    }
`;

export const saveCatalogInventoryLotMutation = gql`
    mutation SaveCatalogInventoryLot($input: SaveCatalogInventoryLotInput!) {
        saveCatalogInventoryLot(input: $input) {
            id
            lotCode
            quantityOnHand
            expiresAt
            state
        }
    }
`;

const catalogInventoryOperationFields = gql`
    fragment CatalogInventoryOperationFields on CatalogInventoryOperation {
        id
        createdAt
        code
        type
        status
        actorUserId
        reason
        reference
        postedAt
        lines {
            id
            quantityDelta
            previousLotQuantity
            resultingLotQuantity
            previousStockOnHand
            resultingStockOnHand
            reconciliationMode
            variant {
                id
                name
                sku
            }
            stockLocation {
                id
                name
            }
            inventoryLot {
                id
                lotCode
            }
        }
    }
`;

export const catalogInventoryOperationsQuery = gql`
    ${catalogInventoryOperationFields}
    query CatalogInventoryOperations($skip: Int, $take: Int) {
        catalogInventoryOperations(skip: $skip, take: $take) {
            items {
                ...CatalogInventoryOperationFields
            }
            totalItems
        }
    }
`;

export const catalogInventoryReconciliationQuery = gql`
    query CatalogInventoryReconciliation {
        catalogInventoryReconciliation {
            items {
                id
                productVariantId
                variantName
                sku
                stockLocationId
                stockLocationName
                lotQuantity
                stockOnHand
                difference
                canCreateBaselineLot
            }
            totalItems
        }
    }
`;

export const adjustCatalogLegacyInventoryMutation = gql`
    ${catalogInventoryOperationFields}
    mutation AdjustCatalogLegacyInventory($input: AdjustCatalogLegacyInventoryInput!) {
        adjustCatalogLegacyInventory(input: $input) {
            ...CatalogInventoryOperationFields
        }
    }
`;

export const transferCatalogInventoryLotMutation = gql`
    ${catalogInventoryOperationFields}
    mutation TransferCatalogInventoryLot($input: TransferCatalogInventoryLotInput!) {
        transferCatalogInventoryLot(input: $input) {
            ...CatalogInventoryOperationFields
        }
    }
`;

export const resolveCatalogInventoryReconciliationMutation = gql`
    ${catalogInventoryOperationFields}
    mutation ResolveCatalogInventoryReconciliation($input: ResolveCatalogInventoryReconciliationInput!) {
        resolveCatalogInventoryReconciliation(input: $input) {
            ...CatalogInventoryOperationFields
        }
    }
`;

const catalogSupplierFields = gql`
    fragment CatalogSupplierFields on CatalogSupplier {
        id
        createdAt
        updatedAt
        channelId
        code
        name
        enabled
        contactName
        phone
        email
        address
        notes
        linkedVariantCount
    }
`;

export const catalogSuppliersQuery = gql`
    ${catalogSupplierFields}
    query CatalogSuppliers($options: CatalogSupplierListOptions) {
        catalogSuppliers(options: $options) {
            items {
                ...CatalogSupplierFields
            }
            totalItems
        }
    }
`;

export const catalogSupplierVariantsQuery = gql`
    query CatalogSupplierVariants($supplierId: ID!, $skip: Int, $take: Int) {
        catalogSupplierVariants(supplierId: $supplierId, skip: $skip, take: $take) {
            items {
                id
                productId
                productName
                name
                sku
                enabled
            }
            totalItems
        }
    }
`;

export const createCatalogSupplierMutation = gql`
    ${catalogSupplierFields}
    mutation CreateCatalogSupplier($input: CreateCatalogSupplierInput!) {
        createCatalogSupplier(input: $input) {
            ...CatalogSupplierFields
        }
    }
`;

export const updateCatalogSupplierMutation = gql`
    ${catalogSupplierFields}
    mutation UpdateCatalogSupplier($input: UpdateCatalogSupplierInput!) {
        updateCatalogSupplier(input: $input) {
            ...CatalogSupplierFields
        }
    }
`;

const catalogPurchaseOrderFields = gql`
    fragment CatalogPurchaseOrderFields on CatalogPurchaseOrder {
        id
        createdAt
        updatedAt
        code
        status
        paymentStatus
        currencyCode
        totalMicrounits
        paidMicrounits
        returnCreditMicrounits
        outstandingMicrounits
        expectedAt
        submittedAt
        closedAt
        notes
        closureNote
        overdue
        hasVariance
        supplier {
            id
            code
            name
            enabled
        }
        stockLocation {
            id
            name
        }
        lines {
            id
            variantId
            variant {
                id
                name
                sku
            }
            orderedQuantity
            receivedQuantity
            acceptedQuantity
            rejectedQuantity
            returnedQuantity
            outstandingQuantity
            returnableQuantity
            returnableLots {
                id
                lotCode
                quantityOnHand
                expiresAt
            }
            unitCostMicrounits
            purchaseUnit
            packageQuantity
            notes
        }
        receipts {
            id
            code
            supplierDeliveryReference
            receivedAt
            receivedByUserId
            notes
            lines {
                id
                purchaseOrderLineId
                inventoryLotId
                receivedQuantity
                acceptedQuantity
                rejectedQuantity
                lotCode
                unitCostMicrounits
                rejectionReason
            }
        }
        supplierReturns {
            id
            code
            supplierAcknowledgementReference
            returnedAt
            returnedByUserId
            notes
            lines {
                id
                purchaseOrderLineId
                inventoryLotId
                quantity
                unitCostMicrounits
                creditMicrounits
                reason
            }
        }
        events {
            id
            createdAt
            type
            actorUserId
            summary
            details
        }
    }
`;

export const catalogPurchaseOrdersQuery = gql`
    ${catalogPurchaseOrderFields}
    query CatalogPurchaseOrders($options: CatalogPurchaseOrderListOptions) {
        catalogPurchaseOrders(options: $options) {
            items {
                ...CatalogPurchaseOrderFields
            }
            totalItems
        }
    }
`;

export const catalogPurchaseOrderQuery = gql`
    ${catalogPurchaseOrderFields}
    query CatalogPurchaseOrder($id: ID!) {
        catalogPurchaseOrder(id: $id) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const catalogPurchaseVariantsQuery = gql`
    query CatalogPurchaseVariants($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            items {
                id
                name
                sku
                customFields
            }
            totalItems
        }
    }
`;

export const createCatalogPurchaseOrderMutation = gql`
    ${catalogPurchaseOrderFields}
    mutation CreateCatalogPurchaseOrder($input: CreateCatalogPurchaseOrderInput!) {
        createCatalogPurchaseOrder(input: $input) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const submitCatalogPurchaseOrderMutation = gql`
    ${catalogPurchaseOrderFields}
    mutation SubmitCatalogPurchaseOrder($id: ID!) {
        submitCatalogPurchaseOrder(id: $id) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const receiveCatalogPurchaseOrderMutation = gql`
    ${catalogPurchaseOrderFields}
    mutation ReceiveCatalogPurchaseOrder($input: ReceiveCatalogPurchaseOrderInput!) {
        receiveCatalogPurchaseOrder(input: $input) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const closeCatalogPurchaseOrderMutation = gql`
    ${catalogPurchaseOrderFields}
    mutation CloseCatalogPurchaseOrder($id: ID!, $note: String) {
        closeCatalogPurchaseOrder(id: $id, note: $note) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const cancelCatalogPurchaseOrderMutation = gql`
    ${catalogPurchaseOrderFields}
    mutation CancelCatalogPurchaseOrder($id: ID!, $note: String) {
        cancelCatalogPurchaseOrder(id: $id, note: $note) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const recordCatalogPurchasePaymentMutation = gql`
    ${catalogPurchaseOrderFields}
    mutation RecordCatalogPurchasePayment($input: RecordCatalogPurchasePaymentInput!) {
        recordCatalogPurchasePayment(input: $input) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const disputeCatalogPurchasePaymentMutation = gql`
    ${catalogPurchaseOrderFields}
    mutation DisputeCatalogPurchasePayment($id: ID!, $note: String!) {
        disputeCatalogPurchasePayment(id: $id, note: $note) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const returnCatalogPurchaseOrderMutation = gql`
    ${catalogPurchaseOrderFields}
    mutation ReturnCatalogPurchaseOrder($input: ReturnCatalogPurchaseOrderInput!) {
        returnCatalogPurchaseOrder(input: $input) {
            ...CatalogPurchaseOrderFields
        }
    }
`;

export const catalogSupplierPerformanceQuery = gql`
    query CatalogSupplierPerformance($supplierId: ID!, $from: DateTime, $to: DateTime) {
        catalogSupplierPerformance(supplierId: $supplierId, from: $from, to: $to) {
            supplierId
            from
            to
            totalOrders
            closedOrders
            orderedQuantity
            acceptedQuantity
            rejectedQuantity
            returnedQuantity
            varianceOrders
            disputeOrders
            onTimeRate
            acceptanceRate
            varianceFreeRate
            disputeFreeRate
            score
        }
    }
`;

export interface CatalogImportJobRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    channelId: string;
    stockLocationId: string;
    stockLocation: { id: string; name: string };
    currencyCode: string;
    clearBlankFields: boolean;
    originalFilename: string;
    byteSize: number;
    fileHash: string;
    sheetName: string | null;
    detectedHeaders: string[] | null;
    fieldMapping: Record<string, string> | null;
    state:
        | 'RECEIVING'
        | 'PREVIEW_READY'
        | 'QUEUED'
        | 'RUNNING'
        | 'COMPLETED'
        | 'COMPLETED_WITH_ERRORS'
        | 'FAILED'
        | 'ROLLED_BACK';
    totalRows: number;
    receivedRows: number;
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    conflictCount: number;
    warningCount: number;
    errorCount: number;
    progress: number;
    errorMessage: string | null;
    completedAt: string | null;
    rolledBackAt: string | null;
}

export interface CatalogImportRowRecord {
    id: string;
    rowNumber: number;
    action: 'PENDING' | 'CREATE' | 'UPDATE' | 'SKIP_UNCHANGED' | 'CONFLICT' | 'WARNING' | 'ERROR';
    resolution: string | null;
    targetProductId: string | null;
    targetVariantId: string | null;
    normalizedData: Record<string, unknown>;
    plannedChanges: Record<string, unknown> | null;
    message: string | null;
    appliedAt: string | null;
}

export interface CatalogExportRowRecord {
    productId: string;
    variantId: string;
    productName: string;
    description: string;
    categories: string[];
    importCategory?: string | null;
    fulfillmentType: 'digital' | 'physical';
    channelCode: string;
    brand: string | null;
    tags: string[];
    productEnabled: boolean;
    variantEnabled: boolean;
    systemCreatedAt: string;
    sourceCreatedAt: string | null;
    supplierName: string | null;
    sku: string;
    barcode: string;
    specification: string;
    saleUnit: string;
    purchaseUnit: string;
    packageQuantity: number;
    shelfLifeDays: number | null;
    sellingPrice: number;
    purchaseCostMicrounits: number | null;
    margin: number | null;
    currencyCode: string;
    stockLevels: Array<{
        stockLocationId: string;
        stockLocationName: string;
        stockOnHand: number;
        stockAllocated: number;
        stockAvailable: number;
        minimumStock: number | null;
        maximumStock: number | null;
    }>;
    lots: Array<{
        id: string;
        stockLocationId: string;
        stockLocationName: string;
        lotCode: string;
        manufacturedAt: string | null;
        expiresAt: string | null;
        quantityOnHand: number;
        purchaseCostMicrounits: number | null;
        currencyCode: string;
        state: string;
    }>;
}

export interface CatalogIntegritySummaryRecord {
    catalogIntegritySummary: {
        totalProducts: number;
        totalVariants: number;
        productsWithoutVariants: number;
        variantsWithoutCategory: number;
        variantsWithoutCost: number;
    };
}

export interface CatalogInventoryReconciliationRecord {
    id: string;
    productVariantId: string;
    variantName: string;
    sku: string;
    stockLocationId: string;
    stockLocationName: string;
    lotQuantity: number;
    stockOnHand: number;
    difference: number;
    canCreateBaselineLot: boolean;
}

export interface CatalogInventoryOperationRecord {
    id: string;
    createdAt: string;
    code: string;
    type: string;
    status: string;
    actorUserId: string | null;
    reason: string;
    reference: string | null;
    postedAt: string;
    lines: Array<{
        id: string;
        quantityDelta: number;
        previousLotQuantity: number;
        resultingLotQuantity: number;
        previousStockOnHand: number;
        resultingStockOnHand: number;
        reconciliationMode: string | null;
        variant: { id: string; name: string; sku: string };
        stockLocation: { id: string; name: string };
        inventoryLot: { id: string; lotCode: string } | null;
    }>;
}

export interface CatalogWorkspaceRecord {
    catalogProductWorkspace: {
        productId: string;
        channelId: string;
        currencyCode: string;
        stockLocations: Array<{ id: string; name: string }>;
        variants: CatalogWorkspaceVariantRecord[];
    };
}

export interface CatalogVariantCreationContextRecord {
    product: {
        id: string;
        name: string;
        translations: Array<{ languageCode: string; name: string }>;
        optionGroups: Array<{
            id: string;
            name: string;
            options: Array<{ id: string; name: string }>;
        }>;
    } | null;
}

export interface CatalogWorkspaceVariantRecord {
    id: string;
    name: string;
    enabled: boolean;
    sku: string;
    barcode: string;
    specification: string;
    saleUnit: string;
    purchaseUnit: string;
    packageQuantity: number;
    shelfLifeDays: number | null;
    supplier: Pick<CatalogSupplierRecord, 'id' | 'code' | 'name' | 'enabled'> | null;
    sellingPrice: number;
    currencyCode: string;
    purchaseCostMicrounits: number | null;
    grossProfitMicrounits: number | null;
    margin: number | null;
    stockLevels: Array<{
        stockLocationId: string;
        stockLocationName: string;
        stockOnHand: number;
        stockAllocated: number;
        stockAvailable: number;
        minimumStock: number | null;
        maximumStock: number | null;
    }>;
    lots: Array<{
        id: string;
        productVariantId: string;
        stockLocationId: string;
        lotCode: string;
        manufacturedAt: string | null;
        expiresAt: string | null;
        quantityOnHand: number;
        purchaseCostMicrounits: number | null;
        currencyCode: string;
        state: string;
        daysUntilExpiry: number | null;
    }>;
}

export interface CatalogSupplierRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    channelId: string;
    code: string;
    name: string;
    enabled: boolean;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    linkedVariantCount: number;
}

export interface CatalogSupplierVariantRecord {
    id: string;
    productId: string;
    productName: string;
    name: string;
    sku: string;
    enabled: boolean;
}

export type CatalogPurchaseOrderStatus =
    'DRAFT' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'VARIANCE_REVIEW' | 'CLOSED' | 'CANCELLED';

export interface CatalogPurchaseOrderRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    code: string;
    status: CatalogPurchaseOrderStatus;
    paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'DISPUTED';
    currencyCode: string;
    totalMicrounits: number;
    paidMicrounits: number;
    returnCreditMicrounits: number;
    outstandingMicrounits: number;
    expectedAt: string | null;
    submittedAt: string | null;
    closedAt: string | null;
    notes: string | null;
    closureNote: string | null;
    overdue: boolean;
    hasVariance: boolean;
    supplier: Pick<CatalogSupplierRecord, 'id' | 'code' | 'name' | 'enabled'>;
    stockLocation: { id: string; name: string };
    lines: Array<{
        id: string;
        variantId: string;
        variant: { id: string; name: string; sku: string };
        orderedQuantity: number;
        receivedQuantity: number;
        acceptedQuantity: number;
        rejectedQuantity: number;
        returnedQuantity: number;
        outstandingQuantity: number;
        returnableQuantity: number;
        returnableLots: Array<{
            id: string;
            lotCode: string;
            quantityOnHand: number;
            expiresAt: string | null;
        }>;
        unitCostMicrounits: number;
        purchaseUnit: string | null;
        packageQuantity: number;
        notes: string | null;
    }>;
    receipts: Array<{
        id: string;
        code: string;
        supplierDeliveryReference: string | null;
        receivedAt: string;
        receivedByUserId: string | null;
        notes: string | null;
        lines: Array<{
            id: string;
            purchaseOrderLineId: string;
            inventoryLotId: string | null;
            receivedQuantity: number;
            acceptedQuantity: number;
            rejectedQuantity: number;
            lotCode: string | null;
            unitCostMicrounits: number;
            rejectionReason: string | null;
        }>;
    }>;
    supplierReturns: Array<{
        id: string;
        code: string;
        supplierAcknowledgementReference: string;
        returnedAt: string;
        returnedByUserId: string | null;
        notes: string | null;
        lines: Array<{
            id: string;
            purchaseOrderLineId: string;
            inventoryLotId: string;
            quantity: number;
            unitCostMicrounits: number;
            creditMicrounits: number;
            reason: string;
        }>;
    }>;
    events: Array<{
        id: string;
        createdAt: string;
        type: string;
        actorUserId: string | null;
        summary: string;
        details: Record<string, unknown> | null;
    }>;
}

export interface CatalogSupplierPerformanceRecord {
    supplierId: string;
    from: string | null;
    to: string | null;
    totalOrders: number;
    closedOrders: number;
    orderedQuantity: number;
    acceptedQuantity: number;
    rejectedQuantity: number;
    returnedQuantity: number;
    varianceOrders: number;
    disputeOrders: number;
    onTimeRate: number | null;
    acceptanceRate: number | null;
    varianceFreeRate: number | null;
    disputeFreeRate: number | null;
    score: number | null;
}
