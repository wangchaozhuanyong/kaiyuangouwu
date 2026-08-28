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
        currencyCode
        position
        isDefault
        healthStatus
        healthMessage
        lastTestedAt
    }
`;

const configFields = gql`
    ${modelFields}
    fragment ImageStudioAdminConfigFields on ImageGenerationAdminConfig {
        id
        enabled
        promptOptimizationEnabled
        defaultModelCode
        termsVersion
        termsZh
        termsEn
        credentialEnabled
        activeSkillHash
        models {
            ...ImageStudioAdminModelFields
        }
    }
`;

const providerConfigFields = gql`
    fragment ImageProviderAdminConfigFields on ImageProviderAdminConfig {
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

export const imageProviderAdminQuery = gql`
    ${providerConfigFields}
    query ImageProviderAdmin {
        imageProviderAdminConfigs {
            ...ImageProviderAdminConfigFields
        }
    }
`;

export const imageGenerationAdminQuery = gql`
    ${configFields}
    query ImageGenerationAdmin {
        imageGenerationAdminConfig {
            ...ImageStudioAdminConfigFields
        }
        imageGenerationJobs(take: 30) {
            totalItems
            items {
                id
                createdAt
                state
                modelNameSnapshot
                officialModelIdSnapshot
                quantity
                unitPriceSnapshot
                capturedAmount
                releasedAmount
                currencyCode
                outputs {
                    id
                    outputIndex
                    state
                    refundedAt
                    errorMessage
                }
            }
        }
        imagePromptSkillReleases {
            id
            createdAt
            bundleVersion
            sourceHash
            status
            activatedAt
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
    mutation TestImageProvider($scope: ImageProviderScope!) {
        testImageProviderConnection(scope: $scope) {
            ok
            message
            testedAt
        }
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
    currencyCode: string;
    position: number;
    isDefault: boolean;
    healthStatus: string;
    healthMessage?: string | null;
    lastTestedAt?: string | null;
}

export interface ImageAdminConfigRecord {
    id: string;
    enabled: boolean;
    promptOptimizationEnabled: boolean;
    defaultModelCode: string;
    termsVersion: string;
    termsZh: string;
    termsEn: string;
    credentialEnabled: boolean;
    activeSkillHash: string;
    models: ImageAdminModelRecord[];
}

export interface ImageProviderAdminConfigRecord {
    scope: 'OPENAI' | 'GEMINI';
    credentialConfigured: boolean;
    credentialEnabled: boolean;
    baseUrl: string;
    apiKeyLast4: string;
    textModelId: string;
    providerHealthStatus: string;
    providerHealthMessage?: string | null;
}

export interface ImageAdminJobRecord {
    id: string;
    createdAt: string;
    state: string;
    modelNameSnapshot: string;
    officialModelIdSnapshot: string;
    quantity: number;
    unitPriceSnapshot: number;
    capturedAmount: number;
    releasedAmount: number;
    currencyCode: string;
    outputs: Array<{
        id: string;
        outputIndex: number;
        state: string;
        refundedAt?: string | null;
        errorMessage?: string | null;
    }>;
}

export interface ImageAdminQueryResult {
    imageGenerationAdminConfig: ImageAdminConfigRecord;
    imageGenerationJobs: { items: ImageAdminJobRecord[]; totalItems: number };
    imagePromptSkillReleases: Array<{
        id: string;
        createdAt: string;
        bundleVersion: number;
        sourceHash: string;
        status: string;
        activatedAt?: string | null;
    }>;
}

export interface ImageProviderAdminQueryResult {
    imageProviderAdminConfigs: ImageProviderAdminConfigRecord[];
}
