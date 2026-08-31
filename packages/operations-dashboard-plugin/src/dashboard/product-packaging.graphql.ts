import { gql } from 'graphql-tag';

export interface ProductPackagingVariantRecord {
    id: string;
    name: string;
    sku: string;
    trackInventory: string;
}

export interface ProductPackagingRuleRecord {
    id: string;
    updatedAt: string;
    enabled: boolean;
    autoUnpack: boolean;
    unitLabel: string;
    packageLabel: string;
    unitsPerPackage: number;
    unitVariant: ProductPackagingVariantRecord;
    packageVariant: ProductPackagingVariantRecord;
}

export interface ProductPackagingStockRecord {
    unitStockOnHand: number;
    unitStockAllocated: number;
    unitStockAvailable: number;
    packageStockOnHand: number;
    packageStockAllocated: number;
    packageStockAvailable: number;
    convertibleUnitStock: number;
}

export interface ProductPackagingUnpackEventRecord {
    id: string;
    createdAt: string;
    packagesOpened: number;
    unitsCreated: number;
    packageStockBefore: number;
    packageStockAfter: number;
    unitStockBefore: number;
    unitStockAfter: number;
    stockLocation: { id: string; name: string };
    order: { id: string; code: string } | null;
}

export interface ProductPackagingWorkspaceResult {
    product: {
        id: string;
        variants: ProductPackagingVariantRecord[];
    } | null;
    productPackaging: ProductPackagingRuleRecord | null;
    productPackagingStock: ProductPackagingStockRecord | null;
    productPackagingUnpackEvents: ProductPackagingUnpackEventRecord[];
}

export const productPackagingWorkspaceQuery = gql`
    query ProductPackagingWorkspace($productId: ID!) {
        product(id: $productId) {
            id
            variants {
                id
                name
                sku
                trackInventory
            }
        }
        productPackaging(productId: $productId) {
            id
            updatedAt
            enabled
            autoUnpack
            unitLabel
            packageLabel
            unitsPerPackage
            unitVariant {
                id
                name
                sku
                trackInventory
            }
            packageVariant {
                id
                name
                sku
                trackInventory
            }
        }
        productPackagingStock(productId: $productId) {
            unitStockOnHand
            unitStockAllocated
            unitStockAvailable
            packageStockOnHand
            packageStockAllocated
            packageStockAvailable
            convertibleUnitStock
        }
        productPackagingUnpackEvents(productId: $productId, take: 10) {
            id
            createdAt
            packagesOpened
            unitsCreated
            packageStockBefore
            packageStockAfter
            unitStockBefore
            unitStockAfter
            stockLocation {
                id
                name
            }
            order {
                id
                code
            }
        }
    }
`;

export const updateProductPackagingMutation = gql`
    mutation UpdateProductPackaging($input: UpdateProductPackagingInput!) {
        updateProductPackaging(input: $input) {
            id
            updatedAt
            enabled
            autoUnpack
            unitLabel
            packageLabel
            unitsPerPackage
            unitVariant {
                id
                name
                sku
                trackInventory
            }
            packageVariant {
                id
                name
                sku
                trackInventory
            }
        }
    }
`;
