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
        nameZh: 'OpenAI 高质量',
        nameEn: 'OpenAI High Quality',
        descriptionZh: '适合重视指令遵循、细节和成品质量的广告图与商品图。',
        descriptionEn: 'Best for ads and product images where instruction following and detail matter.',
        protocol: 'OPENAI_RESPONSES_IMAGE',
    },
    {
        code: 'GEMINI_FLASH',
        officialModelId: 'gemini-3.1-flash-image',
        nameZh: 'Gemini 快速',
        nameEn: 'Gemini Fast',
        descriptionZh: '适合快速试稿、批量创意和日常生图，优先考虑速度与性价比。',
        descriptionEn: 'Best for fast drafts, creative variations, and everyday image generation.',
        protocol: 'GEMINI_INTERACTIONS',
    },
    {
        code: 'GEMINI_PRO',
        officialModelId: 'gemini-3-pro-image',
        nameZh: 'Gemini 专业',
        nameEn: 'Gemini Pro',
        descriptionZh: '适合复杂构图、参考图理解和精细成品，优先考虑质量。',
        descriptionEn: 'Best for complex composition, reference understanding, and refined final images.',
        protocol: 'GEMINI_INTERACTIONS',
    },
] as const;

export const supportedAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_PIXELS = 40_000_000;
export const MAX_PROMPT_LENGTH = 2_000;
export const MAX_GENERATION_COUNT = 4;
