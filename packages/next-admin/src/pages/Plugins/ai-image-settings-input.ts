import type {
    ImageGenerationConfigRecord,
    ImageModelRecord,
    ImageProviderProtocol,
} from '../../graphql/plugins.graphql';
import { omitUnchangedEnglish } from '../../utils/english-edit-intent';

export interface ImageGenerationConfigEdits {
    enabled: boolean;
    promptOptimizationEnabled: boolean;
    defaultModelCode: string;
    termsVersion: string;
    termsZh: string;
    termsEn: string;
}

export interface ImageModelEdits {
    enabled: boolean;
    displayNameZh: string;
    displayNameEn: string;
    descriptionZh: string;
    descriptionEn: string;
    providerModelId: string;
    protocol: ImageProviderProtocol;
    unitPrice: number;
    currencyCode: string;
    position: number;
}

export function buildImageGenerationConfigInput(
    value: ImageGenerationConfigRecord,
    edits: ImageGenerationConfigEdits,
) {
    return {
        ...omitUnchangedEnglish(edits, value),
        promptRateLimitPerMinute: value.promptRateLimitPerMinute,
        promptDailyFreeLimit: value.promptDailyFreeLimit,
        promptDailyFreeUnlimited: value.promptDailyFreeUnlimited,
        paidPromptOptimizationEnabled: value.paidPromptOptimizationEnabled,
        paidPromptOptimizationPrice: value.paidPromptOptimizationPrice,
        paidPromptOptimizationCurrencyCode: value.paidPromptOptimizationCurrencyCode,
    };
}

export function buildImageModelInput(value: ImageModelRecord, edits: ImageModelEdits) {
    return {
        code: value.code,
        ...omitUnchangedEnglish(edits, value),
        unitPrice2K: value.unitPrice2K,
        unitPrice4K: value.unitPrice4K,
        isDefault: value.isDefault,
        supportsIdempotency: value.supportsIdempotency,
        freeImageEnabled: value.freeImageEnabled,
        dailyFreeImageLimit: value.dailyFreeImageLimit,
        dailyFreeImageUnlimited: value.dailyFreeImageUnlimited,
        paidAfterFreeEnabled: value.paidAfterFreeEnabled,
        dailyGenerationSafetyLimit: value.dailyGenerationSafetyLimit,
    };
}
