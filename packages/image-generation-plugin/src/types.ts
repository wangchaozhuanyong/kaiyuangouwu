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

export interface ImageGenerationPluginOptions {
    storageRoot?: string;
    downloadSigningSecret?: string;
    production?: boolean;
}

export interface SaveImageGenerationConfigInput {
    enabled: boolean;
    promptOptimizationEnabled: boolean;
    defaultModelCode: string;
    termsVersion: string;
    termsZh: string;
    termsEn: string;
}

export interface SaveImageProviderCredentialInput {
    scope: ImageProviderScope;
    baseUrl: string;
    apiKey?: string | null;
    textModelId: string;
    enabled: boolean;
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
    currencyCode: CurrencyCode;
    position: number;
    isDefault: boolean;
}

export interface CreateImageGenerationInput {
    modelCode: string;
    prompt: string;
    optimizedPrompt?: string | null;
    referenceAssetId?: ID | null;
    referenceMode?: ImageReferenceMode | null;
    aspectRatio: string;
    quantity: number;
    expectedUnitPrice: number;
    currencyCode: CurrencyCode;
    idempotencyKey: string;
    termsAccepted: boolean;
}

export interface OptimizeImagePromptInput {
    prompt: string;
    referenceMode?: ImageReferenceMode | null;
}

export interface ProviderGenerationInput {
    providerModelId: string;
    prompt: string;
    aspectRatio: string;
    reference?: { bytes: Buffer; mimeType: string };
    idempotencyKey: string;
}

export interface ProviderGenerationResult {
    bytes: Buffer;
    mimeType: string;
    providerRequestId?: string;
    revisedPrompt?: string;
    metadata?: Record<string, any>;
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
