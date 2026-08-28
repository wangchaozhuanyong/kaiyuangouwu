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
        originalFilename
        byteSize
        fileHash
        sheetName
        detectedHeaders
        fieldMapping
        state
        totalRows
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

export const createCatalogImportPreviewMutation = gql`
    ${importJobFields}
    mutation CreateCatalogImportPreview($file: Upload!, $input: CatalogImportContextInput!) {
        createCatalogImportPreview(file: $file, input: $input) {
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

export const catalogStandardImportTemplateQuery = gql`
    query CatalogStandardImportTemplate {
        catalogStandardImportTemplate
    }
`;

export const catalogImportReportQuery = gql`
    query CatalogImportReport($id: ID!) {
        catalogImportReport(id: $id)
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

export interface CatalogImportJobRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    channelId: string;
    stockLocationId: string;
    stockLocation: { id: string; name: string };
    currencyCode: string;
    originalFilename: string;
    byteSize: number;
    fileHash: string;
    sheetName: string | null;
    detectedHeaders: string[] | null;
    fieldMapping: Record<string, string> | null;
    state:
        | 'PREVIEW_READY'
        | 'QUEUED'
        | 'RUNNING'
        | 'COMPLETED'
        | 'COMPLETED_WITH_ERRORS'
        | 'FAILED'
        | 'ROLLED_BACK';
    totalRows: number;
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
    action: 'CREATE' | 'UPDATE' | 'SKIP_UNCHANGED' | 'CONFLICT' | 'WARNING' | 'ERROR';
    resolution: string | null;
    targetProductId: string | null;
    targetVariantId: string | null;
    normalizedData: Record<string, unknown>;
    plannedChanges: Record<string, unknown> | null;
    message: string | null;
    appliedAt: string | null;
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
