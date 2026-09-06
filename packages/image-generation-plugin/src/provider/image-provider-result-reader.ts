import { SafeProviderUrlService } from '../security/safe-provider-url.service';
import { ProviderGenerationResult, ProviderTelemetry } from '../types';

import { DefinitiveImageProviderError } from './image-provider-errors';
import { pinnedImageDownload } from './image-provider-io';
import {
    decodeBase64Image,
    extractImageDataUrl,
    findEmbeddedInlineImage,
    findGenericInlineImage,
    findRemoteImageUrl,
    findStringByKey,
    normalizedImageMimeType,
    stringAt,
    structuredInlineImage,
} from './image-provider-response';
import { safeProviderMetadata, withImageProcessingTelemetry } from './image-provider-telemetry';

export class ImageProviderResultReader {
    constructor(private readonly safeUrls: SafeProviderUrlService) {}
    async imageResult(
        response: unknown,
        requestTelemetry: ProviderTelemetry = {},
    ): Promise<ProviderGenerationResult> {
        try {
            const providerRequestId =
                stringAt(response, ['id']) ??
                stringAt(response, ['responseId']) ??
                findStringByKey(response, new Set(['responseId', 'requestId']), value =>
                    Boolean(value.trim()),
                ) ??
                requestTelemetry.providerRequestId;
            const revisedPrompt = stringAt(response, ['data', 0, 'revised_prompt']);
            const inlineImage =
                structuredInlineImage(response) ??
                findGenericInlineImage(response) ??
                findEmbeddedInlineImage(response);
            if (inlineImage) {
                const dataUrl = extractImageDataUrl(inlineImage.data);
                const encoded = dataUrl?.data ?? inlineImage.data;
                const mimeType =
                    normalizedImageMimeType(inlineImage.mimeType ?? dataUrl?.mimeType) ?? 'image/png';
                const bytes = decodeBase64Image(encoded, requestTelemetry);
                return {
                    bytes,
                    mimeType,
                    providerRequestId,
                    revisedPrompt,
                    metadata: safeProviderMetadata(providerRequestId, revisedPrompt, mimeType, 'inline'),
                    telemetry: { ...requestTelemetry, providerRequestId },
                };
            }
            const imageUrl = findRemoteImageUrl(response);
            if (!imageUrl) {
                throw new DefinitiveImageProviderError('中转站响应中没有可识别的图片', requestTelemetry);
            }
            const downloaded = await this.downloadImage(imageUrl);
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
        } catch (error) {
            throw withImageProcessingTelemetry(error, requestTelemetry);
        }
    }

    async downloadImage(rawUrl: string): Promise<{ bytes: Buffer; mimeType: string }> {
        const resolved = await this.safeUrls.resolveRemoteImage(rawUrl);
        return pinnedImageDownload(resolved);
    }
}
