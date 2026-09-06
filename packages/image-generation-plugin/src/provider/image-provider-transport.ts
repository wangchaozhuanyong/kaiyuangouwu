import { IMAGE_GENERATION_DELIVERY_TIMEOUT_MS } from '../constants';

import {
    IMAGE_GENERATION_TIMEOUT_MESSAGE,
    MAX_PROVIDER_JSON_BYTES,
    REQUEST_TIMEOUT_MS,
} from './image-provider-constants';
import {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    RetryableImageProviderError,
} from './image-provider-errors';
import { readResponseText, remainingTimeout } from './image-provider-io';
import { ProviderJsonResponse } from './image-provider-response';
import {
    httpFailure,
    responseErrorDetails,
    responseTelemetry,
    safeError,
    withProviderTelemetry,
} from './image-provider-telemetry';

export class ImageProviderTransport {
    requestGenerationJson(
        url: URL,
        apiKey: string,
        body: Record<string, unknown> | FormData,
        idempotencyKey: string,
        extraHeaders: Record<string, string> = {},
    ): Promise<ProviderJsonResponse> {
        return this.requestJson(
            url,
            apiKey,
            body,
            idempotencyKey,
            extraHeaders,
            MAX_PROVIDER_JSON_BYTES,
            IMAGE_GENERATION_DELIVERY_TIMEOUT_MS,
            IMAGE_GENERATION_TIMEOUT_MESSAGE,
        );
    }

    async requestJson(
        url: URL,
        apiKey: string,
        body: Record<string, unknown> | FormData,
        idempotencyKey: string,
        extraHeaders: Record<string, string> = {},
        maxResponseBytes = MAX_PROVIDER_JSON_BYTES,
        timeoutMs = REQUEST_TIMEOUT_MS,
        timeoutMessage = '中转站响应超时',
    ): Promise<ProviderJsonResponse> {
        const isForm = body instanceof FormData;
        const deadline = Date.now() + timeoutMs;
        const response = await this.request(
            url,
            {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    ...this.headers(apiKey),
                    ...(!isForm ? { 'content-type': 'application/json' } : {}),
                    'idempotency-key': idempotencyKey,
                    ...extraHeaders,
                },
                body: isForm ? body : JSON.stringify(body),
            },
            timeoutMs,
            timeoutMessage,
        );
        const details = responseErrorDetails(response);
        let text: string;
        try {
            text = await readResponseText(
                response,
                maxResponseBytes,
                remainingTimeout(deadline),
                timeoutMessage,
            );
        } catch (error) {
            throw withProviderTelemetry(error, details);
        }
        if (response.status === 429) throw new RetryableImageProviderError('中转站限流，请稍后重试', details);
        if (response.status >= 300 && response.status < 400) {
            throw new DefinitiveImageProviderError('中转站重定向已被安全策略拒绝', details);
        }
        if (!response.ok) {
            throw httpFailure(response.status, details);
        }
        try {
            const payload = JSON.parse(text) as unknown;
            return { payload, telemetry: responseTelemetry(response, payload) };
        } catch {
            throw new DefinitiveImageProviderError('中转站返回了无效 JSON', details);
        }
    }

    async request(
        url: URL,
        init: RequestInit,
        timeoutMs = REQUEST_TIMEOUT_MS,
        timeoutMessage = '中转站响应超时',
    ): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, {
                ...init,
                signal: controller.signal,
                redirect: init.redirect ?? 'manual',
            });
        } catch (error) {
            throw new AmbiguousImageProviderError(
                error instanceof Error && error.name === 'AbortError'
                    ? timeoutMessage
                    : `中转站网络错误：${safeError(error)}`,
            );
        } finally {
            clearTimeout(timeout);
        }
    }

    headers(apiKey: string): Record<string, string> {
        return { authorization: `Bearer ${apiKey}`, accept: 'application/json' };
    }
}
