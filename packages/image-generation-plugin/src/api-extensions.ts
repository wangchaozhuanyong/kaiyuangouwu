import { gql } from 'graphql-tag';

const commonTypes = gql`
    enum ImageProviderProtocol {
        OPENAI_RESPONSES_IMAGE
        OPENAI_IMAGES
        OPENAI_COMPATIBLE_CHAT
        GEMINI_INTERACTIONS
        GEMINI_NATIVE
    }

    enum ImageProviderScope {
        OPENAI
        GEMINI
    }

    enum ImageReferenceMode {
        NONE
        STYLE
        COMPOSITION
        IDENTITY
        PRODUCT
        EDIT
    }

    enum ImageGenerationState {
        QUEUED
        RUNNING
        PARTIAL_SUCCESS
        SUCCEEDED
        FAILED
        UNKNOWN
        CANCELLED
    }

    enum ImageOutputState {
        QUEUED
        RUNNING
        SUCCEEDED
        FAILED
        UNKNOWN
        CANCELLED
    }

    type ImageStudioModel implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        enabled: Boolean!
        displayNameZh: String!
        displayNameEn: String!
        descriptionZh: String!
        descriptionEn: String!
        officialModelId: String!
        protocol: ImageProviderProtocol!
        unitPrice: Money!
        currencyCode: CurrencyCode!
        position: Int!
        isDefault: Boolean!
        healthStatus: String!
    }

    type ImagePrivateAssetView implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        originalName: String!
        mimeType: String!
        byteSize: Int!
        width: Int!
        height: Int!
        expiresAt: DateTime!
        previewUrl: String
    }

    type ImageGenerationOutput implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        outputIndex: Int!
        state: ImageOutputState!
        attemptCount: Int!
        providerRequestId: String
        errorMessage: String
        completedAt: DateTime
        refundedAt: DateTime
        imageUrl: String
        downloadUrl: String
    }

    type ImageGenerationJob implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        state: ImageGenerationState!
        modelCodeSnapshot: String!
        modelNameSnapshot: String!
        officialModelIdSnapshot: String!
        originalPrompt: String!
        finalPrompt: String!
        promptSpec: JSON
        promptSkillHash: String!
        referenceMode: ImageReferenceMode!
        referenceAsset: ImagePrivateAssetView
        aspectRatio: String!
        quantity: Int!
        unitPriceSnapshot: Money!
        reservedAmount: Money!
        capturedAmount: Money!
        releasedAmount: Money!
        currencyCode: CurrencyCode!
        termsVersion: String!
        errorMessage: String
        completedAt: DateTime
        outputs: [ImageGenerationOutput!]!
    }

    type ImageGenerationJobList implements PaginatedList {
        items: [ImageGenerationJob!]!
        totalItems: Int!
    }

    type ImagePromptOptimizationResult {
        originalPrompt: String!
        optimizedPrompt: String!
        promptSpec: JSON!
        source: String!
        recommendedModelCode: String!
        recommendationReason: String!
        promptSkillHash: String!
    }

    type ImageModelRecommendation {
        modelCode: String!
        modelName: String!
        officialModelId: String!
        unitPrice: Money!
        currencyCode: CurrencyCode!
        reason: String!
        promptSkillHash: String!
    }

    input OptimizeImagePromptInput {
        prompt: String!
        referenceMode: ImageReferenceMode
    }

    input CreateImageGenerationInput {
        modelCode: String!
        prompt: String!
        optimizedPrompt: String
        referenceAssetId: ID
        referenceMode: ImageReferenceMode
        aspectRatio: String!
        quantity: Int!
        expectedUnitPrice: Money!
        currencyCode: CurrencyCode!
        idempotencyKey: String!
        termsAccepted: Boolean!
    }
`;

export const shopApiExtensions = gql`
    ${commonTypes}

    type ImageStudioConfig {
        enabled: Boolean!
        promptOptimizationEnabled: Boolean!
        defaultModelCode: String!
        termsVersion: String!
        termsZh: String!
        termsEn: String!
        outputRetentionDays: Int!
        referenceRetentionHours: Int!
        maxReferenceBytes: Int!
        maxReferencePixels: Int!
        maxQuantity: Int!
        resolution: String!
        models: [ImageStudioModel!]!
    }

    extend type Query {
        imageStudioConfig: ImageStudioConfig!
        imageStudioBalance: Money!
        recommendImageModel(input: OptimizeImagePromptInput!): ImageModelRecommendation!
        myImageGenerationJob(id: ID!): ImageGenerationJob!
        myImageGenerationJobs(skip: Int, take: Int): ImageGenerationJobList!
    }

    extend type Mutation {
        optimizeImagePrompt(input: OptimizeImagePromptInput!): ImagePromptOptimizationResult!
        uploadImageReference(file: Upload!, termsAccepted: Boolean!): ImagePrivateAssetView!
        createImageGeneration(input: CreateImageGenerationInput!): ImageGenerationJob!
        cancelQueuedImageGeneration(id: ID!): ImageGenerationJob!
        deleteMyGeneratedImage(outputId: ID!): Boolean!
    }
`;

export const adminApiExtensions = gql`
    ${commonTypes}

    type ImageGenerationAdminConfig {
        id: ID!
        enabled: Boolean!
        promptOptimizationEnabled: Boolean!
        defaultModelCode: String!
        termsVersion: String!
        termsZh: String!
        termsEn: String!
        models: [ImageStudioModel!]!
        credentialEnabled: Boolean!
        activeSkillHash: String!
    }

    extend type ImageStudioModel {
        providerModelId: String!
        healthMessage: String
        lastTestedAt: DateTime
    }

    type ImageProviderAdminConfig {
        scope: ImageProviderScope!
        credentialConfigured: Boolean!
        credentialEnabled: Boolean!
        baseUrl: String!
        apiKeyLast4: String!
        textModelId: String!
        providerHealthStatus: String!
        providerHealthMessage: String
    }

    type ImageProviderConnectionResult {
        ok: Boolean!
        message: String!
        testedAt: DateTime!
    }

    type ImagePromptSkillRelease implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        bundleVersion: Int!
        sourceHash: String!
        status: String!
        activatedAt: DateTime
    }

    input SaveImageGenerationConfigInput {
        enabled: Boolean!
        promptOptimizationEnabled: Boolean!
        defaultModelCode: String!
        termsVersion: String!
        termsZh: String!
        termsEn: String!
        models: [SaveImageModelInput!]
    }

    input SaveImageProviderCredentialInput {
        scope: ImageProviderScope!
        baseUrl: String!
        apiKey: String
        textModelId: String!
        enabled: Boolean!
    }

    input SaveImageModelInput {
        code: String!
        enabled: Boolean!
        displayNameZh: String!
        displayNameEn: String!
        descriptionZh: String!
        descriptionEn: String!
        providerModelId: String!
        protocol: ImageProviderProtocol!
        unitPrice: Money!
        currencyCode: CurrencyCode!
        position: Int!
        isDefault: Boolean!
    }

    extend type Query {
        imageGenerationAdminConfig: ImageGenerationAdminConfig!
        imageProviderAdminConfigs: [ImageProviderAdminConfig!]!
        imageGenerationJobs(skip: Int, take: Int, state: ImageGenerationState): ImageGenerationJobList!
        imagePromptSkillReleases: [ImagePromptSkillRelease!]!
    }

    extend type Mutation {
        saveImageGenerationConfig(input: SaveImageGenerationConfigInput!): ImageGenerationAdminConfig!
        saveImageProviderCredential(input: SaveImageProviderCredentialInput!): ImageProviderAdminConfig!
        testImageProviderConnection(scope: ImageProviderScope!): ImageProviderConnectionResult!
        testImageModel(code: String!): ImageProviderConnectionResult!
        saveImageModel(input: SaveImageModelInput!): ImageStudioModel!
        activateImagePromptSkillRelease(id: ID!): ImagePromptSkillRelease!
        retryUnknownImageOutput(outputId: ID!): ImageGenerationOutput!
        refundImageOutput(outputId: ID!, reason: String!): ImageGenerationOutput!
    }
`;
