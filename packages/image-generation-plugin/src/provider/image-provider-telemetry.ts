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
    const headerRequestIdSource = ['x-request-id', 'request-id', 'x-goog-request-id'].find(name =>
        response.headers.get(name)?.trim(),
    );
    const headerRequestId = headerRequestIdSource
        ? response.headers.get(headerRequestIdSource)?.trim().slice(0, 200)
        : undefined;
    return {
        httpStatus: response.status,
        providerRequestId: headerRequestId,
        headerRequestId,
        headerRequestIdSource,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
    };
}

export function responseTelemetry(response: Response, payload: unknown): ProviderTelemetry {
    const details = responseErrorDetails(response);
    // Gemini stream events contain cumulative usage snapshots. Read the last
    // snapshot as a whole; adding frames (or mixing their fields) overcounts.
    const events = Array.isArray(payload) ? [...payload].reverse() : [payload];
    const modelResponseId = events
        .map(
            event =>
                stringAt(event, ['id']) ??
                stringAt(event, ['responseId']) ??
                findStringByKey(event, new Set(['responseId', 'requestId']), value => Boolean(value.trim())),
        )
        .find(Boolean)
        ?.slice(0, 200);
    const usageSource = events
        .map(event => findObjectByKey(event, new Set(['usage', 'usageMetadata', 'billing'])))
        .find(Boolean);
    const usage = usageSource ? sanitizeUsage(usageSource) : undefined;
    const costEvidence = [
        ...['total_cost', 'totalCost', 'cost'].map(key => ({
            field: `usage.${key}`,
            value: numericValue(objectAt(usageSource, [key])),
        })),
        ...['actual_cost', 'actualCost', 'total_cost'].map(key => ({
            field: `response.**.${key}`,
            value: numericValue(findValueByKey(payload, new Set([key]))),
        })),
    ].find(candidate => candidate.value != null);
    const costValue = costEvidence?.value;
    const currency = stringAt(usageSource, ['currency']) ?? stringAt(payload, ['currency']);
    const normalizedCurrency = currency && /^[A-Za-z]{3}$/u.test(currency) ? currency.toUpperCase() : null;
    return {
        ...details,
        providerRequestId: modelResponseId ?? details.providerRequestId,
        modelResponseId,
        // A generic gateway cost field is not a verified user charge. Retain
        // the report for reconciliation without inventing its currency/source.
        ...(costValue != null && costValue >= 0 && costValue <= 2_000
            ? {
                  reportedCostEvidence: {
                      amount: costValue,
                      currency: normalizedCurrency,
                      field: costEvidence?.field ?? 'response',
                  },
              }
            : {}),
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
