import type {
    CreateImageGenerationInput,
    ImageGenerationJob,
    ImageModelQuotaStatus,
    ImageModelRecommendation,
    ImagePrivateAssetView,
    ImagePromptOptimizationResult,
    ImagePromptQuotaStatus,
    ImageReferenceMode,
    ImageStudioConfig,
    ImageStudioWallet,
} from '../types';

import { BaseDomainApi } from './base-domain-api';
import { imageGenerationJobFields } from './fragments';
import {
    API_URL,
    GraphQlResponse,
    SEND_CLIENT_CHANNEL_TOKEN,
    ShopApiTimeoutError,
    createRequestSignal,
} from './helpers';

export class ImageStudioApi extends BaseDomainApi {
    async imageStudioConfig(signal?: AbortSignal): Promise<ImageStudioConfig> {
        const result = await this.request<{ imageStudioConfig: ImageStudioConfig }>(
            `
                query ImageStudioConfig {
                    imageStudioConfig {
                        enabled promptOptimizationEnabled promptOptimizerModelIds promptRateLimitPerMinute promptDailyFreeLimit promptDailyFreeUnlimited
                        paidPromptOptimizationEnabled paidPromptOptimizationPrice paidPromptOptimizationCurrencyCode
                        defaultModelCode termsVersion termsZh termsEn
                        outputRetentionDays referenceRetentionHours maxReferenceBytes maxReferencePixels maxQuantity
                        models {
                            id code displayNameZh displayNameEn descriptionZh descriptionEn officialModelId
                            unitPrice unitPrice2K unitPrice4K currencyCode position isDefault healthStatus freeImageEnabled dailyFreeImageLimit
                            dailyFreeImageUnlimited paidAfterFreeEnabled dailyGenerationSafetyLimit
                            resolutionOptions { resolution unitPrice supportedAspectRatios }
                        }
                    }
                }
            `,
            undefined,
            signal,
            15_000,
        );
        return result.imageStudioConfig;
    }

    async imageStudioBalance(signal?: AbortSignal): Promise<number> {
        const result = await this.request<{ imageStudioBalance: number }>(
            `query ImageStudioBalance { imageStudioBalance }`,
            undefined,
            signal,
        );
        return result.imageStudioBalance;
    }

    async imageStudioWallet(signal?: AbortSignal): Promise<ImageStudioWallet> {
        const result = await this.request<{ imageStudioWallet: ImageStudioWallet }>(
            `query ImageStudioWallet {
                imageStudioWallet { availableBalance currencyCode }
            }`,
            undefined,
            signal,
            15_000,
        );
        return result.imageStudioWallet;
    }

    async imagePromptQuotaStatus(signal?: AbortSignal): Promise<ImagePromptQuotaStatus> {
        const result = await this.request<{ imagePromptQuotaStatus: ImagePromptQuotaStatus }>(
            `query ImagePromptQuotaStatus {
                imagePromptQuotaStatus {
                    paidEnabled paidPrice currencyCode
                    minute { limit unlimited reserved consumed remaining windowEndsAt }
                    daily { limit unlimited reserved consumed remaining windowEndsAt }
                }
            }`,
            undefined,
            signal,
            15_000,
        );
        return result.imagePromptQuotaStatus;
    }

    async imageModelQuotaStatus(signal?: AbortSignal): Promise<ImageModelQuotaStatus[]> {
        const result = await this.request<{ imageModelQuotaStatus: ImageModelQuotaStatus[] }>(
            `query ImageModelQuotaStatus {
                imageModelQuotaStatus {
                    modelCode freeImageEnabled paidAfterFreeEnabled unitPrice currencyCode
                    free { limit unlimited reserved consumed remaining windowEndsAt }
                    safety { limit unlimited reserved consumed remaining windowEndsAt }
                }
            }`,
            undefined,
            signal,
            15_000,
        );
        return result.imageModelQuotaStatus;
    }

    async optimizeImagePrompt(
        prompt: string,
        referenceMode: ImageReferenceMode,
        quote?: { expectedPrice?: number | null; currencyCode?: string | null; idempotencyKey?: string },
    ): Promise<ImagePromptOptimizationResult> {
        const result = await this.request<{ optimizeImagePrompt: ImagePromptOptimizationResult }>(
            `
                mutation OptimizeImagePrompt($input: OptimizeImagePromptInput!) {
                    optimizeImagePrompt(input: $input) {
                        originalPrompt optimizedPrompt promptSpec source optimizerModelId recommendedModelCode recommendationReason promptSkillHash
                        billingMode chargedAmount currencyCode inputTokens outputTokens totalTokens actualCostMicrounits costCurrency
                        promptQuota {
                            paidEnabled paidPrice currencyCode
                            minute { limit unlimited reserved consumed remaining windowEndsAt }
                            daily { limit unlimited reserved consumed remaining windowEndsAt }
                        }
                    }
                }
            `,
            { input: { prompt, referenceMode, ...quote } },
            undefined,
            150_000,
            true,
        );
        return result.optimizeImagePrompt;
    }

    async recommendImageModel(
        prompt: string,
        referenceMode: ImageReferenceMode,
    ): Promise<ImageModelRecommendation> {
        const result = await this.request<{ recommendImageModel: ImageModelRecommendation }>(
            `
                query RecommendImageModel($input: OptimizeImagePromptInput!) {
                    recommendImageModel(input: $input) {
                        modelCode modelName officialModelId unitPrice currencyCode reason promptSkillHash
                    }
                }
            `,
            { input: { prompt, referenceMode } },
        );
        return result.recommendImageModel;
    }

    async uploadImageReference(file: File, termsAccepted: boolean): Promise<ImagePrivateAssetView> {
        const operations = {
            query: `mutation UploadImageReference($file: Upload!, $termsAccepted: Boolean!) {
                uploadImageReference(file: $file, termsAccepted: $termsAccepted) {
                    id originalName mimeType byteSize width height expiresAt previewUrl
                }
            }`,
            variables: { file: null, termsAccepted },
        };
        const form = new FormData();
        form.set('operations', JSON.stringify(operations));
        form.set('map', JSON.stringify({ 0: ['variables.file'] }));
        form.set('0', file, file.name);
        const headers: Record<string, string> = { 'language-code': this.languageCode };
        if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
        if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
        const separator = API_URL.includes('?') ? '&' : '?';
        const timeout = createRequestSignal(undefined, 60_000);
        let response: Response;
        let body: GraphQlResponse<{ uploadImageReference: ImagePrivateAssetView }>;
        try {
            response = await fetch(
                `${API_URL}${separator}languageCode=${encodeURIComponent(this.languageCode)}&currencyCode=${encodeURIComponent(this.market.currencyCode)}`,
                { method: 'POST', credentials: 'include', headers, body: form, signal: timeout.signal },
            );
            this.captureAuthToken(response);
            body = (await response.json()) as GraphQlResponse<{
                uploadImageReference: ImagePrivateAssetView;
            }>;
        } catch (error) {
            if (timeout.didTimeout()) throw new ShopApiTimeoutError('参考图上传超时，请检查网络后重试');
            throw error;
        } finally {
            timeout.cleanup();
        }
        if (!response.ok || body.errors?.length || !body.data) {
            throw new Error(body.errors?.[0]?.message ?? `Reference upload failed (${response.status})`);
        }
        return body.data.uploadImageReference;
    }

    async createImageGeneration(input: CreateImageGenerationInput): Promise<ImageGenerationJob> {
        const result = await this.request<{ createImageGeneration: ImageGenerationJob }>(
            `mutation CreateImageGeneration($input: CreateImageGenerationInput!) {
                createImageGeneration(input: $input) { ${imageGenerationJobFields} }
            }`,
            { input },
            undefined,
            45_000,
            true,
        );
        return result.createImageGeneration;
    }

    async myImageGenerationJob(id: string, signal?: AbortSignal): Promise<ImageGenerationJob> {
        const result = await this.request<{ myImageGenerationJob: ImageGenerationJob }>(
            `query MyImageGenerationJob($id: ID!) { myImageGenerationJob(id: $id) { ${imageGenerationJobFields} } }`,
            { id },
            signal,
            15_000,
        );
        return result.myImageGenerationJob;
    }

    async myImageGenerationJobs(skip = 0, take = 20, signal?: AbortSignal) {
        const result = await this.request<{
            myImageGenerationJobs: { items: ImageGenerationJob[]; totalItems: number };
        }>(
            `query MyImageGenerationJobs($skip: Int, $take: Int) {
                myImageGenerationJobs(skip: $skip, take: $take) { totalItems items { ${imageGenerationJobFields} } }
            }`,
            { skip, take },
            signal,
            15_000,
        );
        return result.myImageGenerationJobs;
    }

    async cancelQueuedImageGeneration(id: string): Promise<ImageGenerationJob> {
        const result = await this.request<{ cancelQueuedImageGeneration: ImageGenerationJob }>(
            `mutation CancelImageGeneration($id: ID!) { cancelQueuedImageGeneration(id: $id) { ${imageGenerationJobFields} } }`,
            { id },
        );
        return result.cancelQueuedImageGeneration;
    }

    async deleteMyGeneratedImage(outputId: string): Promise<boolean> {
        const result = await this.request<{ deleteMyGeneratedImage: boolean }>(
            `mutation DeleteMyGeneratedImage($outputId: ID!) { deleteMyGeneratedImage(outputId: $outputId) }`,
            { outputId },
        );
        return result.deleteMyGeneratedImage;
    }

    async deleteMyImageGenerationJob(id: string): Promise<boolean> {
        const result = await this.request<{ deleteMyImageGenerationJob: boolean }>(
            `mutation DeleteMyImageGenerationJob($id: ID!) { deleteMyImageGenerationJob(id: $id) }`,
            { id },
        );
        return result.deleteMyImageGenerationJob;
    }
}
