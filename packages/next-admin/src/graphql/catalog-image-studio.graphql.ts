import { gql } from '@apollo/client';

export const CATALOG_IMAGE_STUDIO_CONFIG = gql`
    query CatalogImageStudioConfig {
        catalogImageStudioConfig {
            enabled
            unavailableReason
            defaultModelCode
            defaultModelName
            termsVersion
            termsZh
            maxReferenceBytes
            acceptedMimeTypes
            aspectRatio
            resolution
            quantity
        }
    }
`;

export const CATALOG_IMAGE_GENERATION_JOBS = gql`
    query CatalogImageGenerationJobs($skip: Int, $take: Int) {
        catalogImageGenerationJobs(skip: $skip, take: $take) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                state
                modelNameSnapshot
                productName
                description
                errorMessage
                referenceAsset {
                    id
                    previewUrl
                }
                outputs {
                    id
                    state
                    errorMessage
                    imageUrl
                    catalogAssetId
                    usedAt
                }
            }
        }
    }
`;

export const CREATE_CATALOG_IMAGE_GENERATION = gql`
    mutation CreateCatalogImageGeneration($input: CreateCatalogImageGenerationInput!) {
        createCatalogImageGeneration(input: $input) {
            id
            state
        }
    }
`;

export const USE_CATALOG_IMAGE_OUTPUT = gql`
    mutation UseCatalogImageOutput($outputId: ID!) {
        useCatalogImageOutput(outputId: $outputId) {
            id
            name
            preview
            source
            type
        }
    }
`;

export const UPLOAD_CATALOG_IMAGE_REFERENCE = `
    mutation UploadCatalogImageReference($file: Upload!, $termsAccepted: Boolean!) {
        uploadCatalogImageReference(file: $file, termsAccepted: $termsAccepted) {
            id
            previewUrl
            mimeType
            byteSize
        }
    }
`;
