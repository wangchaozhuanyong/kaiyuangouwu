import { gql } from '@apollo/client';

export const GET_PRODUCTS = gql`
    query GetProducts($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                createdAt
                updatedAt
                enabled
                name
                slug
                description
                customFields {
                    fulfillmentType
                    refundPolicy
                    manualDeliverySlaMinutes
                }
                featuredAsset {
                    id
                    preview
                    name
                }
                variants {
                    id
                    name
                    sku
                    price
                    currencyCode
                    stockLevel
                    stockOnHand
                    stockAllocated
                    enabled
                    trackInventory
                    autoCardAvailableStock
                    customFields {
                        fulfillmentType
                        digitalDeliveryMode
                        digitalStockPolicy
                    }
                }
                facetValues {
                    id
                    code
                    name
                    facet {
                        id
                        code
                        name
                    }
                }
                collections {
                    id
                    name
                    slug
                }
            }
            totalItems
        }
    }
`;

export const GET_PRODUCT_DETAIL = gql`
    query GetProductDetail($id: ID!) {
        product(id: $id) {
            id
            createdAt
            updatedAt
            enabled
            name
            slug
            description
            customFields {
                fulfillmentType
                refundPolicy
                manualDeliverySlaMinutes
            }
            featuredAsset {
                id
                preview
                name
            }
            assets {
                id
                preview
                name
                source
            }
            translations {
                id
                languageCode
                name
                slug
                description
            }
            optionGroups {
                id
                code
                name
                options {
                    id
                    code
                    name
                }
            }
            variants {
                id
                createdAt
                updatedAt
                enabled
                name
                sku
                price
                currencyCode
                stockOnHand
                stockAllocated
                stockLevel
                translations {
                    languageCode
                    name
                }
                stockLevels {
                    id
                    stockLocationId
                    stockLocation {
                        id
                        name
                    }
                    stockOnHand
                    stockAllocated
                }
                useGlobalOutOfStockThreshold
                trackInventory
                autoCardAvailableStock
                customFields {
                    fulfillmentType
                    digitalDeliveryMode
                    digitalStockPolicy
                }
                featuredAsset {
                    id
                    preview
                }
                options {
                    id
                    code
                    name
                    groupId
                }
                facetValues {
                    id
                    code
                    name
                    facet {
                        id
                        code
                        name
                    }
                }
            }
            facetValues {
                id
                code
                name
                facet {
                    id
                    code
                    name
                }
            }
            collections {
                id
                name
                slug
                filters {
                    code
                    args {
                        name
                        value
                    }
                }
            }
            channels {
                id
                code
            }
        }
    }
`;

export const CREATE_PRODUCT = gql`
    mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
            name
            slug
            enabled
            createdAt
            updatedAt
        }
    }
`;

export const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            name
            slug
            enabled
            updatedAt
            featuredAsset {
                id
                preview
            }
            facetValues {
                id
                code
                name
            }
        }
    }
`;

export const CREATE_PRODUCT_VARIANTS = gql`
    mutation CreateProductVariants($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            id
            sku
            name
            price
            stockOnHand
            enabled
        }
    }
`;

export const UPDATE_PRODUCT_VARIANTS = gql`
    mutation UpdateProductVariants($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
            sku
            name
            price
            stockOnHand
            enabled
        }
    }
`;

export const DELETE_PRODUCT = gql`
    mutation DeleteProduct($id: ID!) {
        deleteProduct(id: $id) {
            result
            message
        }
    }
`;

export const DELETE_PRODUCT_VARIANT = gql`
    mutation DeleteProductVariant($id: ID!) {
        deleteProductVariant(id: $id) {
            result
            message
        }
    }
`;

export const GET_FACETS = gql`
    query GetFacets($options: FacetListOptions) {
        facets(options: $options) {
            items {
                id
                code
                name
                values {
                    id
                    code
                    name
                }
            }
            totalItems
        }
    }
`;

export const GET_COLLECTIONS = gql`
    query GetCollections($options: CollectionListOptions) {
        collections(options: $options) {
            items {
                id
                name
                slug
                isPrivate
                filters {
                    code
                    args {
                        name
                        value
                    }
                }
            }
            totalItems
        }
    }
`;

export const GET_COLLECTION_ASSIGNMENT_DETAIL = gql`
    query GetCollectionAssignmentDetail($id: ID!) {
        collection(id: $id) {
            id
            filters {
                code
                args {
                    name
                    value
                }
            }
        }
    }
`;

export const UPDATE_COLLECTION_ASSIGNMENT = gql`
    mutation UpdateCollectionAssignment($input: UpdateCollectionInput!) {
        updateCollection(input: $input) {
            id
        }
    }
`;

export const GET_CATALOG_CHANNELS = gql`
    query GetCatalogChannels($options: ChannelListOptions) {
        activeChannel {
            id
            code
            token
            defaultCurrencyCode
        }
        channels(options: $options) {
            items {
                id
                code
                token
                defaultCurrencyCode
            }
            totalItems
        }
    }
`;

export const ASSIGN_PRODUCTS_TO_CHANNEL = gql`
    mutation AssignCatalogProductsToChannel($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`;

export const REMOVE_PRODUCTS_FROM_CHANNEL = gql`
    mutation RemoveCatalogProductsFromChannel($input: RemoveProductsFromChannelInput!) {
        removeProductsFromChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`;

export const GET_ASSETS = gql`
    query GetAssets($options: AssetListOptions) {
        assets(options: $options) {
            items {
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
            totalItems
        }
    }
`;

export const GET_ACTIVE_CHANNEL = gql`
    query GetActiveCatalogChannel {
        activeChannel {
            id
            code
            defaultLanguageCode
            currencyCode
            defaultCurrencyCode
        }
    }
`;

export const GET_OPTION_GROUPS = gql`
    query GetCatalogOptionGroups($options: ProductOptionGroupListOptions) {
        productOptionGroups(options: $options) {
            items {
                id
                name
                code
                productCount
                options {
                    id
                    name
                    code
                }
            }
            totalItems
        }
    }
`;

export const ADD_OPTION_GROUP_TO_PRODUCT = gql`
    mutation AddCatalogOptionGroupToProduct($productId: ID!, $optionGroupId: ID!) {
        addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) {
            id
            updatedAt
        }
    }
`;

export const REMOVE_OPTION_GROUP_FROM_PRODUCT = gql`
    mutation RemoveCatalogOptionGroupFromProduct($productId: ID!, $optionGroupId: ID!) {
        removeOptionGroupFromProduct(productId: $productId, optionGroupId: $optionGroupId, force: false) {
            __typename
            ... on Product {
                id
                updatedAt
            }
            ... on ProductOptionInUseError {
                message
                optionGroupCode
                productVariantCount
            }
        }
    }
`;
