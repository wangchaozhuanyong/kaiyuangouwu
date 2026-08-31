import { gql } from '@apollo/client';

export const GET_CATALOG_TAXONOMY = gql`
    query GetCatalogTaxonomy(
        $collectionOptions: CollectionListOptions
        $optionGroupOptions: ProductOptionGroupListOptions
        $facetOptions: FacetListOptions
    ) {
        collections(options: $collectionOptions) {
            items {
                id
                name
                slug
                description
                isPrivate
                parentId
                position
                productVariantCount
                translations {
                    id
                    languageCode
                    name
                    slug
                    description
                }
            }
            totalItems
        }
        productOptionGroups(options: $optionGroupOptions) {
            items {
                id
                name
                code
                productCount
                translations {
                    id
                    languageCode
                    name
                }
                options {
                    id
                    name
                    code
                    translations {
                        id
                        languageCode
                        name
                    }
                }
            }
            totalItems
        }
        facets(options: $facetOptions) {
            items {
                id
                name
                code
                isPrivate
                translations {
                    id
                    languageCode
                    name
                }
                values {
                    id
                    name
                    code
                    translations {
                        id
                        languageCode
                        name
                    }
                }
            }
            totalItems
        }
        activeChannel {
            id
            defaultLanguageCode
        }
    }
`;

export const CREATE_COLLECTION = gql`
    mutation CreateCatalogCollection($input: CreateCollectionInput!) {
        createCollection(input: $input) {
            id
            name
        }
    }
`;

export const UPDATE_COLLECTION = gql`
    mutation UpdateCatalogCollection($input: UpdateCollectionInput!) {
        updateCollection(input: $input) {
            id
            name
        }
    }
`;

export const DELETE_COLLECTION = gql`
    mutation DeleteCatalogCollection($id: ID!) {
        deleteCollection(id: $id) {
            result
            message
        }
    }
`;

export const CREATE_OPTION_GROUP = gql`
    mutation CreateCatalogOptionGroup($input: CreateProductOptionGroupInput!) {
        createProductOptionGroup(input: $input) {
            id
            name
        }
    }
`;

export const UPDATE_OPTION_GROUP = gql`
    mutation UpdateCatalogOptionGroup($input: UpdateProductOptionGroupInput!) {
        updateProductOptionGroup(input: $input) {
            id
            name
        }
    }
`;

export const DELETE_OPTION_GROUP = gql`
    mutation DeleteCatalogOptionGroup($id: ID!, $force: Boolean) {
        deleteProductOptionGroup(id: $id, force: $force) {
            result
            message
        }
    }
`;

export const CREATE_PRODUCT_OPTION = gql`
    mutation CreateCatalogProductOption($input: CreateProductOptionInput!) {
        createProductOption(input: $input) {
            id
            name
        }
    }
`;

export const UPDATE_PRODUCT_OPTION = gql`
    mutation UpdateCatalogProductOption($input: UpdateProductOptionInput!) {
        updateProductOption(input: $input) {
            id
            name
        }
    }
`;

export const DELETE_PRODUCT_OPTION = gql`
    mutation DeleteCatalogProductOption($id: ID!) {
        deleteProductOption(id: $id) {
            result
            message
        }
    }
`;

export const CREATE_FACET = gql`
    mutation CreateCatalogFacet($input: CreateFacetInput!) {
        createFacet(input: $input) {
            id
            name
        }
    }
`;

export const UPDATE_FACET = gql`
    mutation UpdateCatalogFacet($input: UpdateFacetInput!) {
        updateFacet(input: $input) {
            id
            name
        }
    }
`;

export const DELETE_FACET = gql`
    mutation DeleteCatalogFacet($id: ID!, $force: Boolean) {
        deleteFacet(id: $id, force: $force) {
            result
            message
        }
    }
`;

export const CREATE_FACET_VALUE = gql`
    mutation CreateCatalogFacetValue($input: CreateFacetValueInput!) {
        createFacetValue(input: $input) {
            id
            name
        }
    }
`;

export const UPDATE_FACET_VALUE = gql`
    mutation UpdateCatalogFacetValue($input: UpdateFacetValueInput!) {
        updateFacetValue(input: $input) {
            id
            name
        }
    }
`;

export const DELETE_FACET_VALUE = gql`
    mutation DeleteCatalogFacetValue($ids: [ID!]!, $force: Boolean) {
        deleteFacetValues(ids: $ids, force: $force) {
            result
            message
        }
    }
`;

export const GET_INVENTORY_OVERVIEW = gql`
    query GetInventoryOverview($variantOptions: ProductVariantListOptions) {
        productVariants(options: $variantOptions) {
            items {
                id
                name
                sku
                enabled
                price
                currencyCode
                trackInventory
                outOfStockThreshold
                useGlobalOutOfStockThreshold
                product {
                    id
                    name
                }
                stockLevels {
                    id
                    stockLocationId
                    stockOnHand
                    stockAllocated
                    stockLocation {
                        id
                        name
                        description
                    }
                }
                stockMovements(options: { take: 20 }) {
                    items {
                        ... on StockMovement {
                            id
                            createdAt
                            type
                            quantity
                        }
                    }
                    totalItems
                }
            }
            totalItems
        }
        globalSettings {
            outOfStockThreshold
        }
    }
`;

export const GET_STOCK_LOCATIONS = gql`
    query GetStockLocations($options: StockLocationListOptions) {
        stockLocations(options: $options) {
            items {
                id
                name
                description
            }
            totalItems
        }
    }
`;

export const UPDATE_VARIANT_STOCK = gql`
    mutation UpdateCatalogVariantStock($input: UpdateProductVariantInput!) {
        updateProductVariant(input: $input) {
            id
            stockLevels {
                id
                stockLocationId
                stockOnHand
                stockAllocated
            }
        }
    }
`;

export const CREATE_STOCK_LOCATION = gql`
    mutation CreateCatalogStockLocation($input: CreateStockLocationInput!) {
        createStockLocation(input: $input) {
            id
            name
            description
        }
    }
`;

export const UPDATE_STOCK_LOCATION = gql`
    mutation UpdateCatalogStockLocation($input: UpdateStockLocationInput!) {
        updateStockLocation(input: $input) {
            id
            name
            description
        }
    }
`;

export const DELETE_STOCK_LOCATION = gql`
    mutation DeleteCatalogStockLocation($input: DeleteStockLocationInput!) {
        deleteStockLocation(input: $input) {
            result
            message
        }
    }
`;

export const UPDATE_ASSET = gql`
    mutation UpdateCatalogAsset($input: UpdateAssetInput!) {
        updateAsset(input: $input) {
            id
            name
            tags {
                id
                value
            }
        }
    }
`;

export const DELETE_ASSET = gql`
    mutation DeleteCatalogAsset($input: DeleteAssetInput!) {
        deleteAsset(input: $input) {
            result
            message
        }
    }
`;

export const CREATE_ASSETS_MULTIPART = `
  mutation CreateCatalogAssets($input: [CreateAssetInput!]!) {
    createAssets(input: $input) {
      __typename
      ... on Asset {
        id
        name
        preview
        source
        type
        fileSize
        mimeType
        width
        height
        tags {
          id
          value
        }
      }
      ... on ErrorResult {
        message
      }
    }
  }
`;
