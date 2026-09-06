import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ImageProviderCredential } from '../entities/image-provider-credential.entity';
import { ImageProviderCipherService } from '../security/image-provider-cipher.service';
import { SafeProviderUrlService } from '../security/safe-provider-url.service';
import {
    ImageProviderProtocol,
    ProviderGenerationInput,
    ProviderGenerationResult,
    ProviderPromptResult,
    ProviderTelemetry,
} from '../types';

import { MAX_MODEL_RESPONSE_BYTES, MAX_PROMPT_RESPONSE_BYTES } from './image-provider-constants';
import { DefinitiveImageProviderError } from './image-provider-errors';
import { readResponseText } from './image-provider-io';
import { ImageProviderProtocols } from './image-provider-protocols';
import {
    collectModelIdentifiers,
    geminiResponseText,
    objectAt,
    sameModelIdentifier,
} from './image-provider-response';
import { ImageProviderResultReader } from './image-provider-result-reader';
import { safeError } from './image-provider-telemetry';
import { ImageProviderTransport } from './image-provider-transport';

export {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    LocalImageProcessingError,
    RetryableImageProviderError,
    type ImageProviderErrorDetails,
} from './image-provider-errors';
@Injectable()
export class ImageProviderClient {
    private readonly transport = new ImageProviderTransport();
    private readonly resultReader: ImageProviderResultReader;
    private readonly protocols: ImageProviderProtocols;
    constructor(
        private readonly cipher: ImageProviderCipherService,
        private readonly safeUrls: SafeProviderUrlService,
    ) {
        this.resultReader = new ImageProviderResultReader(safeUrls);
        this.protocols = new ImageProviderProtocols(safeUrls, this.transport, this.resultReader);
    }
    async generate(
        credential: ImageProviderCredential,
        protocol: ImageProviderProtocol,
        input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
        if (!credential.enabled) throw new DefinitiveImageProviderError('平台生图中转站尚未启用');
        const baseUrl = await this.safeUrls.validate(credential.baseUrl);
        const apiKey = this.cipher.decrypt(credential.encryptedApiKey);
        if (protocol === 'OPENAI_RESPONSES_IMAGE') {
            return this.protocols.openAiResponsesImage(
                baseUrl,
                apiKey,
                credential.orchestrationModelId || credential.textModelId,
                input,
            );
        }
        if (protocol === 'OPENAI_IMAGES') return this.protocols.openAiImages(baseUrl, apiKey, input);
        if (protocol === 'OPENAI_COMPATIBLE_CHAT') return this.protocols.openAiChat(baseUrl, apiKey, input);
        if (protocol === 'GEMINI_INTERACTIONS')
            return this.protocols.geminiInteractions(baseUrl, apiKey, input);
        if (protocol === 'GEMINI_NATIVE') return this.protocols.geminiNative(baseUrl, apiKey, input);
        if (protocol === 'GEMINI_NATIVE_STREAM')
            return this.protocols.geminiNativeStream(baseUrl, apiKey, input);
        throw new DefinitiveImageProviderError('不支持的生图协议');
    }

    async optimizePrompt(
        credential: ImageProviderCredential,
        rawModelId: string,
        systemPrompt: string,
        userPrompt: string,
    ): Promise<ProviderPromptResult> {
        const configuredModelId = rawModelId.trim();
        if (!credential.enabled || !configuredModelId) {
            throw new DefinitiveImageProviderError('提示词优化模型尚未配置');
        }
        const baseUrl = await this.safeUrls.validate(credential.baseUrl);
        const apiKey = this.cipher.decrypt(credential.encryptedApiKey);
        if (credential.scope === 'GEMINI') {
            const modelId = configuredModelId.replace(/^models\//iu, '');
            const { payload: geminiResponse, telemetry: geminiTelemetry } = await this.transport.requestJson(
                this.safeUrls.endpoint(baseUrl, `models/${encodeURIComponent(modelId)}:generateContent`),
                apiKey,
                {
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                    generationConfig: {
                        temperature: 0.2,
                        responseMimeType: 'application/json',
                    },
                },
                `prompt-${randomUUID()}`,
                { 'x-goog-api-key': apiKey },
                MAX_PROMPT_RESPONSE_BYTES,
            );
            const geminiContent = geminiResponseText(geminiResponse);
            if (!geminiContent) throw new DefinitiveImageProviderError('Gemini 提示词模型未返回文本');
            return { text: geminiContent, telemetry: geminiTelemetry };
        }
        const { payload: openAiResponse, telemetry: openAiTelemetry } = await this.transport.requestJson(
            this.safeUrls.endpoint(baseUrl, 'chat/completions'),
            apiKey,
            {
                model: configuredModelId,
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
        const openAiContent = objectAt(openAiResponse, ['choices', 0, 'message', 'content']);
        if (typeof openAiContent !== 'string' || !openAiContent.trim()) {
            throw new DefinitiveImageProviderError('提示词优化模型未返回文本');
        }
        return { text: openAiContent, telemetry: openAiTelemetry };
    }

    async testConnection(credential: ImageProviderCredential): Promise<{ ok: boolean; message: string }> {
        try {
            const baseUrl = await this.safeUrls.validate(credential.baseUrl);
            const apiKey = this.cipher.decrypt(credential.encryptedApiKey);
            const response = await this.transport.request(this.safeUrls.endpoint(baseUrl, 'models'), {
                method: 'GET',
                headers: {
                    ...this.transport.headers(apiKey),
                    'x-goog-api-key': apiKey,
                },
            });
            await response.body?.cancel().catch(() => undefined);
            if (response.ok) {
                const modelIds = [
                    (credential.textModelId ?? '').trim(),
                    credential.scope === 'OPENAI' ? (credential.orchestrationModelId ?? '').trim() : '',
                ].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
                for (const modelId of modelIds) {
                    const model = await this.testModel(credential, modelId);
                    if (!model.ok) {
                        return { ok: false, message: `中转站可连接，但兼容模型不可用：${model.message}` };
                    }
                }
                const modelSummary = modelIds.length ? `，兼容模型 ${modelIds.join('、')} 已验证` : '';
                return { ok: true, message: `连接成功${modelSummary}` };
            }
            return {
                ok: false,
                message: `中转站模型列表端点返回 HTTP ${response.status}`,
            };
        } catch (error) {
            return { ok: false, message: safeError(error) };
        }
    }

    async testModel(
        credential: ImageProviderCredential,
        providerModelId: string,
    ): Promise<{ ok: boolean; message: string }> {
        try {
            const target = providerModelId.trim();
            if (!target) return { ok: false, message: '中转站模型 ID 不能为空' };
            const baseUrl = await this.safeUrls.validate(credential.baseUrl);
            const apiKey = this.cipher.decrypt(credential.encryptedApiKey);
            const headers = { ...this.transport.headers(apiKey), 'x-goog-api-key': apiKey };

            const exactResponse = await this.transport.request(
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

            const listResponse = await this.transport.request(this.safeUrls.endpoint(baseUrl, 'models'), {
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
    private imageResult(
        response: unknown,
        requestTelemetry: ProviderTelemetry = {},
    ): Promise<ProviderGenerationResult> {
        return this.resultReader.imageResult(response, requestTelemetry);
    }
}
