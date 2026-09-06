import { ProviderTelemetry } from '../types';

import {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    ImageProviderError,
    ImageProviderErrorDetails,
    LocalImageProcessingError,
    RetryableImageProviderError,
} from './image-provider-errors';
import { findStringByKey, objectAt, stringAt } from './image-provider-response';
export function safeError(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

export function httpFailure(status: number, details: ImageProviderErrorDetails): ImageProviderError {
    const message = `中转站返回 HTTP ${status}`;
    if ([408, 425, 500, 502, 503, 504].includes(status)) {
        return new AmbiguousImageProviderError(`${message}，结果暂时无法确认`, details);
    }
    return new DefinitiveImageProviderError(message, details);
}

export function withProviderTelemetry(error: unknown, telemetry: ProviderTelemetry): ImageProviderError {
    const message = safeError(error);
    if (error instanceof LocalImageProcessingError) {
        return new LocalImageProcessingError(
            message,
            { ...telemetry, ...error.details },
            error.sourceErrorName,
        );
    }
    if (error instanceof RetryableImageProviderError) {
        return new RetryableImageProviderError(message, { ...telemetry, ...error.details });
    }
    if (error instanceof AmbiguousImageProviderError) {
        return new AmbiguousImageProviderError(message, { ...telemetry, ...error.details });
    }
    if (error instanceof DefinitiveImageProviderError) {
        return new DefinitiveImageProviderError(message, { ...telemetry, ...error.details });
    }
    return new DefinitiveImageProviderError(message, telemetry);
}

export function withImageProcessingTelemetry(
    error: unknown,
    telemetry: ProviderTelemetry,
): ImageProviderError {
    if (error instanceof ImageProviderError) return withProviderTelemetry(error, telemetry);
    return new LocalImageProcessingError(
        '中转站返回的图片无法解析',
        telemetry,
        error instanceof Error ? error.name.slice(0, 100) : typeof error,
    );
}

export function responseErrorDetails(response: Response): ImageProviderErrorDetails {
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
        httpStatus: response.status,
        providerRequestId:
            response.headers.get('x-request-id') ??
            response.headers.get('request-id') ??
            response.headers.get('x-goog-request-id') ??
            undefined,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
    };
}

export function responseTelemetry(response: Response, payload: unknown): ProviderTelemetry {
    const headerRequestId = responseErrorDetails(response).providerRequestId;
    const providerRequestId =
        stringAt(payload, ['id']) ??
        stringAt(payload, ['responseId']) ??
        findStringByKey(payload, new Set(['responseId', 'requestId']), value => Boolean(value.trim())) ??
        headerRequestId;
    const usageSource = findObjectByKey(payload, new Set(['usage', 'usageMetadata', 'billing'])) ?? undefined;
    const usage = usageSource ? sanitizeUsage(usageSource) : undefined;
    const costValue =
        numericValue(objectAt(usageSource, ['total_cost'])) ??
        numericValue(objectAt(usageSource, ['totalCost'])) ??
        numericValue(objectAt(usageSource, ['cost'])) ??
        numericValue(findValueByKey(payload, new Set(['actual_cost', 'actualCost', 'total_cost'])));
    const currency =
        stringAt(usageSource, ['currency']) ??
        stringAt(payload, ['currency']) ??
        (costValue == null ? undefined : 'USD');
    return {
        httpStatus: response.status,
        providerRequestId,
        ...(costValue != null && costValue >= 0 && costValue <= 2_000
            ? { actualCostMicrounits: Math.round(costValue * 1_000_000) }
            : {}),
        ...(currency && /^[A-Za-z]{3}$/u.test(currency) ? { costCurrency: currency.toUpperCase() } : {}),
        ...(usage && Object.keys(usage).length ? { usage } : {}),
    };
}

export function numericValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
}

export function findObjectByKey(
    value: unknown,
    keys: Set<string>,
    depth = 0,
): Record<string, unknown> | undefined {
    if (depth > 6 || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key) && child && typeof child === 'object' && !Array.isArray(child)) {
            return child as Record<string, unknown>;
        }
        const nested = findObjectByKey(child, keys, depth + 1);
        if (nested) return nested;
    }
}

export function findValueByKey(value: unknown, keys: Set<string>, depth = 0): unknown {
    if (depth > 6 || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key)) return child;
        const nested = findValueByKey(child, keys, depth + 1);
        if (nested !== undefined) return nested;
    }
}

export function sanitizeUsage(value: Record<string, unknown>, depth = 0): Record<string, any> {
    if (depth > 4) return {};
    const entries = Object.entries(value).slice(0, 40);
    const sanitized: Record<string, any> = {};
    for (const [key, child] of entries) {
        if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(key)) continue;
        if (typeof child === 'number' || typeof child === 'boolean' || child == null) {
            sanitized[key] = child;
        } else if (Array.isArray(child)) {
            sanitized[key] = child.slice(0, 20).filter(item => ['number', 'boolean'].includes(typeof item));
        } else if (typeof child === 'object') {
            sanitized[key] = sanitizeUsage(child as Record<string, unknown>, depth + 1);
        }
    }
    return sanitized;
}

export function safeProviderMetadata(
    providerRequestId: string | undefined,
    revisedPrompt: string | undefined,
    mimeType: string,
    delivery: 'inline' | 'remote-url',
): Record<string, string> {
    return {
        delivery,
        mimeType: mimeType.slice(0, 64),
        ...(providerRequestId ? { providerRequestId: providerRequestId.slice(0, 200) } : {}),
        ...(revisedPrompt ? { revisedPrompt: revisedPrompt.slice(0, 2_000) } : {}),
    };
}
