import { gql } from 'graphql-tag';

export const digitalProductAdminSchema = gql`
    type DigitalFileVersion implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        fileName: String!
        size: Int!
    }
    type DigitalVariantConfig implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        productVariantId: ID!
        deliveryMode: String!
        stockPolicy: String!
        availableQuantity: Int!
        fileVersionId: ID
    }
    type DigitalProductVariant {
        id: ID!
        sku: String!
        deliveryMode: String!
        stockPolicy: String!
        availableQuantity: Int
        migrationRequired: Boolean!
        fileVersion: DigitalFileVersion
        purchaseCostMicrounits: Float
        supplier: CatalogSupplier
    }
    type CheckoutDeliveryException {
        id: ID!
        orderId: ID!
        state: String!
        reviewReason: String
        updatedAt: DateTime!
    }
    type DigitalProductWorkspace {
        productId: ID!
        variants: [DigitalProductVariant!]!
    }
    type DigitalInventoryMigrationPreview {
        productVariantId: ID!
        availableQuantity: Int!
        reservedQuantity: Int!
        conflicts: [String!]!
        alreadyMigrated: Boolean!
        confirmableStockLevels: [DigitalInventoryLegacyStockLevel!]!
    }
    type DigitalInventoryLegacyStockLevel {
        id: ID!
        stockLocationId: ID!
        stockOnHand: Int!
        stockAllocated: Int!
    }
    input DigitalInventoryLegacyStockLevelInput {
        id: ID!
        stockLocationId: ID!
        stockOnHand: Int!
        stockAllocated: Int!
    }
    input DigitalInventoryOwnershipConfirmationInput {
        stockLevels: [DigitalInventoryLegacyStockLevelInput!]!
        reason: String!
    }
    input UpdateDigitalVariantConfigInput {
        productVariantId: ID!
        deliveryMode: String!
        stockPolicy: String
        availableQuantity: Int
        expectedAvailableQuantity: Int
        fileVersionId: ID
    }
    extend type Query {
        productTypeChangeAllowed(productId: ID!): Boolean!
        digitalDeliveryExceptions: [CheckoutDeliveryException!]!
        digitalProductWorkspace(productId: ID!): DigitalProductWorkspace!
        digitalInventoryMigrationPreview(
            productVariantId: ID!
            ownershipConfirmation: DigitalInventoryOwnershipConfirmationInput
        ): DigitalInventoryMigrationPreview!
    }
    extend type Mutation {
        copyProductBasicsAsType(productId: ID!, fulfillmentType: String!): Product!
        retryCheckoutDelivery(orderId: ID!): CheckoutDeliveryException!
        updateDigitalVariantConfig(input: UpdateDigitalVariantConfigInput!): DigitalVariantConfig!
        uploadDigitalDeliveryFile(file: Upload!): DigitalFileVersion!
        migrateDigitalInventory(
            productVariantId: ID!
            expectedAvailable: Int!
            expectedReserved: Int!
            ownershipConfirmation: DigitalInventoryOwnershipConfirmationInput
        ): DigitalVariantConfig!
    }
`;
