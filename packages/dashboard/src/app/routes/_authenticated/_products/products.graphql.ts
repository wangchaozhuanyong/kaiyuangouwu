import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { assetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { parse } from 'graphql';

const productVariantFulfillmentFragment = graphql(`
    fragment ProductVariantFulfillment on ProductVariant {
        id
        sku
        enabled
        price
        currencyCode
        stockLevels {
            stockOnHand
            stockAllocated
        }
        customFields
    }
`);

/**
 * Product variants are nested below Product in these documents. Opt their
 * fragment into runtime custom-field expansion so a configured
 * ProductVariantCustomFields object is never sent as a bare GraphQL field.
 */
export function withProductVariantCustomFields<T extends TypedDocumentNode<any, any>>(document: T): T {
    return addCustomFields(document, {
        includeNestedFragments: ['ProductVariantFulfillment'],
    }) as T;
}

export const productListDocument = graphql(
    `
        query ProductList($options: ProductListOptions) {
            products(options: $options) {
                items {
                    id
                    createdAt
                    updatedAt
                    featuredAsset {
                        id
                        preview
                    }
                    name
                    slug
                    enabled
                    description
                    channels {
                        id
                        code
                        token
                    }
                    variants {
                        ...ProductVariantFulfillment
                    }
                }
                totalItems
            }
        }
    `,
    [productVariantFulfillmentFragment],
);

export const productDetailFragment = graphql(
    `
        fragment ProductDetail on Product {
            id
            createdAt
            updatedAt
            enabled
            name
            slug
            description
            featuredAsset {
                ...Asset
            }
            assets {
                ...Asset
            }
            channels {
                id
                code
                token
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
                translations {
                    languageCode
                    name
                }
                options {
                    id
                    code
                    name
                    translations {
                        languageCode
                        name
                    }
                }
            }
            facetValues {
                id
                name
                code
                facet {
                    id
                    name
                    code
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
            customFields
        }
    `,
    [assetFragment],
);

export const productVariantListDocument = graphql(
    `
        query ProductVariantList($options: ProductVariantListOptions, $productId: ID) {
            productVariants(options: $options, productId: $productId) {
                items {
                    id
                    createdAt
                    updatedAt
                    featuredAsset {
                        ...Asset
                    }
                    name
                    sku
                    enabled
                    currencyCode
                    price
                    priceWithTax
                    stockLevels {
                        stockOnHand
                        stockAllocated
                    }
                }
                totalItems
            }
        }
    `,
    [assetFragment],
);

export const productDetailDocument = graphql(
    `
        query ProductDetail($id: ID!) {
            product(id: $id) {
                ...ProductDetail
                variantList {
                    totalItems
                }
                variants {
                    id
                    ...ProductVariantFulfillment
                }
            }
        }
    `,
    [productDetailFragment, productVariantFulfillmentFragment],
);

export const productDetailWithVariantsDocument = graphql(
    `
        query ProductDetailWithVariants($id: ID!) {
            product(id: $id) {
                id
                createdAt
                updatedAt
                name
                variantList {
                    totalItems
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
                    name
                    sku
                    price
                    stockOnHand
                    trackInventory
                    ...ProductVariantFulfillment
                    currencyCode
                    priceWithTax
                    createdAt
                    updatedAt
                    options {
                        id
                        code
                        name
                        groupId
                    }
                }
            }
        }
    `,
    [productVariantFulfillmentFragment],
);

export const createProductDocument = graphql(`
    mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
        }
    }
`);

export const updateProductDocument = graphql(`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`);

export const saveCatalogProductDocument = parse(`
    mutation SaveCatalogProduct($input: SaveCatalogProductInput!) {
        saveCatalogProduct(input: $input) {
            id
        }
    }
`);

export const catalogProductSummariesDocument = parse(`
    query CatalogProductSummaries($filter: CatalogProductSummaryFilterInput) {
        catalogProductSummaries(filter: $filter) {
            items {
                productId
            }
            totalItems
        }
    }
`);

export const productCollectionHierarchyDocument = graphql(`
    query ProductCollectionHierarchy($options: CollectionListOptions) {
        collections(options: $options) {
            items {
                id
                name
                slug
                position
                children {
                    id
                    name
                    slug
                    position
                }
            }
            totalItems
        }
    }
`);

export const productCollectionAssignmentDetailDocument = graphql(`
    query ProductCollectionAssignmentDetail($id: ID!) {
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
`);

export const updateProductCollectionAssignmentDocument = graphql(`
    mutation UpdateProductCollectionAssignment($input: UpdateCollectionInput!) {
        updateCollection(input: $input) {
            id
        }
    }
`);

export const deleteProductDocument = graphql(`
    mutation DeleteProduct($id: ID!) {
        deleteProduct(id: $id) {
            result
            message
        }
    }
`);

export const deleteProductsDocument = graphql(`
    mutation DeleteProducts($ids: [ID!]!) {
        deleteProducts(ids: $ids) {
            result
            message
        }
    }
`);

export const assignProductsToChannelDocument = graphql(`
    mutation AssignProductsToChannel($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`);

export const allProductIdsDocument = graphql(`
    query AllProductIds($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
            }
            totalItems
        }
    }
`);

export const removeProductsFromChannelDocument = graphql(`
    mutation RemoveProductsFromChannel($input: RemoveProductsFromChannelInput!) {
        removeProductsFromChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`);

export const updateProductsDocument = graphql(`
    mutation UpdateProducts($input: [UpdateProductInput!]!) {
        updateProducts(input: $input) {
            id
            name
            facetValues {
                id
                name
                code
            }
        }
    }
`);

export const getProductsWithFacetValuesByIdsDocument = graphql(`
    query GetProductsWithFacetValuesByIds($ids: [String!]!) {
        products(options: { filter: { id: { in: $ids } } }) {
            items {
                id
                updatedAt
                name
                facetValues {
                    id
                    name
                    code
                    facet {
                        id
                        name
                        code
                    }
                }
            }
        }
    }
`);

export const addOptionGroupToProductDocument = graphql(`
    mutation AddOptionGroupToProduct($productId: ID!, $optionGroupId: ID!, $expectedUpdatedAt: DateTime!) {
        addOptionGroupToProduct(
            productId: $productId
            optionGroupId: $optionGroupId
            expectedUpdatedAt: $expectedUpdatedAt
        ) {
            id
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
        }
    }
`);

export const removeOptionGroupsFromProductDocument = graphql(`
    mutation RemoveOptionGroupsFromProduct(
        $productId: ID!
        $optionGroupIds: [ID!]!
        $expectedUpdatedAt: DateTime!
    ) {
        removeOptionGroupsFromProduct(
            productId: $productId
            optionGroupIds: $optionGroupIds
            expectedUpdatedAt: $expectedUpdatedAt
        ) {
            id
            updatedAt
        }
    }
`);

export const updateProductVariantDocument = graphql(`
    mutation UpdateProductVariant($input: UpdateProductVariantInput!) {
        updateProductVariant(input: $input) {
            id
            name
            options {
                id
                code
                name
                groupId
            }
        }
    }
`);

export const updateProductVariantsDocument = graphql(`
    mutation UpdateProductVariantsForProduct($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
            customFields
            trackInventory
        }
    }
`);

export const deleteProductVariantDocument = graphql(`
    mutation DeleteProductVariant($id: ID!) {
        deleteProductVariant(id: $id) {
            result
            message
        }
    }
`);

export const removeOptionGroupFromProductDocument = graphql(`
    mutation RemoveOptionGroupFromProduct($productId: ID!, $optionGroupId: ID!, $force: Boolean) {
        removeOptionGroupFromProduct(productId: $productId, optionGroupId: $optionGroupId, force: $force) {
            ... on Product {
                __typename
                id
                optionGroups {
                    id
                    code
                    name
                }
            }
            ... on ProductOptionInUseError {
                __typename
                errorCode
                message
            }
        }
    }
`);

export const createProductOptionGroupDocument = graphql(`
    mutation CreateOptionGroups($input: CreateProductOptionGroupInput!) {
        createProductOptionGroup(input: $input) {
            id
            name
            code
            options {
                id
                code
                name
            }
        }
    }
`);

export const createProductOptionGroupForProductDocument = graphql(`
    mutation CreateProductOptionGroupForProduct(
        $productId: ID!
        $expectedUpdatedAt: DateTime!
        $input: CreateProductOptionGroupInput!
    ) {
        createProductOptionGroupForProduct(
            productId: $productId
            expectedUpdatedAt: $expectedUpdatedAt
            input: $input
        ) {
            id
            name
            code
            options {
                id
                code
                name
            }
        }
    }
`);

export const createProductOptionDocument = graphql(`
    mutation CreateProductOption($input: CreateProductOptionInput!) {
        createProductOption(input: $input) {
            id
            code
            name
            groupId
        }
    }
`);

export const createProductVariantsDocument = graphql(`
    mutation CreateProductVariants($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            id
            name
        }
    }
`);

export const reindexDocument = graphql(`
    mutation Reindex {
        reindex {
            id
        }
    }
`);
