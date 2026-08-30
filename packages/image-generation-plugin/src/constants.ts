import { CrudPermissionDefinition } from '@vendure/core';

export const IMAGE_GENERATION_QUEUE = 'image-generation-output';
export const IMAGE_GENERATION_LOGGER_CTX = 'ImageGenerationPlugin';
export const IMAGE_GENERATION_OPTIONS = Symbol('IMAGE_GENERATION_OPTIONS');

export const manageImageGenerationPermission = new CrudPermissionDefinition(
    'ImageGeneration',
    operation => `${operation} AI image models, pricing, jobs, and refunds`,
);

export const launchModelDefinitions = [
    {
        code: 'OPENAI_HIGH_QUALITY',
        officialModelId: 'gpt-image-1',
        nameZh: 'Codex 图片 1',
        nameEn: 'Codex Image 1',
        descriptionZh: '标准质量档，适合商品场景、社交配图和日常创作。',
        descriptionEn: 'Standard tier for product scenes, social visuals, and everyday creation.',
        protocol: 'OPENAI_RESPONSES_IMAGE',
    },
    {
        code: 'OPENAI_IMAGE_1_5',
        officialModelId: 'gpt-image-1.5',
        nameZh: 'Codex 图片 1.5',
        nameEn: 'Codex Image 1.5',
        descriptionZh: '增强质量档，适合精细编辑、商品抠图和透明背景。',
        descriptionEn: 'Enhanced tier for precise edits, product cutouts, and transparent backgrounds.',
        protocol: 'OPENAI_RESPONSES_IMAGE',
    },
    {
        code: 'OPENAI_IMAGE_2',
        officialModelId: 'gpt-image-2',
        nameZh: 'Codex 图片 2',
        nameEn: 'Codex Image 2',
        descriptionZh: '旗舰质量档，适合复杂版式、准确文字和身份一致性要求。',
        descriptionEn: 'Premium tier for complex layouts, exact text, and identity consistency.',
        protocol: 'OPENAI_RESPONSES_IMAGE',
    },
    {
        code: 'GEMINI_FLASH',
        officialModelId: 'gemini-3.1-flash-image',
        nameZh: 'Gemini 3.1 Flash Image',
        nameEn: 'Gemini 3.1 Flash Image',
        descriptionZh: '适合快速试稿、批量创意和日常生图，优先考虑速度与性价比。',
        descriptionEn: 'Best for fast drafts, creative variations, and everyday image generation.',
        protocol: 'GEMINI_NATIVE_STREAM',
    },
] as const;

export const retiredLaunchModelCodes = new Set(['GEMINI_PRO']);

export const supportedAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_PIXELS = 40_000_000;
export const MAX_REFERENCE_IMAGES_PER_JOB = 3;
export const MAX_REFERENCE_INSTRUCTION_LENGTH = 500;
export const MAX_PROMPT_LENGTH = 2_000;
export const MAX_GENERATION_COUNT = 4;
export const MAX_ACTIVE_GENERATION_JOBS = 5;
export const MAX_REFERENCE_UPLOADS_PER_MINUTE = 5;
export const MAX_REFERENCE_UPLOADS_PER_DAY = 30;
export const MAX_ACTIVE_REFERENCE_ASSETS = 10;
export const MAX_ACTIVE_REFERENCE_BYTES = 100 * 1024 * 1024;
export const IMAGE_DISPATCH_MAX_AGE_MS = 15 * 60 * 1_000;
export const IMAGE_UNKNOWN_MAX_AGE_MS = 15 * 60 * 1_000;
// Image providers commonly take longer than ordinary metadata/text APIs. Keep this
// below the 15-minute stale-output guard so a live worker finishes before reconciliation.
export const IMAGE_GENERATION_DELIVERY_TIMEOUT_MS = 10 * 60 * 1_000;
