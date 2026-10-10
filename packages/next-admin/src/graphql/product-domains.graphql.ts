import { gql } from '@apollo/client';
import type { DigitalDeliveryMode, DigitalStockPolicy } from './commerce.graphql';
export const COPY_PRODUCT_DOMAIN = gql`
    mutation CopyProductBasicsAsType($productId: ID!, $fulfillmentType: String!) {
        copyProductBasicsAsType(productId: $productId, fulfillmentType: $fulfillmentType) {
            id
        }
    }
`;

export interface DigitalWorkspaceVariant {
    id: string;
    sku: string;
    supplier?: { id: string; name: string } | null;
    deliveryMode: DigitalDeliveryMode;
    stockPolicy: DigitalStockPolicy;
    availableQuantity: number | null;
    migrationRequired: boolean;
    purchaseCostMicrounits: number | null;
    fileVersion: { id: string; fileName: string } | null;
}
export const DIGITAL_PRODUCT_WORKSPACE = gql`
    query DigitalProductWorkspace($productId: ID!) {
        digitalProductWorkspace(productId: $productId) {
            productId
            variants {
                id
                sku
                deliveryMode
                stockPolicy
                availableQuantity
                migrationRequired
                purchaseCostMicrounits
                supplier {
                    id
                    name
                }
                fileVersion {
                    id
                    fileName
                }
            }
        }
    }
`;
export const UPDATE_DIGITAL_VARIANT = gql`
    mutation UpdateDigitalVariant($input: UpdateDigitalVariantConfigInput!) {
        updateDigitalVariantConfig(input: $input) {
            id
            availableQuantity
        }
    }
`;
export const UPDATE_VARIANT_COST = gql`
    mutation UpdateVariantCost(
        $productVariantId: ID!
        $currencyCode: CurrencyCode!
        $costMicrounits: Float!
    ) {
        updateProductVariantCost(
            productVariantId: $productVariantId
            currencyCode: $currencyCode
            costMicrounits: $costMicrounits
        )
    }
`;
export const UPLOAD_DIGITAL_FILE = gql`
    mutation UploadDigitalDeliveryFile($file: Upload!) {
        uploadDigitalDeliveryFile(file: $file) {
            id
            fileName
        }
    }
`;
export const DIGITAL_MIGRATION_PREVIEW = gql`
    query DigitalInventoryMigrationPreview(
        $productVariantId: ID!
        $ownershipConfirmation: DigitalInventoryOwnershipConfirmationInput
    ) {
        digitalInventoryMigrationPreview(
            productVariantId: $productVariantId
            ownershipConfirmation: $ownershipConfirmation
        ) {
            productVariantId
            availableQuantity
            reservedQuantity
            conflicts
            alreadyMigrated
            confirmableStockLevels {
                id
                stockLocationId
                stockOnHand
                stockAllocated
            }
        }
    }
`;
export const MIGRATE_DIGITAL_INVENTORY = gql`
    mutation MigrateDigitalInventory(
        $productVariantId: ID!
        $expectedAvailable: Int!
        $expectedReserved: Int!
        $ownershipConfirmation: DigitalInventoryOwnershipConfirmationInput
    ) {
        migrateDigitalInventory(
            productVariantId: $productVariantId
            expectedAvailable: $expectedAvailable
            expectedReserved: $expectedReserved
            ownershipConfirmation: $ownershipConfirmation
        ) {
            id
            availableQuantity
        }
    }
`;

export interface DigitalInventoryLegacyStockLevel {
    id: string;
    stockLocationId: string;
    stockOnHand: number;
    stockAllocated: number;
}
export interface DigitalInventoryOwnershipConfirmation {
    stockLevels: DigitalInventoryLegacyStockLevel[];
    reason: string;
}

export const UPDATE_PHYSICAL_VARIANT = gql`
    mutation UpdatePhysicalVariant($input: UpdatePhysicalVariantInput!) {
        updatePhysicalVariant(input: $input) {
            productId
        }
    }
`;

export const UPDATE_VARIANT_SUPPLIER = gql`
    mutation UpdateVariantSupplier($productVariantId: ID!, $supplierId: ID) {
        updateProductVariantSupplier(productVariantId: $productVariantId, supplierId: $supplierId)
    }
`;

export const PRODUCT_TYPE_CHANGE_ALLOWED = gql`
    query ProductTypeChangeAllowed($productId: ID!) {
        productTypeChangeAllowed(productId: $productId)
    }
`;
