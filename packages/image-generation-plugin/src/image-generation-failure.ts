import {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    LocalImageProcessingError,
    RetryableImageProviderError,
} from './provider/image-provider.client';
import { ImageGenerationFailureCode, ImageGenerationProcessingStage, ProviderTelemetry } from './types';

export interface ImageGenerationFailure {
    code: ImageGenerationFailureCode;
    publicMessage: string;
    rawMessage: string;
    affectsProviderHealth: boolean;
    ambiguous: boolean;
    retryable: boolean;
    telemetry: ProviderTelemetry;
}

export function classifyImageGenerationFailure(
    error: unknown,
    stage?: ImageGenerationProcessingStage | null,
): ImageGenerationFailure {
    const rawMessage = safeDiagnosticMessage(error);
    const telemetry = providerErrorDetails(error);
    const status = telemetry.httpStatus;
    const normalized = rawMessage.toLowerCase();

    if (error instanceof LocalImageProcessingError) {
        return failure(
            'LOCAL_IMAGE_PROCESSING',
            '图片处理失败，本张费用已退回，请稍后重试',
            false,
            false,
            false,
        );
    }
    if (status === 401 || status === 403) {
        return failure('UPSTREAM_AUTH', '生图服务鉴权失败，本张费用已退回，请稍后再试', true, false, true);
    }
    if (status === 429 || error instanceof RetryableImageProviderError) {
        return failure('UPSTREAM_RATE_LIMIT', '生图服务繁忙，系统将稍后重试', true, false, true);
    }
    if (
        normalized.includes('没有可路由') ||
        normalized.includes('没有可用') ||
        normalized.includes('尚未配置') ||
        normalized.includes('凭证不可用')
    ) {
        return failure('CREDENTIAL_UNAVAILABLE', '当前生图服务暂不可用，本张费用已退回', false, false, false);
    }
    if (error instanceof AmbiguousImageProviderError) {
        const code = normalized.includes('超时') ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK';
        return failure(code, '生成结果暂时无法确认，系统正在核对，请勿重复提交', true, true, false);
    }
    if (normalized.includes('25mb') || normalized.includes('超过安全大小')) {
        return failure('IMAGE_TOO_LARGE', '生成图片超过平台大小限制，本张费用已退回', false, false, false);
    }
    if (
        normalized.includes('分辨率') ||
        normalized.includes('尺寸不符') ||
        normalized.includes('未返回原生')
    ) {
        return failure(
            'IMAGE_RESOLUTION_MISMATCH',
            '生成图片尺寸不符合所选规格，本张费用已退回',
            false,
            false,
            false,
        );
    }
    if (stage === 'ASSET_STORED') {
        return failure('SETTLEMENT', '图片已生成，系统正在恢复结算', false, false, false);
    }
    if (typeof status === 'number' && status >= 500) {
        return failure(
            'UPSTREAM_HTTP',
            '生成结果暂时无法确认，系统正在核对，请勿重复提交',
            true,
            true,
            false,
        );
    }
    if (error instanceof DefinitiveImageProviderError) {
        const invalid =
            normalized.includes('无效') || normalized.includes('没有可识别') || normalized.includes('未返回');
        return failure(
            invalid ? 'UPSTREAM_INVALID_RESPONSE' : 'CREDENTIAL_UNAVAILABLE',
            invalid ? '生图服务返回异常，本张费用已退回，请稍后重试' : '当前生图服务暂不可用，本张费用已退回',
            invalid,
            false,
            false,
        );
    }
    if (stage === 'RESPONSE_RECEIVED') {
        return failure('STORAGE', '图片保存失败，本张费用已退回，请稍后重试', false, false, false);
    }
    return failure('UNKNOWN_RESULT', '生图处理失败，本张费用已退回，请稍后重试', false, false, false);

    function failure(
        code: ImageGenerationFailureCode,
        publicMessage: string,
        affectsProviderHealth: boolean,
        ambiguous: boolean,
        retryable: boolean,
    ): ImageGenerationFailure {
        return { code, publicMessage, rawMessage, affectsProviderHealth, ambiguous, retryable, telemetry };
    }
}

export function safeDiagnosticMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function providerErrorDetails(error: unknown): ProviderTelemetry {
    if (!error || typeof error !== 'object' || !('details' in error)) return {};
    const details = error.details;
    return details && typeof details === 'object' ? details : {};
}
