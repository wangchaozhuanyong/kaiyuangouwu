import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

export type ImageProviderProtocol =
    | 'OPENAI_RESPONSES_IMAGE'
    | 'OPENAI_IMAGES'
    | 'OPENAI_COMPATIBLE_CHAT'
    | 'GEMINI_INTERACTIONS'
    | 'GEMINI_NATIVE'
    | 'GEMINI_NATIVE_STREAM';
export type ImageProviderScope = 'OPENAI' | 'GEMINI';
export type ImageGenerationState =
    'QUEUED' | 'RUNNING' | 'PARTIAL_SUCCESS' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
export type ImageOutputState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
export type ImageReferenceMode = 'NONE' | 'STYLE' | 'COMPOSITION' | 'IDENTITY' | 'PRODUCT' | 'EDIT';
export type ImageResolution = '1K' | '2K' | '4K';

export interface ImageGenerationPluginOptions {
    storageRoot?: string;
    downloadSigningSecret?: string;
    production?: boolean;
    /**
     * Automatically promotes a newly discovered, build-validated prompt Skill bundle.
     * Existing releases are never promoted merely because an older process restarts.
     */
    autoActivateSkillReleases?: boolean;
}

export interface SaveImageGenerationConfigInput {
    enabled: boolean;
    promptOptimizationEnabled: boolean;
    promptRateLimitPerMinute: number;
    promptDailyFreeLimit: number;
    promptDailyFreeUnlimited: boolean;
    paidPromptOptimizationEnabled: boolean;
    paidPromptOptimizationPrice: number;
    paidPromptOptimizationCurrencyCode: CurrencyCode;
    defaultModelCode: string;
    termsVersion: string;
    termsZh: string;
    termsEn: string;
    models?: SaveImageModelInput[];
}

export interface SaveImageProviderCredentialInput {
    id?: ID | null;
    scope: ImageProviderScope;
    code: string;
    name: string;
    purpose: 'PROMPT' | 'IMAGE' | 'BOTH';
    baseUrl: string;
    apiKey?: string | null;
    textModelId: string;
    enabled: boolean;
    priority: number;
    weight: number;
    modelCodes: string[];
}

export interface SaveImageModelInput {
    code: string;
    enabled: boolean;
    displayNameZh: string;
    displayNameEn: string;
    descriptionZh: string;
    descriptionEn: string;
    providerModelId: string;
    protocol: ImageProviderProtocol;
    unitPrice: number;
    unitPrice2K: number;
    unitPrice4K: number;
    currencyCode: CurrencyCode;
    position: number;
    isDefault: boolean;
    supportsIdempotency: boolean;
    freeImageEnabled: boolean;
    dailyFreeImageLimit: number;
    dailyFreeImageUnlimited: boolean;
    paidAfterFreeEnabled: boolean;
    dailyGenerationSafetyLimit: number;
}

export interface CreateImageGenerationInput {
    modelCode: string;
    prompt: string;
    optimizedPrompt?: string | null;
    referenceAssetId?: ID | null;
    referenceAssetIds?: ID[] | null;
    referenceMode?: ImageReferenceMode | null;
    referenceInstruction?: string | null;
    aspectRatio: string;
    resolution: ImageResolution;
    quantity: number;
    expectedUnitPrice: number;
    expectedChargeAmount: number;
    currencyCode: CurrencyCode;
    idempotencyKey: string;
    termsAccepted: boolean;
}

export interface OptimizeImagePromptInput {
    prompt: string;
    referenceMode?: ImageReferenceMode | null;
    expectedPrice?: number | null;
    currencyCode?: CurrencyCode | null;
    idempotencyKey?: string | null;
}

export interface ImageAiUsageRecordListInput {
    skip?: number | null;
    take?: number | null;
    recordType?: 'PROMPT_OPTIMIZATION' | 'IMAGE_GENERATION' | null;
    from?: Date | string | null;
    to?: Date | string | null;
    customer?: string | null;
    modelCode?: string | null;
    credentialCode?: string | null;
    state?: string | null;
    billingMode?: string | null;
    failuresOnly?: boolean | null;
    missingCostOnly?: boolean | null;
}

export interface ProviderPromptResult {
    text: string;
    telemetry?: ProviderTelemetry;
}

export interface ProviderGenerationInput {
    providerModelId: string;
    prompt: string;
    aspectRatio: string;
    resolution?: ImageResolution;
    reference?: { bytes: Buffer; mimeType: string };
    references?: Array<{ bytes: Buffer; mimeType: string }>;
    idempotencyKey: string;
}

export interface ProviderGenerationResult {
    bytes: Buffer;
    mimeType: string;
    providerRequestId?: string;
    revisedPrompt?: string;
    metadata?: Record<string, any>;
    telemetry?: ProviderTelemetry;
}

export interface ProviderTelemetry {
    httpStatus?: number;
    providerRequestId?: string;
    actualCostMicrounits?: number;
    costCurrency?: string;
    usage?: Record<string, any>;
    retryAfterSeconds?: number;
}

export interface ImagePromptSpec {
    useCase: string;
    subject: string;
    scene: string;
    composition: string;
    lighting: string;
    camera: string;
    style: string;
    colors: string[];
    materials: string[];
    exactText: string[];
    preserve: string[];
    avoid: string[];
    referenceMode: ImageReferenceMode;
}
