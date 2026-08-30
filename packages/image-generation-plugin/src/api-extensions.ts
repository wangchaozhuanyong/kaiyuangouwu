import { gql } from 'graphql-tag';

const commonTypes = gql`
    enum ImageProviderProtocol {
        OPENAI_RESPONSES_IMAGE
        OPENAI_IMAGES
        OPENAI_COMPATIBLE_CHAT
        GEMINI_INTERACTIONS
        GEMINI_NATIVE
        GEMINI_NATIVE_STREAM
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

    type ImageResolutionOption {
        resolution: String!
        unitPrice: Money!
        supportedAspectRatios: [String!]!
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
        unitPrice2K: Money!
        unitPrice4K: Money!
        resolutionOptions: [ImageResolutionOption!]!
        currencyCode: CurrencyCode!
        position: Int!
        isDefault: Boolean!
        healthStatus: String!
        freeImageEnabled: Boolean!
        dailyFreeImageLimit: Int!
        dailyFreeImageUnlimited: Boolean!
        paidAfterFreeEnabled: Boolean!
        dailyGenerationSafetyLimit: Int!
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
        billingMode: String!
        chargeAmount: Money!
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
        resolution: String!
        quantity: Int!
        unitPriceSnapshot: Money!
        reservedAmount: Money!
        expectedChargeAmount: Money!
        freeQuantityReserved: Int!
        freeQuantityCaptured: Int!
        paidQuantityReserved: Int!
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
        optimizerModelId: String
        recommendedModelCode: String!
        recommendationReason: String!
        promptSkillHash: String!
        billingMode: String!
        chargedAmount: Money!
        currencyCode: CurrencyCode!
        inputTokens: Int
        outputTokens: Int
        totalTokens: Int
        actualCostMicrounits: Int
        costCurrency: String
        promptQuota: ImagePromptQuotaStatus!
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
        expectedPrice: Money
        currencyCode: CurrencyCode
        idempotencyKey: String
    }

    input CreateImageGenerationInput {
        modelCode: String!
        prompt: String!
        optimizedPrompt: String
        referenceAssetId: ID
        referenceAssetIds: [ID!]
        referenceMode: ImageReferenceMode
        referenceInstruction: String
        aspectRatio: String!
        resolution: String!
        quantity: Int!
        expectedUnitPrice: Money!
        expectedChargeAmount: Money!
        currencyCode: CurrencyCode!
        idempotencyKey: String!
        termsAccepted: Boolean!
    }

    type ImageQuotaWindowStatus {
        limit: Int!
        unlimited: Boolean!
        reserved: Int!
        consumed: Int!
        remaining: Int!
        windowEndsAt: DateTime!
    }

    type ImagePromptQuotaStatus {
        minute: ImageQuotaWindowStatus!
        daily: ImageQuotaWindowStatus!
        paidEnabled: Boolean!
        paidPrice: Money!
        currencyCode: CurrencyCode!
    }

    type ImageModelQuotaStatus {
        modelCode: String!
        freeImageEnabled: Boolean!
        paidAfterFreeEnabled: Boolean!
        unitPrice: Money!
        currencyCode: CurrencyCode!
        free: ImageQuotaWindowStatus!
        safety: ImageQuotaWindowStatus!
    }

    type ImageStudioWallet {
        availableBalance: Money!
        currencyCode: CurrencyCode!
    }
`;

export const shopApiExtensions = gql`
    ${commonTypes}

    type ImageStudioConfig {
        enabled: Boolean!
        promptOptimizationEnabled: Boolean!
        promptOptimizerModelIds: [String!]!
        promptRateLimitPerMinute: Int!
        promptDailyFreeLimit: Int!
        promptDailyFreeUnlimited: Boolean!
        paidPromptOptimizationEnabled: Boolean!
        paidPromptOptimizationPrice: Money!
        paidPromptOptimizationCurrencyCode: CurrencyCode!
        defaultModelCode: String!
        termsVersion: String!
        termsZh: String!
        termsEn: String!
        outputRetentionDays: Int!
        referenceRetentionHours: Int!
        maxReferenceBytes: Int!
        maxReferencePixels: Int!
        maxQuantity: Int!
        models: [ImageStudioModel!]!
    }

    extend type Query {
        imageStudioConfig: ImageStudioConfig!
        imageStudioBalance: Money!
        imageStudioWallet: ImageStudioWallet!
        imagePromptQuotaStatus: ImagePromptQuotaStatus!
        imageModelQuotaStatus: [ImageModelQuotaStatus!]!
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
        deleteMyImageGenerationJob(id: ID!): Boolean!
    }
`;

export const adminApiExtensions = gql`
    ${commonTypes}

    type ImageGenerationAdminConfig {
        id: ID!
        enabled: Boolean!
        promptOptimizationEnabled: Boolean!
        promptRateLimitPerMinute: Int!
        promptDailyFreeLimit: Int!
        promptDailyFreeUnlimited: Boolean!
        paidPromptOptimizationEnabled: Boolean!
        paidPromptOptimizationPrice: Money!
        paidPromptOptimizationCurrencyCode: CurrencyCode!
        defaultModelCode: String!
        termsVersion: String!
        termsZh: String!
        termsEn: String!
        models: [ImageStudioModel!]!
        credentialEnabled: Boolean!
        activeSkillHash: String!
        skillAutoActivateEnabled: Boolean!
    }

    extend type ImageStudioModel {
        providerModelId: String!
        healthMessage: String
        lastTestedAt: DateTime
        supportsIdempotency: Boolean!
    }

    extend type ImageGenerationJob {
        customer: Customer!
        providerScopeSnapshot: String!
        providerCredentialCodeSnapshot: String!
        providerCredentialNameSnapshot: String!
        providerCredentialLast4Snapshot: String!
        providerSelectionReason: String
    }

    type ImageProviderAdminConfig {
        id: ID!
        code: String!
        name: String!
        purpose: String!
        scope: ImageProviderScope!
        credentialConfigured: Boolean!
        credentialEnabled: Boolean!
        baseUrl: String!
        apiKeyLast4: String!
        textModelId: String!
        providerHealthStatus: String!
        providerHealthMessage: String
        priority: Int!
        weight: Int!
        cooldownUntil: DateTime
        lastUsedAt: DateTime
        modelCodes: [String!]!
    }

    type ImageProviderConnectionResult {
        ok: Boolean!
        message: String!
        testedAt: DateTime!
        actualCostMicrounits: Int
        costCurrency: String
    }

    type ImageComplianceActionResult {
        auditEventId: ID!
        affectedPromptRecords: Int!
        affectedJobs: Int!
    }

    type ImageGenerationCostSummaryItem {
        modelCode: String!
        providerScope: String!
        saleCurrencyCode: String!
        costCurrency: String!
        attempts: Int!
        successes: Int!
        retries: Int!
        failures: Int!
        unknowns: Int!
        missingCostCount: Int!
        grossRevenue: Money!
        actualCost: Float!
        averageLatencyMs: Int!
    }

    type ImageGenerationCostSummary {
        from: DateTime!
        to: DateTime!
        truncated: Boolean!
        items: [ImageGenerationCostSummaryItem!]!
    }

    type ImagePromptSkillRelease implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        bundleVersion: Int!
        sourceHash: String!
        status: String!
        activatedAt: DateTime
        supportedUseCases: [String!]!
        supportedModels: [String!]!
        routingStrategy: String!
    }

    type ImagePromptOptimizationAudit implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        customer: Customer!
        channelId: ID!
        inputPrompt: String!
        optimizedPrompt: String!
        source: String!
        optimizerModelId: String
        promptSkillHash: String!
        recommendedModelCode: String!
        billingMode: String!
        chargedAmount: Money!
        currencyCode: CurrencyCode!
        inputTokens: Int
        outputTokens: Int
        totalTokens: Int
        actualCostMicrounits: Int
        costCurrency: String
        providerRequestId: String
        credentialCodeSnapshot: String!
        credentialNameSnapshot: String!
        credentialLast4Snapshot: String!
        credentialSelectionReason: String
        upstreamCallCount: Int!
        latencyMs: Int!
        errorMessage: String
    }

    type ImagePromptOptimizationAuditList implements PaginatedList {
        items: [ImagePromptOptimizationAudit!]!
        totalItems: Int!
    }

    input ImageAiUsageRecordListInput {
        skip: Int
        take: Int
        recordType: String
        from: DateTime
        to: DateTime
        customer: String
        modelCode: String
        credentialCode: String
        state: String
        billingMode: String
        failuresOnly: Boolean
        missingCostOnly: Boolean
    }

    type ImageAiUsageRecord implements Node {
        id: ID!
        recordType: String!
        createdAt: DateTime!
        customer: Customer!
        channelId: ID!
        modelCode: String!
        credentialCode: String!
        credentialName: String!
        credentialLast4: String!
        state: String!
        billingMode: String!
        freeQuantity: Int!
        paidQuantity: Int!
        chargedAmount: Money!
        refundedAmount: Money!
        currencyCode: CurrencyCode!
        actualCostMicrounits: Int
        costCurrency: String
        missingCost: Boolean!
        errorMessage: String
    }

    type ImageAiUsageRecordList implements PaginatedList {
        items: [ImageAiUsageRecord!]!
        totalItems: Int!
    }

    type ImageAiUsageOutputDetail {
        id: ID!
        state: String!
        billingMode: String!
        chargeAmount: Money!
        providerRequestId: String
        errorMessage: String
        refundedAt: DateTime
    }

    type ImageAiUsageTimelineItem {
        at: DateTime!
        stage: String!
        status: String!
        amount: Int
        currencyCode: String
        costMicrounits: Int
        message: String!
        keyName: String
        keyLast4: String
    }

    type ImageAiUsageRecordDetail {
        record: ImageAiUsageRecord!
        inputPrompt: String!
        outputPrompt: String
        totalTokens: Int
        providerRequestIds: [String!]!
        outputs: [ImageAiUsageOutputDetail!]!
        timeline: [ImageAiUsageTimelineItem!]!
    }

    input SaveImageGenerationConfigInput {
        enabled: Boolean!
        promptOptimizationEnabled: Boolean!
        promptRateLimitPerMinute: Int!
        promptDailyFreeLimit: Int!
        promptDailyFreeUnlimited: Boolean!
        paidPromptOptimizationEnabled: Boolean!
        paidPromptOptimizationPrice: Money!
        paidPromptOptimizationCurrencyCode: CurrencyCode!
        defaultModelCode: String!
        termsVersion: String!
        termsZh: String!
        termsEn: String!
        models: [SaveImageModelInput!]
    }

    input SaveImageProviderCredentialInput {
        id: ID
        scope: ImageProviderScope!
        code: String!
        name: String!
        purpose: String!
        baseUrl: String!
        apiKey: String
        textModelId: String!
        enabled: Boolean!
        priority: Int!
        weight: Int!
        modelCodes: [String!]!
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
        unitPrice2K: Money!
        unitPrice4K: Money!
        currencyCode: CurrencyCode!
        position: Int!
        isDefault: Boolean!
        supportsIdempotency: Boolean!
        freeImageEnabled: Boolean!
        dailyFreeImageLimit: Int!
        dailyFreeImageUnlimited: Boolean!
        paidAfterFreeEnabled: Boolean!
        dailyGenerationSafetyLimit: Int!
    }

    extend type Query {
        imageGenerationAdminConfig: ImageGenerationAdminConfig!
        imageProviderAdminConfigs: [ImageProviderAdminConfig!]!
        imageGenerationJobs(skip: Int, take: Int, state: ImageGenerationState): ImageGenerationJobList!
        imagePromptSkillReleases: [ImagePromptSkillRelease!]!
        imagePromptOptimizationAudit(skip: Int, take: Int): ImagePromptOptimizationAuditList!
        imageAiUsageRecords(input: ImageAiUsageRecordListInput): ImageAiUsageRecordList!
        imageAiUsageRecord(recordType: String!, id: ID!): ImageAiUsageRecordDetail!
        imageGenerationCostSummary(days: Int): ImageGenerationCostSummary!
    }

    extend type Mutation {
        saveImageGenerationConfig(input: SaveImageGenerationConfigInput!): ImageGenerationAdminConfig!
        saveImageProviderCredential(input: SaveImageProviderCredentialInput!): ImageProviderAdminConfig!
        testImageProviderConnection(scope: ImageProviderScope!): ImageProviderConnectionResult!
        testImageProviderCredential(id: ID!): ImageProviderConnectionResult!
        archiveImageProviderCredential(id: ID!): Boolean!
        anonymizeImageGenerationCustomerData(customerId: ID!, reason: String!): ImageComplianceActionResult!
        testImageModel(code: String!): ImageProviderConnectionResult!
        smokeTestImageModel(code: String!): ImageProviderConnectionResult!
        saveImageModel(input: SaveImageModelInput!): ImageStudioModel!
        activateImagePromptSkillRelease(id: ID!): ImagePromptSkillRelease!
        retryUnknownImageOutput(outputId: ID!): ImageGenerationOutput!
        reconcileStaleImageGenerationOutputs: Int!
        refundImageOutput(outputId: ID!, reason: String!): ImageGenerationOutput!
    }
`;
