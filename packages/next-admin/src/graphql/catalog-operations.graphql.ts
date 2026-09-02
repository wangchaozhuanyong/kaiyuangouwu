import { gql } from '@apollo/client';

export const CATALOG_PRODUCT_WORKSPACE_QUERY = gql`
    query NextAdminCatalogProductWorkspace($productId: ID!) {
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

export const UPDATE_CATALOG_VARIANT_OPERATIONS_MUTATION = gql`
    mutation NextAdminUpdateCatalogVariantOperations($input: UpdateCatalogVariantOperationsInput!) {
        updateCatalogVariantOperations(input: $input) {
            productId
        }
    }
`;

export const SAVE_CATALOG_INVENTORY_LOT_MUTATION = gql`
    mutation NextAdminSaveCatalogInventoryLot($input: SaveCatalogInventoryLotInput!) {
        saveCatalogInventoryLot(input: $input) {
            id
            lotCode
            quantityOnHand
            expiresAt
            state
        }
    }
`;

const CATALOG_SUPPLIER_FIELDS = gql`
    fragment NextAdminCatalogSupplierFields on CatalogSupplier {
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

export const CATALOG_SUPPLIERS_QUERY = gql`
    ${CATALOG_SUPPLIER_FIELDS}
    query NextAdminCatalogSuppliers($options: CatalogSupplierListOptions) {
        catalogSuppliers(options: $options) {
            items {
                ...NextAdminCatalogSupplierFields
            }
            totalItems
        }
    }
`;

export const CATALOG_SUPPLIER_VARIANTS_QUERY = gql`
    query NextAdminCatalogSupplierVariants($supplierId: ID!, $skip: Int, $take: Int) {
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

export const CREATE_CATALOG_SUPPLIER_MUTATION = gql`
    ${CATALOG_SUPPLIER_FIELDS}
    mutation NextAdminCreateCatalogSupplier($input: CreateCatalogSupplierInput!) {
        createCatalogSupplier(input: $input) {
            ...NextAdminCatalogSupplierFields
        }
    }
`;

export const UPDATE_CATALOG_SUPPLIER_MUTATION = gql`
    ${CATALOG_SUPPLIER_FIELDS}
    mutation NextAdminUpdateCatalogSupplier($input: UpdateCatalogSupplierInput!) {
        updateCatalogSupplier(input: $input) {
            ...NextAdminCatalogSupplierFields
        }
    }
`;

export const CATALOG_EXPORT_ROWS_QUERY = gql`
    query NextAdminCatalogExportRows($skip: Int, $take: Int) {
        catalogExportRows(skip: $skip, take: $take) {
            totalItems
            items {
                productId
                variantId
                productName
                description
                categories
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

export const CATALOG_INTEGRITY_SUMMARY_QUERY = gql`
    query NextAdminCatalogIntegritySummary {
        catalogIntegritySummary {
            totalProducts
            totalVariants
            productsWithoutVariants
            variantsWithoutCategory
            variantsWithoutCost
        }
    }
`;

export const PRODUCT_PACKAGING_WORKSPACE_QUERY = gql`
    query NextAdminProductPackagingWorkspace($productId: ID!) {
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

export const UPDATE_PRODUCT_PACKAGING_MUTATION = gql`
    mutation NextAdminUpdateProductPackaging($input: UpdateProductPackagingInput!) {
        updateProductPackaging(input: $input) {
            id
            updatedAt
            enabled
            autoUnpack
            unitLabel
            packageLabel
            unitsPerPackage
        }
    }
`;

export const PRODUCT_VARIANT_PRICES_QUERY = gql`
    query NextAdminProductVariantPrices($productId: ID!) {
        activeChannel {
            id
            code
            defaultCurrencyCode
            availableCurrencyCodes
        }
        product(id: $productId) {
            id
            variants {
                id
                name
                sku
                currencyCode
                price
                prices {
                    currencyCode
                    price
                }
            }
        }
    }
`;

export const UPDATE_PRODUCT_VARIANT_PRICES_MUTATION = gql`
    mutation NextAdminUpdateProductVariantPrices($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
            price
            currencyCode
            prices {
                currencyCode
                price
            }
        }
    }
`;

export const PRODUCT_VARIANT_CUSTOM_FIELDS_QUERY = gql`
    fragment NextAdminProductVariantCustomFields on ProductVariant {
        id
        name
        sku
        translations {
            id
            languageCode
            name
        }
    }
    query NextAdminProductVariantCustomFields($productId: ID!) {
        product(id: $productId) {
            id
            variants {
                ...NextAdminProductVariantCustomFields
            }
        }
    }
`;

export const UPDATE_PRODUCT_VARIANT_CUSTOM_FIELDS_MUTATION = gql`
    mutation NextAdminUpdateProductVariantCustomFields($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
        }
    }
`;

export interface CatalogSupplierRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    channelId: string;
    code: string;
    name: string;
    enabled: boolean;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
    linkedVariantCount: number;
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
    shelfLifeDays?: number | null;
    supplier?: Pick<CatalogSupplierRecord, 'id' | 'code' | 'name' | 'enabled'> | null;
    sellingPrice: number;
    currencyCode: string;
    purchaseCostMicrounits?: number | null;
    grossProfitMicrounits?: number | null;
    margin?: number | null;
    stockLevels: Array<{
        stockLocationId: string;
        stockLocationName: string;
        stockOnHand: number;
        stockAllocated: number;
        stockAvailable: number;
        minimumStock?: number | null;
        maximumStock?: number | null;
    }>;
    lots: Array<{
        id: string;
        productVariantId: string;
        stockLocationId: string;
        lotCode: string;
        manufacturedAt?: string | null;
        expiresAt?: string | null;
        quantityOnHand: number;
        purchaseCostMicrounits?: number | null;
        currencyCode: string;
        state: string;
        daysUntilExpiry?: number | null;
    }>;
}

export interface CatalogWorkspaceResult {
    catalogProductWorkspace: {
        productId: string;
        channelId: string;
        currencyCode: string;
        stockLocations: Array<{ id: string; name: string }>;
        variants: CatalogWorkspaceVariantRecord[];
    };
}

export interface ProductPackagingWorkspaceResult {
    product: {
        id: string;
        variants: Array<{ id: string; name: string; sku: string; trackInventory: string }>;
    } | null;
    productPackaging: {
        id: string;
        updatedAt: string;
        enabled: boolean;
        autoUnpack: boolean;
        unitLabel: string;
        packageLabel: string;
        unitsPerPackage: number;
        unitVariant: { id: string; name: string; sku: string; trackInventory: string };
        packageVariant: { id: string; name: string; sku: string; trackInventory: string };
    } | null;
    productPackagingStock: {
        unitStockOnHand: number;
        unitStockAllocated: number;
        unitStockAvailable: number;
        packageStockOnHand: number;
        packageStockAllocated: number;
        packageStockAvailable: number;
        convertibleUnitStock: number;
    } | null;
    productPackagingUnpackEvents: Array<{
        id: string;
        createdAt: string;
        packagesOpened: number;
        unitsCreated: number;
        packageStockBefore: number;
        packageStockAfter: number;
        unitStockBefore: number;
        unitStockAfter: number;
        stockLocation: { id: string; name: string };
        order?: { id: string; code: string } | null;
    }>;
}
