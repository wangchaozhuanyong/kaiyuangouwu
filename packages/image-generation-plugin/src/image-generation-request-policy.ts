import { UserInputError } from '@vendure/core';

import {
    MAX_GENERATION_COUNT,
    MAX_PROMPT_LENGTH,
    MAX_REFERENCE_IMAGES_PER_JOB,
    MAX_REFERENCE_INSTRUCTION_LENGTH,
    supportedAspectRatios,
} from './constants';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import {
    normalizeReferenceMode,
    referenceModeInstruction,
    storedReferenceAssetIds,
    storedReferenceInstruction,
    uniqueReferenceAssetIds,
} from './image-generation-helpers';
import { isImageResolution } from './image-resolution';
import {
    detectPromptLanguage,
    PromptRulesService,
    type PromptOutputLanguage,
} from './prompt/prompt-rules.service';
import { CreateCatalogImageGenerationInput, CreateImageGenerationInput } from './types';
/** Validates request identity and renders immutable prompt snapshots. */
export class ImageGenerationRequestPolicy {
    constructor(private readonly rules: PromptRulesService) {}

    validatePromptInput(
        input: Pick<
            CreateImageGenerationInput,
            | 'prompt'
            | 'optimizedPrompt'
            | 'referenceMode'
            | 'referenceAssetId'
            | 'referenceAssetIds'
            | 'referenceInstruction'
        >,
        fallbackLanguage: PromptOutputLanguage = 'en',
    ) {
        const prompt = input.prompt.trim();
        if (!prompt || prompt.length > MAX_PROMPT_LENGTH)
            throw new UserInputError(`原始描述必须为 1 至 ${MAX_PROMPT_LENGTH} 个字符`);
        const optimizedPrompt = input.optimizedPrompt?.trim() ?? '';
        if (optimizedPrompt.length > 8_000) throw new UserInputError('优化后的提示词不能超过 8000 个字符');
        const referenceAssetIds = uniqueReferenceAssetIds(input);
        if (referenceAssetIds.length > MAX_REFERENCE_IMAGES_PER_JOB) {
            throw new UserInputError(`每次最多可以使用 ${MAX_REFERENCE_IMAGES_PER_JOB} 张参考图`);
        }
        const referenceInstruction = input.referenceInstruction?.trim() ?? '';
        if (referenceInstruction.length > MAX_REFERENCE_INSTRUCTION_LENGTH) {
            throw new UserInputError(`参考要求不能超过 ${MAX_REFERENCE_INSTRUCTION_LENGTH} 个字符`);
        }
        const referenceMode = normalizeReferenceMode(input.referenceMode);
        if (!referenceAssetIds.length && referenceInstruction) {
            throw new UserInputError('添加参考要求前请先上传参考图');
        }
        const promptLanguage = detectPromptLanguage(prompt, fallbackLanguage);
        return {
            prompt,
            optimizedPrompt,
            referenceAssetId: referenceAssetIds[0] ?? null,
            referenceAssetIds,
            referenceInstruction,
            referenceMode,
            promptLanguage,
        };
    }

    validateCreateInput(input: CreateImageGenerationInput, fallbackLanguage: PromptOutputLanguage = 'en') {
        const content = this.validatePromptInput(input, fallbackLanguage);
        if (!supportedAspectRatios.includes(input.aspectRatio as (typeof supportedAspectRatios)[number]))
            throw new UserInputError('图片比例无效');
        const resolution = String(input.resolution).toUpperCase();
        if (!isImageResolution(resolution)) throw new UserInputError('图片清晰度无效');
        if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_GENERATION_COUNT)
            throw new UserInputError('每次只能生成 1 至 4 张图片');
        if (!Number.isSafeInteger(input.expectedUnitPrice) || input.expectedUnitPrice < 0)
            throw new UserInputError('预期价格无效');
        if (!Number.isSafeInteger(input.expectedChargeAmount) || input.expectedChargeAmount < 0)
            throw new UserInputError('预期结算金额无效');
        if (!input.termsAccepted) throw new UserInputError('请先同意 AI 图片服务条款');
        const idempotencyKey = input.idempotencyKey.trim();
        if (!/^[a-zA-Z0-9._:-]{8,64}$/u.test(idempotencyKey)) throw new UserInputError('请求幂等键无效');
        return { ...input, ...content, idempotencyKey, resolution };
    }

    assertSameCreateRequest(
        job: ImageGenerationJob,
        input: ReturnType<ImageGenerationRequestPolicy['validateCreateInput']>,
    ): void {
        const sameReference =
            storedReferenceAssetIds(job).join('|') === input.referenceAssetIds.map(String).join('|');
        const sameReferenceInstruction = storedReferenceInstruction(job) === input.referenceInstruction;
        const expectedPrompt = this.compileFinalPrompt(
            input,
            this.rules.fallbackSpec(input.prompt, input.referenceMode, input.promptLanguage),
        );
        const sameExplicitOptimizedPrompt = !input.optimizedPrompt || job.finalPrompt === expectedPrompt;
        if (
            job.modelCodeSnapshot !== input.modelCode ||
            job.originalPrompt !== input.prompt ||
            !sameExplicitOptimizedPrompt ||
            job.referenceMode !== input.referenceMode ||
            !sameReference ||
            !sameReferenceInstruction ||
            job.aspectRatio !== input.aspectRatio ||
            job.resolution !== input.resolution ||
            job.quantity !== input.quantity ||
            job.unitPriceSnapshot !== input.expectedUnitPrice ||
            job.expectedChargeAmount !== input.expectedChargeAmount ||
            job.currencyCode !== input.currencyCode
        ) {
            throw new UserInputError('请求幂等键已被其他生图参数使用');
        }
    }

    compileFinalPrompt(
        input: ReturnType<ImageGenerationRequestPolicy['validatePromptInput']>,
        promptSpec: ReturnType<PromptRulesService['fallbackSpec']>,
        enforceLimit = true,
    ): string {
        const base = input.optimizedPrompt || this.rules.render(promptSpec, input.promptLanguage);
        const referenceInstruction = referenceModeInstruction(input.referenceMode, input.promptLanguage);
        const isZh = input.promptLanguage === 'zh';
        const referenceLines = [
            input.referenceAssetIds.length > 1
                ? isZh
                    ? `参考图已按第 1 张至第 ${input.referenceAssetIds.length} 张的顺序附加。`
                    : `Reference images are attached in order from 1 to ${input.referenceAssetIds.length}.`
                : '',
            referenceInstruction
                ? `${isZh ? '参考图要求：' : 'Reference instruction: '}${referenceInstruction}`
                : '',
            input.referenceInstruction
                ? `${isZh ? '具体参考要求：' : 'Specific reference requirement: '}${input.referenceInstruction}`
                : '',
        ].filter(Boolean);
        const finalPrompt = referenceLines.length ? `${base}\n${referenceLines.join('\n')}` : base;
        if (enforceLimit && finalPrompt.length > 8_000)
            throw new UserInputError('最终提示词超过 8000 个字符');
        return finalPrompt;
    }

    validateCatalogCreateInput(input: CreateCatalogImageGenerationInput) {
        const productName = input.productName.trim();
        if (!productName || productName.length > 255)
            throw new UserInputError('商品名称必须为 1 至 255 个字符');
        const description = input.description.trim();
        if (!description || description.length > 1_500)
            throw new UserInputError('主图效果描述必须为 1 至 1500 个字符');
        if (!input.referenceAssetId) throw new UserInputError('请先拍摄或选择商品照片');
        if (!input.termsAccepted) throw new UserInputError('请先同意 AI 图片服务条款');
        const idempotencyKey = input.idempotencyKey.trim();
        if (!/^[a-zA-Z0-9._:-]{8,64}$/u.test(idempotencyKey)) throw new UserInputError('请求幂等键无效');
        return { ...input, productName, description, idempotencyKey };
    }

    assertSameCatalogRequest(
        job: ImageGenerationJob,
        input: ReturnType<ImageGenerationRequestPolicy['validateCatalogCreateInput']>,
    ) {
        if (
            String(job.referenceAssetId) !== String(input.referenceAssetId) ||
            String(job.promptSpec?.catalogProductName ?? '') !== input.productName ||
            String(job.promptSpec?.catalogDescription ?? '') !== input.description
        ) {
            throw new UserInputError('请求幂等键已被其他商品图参数使用');
        }
    }
}
