import { gql } from 'graphql-tag';

const modelFields = gql`
    fragment ImageStudioAdminModelFields on ImageStudioModel {
        id
        code
        enabled
        displayNameZh
        displayNameEn
        descriptionZh
        descriptionEn
        officialModelId
        providerModelId
        protocol
        unitPrice
        unitPrice2K
        unitPrice4K
        resolutionOptions {
            resolution
            unitPrice
            supportedAspectRatios
        }
        currencyCode
        position
        isDefault
        healthStatus
        healthMessage
        lastTestedAt
        supportsIdempotency
        freeImageEnabled
        dailyFreeImageLimit
        dailyFreeImageUnlimited
        paidAfterFreeEnabled
        dailyGenerationSafetyLimit
    }
`;

const configFields = gql`
    ${modelFields}
    fragment ImageStudioAdminConfigFields on ImageGenerationAdminConfig {
        id
        enabled
        promptOptimizationEnabled
        promptRateLimitPerMinute
        promptDailyFreeLimit
        promptDailyFreeUnlimited
        paidPromptOptimizationEnabled
        paidPromptOptimizationPrice
        paidPromptOptimizationCurrencyCode
        defaultModelCode
        termsVersion
        termsZh
        termsEn
        credentialEnabled
        activeSkillHash
        skillAutoActivateEnabled
        models {
            ...ImageStudioAdminModelFields
        }
    }
`;

const providerConfigFields = gql`
    fragment ImageProviderAdminConfigFields on ImageProviderAdminConfig {
        id
        code
        name
        purpose
        scope
        credentialConfigured
        credentialEnabled
        baseUrl
        apiKeyLast4
        textModelId
        providerHealthStatus
        providerHealthMessage
        providerRuntimeStatus
        lastRuntimeOutcome
        lastRuntimeAt
        recentAttempts
        recentSuccessRate
        priority
        weight
        cooldownUntil
        lastUsedAt
        modelCodes
    }
`;

export const imageProviderAdminQuery = gql`
    ${providerConfigFields}
    query ImageProviderAdmin {
        imageProviderAdminConfigs {
            ...ImageProviderAdminConfigFields
        }
        imageGenerationAdminConfig {
            models {
                code
                displayNameZh
            }
        }
    }
`;

export const imageGenerationAdminQuery = gql`
    ${configFields}
    query ImageGenerationAdmin {
        imageGenerationAdminConfig {
            ...ImageStudioAdminConfigFields
        }
    }
`;

export const imageGenerationOperationsQuery = gql`
    query ImageGenerationOperations(
        $includeJobs: Boolean!
        $includeCosts: Boolean!
        $includeSkills: Boolean!
        $includePromptAudit: Boolean!
        $jobSkip: Int
        $jobTake: Int
        $jobState: ImageGenerationState
    ) {
        imageGenerationJobs(skip: $jobSkip, take: $jobTake, state: $jobState) @include(if: $includeJobs) {
            totalItems
            items {
                id
                createdAt
                state
                modelNameSnapshot
                officialModelIdSnapshot
                resolution
                providerScopeSnapshot
                providerCredentialCodeSnapshot
                providerCredentialNameSnapshot
                providerCredentialLast4Snapshot
                providerSelectionReason
                originalPrompt
                finalPrompt
                expectedChargeAmount
                freeQuantityReserved
                freeQuantityCaptured
                paidQuantityReserved
                customer {
                    id
                    firstName
                    lastName
                    emailAddress
                }
                quantity
                unitPriceSnapshot
                capturedAmount
                releasedAmount
                currencyCode
                outputs {
                    id
                    outputIndex
                    state
                    billingMode
                    chargeAmount
                    providerRequestId
                    refundedAt
                    errorMessage
                    failureCode
                }
            }
        }
        imageGenerationCostSummary(days: 30) @include(if: $includeCosts) {
            from
            to
            truncated
            items {
                modelCode
                providerScope
                saleCurrencyCode
                costCurrency
                attempts
                successes
                retries
                failures
                unknowns
                missingCostCount
                grossRevenue
                actualCost
                averageLatencyMs
            }
        }
        imageGenerationReliabilitySummary @include(if: $includeCosts) {
            workerStatus
            workerHeartbeatAt
            workerStale
            lastReconcileAt
            oldestQueuedAt
            queuedOutputs
            activeOutputs
            attempts24h
            successes24h
            failures24h
            unknowns24h
            successRate
            unknownRate
            missingCostCount
            missingCostRate
            failureBuckets {
                code
                count
            }
            keyRedundancy {
                scope
                healthyKeyCount
                warning
            }
        }
        imagePromptSkillReleases @include(if: $includeSkills) {
            id
            createdAt
            bundleVersion
            sourceHash
            status
            activatedAt
            supportedUseCases
            supportedModels
            routingStrategy
        }
        imagePromptOptimizationAudit(take: 30) @include(if: $includePromptAudit) {
            totalItems
            items {
                id
                createdAt
                channelId
                inputPrompt
                optimizedPrompt
                source
                optimizerModelId
                recommendedModelCode
                billingMode
                chargedAmount
                currencyCode
                inputTokens
                outputTokens
                totalTokens
                actualCostMicrounits
                costCurrency
                providerRequestId
                credentialCodeSnapshot
                credentialNameSnapshot
                credentialLast4Snapshot
                credentialSelectionReason
                upstreamCallCount
                latencyMs
                errorMessage
                customer {
                    id
                    firstName
                    lastName
                    emailAddress
                }
            }
        }
    }
`;

const usageRecordFields = gql`
    fragment ImageAiUsageRecordFields on ImageAiUsageRecord {
        id
        recordType
        createdAt
        channelId
        modelCode
        credentialCode
        credentialName
        credentialLast4
        state
        billingMode
        freeQuantity
        paidQuantity
        chargedAmount
        refundedAmount
        currencyCode
        actualCostMicrounits
        costCurrency
        missingCost
        errorMessage
        customer {
            id
            firstName
            lastName
            emailAddress
        }
    }
`;

export const imageAiUsageRecordsQuery = gql`
    ${usageRecordFields}
    query ImageAiUsageRecords($input: ImageAiUsageRecordListInput) {
        imageAiUsageRecords(input: $input) {
            totalItems
            items {
                ...ImageAiUsageRecordFields
            }
        }
    }
`;

export const imageAiUsageRecordDetailQuery = gql`
    ${usageRecordFields}
    query ImageAiUsageRecordDetail($recordType: String!, $id: ID!) {
        imageAiUsageRecord(recordType: $recordType, id: $id) {
            record {
                ...ImageAiUsageRecordFields
            }
            inputPrompt
            outputPrompt
            totalTokens
            providerRequestIds
            outputs {
                id
                state
                billingMode
                chargeAmount
                providerRequestId
                errorMessage
                refundedAt
            }
            timeline {
                at
                stage
                status
                amount
                currencyCode
                costMicrounits
                message
                keyName
                keyLast4
            }
        }
    }
`;

export const saveImageGenerationConfigMutation = gql`
    ${configFields}
    mutation SaveImageGenerationConfig($input: SaveImageGenerationConfigInput!) {
        saveImageGenerationConfig(input: $input) {
            ...ImageStudioAdminConfigFields
        }
    }
`;

export const saveImageModelMutation = gql`
    ${modelFields}
    mutation SaveImageModel($input: SaveImageModelInput!) {
        saveImageModel(input: $input) {
            ...ImageStudioAdminModelFields
        }
    }
`;

export const saveImageCredentialMutation = gql`
    ${providerConfigFields}
    mutation SaveImageCredential($input: SaveImageProviderCredentialInput!) {
        saveImageProviderCredential(input: $input) {
            ...ImageProviderAdminConfigFields
        }
    }
`;

export const testImageProviderMutation = gql`
    mutation TestImageProvider($id: ID!, $enableOnSuccess: Boolean) {
        testImageProviderCredential(id: $id, enableOnSuccess: $enableOnSuccess) {
            ok
            message
            testedAt
        }
    }
`;

export const archiveImageProviderMutation = gql`
    mutation ArchiveImageProvider($id: ID!) {
        archiveImageProviderCredential(id: $id)
    }
`;

export const testImageModelMutation = gql`
    mutation TestImageModel($code: String!) {
        testImageModel(code: $code) {
            ok
            message
            testedAt
        }
    }
`;

export const smokeTestImageModelMutation = gql`
    mutation SmokeTestImageModel($code: String!) {
        smokeTestImageModel(code: $code) {
            ok
            message
            testedAt
            actualCostMicrounits
            costCurrency
        }
    }
`;

export const activateImageSkillMutation = gql`
    mutation ActivateImageSkill($id: ID!) {
        activateImagePromptSkillRelease(id: $id) {
            id
            status
            activatedAt
        }
    }
`;

export const retryImageOutputMutation = gql`
    mutation RetryImageOutput($outputId: ID!) {
        retryUnknownImageOutput(outputId: $outputId) {
            id
            state
        }
    }
`;

export const reconcileStaleImageOutputsMutation = gql`
    mutation ReconcileStaleImageOutputs {
        reconcileStaleImageGenerationOutputs
    }
`;

export const refundImageOutputMutation = gql`
    mutation RefundImageOutput($outputId: ID!, $reason: String!) {
        refundImageOutput(outputId: $outputId, reason: $reason) {
            id
            state
            refundedAt
        }
    }
`;

export interface ImageAdminModelRecord {
    id: string;
    code: string;
    enabled: boolean;
    displayNameZh: string;
    displayNameEn: string;
    descriptionZh: string;
    descriptionEn: string;
    officialModelId: string;
    providerModelId: string;
    protocol:
        | 'OPENAI_RESPONSES_IMAGE'
        | 'OPENAI_IMAGES'
        | 'OPENAI_COMPATIBLE_CHAT'
        | 'GEMINI_INTERACTIONS'
        | 'GEMINI_NATIVE'
        | 'GEMINI_NATIVE_STREAM';
    unitPrice: number;
    unitPrice2K: number;
    unitPrice4K: number;
    resolutionOptions: Array<{
        resolution: '1K' | '2K' | '4K';
        unitPrice: number;
        supportedAspectRatios: string[];
    }>;
    currencyCode: string;
    position: number;
    isDefault: boolean;
    healthStatus: string;
    healthMessage?: string | null;
    lastTestedAt?: string | null;
    supportsIdempotency: boolean;
    freeImageEnabled: boolean;
    dailyFreeImageLimit: number;
    dailyFreeImageUnlimited: boolean;
    paidAfterFreeEnabled: boolean;
    dailyGenerationSafetyLimit: number;
}

export interface ImageAdminConfigRecord {
    id: string;
    enabled: boolean;
    promptOptimizationEnabled: boolean;
    promptRateLimitPerMinute: number;
    promptDailyFreeLimit: number;
    promptDailyFreeUnlimited: boolean;
    paidPromptOptimizationEnabled: boolean;
    paidPromptOptimizationPrice: number;
    paidPromptOptimizationCurrencyCode: string;
    defaultModelCode: string;
    termsVersion: string;
    termsZh: string;
    termsEn: string;
    credentialEnabled: boolean;
    activeSkillHash: string;
    skillAutoActivateEnabled: boolean;
    models: ImageAdminModelRecord[];
}

export interface ImageProviderAdminConfigRecord {
    id: string;
    code: string;
    name: string;
    purpose: 'PROMPT' | 'IMAGE' | 'BOTH';
    scope: 'OPENAI' | 'GEMINI';
    credentialConfigured: boolean;
    credentialEnabled: boolean;
    baseUrl: string;
    apiKeyLast4: string;
    textModelId: string;
    providerHealthStatus: string;
    providerHealthMessage?: string | null;
    providerRuntimeStatus?: string;
    lastRuntimeOutcome?: string | null;
    lastRuntimeAt?: string | null;
    recentAttempts?: number;
    recentSuccessRate?: number;
    priority: number;
    weight: number;
    cooldownUntil?: string | null;
    lastUsedAt?: string | null;
    modelCodes: string[];
}

export interface ImageAdminJobRecord {
    id: string;
    createdAt: string;
    state: string;
    modelNameSnapshot: string;
    officialModelIdSnapshot: string;
    resolution: '1K' | '2K' | '4K';
    providerScopeSnapshot: string;
    providerCredentialCodeSnapshot: string;
    providerCredentialNameSnapshot: string;
    providerCredentialLast4Snapshot: string;
    providerSelectionReason?: string | null;
    originalPrompt: string;
    finalPrompt: string;
    expectedChargeAmount: number;
    freeQuantityReserved: number;
    freeQuantityCaptured: number;
    paidQuantityReserved: number;
    customer: { id: string; firstName: string; lastName: string; emailAddress: string };
    quantity: number;
    unitPriceSnapshot: number;
    capturedAmount: number;
    releasedAmount: number;
    currencyCode: string;
    outputs: Array<{
        id: string;
        outputIndex: number;
        state: string;
        billingMode: string;
        chargeAmount: number;
        providerRequestId?: string | null;
        refundedAt?: string | null;
        errorMessage?: string | null;
        failureCode?: string | null;
    }>;
}

export interface ImageAiUsageRecord {
    id: string;
    recordType: 'PROMPT_OPTIMIZATION' | 'IMAGE_GENERATION';
    createdAt: string;
    channelId: string;
    modelCode: string;
    credentialCode: string;
    credentialName: string;
    credentialLast4: string;
    state: string;
    billingMode: string;
    freeQuantity: number;
    paidQuantity: number;
    chargedAmount: number;
    refundedAmount: number;
    currencyCode: string;
    actualCostMicrounits?: number | null;
    costCurrency?: string | null;
    missingCost: boolean;
    errorMessage?: string | null;
    customer: { id: string; firstName: string; lastName: string; emailAddress: string };
}

export interface ImageAiUsageRecordsQueryResult {
    imageAiUsageRecords: { items: ImageAiUsageRecord[]; totalItems: number };
}

export interface ImageAiUsageRecordDetailQueryResult {
    imageAiUsageRecord: {
        record: ImageAiUsageRecord;
        inputPrompt: string;
        outputPrompt?: string | null;
        totalTokens?: number | null;
        providerRequestIds: string[];
        outputs: Array<{
            id: string;
            state: string;
            billingMode: string;
            chargeAmount: number;
            providerRequestId?: string | null;
            errorMessage?: string | null;
            refundedAt?: string | null;
        }>;
        timeline: Array<{
            at: string;
            stage: string;
            status: string;
            amount?: number | null;
            currencyCode?: string | null;
            costMicrounits?: number | null;
            message: string;
            keyName?: string | null;
            keyLast4?: string | null;
        }>;
    };
}

export interface ImageAdminQueryResult {
    imageGenerationAdminConfig: ImageAdminConfigRecord;
}

export interface ImageAdminOperationsQueryResult {
    imageGenerationJobs?: { items: ImageAdminJobRecord[]; totalItems: number };
    imageGenerationCostSummary?: {
        from: string;
        to: string;
        truncated: boolean;
        items: Array<{
            modelCode: string;
            providerScope: string;
            saleCurrencyCode: string;
            costCurrency: string;
            attempts: number;
            successes: number;
            retries: number;
            failures: number;
            unknowns: number;
            missingCostCount: number;
            grossRevenue: number;
            actualCost: number;
            averageLatencyMs: number;
        }>;
    };
    imageGenerationReliabilitySummary?: {
        workerStatus: string;
        workerHeartbeatAt?: string | null;
        workerStale: boolean;
        lastReconcileAt?: string | null;
        oldestQueuedAt?: string | null;
        queuedOutputs: number;
        activeOutputs: number;
        attempts24h: number;
        successes24h: number;
        failures24h: number;
        unknowns24h: number;
        successRate: number;
        unknownRate: number;
        missingCostCount: number;
        missingCostRate: number;
        failureBuckets: Array<{ code: string; count: number }>;
        keyRedundancy: Array<{ scope: string; healthyKeyCount: number; warning?: string | null }>;
    };
    imagePromptSkillReleases?: Array<{
        id: string;
        createdAt: string;
        bundleVersion: number;
        sourceHash: string;
        status: string;
        activatedAt?: string | null;
        supportedUseCases: string[];
        supportedModels: string[];
        routingStrategy: string;
    }>;
    imagePromptOptimizationAudit?: {
        totalItems: number;
        items: Array<{
            id: string;
            createdAt: string;
            channelId: string;
            inputPrompt: string;
            optimizedPrompt: string;
            source: string;
            optimizerModelId?: string | null;
            recommendedModelCode: string;
            billingMode: string;
            chargedAmount: number;
            currencyCode: string;
            inputTokens?: number | null;
            outputTokens?: number | null;
            totalTokens?: number | null;
            actualCostMicrounits?: number | null;
            costCurrency?: string | null;
            providerRequestId?: string | null;
            credentialCodeSnapshot: string;
            credentialNameSnapshot: string;
            credentialLast4Snapshot: string;
            credentialSelectionReason?: string | null;
            upstreamCallCount: number;
            latencyMs: number;
            errorMessage?: string | null;
            customer: { id: string; firstName: string; lastName: string; emailAddress: string };
        }>;
    };
}

export interface ImageProviderAdminQueryResult {
    imageProviderAdminConfigs: ImageProviderAdminConfigRecord[];
    imageGenerationAdminConfig: { models: Array<{ code: string; displayNameZh: string }> };
}
