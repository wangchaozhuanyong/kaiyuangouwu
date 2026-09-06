import { gql } from '@apollo/client';

const IMAGE_MODEL_FIELDS = gql`
    fragment NextAdminImageModelFields on ImageStudioModel {
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

const IMAGE_CONFIG_FIELDS = gql`
    ${IMAGE_MODEL_FIELDS}
    fragment NextAdminImageConfigFields on ImageGenerationAdminConfig {
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
        models {
            ...NextAdminImageModelFields
        }
    }
`;

const IMAGE_PROVIDER_FIELDS = gql`
    fragment NextAdminImageProviderFields on ImageProviderAdminConfig {
        scope
        credentialConfigured
        credentialEnabled
        baseUrl
        apiKeyLast4
        textModelId
        providerHealthStatus
        providerHealthMessage
    }
`;

export const IMAGE_PROVIDER_ADMIN_QUERY = gql`
    ${IMAGE_PROVIDER_FIELDS}
    query NextAdminImageProviders {
        imageProviderAdminConfigs {
            ...NextAdminImageProviderFields
        }
    }
`;

export const SAVE_IMAGE_PROVIDER_MUTATION = gql`
    ${IMAGE_PROVIDER_FIELDS}
    mutation NextAdminSaveImageProvider($input: SaveImageProviderCredentialInput!) {
        saveImageProviderCredential(input: $input) {
            ...NextAdminImageProviderFields
        }
    }
`;

export const TEST_IMAGE_PROVIDER_MUTATION = gql`
    mutation NextAdminTestImageProvider($scope: ImageProviderScope!) {
        testImageProviderConnection(scope: $scope) {
            ok
            message
            testedAt
        }
    }
`;

export const IMAGE_GENERATION_ADMIN_QUERY = gql`
    ${IMAGE_CONFIG_FIELDS}
    query NextAdminImageGeneration($skip: Int, $take: Int, $state: ImageGenerationState) {
        activeChannel {
            id
            code
            defaultCurrencyCode
        }
        imageGenerationAdminConfig {
            ...NextAdminImageConfigFields
        }
        imageGenerationJobs(skip: $skip, take: $take, state: $state) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                state
                modelCodeSnapshot
                modelNameSnapshot
                officialModelIdSnapshot
                quantity
                unitPriceSnapshot
                reservedAmount
                capturedAmount
                releasedAmount
                currencyCode
                termsVersion
                errorMessage
                completedAt
                outputs {
                    id
                    outputIndex
                    state
                    attemptCount
                    errorMessage
                    completedAt
                    refundedAt
                }
            }
        }
        imagePromptSkillReleases {
            id
            createdAt
            updatedAt
            bundleVersion
            sourceHash
            status
            activatedAt
        }
    }
`;

export const SAVE_IMAGE_GENERATION_CONFIG_MUTATION = gql`
    ${IMAGE_CONFIG_FIELDS}
    mutation NextAdminSaveImageGenerationConfig($input: SaveImageGenerationConfigInput!) {
        saveImageGenerationConfig(input: $input) {
            ...NextAdminImageConfigFields
        }
    }
`;

export const SAVE_IMAGE_MODEL_MUTATION = gql`
    ${IMAGE_MODEL_FIELDS}
    mutation NextAdminSaveImageModel($input: SaveImageModelInput!) {
        saveImageModel(input: $input) {
            ...NextAdminImageModelFields
        }
    }
`;

export const TEST_IMAGE_MODEL_MUTATION = gql`
    mutation NextAdminTestImageModel($code: String!) {
        testImageModel(code: $code) {
            ok
            message
            testedAt
        }
    }
`;

export const ACTIVATE_IMAGE_SKILL_MUTATION = gql`
    mutation NextAdminActivateImageSkill($id: ID!) {
        activateImagePromptSkillRelease(id: $id) {
            id
            status
            activatedAt
        }
    }
`;

export const RETRY_IMAGE_OUTPUT_MUTATION = gql`
    mutation NextAdminRetryImageOutput($outputId: ID!) {
        retryUnknownImageOutput(outputId: $outputId) {
            id
            state
            attemptCount
        }
    }
`;

export const REFUND_IMAGE_OUTPUT_MUTATION = gql`
    mutation NextAdminRefundImageOutput($outputId: ID!, $reason: String!) {
        refundImageOutput(outputId: $outputId, reason: $reason) {
            id
            state
            refundedAt
        }
    }
`;

export const CONTENT_TRANSLATION_AUDIT_QUERY = gql`
    query NextAdminContentTranslationAudit {
        activeChannel {
            id
            code
            defaultLanguageCode
            availableLanguageCodes
        }
        contentTranslationStaleCount
        contentTranslationAudit {
            configured
            provider
            total
            counts {
                status
                count
            }
            states {
                id
                channelId
                entityType
                entityId
                fieldPath
                sourceLanguageCode
                targetLanguageCode
                status
                origin
                locked
                error
                attempts
                revision
                nextAttemptAt
                lastErrorCode
                updatedAt
            }
        }
    }
`;

export const BACKFILL_CONTENT_TRANSLATIONS_MUTATION = gql`
    mutation NextAdminBackfillContentTranslations($entityType: String, $limit: Int, $offset: Int) {
        backfillCustomerContentTranslations(entityType: $entityType, limit: $limit, offset: $offset) {
            total
            scanned
            queued
            processed
            skipped
            failed
            nextOffset
            hasMore
            skippedRecords
            errors
        }
    }
`;

export const TEST_CONTENT_TRANSLATION_MUTATION = gql`
    mutation NextAdminTestContentTranslation($segments: [ContentTranslationSegmentInput!]!) {
        translateCustomerContent(segments: $segments) {
            configured
            provider
            translations {
                key
                text
            }
        }
    }
`;

export type ImageProviderScope = 'OPENAI' | 'GEMINI';
export type ImageProviderProtocol =
    | 'OPENAI_RESPONSES_IMAGE'
    | 'OPENAI_IMAGES'
    | 'OPENAI_COMPATIBLE_CHAT'
    | 'GEMINI_INTERACTIONS'
    | 'GEMINI_NATIVE'
    | 'GEMINI_NATIVE_STREAM';

export interface ImageProviderRecord {
    scope: ImageProviderScope;
    credentialConfigured: boolean;
    credentialEnabled: boolean;
    baseUrl: string;
    apiKeyLast4: string;
    textModelId: string;
    providerHealthStatus: string;
    providerHealthMessage: string | null;
}

export interface ImageModelRecord {
    id: string;
    code: string;
    enabled: boolean;
    displayNameZh: string;
    displayNameEn: string;
    descriptionZh: string;
    descriptionEn: string;
    officialModelId: string;
    providerModelId: string;
    protocol: ImageProviderProtocol;
    unitPrice: number;
    unitPrice2K: number;
    unitPrice4K: number;
    currencyCode: string;
    position: number;
    isDefault: boolean;
    healthStatus: string;
    healthMessage: string | null;
    lastTestedAt: string | null;
    supportsIdempotency: boolean;
    freeImageEnabled: boolean;
    dailyFreeImageLimit: number;
    dailyFreeImageUnlimited: boolean;
    paidAfterFreeEnabled: boolean;
    dailyGenerationSafetyLimit: number;
}

export interface ImageGenerationConfigRecord {
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
    models: ImageModelRecord[];
}

export interface ImageGenerationOutputRecord {
    id: string;
    outputIndex: number;
    state: string;
    attemptCount: number;
    errorMessage: string | null;
    completedAt: string | null;
    refundedAt: string | null;
}

export interface ImageGenerationJobRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    state: string;
    modelCodeSnapshot: string;
    modelNameSnapshot: string;
    officialModelIdSnapshot: string;
    quantity: number;
    unitPriceSnapshot: number;
    reservedAmount: number;
    capturedAmount: number;
    releasedAmount: number;
    currencyCode: string;
    termsVersion: string;
    errorMessage: string | null;
    completedAt: string | null;
    outputs: ImageGenerationOutputRecord[];
}

export interface ImageGenerationAdminResult {
    activeChannel: { id: string; code: string; defaultCurrencyCode: string };
    imageGenerationAdminConfig: ImageGenerationConfigRecord;
    imageGenerationJobs: { totalItems: number; items: ImageGenerationJobRecord[] };
    imagePromptSkillReleases: Array<{
        id: string;
        createdAt: string;
        updatedAt: string;
        bundleVersion: number;
        sourceHash: string;
        status: string;
        activatedAt: string | null;
    }>;
}

export interface ContentTranslationStateRecord {
    attempts: number;
    revision: number;
    nextAttemptAt: string | null;
    lastErrorCode: string | null;
    id: string;
    channelId: string | null;
    entityType: string;
    entityId: string;
    fieldPath: string;
    sourceLanguageCode: string;
    targetLanguageCode: string;
    status: string;
    origin: string;
    locked: boolean;
    error: string | null;
    updatedAt: string;
}

export interface ContentTranslationAuditResult {
    activeChannel: {
        id: string;
        code: string;
        defaultLanguageCode: string;
        availableLanguageCodes: string[];
    };
    contentTranslationStaleCount: number;
    contentTranslationAudit: {
        configured: boolean;
        provider: string;
        total: number;
        counts: Array<{ status: string; count: number }>;
        states: ContentTranslationStateRecord[];
    };
}

export const RETRY_CONTENT_TRANSLATIONS_MUTATION = gql`
    mutation NextAdminRetryContentTranslations($ids: [ID!]!) {
        retryCustomerContentTranslations(ids: $ids) {
            queued
        }
    }
`;
