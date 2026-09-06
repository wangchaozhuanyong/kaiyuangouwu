import { IMAGE_GENERATION_DELIVERY_TIMEOUT_MS } from '../constants';
import { SafeProviderUrlService } from '../security/safe-provider-url.service';
import { ProviderGenerationInput, ProviderGenerationResult } from '../types';

import {
    IMAGE_GENERATION_TIMEOUT_MESSAGE,
    MAX_PROVIDER_JSON_BYTES,
    OPENAI_IMAGE_QUALITY,
} from './image-provider-constants';
import { DefinitiveImageProviderError, RetryableImageProviderError } from './image-provider-errors';
import { geminiParts, openAiSize, providerReferences } from './image-provider-input';
import { readResponseText, remainingTimeout } from './image-provider-io';
import { ProviderJsonResponse, parseGeminiStreamResponse } from './image-provider-response';
import { ImageProviderResultReader } from './image-provider-result-reader';
import {
    httpFailure,
    responseErrorDetails,
    responseTelemetry,
    withProviderTelemetry,
} from './image-provider-telemetry';
import { ImageProviderTransport } from './image-provider-transport';

export class ImageProviderProtocols {
    constructor(
        private readonly safeUrls: SafeProviderUrlService,
        private readonly transport: ImageProviderTransport,
        private readonly resultReader: ImageProviderResultReader,
    ) {}
    async openAiImages(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const size = openAiSize(input.aspectRatio, input.resolution ?? '1K', input.providerModelId);
        const references = providerReferences(input);
        let response: ProviderJsonResponse;
        if (references.length) {
            const form = new FormData();
            form.set('model', input.providerModelId);
            form.set('prompt', input.prompt);
            form.set('size', size);
            form.set('quality', OPENAI_IMAGE_QUALITY);
            form.set('n', '1');
            references.forEach((reference, index) => {
                const fieldName = references.length === 1 ? 'image' : 'image[]';
                form.append(
                    fieldName,
                    new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType }),
                    `reference-${index + 1}.png`,
                );
            });
            response = await this.transport.requestGenerationJson(
                this.safeUrls.endpoint(baseUrl, 'images/edits'),
                apiKey,
                form,
                input.idempotencyKey,
            );
        } else {
            response = await this.transport.requestGenerationJson(
                this.safeUrls.endpoint(baseUrl, 'images/generations'),
                apiKey,
                {
                    model: input.providerModelId,
                    prompt: input.prompt,
                    size,
                    quality: OPENAI_IMAGE_QUALITY,
                    n: 1,
                    response_format: 'b64_json',
                },
                input.idempotencyKey,
            );
        }
        return this.resultReader.imageResult(response.payload, response.telemetry);
    }

    async openAiResponsesImage(
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
        const references = providerReferences(input);
        for (const reference of references) {
            content.push({
                type: 'input_image',
                image_url: `data:${reference.mimeType};base64,${reference.bytes.toString('base64')}`,
            });
        }
        const response = await this.transport.requestGenerationJson(
            this.safeUrls.endpoint(baseUrl, 'responses'),
            apiKey,
            {
                model: orchestrationModelId.trim(),
                input: [{ role: 'user', content }],
                tools: [
                    {
                        type: 'image_generation',
                        model: input.providerModelId,
                        quality: OPENAI_IMAGE_QUALITY,
                        size: openAiSize(input.aspectRatio, input.resolution ?? '1K', input.providerModelId),
                        output_format: 'png',
                        action: references.length ? 'edit' : 'generate',
                    },
                ],
                tool_choice: { type: 'image_generation' },
                store: false,
            },
            input.idempotencyKey,
        );
        return this.resultReader.imageResult(response.payload, response.telemetry);
    }

    async openAiChat(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const content: Array<Record<string, unknown>> = [
            { type: 'text', text: `${input.prompt}\nAspect ratio: ${input.aspectRatio}` },
        ];
        for (const reference of providerReferences(input)) {
            content.push({
                type: 'image_url',
                image_url: {
                    url: `data:${reference.mimeType};base64,${reference.bytes.toString('base64')}`,
                },
            });
        }
        const response = await this.transport.requestGenerationJson(
            this.safeUrls.endpoint(baseUrl, 'chat/completions'),
            apiKey,
            {
                model: input.providerModelId,
                messages: [{ role: 'user', content }],
                modalities: ['text', 'image'],
            },
            input.idempotencyKey,
        );
        return this.resultReader.imageResult(response.payload, response.telemetry);
    }

    async geminiNative(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const parts = geminiParts(input);
        const endpoint = this.safeUrls.endpoint(
            baseUrl,
            `models/${encodeURIComponent(input.providerModelId)}:generateContent`,
        );
        const response = await this.transport.requestGenerationJson(
            endpoint,
            apiKey,
            {
                contents: [{ role: 'user', parts }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: { aspectRatio: input.aspectRatio, imageSize: input.resolution ?? '1K' },
                },
            },
            input.idempotencyKey,
            { 'x-goog-api-key': apiKey },
        );
        return this.resultReader.imageResult(response.payload, response.telemetry);
    }

    async geminiNativeStream(
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
        const deadline = Date.now() + IMAGE_GENERATION_DELIVERY_TIMEOUT_MS;
        const response = await this.transport.request(
            endpoint,
            {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    ...this.transport.headers(apiKey),
                    accept: 'text/event-stream',
                    'content-type': 'application/json',
                    'idempotency-key': input.idempotencyKey,
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        responseModalities: ['TEXT', 'IMAGE'],
                        imageConfig: { aspectRatio: input.aspectRatio, imageSize: input.resolution ?? '1K' },
                    },
                }),
            },
            IMAGE_GENERATION_DELIVERY_TIMEOUT_MS,
            IMAGE_GENERATION_TIMEOUT_MESSAGE,
        );
        const details = responseErrorDetails(response);
        let text: string;
        try {
            text = await readResponseText(
                response,
                MAX_PROVIDER_JSON_BYTES,
                remainingTimeout(deadline),
                IMAGE_GENERATION_TIMEOUT_MESSAGE,
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
        let payload: unknown;
        try {
            payload = parseGeminiStreamResponse(text);
        } catch (error) {
            throw withProviderTelemetry(error, details);
        }
        return this.resultReader.imageResult(payload, responseTelemetry(response, payload));
    }

    async geminiInteractions(
        baseUrl: URL,
        apiKey: string,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        const interactionInput: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
        for (const reference of providerReferences(input)) {
            interactionInput.push({
                type: 'image',
                mime_type: reference.mimeType,
                data: reference.bytes.toString('base64'),
            });
        }
        const response = await this.transport.requestGenerationJson(
            this.safeUrls.endpoint(baseUrl, 'interactions'),
            apiKey,
            {
                model: input.providerModelId.replace(/^models\//iu, ''),
                input: interactionInput,
                response_format: {
                    type: 'image',
                    mime_type: 'image/png',
                    aspect_ratio: input.aspectRatio,
                    image_size: input.resolution ?? '1K',
                },
            },
            input.idempotencyKey,
            { 'x-goog-api-key': apiKey },
        );
        return this.resultReader.imageResult(response.payload, response.telemetry);
    }
}
