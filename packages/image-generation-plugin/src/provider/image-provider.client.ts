import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { ImageProviderCredential } from '../entities/image-provider-credential.entity';
import { ImageProviderCipherService } from '../security/image-provider-cipher.service';
import { SafeProviderUrlService } from '../security/safe-provider-url.service';
import {
    ImageProviderProtocol,
    ProviderGenerationInput,
    ProviderGenerationResult,
    ProviderTelemetry,
} from '../types';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_PROVIDER_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PROVIDER_JSON_BYTES = 40 * 1024 * 1024;
const MAX_PROMPT_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODEL_RESPONSE_BYTES = 1024 * 1024;

export type ImageProviderErrorDetails = ProviderTelemetry;

class ImageProviderError extends Error {
    constructor(
        message: string,
        readonly details: ImageProviderErrorDetails = {},
    ) {
        super(message);
    }
}

export class RetryableImageProviderError extends ImageProviderError {}
export class AmbiguousImageProviderError extends ImageProviderError {}
export class DefinitiveImageProviderError extends ImageProviderError {}

interface ProviderJsonResponse {
    payload: unknown;
    telemetry: ProviderTelemetry;
}

@Injectable()
export class ImageProviderClient {
    constructor(
        private readonly cipher: ImageProviderCipherService,
        private readonly safeUrls: SafeProviderUrlService,
    ) {}

    async generate(
        credential: ImageProviderCredential,
        protocol: ImageProviderProtocol,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        if (!credential.enabled) throw new DefinitiveImageProviderError('平台生图中转站尚未启用');
        const baseUrl = await this.safeUrls.validate(credential.baseUrl);
        const apiKey = this.cipher.decrypt(credential.encryptedApiKey);
        if (protocol === 'OPENAI_RESPONSES_IMAGE') {
            return this.openAiResponsesImage(baseUrl, apiKey, credential.textModelId, input);
        }
        if (protocol === 'OPENAI_IMAGES') return this.openAiImages(baseUrl, apiKey, input);
        if (protocol === 'OPENAI_COMPATIBLE_CHAT') return this.openAiChat(baseUrl, apiKey, input);
        if (protocol === 'GEMINI_INTERACTIONS') return this.geminiInteractions(baseUrl, apiKey, input);
        if (protocol === 'GEMINI_NATIVE') return this.geminiNative(baseUrl, apiKey, input);
        if (protocol === 'GEMINI_NATIVE_STREAM') return this.geminiNativeStream(baseUrl, apiKey, input);
        throw new DefinitiveImageProviderError('不支持的生图协议');
    }

    async optimizePrompt(
        credential: ImageProviderCredential,
        systemPrompt: string,
        userPrompt: string,
    ): Promise<string> {
        if (!credential.enabled || !credential.textModelId.trim()) {
            throw new DefinitiveImageProviderError('提示词优化模型尚未配置');
        }
        const baseUrl = await this.safeUrls.validate(credential.baseUrl);
        const { payload: response } = await this.requestJson(
            this.safeUrls.endpoint(baseUrl, 'chat/completions'),
            this.cipher.decrypt(credential.encryptedApiKey),
            {
                model: credential.textModelId,
                temperature: 0.2,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            },
            `prompt-${randomUUID()}`,
            {},
            MAX_PROMPT_RESPONSE_BYTES,
        );
        const content = objectAt(response, ['choices', 0, 'message', 'content']);
        if (typeof content !== 'string' || !content.trim()) {
            throw new DefinitiveImageProviderError('提示词优化模型未返回文本');
        }
        return content;
    }

    async testConnection(credential: ImageProviderCredential): Promise<{ ok: boolean; message: string }> {
        try {
            const baseUrl = await this.safeUrls.validate(credential.baseUrl);
            const apiKey = this.cipher.decrypt(credential.encryptedApiKey);
            const response = await this.request(this.safeUrls.endpoint(baseUrl, 'models'), {
                method: 'GET',
                headers: {
                    ...this.headers(apiKey),
                    'x-goog-api-key': apiKey,
                },
            });
            await response.body?.cancel().catch(() => undefined);
            if (response.ok) {
                const textModel = await this.testModel(credential, credential.textModelId);
                if (!textModel.ok) {
                    return { ok: false, message: `中转站可连接，但文本编排模型不可用：${textModel.message}` };
                }
            }
            return {
                ok: response.ok,
                message: response.ok
                    ? `连接成功，文本编排模型 ${credential.textModelId} 已验证`
                    : `中转站模型列表端点返回 HTTP ${response.status}`,
            };
        } catch (error) {
            return { ok: false, message: safeError(error) };
        }
    }

    /**
     * Verifies a relay model mapping through read-only model metadata endpoints.
     * This never invokes image generation and therefore should not consume image credits.
     */
    async testModel(
        credential: ImageProviderCredential,
        providerModelId: string,
    ): Promise<{ ok: boolean; message: string }> {
        try {
            const target = providerModelId.trim();
            if (!target) return { ok: false, message: '中转站模型 ID 不能为空' };
            const baseUrl = await this.safeUrls.validate(credential.baseUrl);
            const apiKey = this.cipher.decrypt(credential.encryptedApiKey);
            const headers = { ...this.headers(apiKey), 'x-goog-api-key': apiKey };

            const exactResponse = await this.request(
                this.safeUrls.endpoint(baseUrl, `models/${encodeURIComponent(target)}`),
                { method: 'GET', headers },
            );
            await readResponseText(exactResponse, MAX_MODEL_RESPONSE_BYTES);
            if (exactResponse.ok) {
                return { ok: true, message: `模型 ${target} 已通过只读元数据端点验证` };
            }
            if ([401, 403].includes(exactResponse.status)) {
                return { ok: false, message: `模型验证失败：中转站返回 HTTP ${exactResponse.status}` };
            }

            const listResponse = await this.request(this.safeUrls.endpoint(baseUrl, 'models'), {
                method: 'GET',
                headers,
            });
            const listText = await readResponseText(listResponse, MAX_MODEL_RESPONSE_BYTES);
            if (!listResponse.ok) {
                return {
                    ok: false,
                    message: `模型 ${target} 无法验证（元数据 HTTP ${exactResponse.status}，列表 HTTP ${listResponse.status}）`,
                };
            }
            let payload: unknown;
            try {
                payload = JSON.parse(listText) as unknown;
            } catch {
                return { ok: false, message: '中转站模型列表返回了无效 JSON' };
            }
            const found = collectModelIdentifiers(payload).some(value => sameModelIdentifier(value, target));
            return found
                ? { ok: true, message: `模型 ${target} 已在中转站模型列表中确认` }
                : { ok: false, message: `中转站连接正常，但模型列表中未找到 ${target}` };
        } catch (error) {
            return { ok: false, message: safeError(error) };
        }
    }

    private async openAiImages(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const size = openAiSize(input.aspectRatio);
        let response: ProviderJsonResponse;
        if (input.reference) {
            const form = new FormData();
            form.set('model', input.providerModelId);
            form.set('prompt', input.prompt);
            form.set('size', size);
            form.set('n', '1');
            form.set(
                'image',
                new Blob([new Uint8Array(input.reference.bytes)], { type: input.reference.mimeType }),
                'reference.png',
            );
            response = await this.requestJson(
                this.safeUrls.endpoint(baseUrl, 'images/edits'),
                apiKey,
                form,
                input.idempotencyKey,
            );
        } else {
            response = await this.requestJson(
                this.safeUrls.endpoint(baseUrl, 'images/generations'),
                apiKey,
                {
                    model: input.providerModelId,
                    prompt: input.prompt,
                    size,
                    n: 1,
                    response_format: 'b64_json',
                },
                input.idempotencyKey,
            );
        }
        return this.imageResult(response.payload, response.telemetry);
    }

    private async openAiResponsesImage(
        baseUrl: URL,
        apiKey: string,
        orchestrationModelId: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        if (!orchestrationModelId.trim()) {
            throw new DefinitiveImageProviderError('OpenAI Responses 编排模型尚未配置');
        }
        const content: Array<Record<string, unknown>> = [
            {
                type: 'input_text',
                text: `${input.prompt}\nAspect ratio: ${input.aspectRatio}`,
            },
        ];
        if (input.reference) {
            content.push({
                type: 'input_image',
                image_url: `data:${input.reference.mimeType};base64,${input.reference.bytes.toString('base64')}`,
            });
        }
        const response = await this.requestJson(
            this.safeUrls.endpoint(baseUrl, 'responses'),
            apiKey,
            {
                model: orchestrationModelId.trim(),
                input: [{ role: 'user', content }],
                tools: [
                    {
                        type: 'image_generation',
                        model: input.providerModelId,
                        quality: 'low',
                        size: openAiSize(input.aspectRatio),
                        output_format: 'png',
                        action: input.reference ? 'edit' : 'generate',
                    },
                ],
                tool_choice: { type: 'image_generation' },
                store: false,
            },
            input.idempotencyKey,
        );
        return this.imageResult(response.payload, response.telemetry);
    }

    private async openAiChat(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const content: Array<Record<string, unknown>> = [
            { type: 'text', text: `${input.prompt}\nAspect ratio: ${input.aspectRatio}` },
        ];
        if (input.reference) {
            content.push({
                type: 'image_url',
                image_url: {
                    url: `data:${input.reference.mimeType};base64,${input.reference.bytes.toString('base64')}`,
                },
            });
        }
        const response = await this.requestJson(
            this.safeUrls.endpoint(baseUrl, 'chat/completions'),
            apiKey,
            {
                model: input.providerModelId,
                messages: [{ role: 'user', content }],
                modalities: ['text', 'image'],
            },
            input.idempotencyKey,
        );
        return this.imageResult(response.payload, response.telemetry);
    }

    private async geminiNative(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const parts = geminiParts(input);
        const endpoint = this.safeUrls.endpoint(
            baseUrl,
            `models/${encodeURIComponent(input.providerModelId)}:generateContent`,
        );
        const response = await this.requestJson(
            endpoint,
            apiKey,
            {
                contents: [{ role: 'user', parts }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: { aspectRatio: input.aspectRatio },
                },
            },
            input.idempotencyKey,
            { 'x-goog-api-key': apiKey },
        );
        return this.imageResult(response.payload, response.telemetry);
    }

    private async geminiNativeStream(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const parts = geminiParts(input);
        const endpoint = this.safeUrls.endpoint(
            baseUrl,
            `models/${encodeURIComponent(input.providerModelId)}:streamGenerateContent`,
        );
        endpoint.searchParams.set('alt', 'sse');
        const response = await this.request(endpoint, {
            method: 'POST',
            redirect: 'manual',
            headers: {
                ...this.headers(apiKey),
                accept: 'text/event-stream',
                'content-type': 'application/json',
                'idempotency-key': input.idempotencyKey,
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: { aspectRatio: input.aspectRatio },
                },
            }),
        });
        const details = responseErrorDetails(response);
        let text: string;
        try {
            text = await readResponseText(response, MAX_PROVIDER_JSON_BYTES);
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
        let payload: unknown;
        try {
            payload = parseGeminiStreamResponse(text);
        } catch (error) {
            throw withProviderTelemetry(error, details);
        }
        return this.imageResult(payload, responseTelemetry(response, payload));
    }

    private async geminiInteractions(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const interactionInput: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
        if (input.reference) {
            interactionInput.push({
                type: 'image',
                mime_type: input.reference.mimeType,
                data: input.reference.bytes.toString('base64'),
            });
        }
        const response = await this.requestJson(
            this.safeUrls.endpoint(baseUrl, 'interactions'),
            apiKey,
            {
                model: input.providerModelId.replace(/^models\//iu, ''),
                input: interactionInput,
                response_format: {
                    type: 'image',
                    mime_type: 'image/png',
                    aspect_ratio: input.aspectRatio,
                    image_size: '1K',
                },
            },
            input.idempotencyKey,
            { 'x-goog-api-key': apiKey },
        );
        return this.imageResult(response.payload, response.telemetry);
    }

    private async imageResult(
        response: unknown,
        requestTelemetry: ProviderTelemetry = {},
    ): Promise<ProviderGenerationResult> {
        const providerRequestId =
            stringAt(response, ['id']) ??
            stringAt(response, ['responseId']) ??
            findStringByKey(response, new Set(['responseId', 'requestId']), value => Boolean(value.trim())) ??
            requestTelemetry.providerRequestId;
        const revisedPrompt = stringAt(response, ['data', 0, 'revised_prompt']);
        const embeddedDataUrl = findStringValue(response, value =>
            /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/iu.test(value),
        );
        const embeddedData = embeddedDataUrl?.match(/data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)/iu);
        const base64 =
            imageGenerationResult(response) ??
            stringAt(response, ['data', 0, 'b64_json']) ??
            stringAt(response, ['output_image', 'data']) ??
            stringAt(response, ['candidates', 0, 'content', 'parts', 0, 'inlineData', 'data']) ??
            findStringByKey(response, new Set(['b64_json', 'data', 'result']), value =>
                /^[a-z0-9+/=\s]{128,}$/iu.test(value),
            ) ??
            embeddedData?.[2];
        const mimeType =
            stringAt(response, ['output_image', 'mime_type']) ??
            stringAt(response, ['candidates', 0, 'content', 'parts', 0, 'inlineData', 'mimeType']) ??
            findStringByKey(response, new Set(['mime_type', 'mimeType']), value =>
                /^image\/[a-z0-9.+-]+$/iu.test(value),
            ) ??
            embeddedData?.[1] ??
            'image/png';
        if (base64) {
            const bytes = Buffer.from(base64.replace(/^data:image\/[a-z0-9.+-]+;base64,/iu, ''), 'base64');
            if (!bytes.length || bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
                throw new DefinitiveImageProviderError('中转站返回的图片大小无效', requestTelemetry);
            }
            return {
                bytes,
                mimeType,
                providerRequestId,
                revisedPrompt,
                metadata: safeProviderMetadata(providerRequestId, revisedPrompt, mimeType, 'inline'),
                telemetry: { ...requestTelemetry, providerRequestId },
            };
        }
        const imageUrl =
            stringAt(response, ['data', 0, 'url']) ??
            findStringByKey(response, new Set(['url', 'image_url']), value => /^https?:\/\//iu.test(value)) ??
            findStringValue(response, value => /https?:\/\/[^\s)"']+/iu.test(value))?.match(
                /https?:\/\/[^\s)"']+/iu,
            )?.[0];
        if (!imageUrl)
            throw new DefinitiveImageProviderError('中转站响应中没有可识别的图片', requestTelemetry);
        let downloaded: { bytes: Buffer; mimeType: string };
        try {
            downloaded = await this.downloadImage(imageUrl);
        } catch (error) {
            throw withProviderTelemetry(error, requestTelemetry);
        }
        return {
            ...downloaded,
            providerRequestId,
            revisedPrompt,
            metadata: safeProviderMetadata(
                providerRequestId,
                revisedPrompt,
                downloaded.mimeType,
                'remote-url',
            ),
            telemetry: { ...requestTelemetry, providerRequestId },
        };
    }

    private async downloadImage(rawUrl: string): Promise<{ bytes: Buffer; mimeType: string }> {
        const resolved = await this.safeUrls.resolveRemoteImage(rawUrl);
        return pinnedImageDownload(resolved);
    }

    private async requestJson(
        url: URL,
        apiKey: string,
        body: Record<string, unknown> | FormData,
        idempotencyKey: string,
        extraHeaders: Record<string, string> = {},
        maxResponseBytes = MAX_PROVIDER_JSON_BYTES,
    ): Promise<ProviderJsonResponse> {
        const isForm = body instanceof FormData;
        const response = await this.request(url, {
            method: 'POST',
            redirect: 'manual',
            headers: {
                ...this.headers(apiKey),
                ...(!isForm ? { 'content-type': 'application/json' } : {}),
                'idempotency-key': idempotencyKey,
                ...extraHeaders,
            },
            body: isForm ? body : JSON.stringify(body),
        });
        const details = responseErrorDetails(response);
        let text: string;
        try {
            text = await readResponseText(response, maxResponseBytes);
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

    private async request(url: URL, init: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            return await fetch(url, {
                ...init,
                signal: controller.signal,
                redirect: init.redirect ?? 'manual',
            });
        } catch (error) {
            throw new AmbiguousImageProviderError(
                error instanceof Error && error.name === 'AbortError'
                    ? '中转站响应超时'
                    : `中转站网络错误：${safeError(error)}`,
            );
        } finally {
            clearTimeout(timeout);
        }
    }

    private headers(apiKey: string): Record<string, string> {
        return { authorization: `Bearer ${apiKey}`, accept: 'application/json' };
    }
}

async function pinnedImageDownload(input: {
    url: URL;
    address: string;
    family: number;
}): Promise<{ bytes: Buffer; mimeType: string }> {
    return new Promise((resolve, reject) => {
        const transport = input.url.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = transport(
            {
                protocol: input.url.protocol,
                hostname: input.address,
                family: input.family,
                port: input.url.port || undefined,
                method: 'GET',
                path: `${input.url.pathname}${input.url.search}`,
                servername: input.url.protocol === 'https:' ? input.url.hostname : undefined,
                headers: { host: input.url.host, accept: 'image/jpeg,image/png,image/webp' },
                timeout: REQUEST_TIMEOUT_MS,
            },
            response => {
                const status = response.statusCode ?? 0;
                if (status < 200 || status >= 300) {
                    response.resume();
                    reject(
                        new DefinitiveImageProviderError(`下载中转站图片失败（HTTP ${status}）`, {
                            httpStatus: status,
                        }),
                    );
                    return;
                }
                const declared = Number(response.headers['content-length'] ?? 0);
                if (declared > MAX_PROVIDER_IMAGE_BYTES) {
                    response.destroy();
                    reject(new DefinitiveImageProviderError('中转站图片超过 25MB'));
                    return;
                }
                const chunks: Buffer[] = [];
                let total = 0;
                response.on('data', (chunk: Buffer | string) => {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    total += buffer.length;
                    if (total > MAX_PROVIDER_IMAGE_BYTES) {
                        response.destroy(new DefinitiveImageProviderError('中转站图片超过 25MB'));
                        return;
                    }
                    chunks.push(buffer);
                });
                response.on('end', () => {
                    if (!total) {
                        reject(new DefinitiveImageProviderError('中转站图片大小无效'));
                        return;
                    }
                    const contentType = Array.isArray(response.headers['content-type'])
                        ? response.headers['content-type'][0]
                        : response.headers['content-type'];
                    resolve({
                        bytes: Buffer.concat(chunks, total),
                        mimeType: contentType?.split(';')[0] ?? 'image/png',
                    });
                });
                response.on('error', error =>
                    reject(new AmbiguousImageProviderError(`读取中转站图片失败：${safeError(error)}`)),
                );
            },
        );
        request.on('timeout', () => request.destroy(new AmbiguousImageProviderError('下载中转站图片超时')));
        request.on('error', error =>
            reject(
                error instanceof ImageProviderError
                    ? error
                    : new AmbiguousImageProviderError(`下载中转站图片网络错误：${safeError(error)}`),
            ),
        );
        request.end();
    });
}

function openAiSize(aspectRatio: string): string {
    if (['3:4', '9:16'].includes(aspectRatio)) return '1024x1536';
    if (['4:3', '16:9'].includes(aspectRatio)) return '1536x1024';
    return '1024x1024';
}

function geminiParts(input: ProviderGenerationInput): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [
        { text: `${input.prompt}\nAspect ratio: ${input.aspectRatio}` },
    ];
    if (input.reference) {
        parts.push({
            inlineData: {
                mimeType: input.reference.mimeType,
                data: input.reference.bytes.toString('base64'),
            },
        });
    }
    return parts;
}

function parseGeminiStreamResponse(text: string): unknown {
    const normalized = text.replace(/\r\n?/gu, '\n').trim();
    const events: unknown[] = [];
    for (const block of normalized.split(/\n\n+/gu)) {
        const data = block
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
            .trim();
        if (!data || data === '[DONE]') continue;
        try {
            events.push(JSON.parse(data) as unknown);
        } catch {
            throw new DefinitiveImageProviderError('中转站返回了无效的 Gemini 流式数据');
        }
    }
    if (events.length) return events;
    try {
        return JSON.parse(normalized) as unknown;
    } catch {
        throw new DefinitiveImageProviderError('中转站没有返回可识别的 Gemini 流式数据');
    }
}

function objectAt(value: unknown, path: Array<string | number>): unknown {
    return path.reduce<unknown>((current, key) => {
        if (Array.isArray(current) && typeof key === 'number') return current[key];
        if (current && typeof current === 'object' && typeof key === 'string')
            return (current as Record<string, unknown>)[key];
        return undefined;
    }, value);
}

function stringAt(value: unknown, path: Array<string | number>): string | undefined {
    const found = objectAt(value, path);
    return typeof found === 'string' && found.trim() ? found : undefined;
}

function imageGenerationResult(value: unknown): string | undefined {
    const output = objectAt(value, ['output']);
    if (!Array.isArray(output)) return;
    for (const item of output) {
        if (objectAt(item, ['type']) !== 'image_generation_call') continue;
        const result = stringAt(item, ['result']);
        if (result) return result;
    }
}

function findStringByKey(
    value: unknown,
    keys: Set<string>,
    predicate: (value: string) => boolean,
    depth = 0,
): string | undefined {
    if (depth > 8 || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key) && typeof child === 'string' && predicate(child)) return child;
        const nested = findStringByKey(child, keys, predicate, depth + 1);
        if (nested) return nested;
    }
}

function findStringValue(
    value: unknown,
    predicate: (value: string) => boolean,
    depth = 0,
): string | undefined {
    if (depth > 8) return;
    if (typeof value === 'string') return predicate(value) ? value : undefined;
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value as Record<string, unknown>)) {
        const nested = findStringValue(child, predicate, depth + 1);
        if (nested) return nested;
    }
}

function safeError(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

function httpFailure(status: number, details: ImageProviderErrorDetails): ImageProviderError {
    const message = `中转站返回 HTTP ${status}`;
    if ([408, 425, 500, 502, 503, 504].includes(status)) {
        return new AmbiguousImageProviderError(`${message}，结果暂时无法确认`, details);
    }
    return new DefinitiveImageProviderError(message, details);
}

function withProviderTelemetry(error: unknown, telemetry: ProviderTelemetry): ImageProviderError {
    const message = safeError(error);
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

function responseErrorDetails(response: Response): ImageProviderErrorDetails {
    return {
        httpStatus: response.status,
        providerRequestId:
            response.headers.get('x-request-id') ??
            response.headers.get('request-id') ??
            response.headers.get('x-goog-request-id') ??
            undefined,
    };
}

function responseTelemetry(response: Response, payload: unknown): ProviderTelemetry {
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

function numericValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
}

function findObjectByKey(value: unknown, keys: Set<string>, depth = 0): Record<string, unknown> | undefined {
    if (depth > 6 || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key) && child && typeof child === 'object' && !Array.isArray(child)) {
            return child as Record<string, unknown>;
        }
        const nested = findObjectByKey(child, keys, depth + 1);
        if (nested) return nested;
    }
}

function findValueByKey(value: unknown, keys: Set<string>, depth = 0): unknown {
    if (depth > 6 || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key)) return child;
        const nested = findValueByKey(child, keys, depth + 1);
        if (nested !== undefined) return nested;
    }
}

function sanitizeUsage(value: Record<string, unknown>, depth = 0): Record<string, any> {
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

function collectModelIdentifiers(value: unknown, depth = 0): string[] {
    if (depth > 6 || value == null) return [];
    if (Array.isArray(value)) {
        return value.flatMap(item => collectModelIdentifiers(item, depth + 1));
    }
    if (typeof value !== 'object') return [];
    const identifiers: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (['id', 'name', 'model', 'modelId'].includes(key) && typeof child === 'string') {
            identifiers.push(child);
        } else if (typeof child === 'object' && child != null) {
            identifiers.push(...collectModelIdentifiers(child, depth + 1));
        }
    }
    return identifiers;
}

function sameModelIdentifier(left: string, right: string): boolean {
    const normalize = (value: string) =>
        value
            .trim()
            .replace(/^models\//iu, '')
            .toLowerCase();
    return normalize(left) === normalize(right);
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
    return (await readResponseBytes(response, maxBytes)).toString('utf8');
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new DefinitiveImageProviderError('中转站响应超过安全大小限制');
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    while (true) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            await reader.cancel().catch(() => undefined);
            throw new AmbiguousImageProviderError('中转站响应体超时');
        }
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
            chunk = await readChunkWithTimeout(reader, remainingMs);
        } catch (error) {
            await reader.cancel().catch(() => undefined);
            throw error;
        }
        const { done, value } = chunk;
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new DefinitiveImageProviderError('中转站响应超过安全大小限制');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
}

async function readChunkWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new AmbiguousImageProviderError('中转站响应体超时')),
            timeoutMs,
        );
        reader.read().then(
            value => {
                clearTimeout(timeout);
                resolve(value);
            },
            error => {
                clearTimeout(timeout);
                reject(new AmbiguousImageProviderError(`读取中转站响应失败：${safeError(error)}`));
            },
        );
    });
}

function safeProviderMetadata(
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
