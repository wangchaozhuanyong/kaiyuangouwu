import { gql } from 'graphql-tag';

export const adminApiExtensions = gql`
    enum CatalogImportState {
        PREVIEW_READY
        QUEUED
        RUNNING
        COMPLETED
        COMPLETED_WITH_ERRORS
        FAILED
        ROLLED_BACK
    }

    enum CatalogImportAction {
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

    type CatalogImportJob implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        stockLocationId: ID!
        stockLocation: CatalogImportStockLocation!
        currencyCode: CurrencyCode!
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

    input CatalogImportContextInput {
        channelId: ID!
        stockLocationId: ID!
        currencyCode: CurrencyCode!
    }

    input ResolveCatalogImportRowInput {
        rowId: ID!
        resolution: CatalogImportResolution!
        targetVariantId: ID
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
    }

    extend type Query {
        catalogImportJob(id: ID!): CatalogImportJob!
        catalogImportJobs(skip: Int, take: Int): CatalogImportJobList!
        catalogImportRows(jobId: ID!, action: CatalogImportAction): [CatalogImportRow!]!
        catalogProductWorkspace(productId: ID!): CatalogProductWorkspace!
        catalogStandardImportTemplate: String!
        catalogImportReport(id: ID!): String!
    }

    extend type Mutation {
        createCatalogImportPreview(file: Upload!, input: CatalogImportContextInput!): CatalogImportJob!
        resolveCatalogImportRow(input: ResolveCatalogImportRowInput!): CatalogImportRow!
        executeCatalogImport(id: ID!): CatalogImportJob!
        rollbackCatalogImport(id: ID!): CatalogImportJob!
        updateCatalogVariantOperations(input: UpdateCatalogVariantOperationsInput!): CatalogProductWorkspace!
        saveCatalogInventoryLot(input: SaveCatalogInventoryLotInput!): CatalogInventoryLot!
    }
`;
