import { describe, expect, it } from 'vitest';
import type { ImageGenerationConfigRecord, ImageModelRecord } from '../../graphql/plugins.graphql';
import { buildImageGenerationConfigInput, buildImageModelInput } from './ai-image-settings-input';

const model: ImageModelRecord = {
    id: 'model-1',
    code: 'GEMINI_FLASH',
    enabled: true,
    displayNameZh: 'Gemini 闪电',
    displayNameEn: 'Gemini Flash',
    descriptionZh: '原说明',
    descriptionEn: 'Original description',
    officialModelId: 'gemini-3.1-flash-image',
    providerModelId: 'gemini-3.1-flash-image',
    protocol: 'GEMINI_NATIVE_STREAM',
    unitPrice: 30,
    unitPrice2K: 60,
    unitPrice4K: 120,
    currencyCode: 'CNY',
    position: 1,
    isDefault: true,
    healthStatus: 'HEALTHY',
    healthMessage: null,
    lastTestedAt: null,
    supportsIdempotency: false,
    freeImageEnabled: true,
    dailyFreeImageLimit: 2,
    dailyFreeImageUnlimited: false,
    paidAfterFreeEnabled: true,
    dailyGenerationSafetyLimit: 20,
};

const config: ImageGenerationConfigRecord = {
    id: 'config-1',
    enabled: true,
    promptOptimizationEnabled: true,
    promptRateLimitPerMinute: 3,
    promptDailyFreeLimit: 20,
    promptDailyFreeUnlimited: false,
    paidPromptOptimizationEnabled: true,
    paidPromptOptimizationPrice: 10,
    paidPromptOptimizationCurrencyCode: 'CNY',
    defaultModelCode: model.code,
    termsVersion: '2026-08',
    termsZh: '原条款',
    termsEn: 'Original terms',
    credentialEnabled: true,
    activeSkillHash: 'skill-hash',
    models: [model],
};

describe('AI 图片配置保存载荷', () => {
    it('保存全局开关时原样回传未在简化页面编辑的必填配置', () => {
        expect(
            buildImageGenerationConfigInput(config, {
                enabled: false,
                promptOptimizationEnabled: false,
                defaultModelCode: model.code,
                termsVersion: '2026-09',
                termsZh: '新条款',
                termsEn: 'New terms',
            }),
        ).toEqual({
            enabled: false,
            promptOptimizationEnabled: false,
            defaultModelCode: model.code,
            termsVersion: '2026-09',
            termsZh: '新条款',
            termsEn: 'New terms',
            promptRateLimitPerMinute: 3,
            promptDailyFreeLimit: 20,
            promptDailyFreeUnlimited: false,
            paidPromptOptimizationEnabled: true,
            paidPromptOptimizationPrice: 10,
            paidPromptOptimizationCurrencyCode: 'CNY',
        });
    });

    it('关闭买家模型时保留新 schema 要求的分辨率、免费额度和安全上限', () => {
        expect(
            buildImageModelInput(model, {
                enabled: false,
                displayNameZh: model.displayNameZh,
                displayNameEn: model.displayNameEn,
                descriptionZh: model.descriptionZh,
                descriptionEn: model.descriptionEn,
                providerModelId: model.providerModelId,
                protocol: model.protocol,
                unitPrice: model.unitPrice,
                currencyCode: model.currencyCode,
                position: model.position,
            }),
        ).toMatchObject({
            code: model.code,
            enabled: false,
            protocol: 'GEMINI_NATIVE_STREAM',
            unitPrice2K: 60,
            unitPrice4K: 120,
            supportsIdempotency: false,
            freeImageEnabled: true,
            dailyFreeImageLimit: 2,
            dailyFreeImageUnlimited: false,
            paidAfterFreeEnabled: true,
            dailyGenerationSafetyLimit: 20,
        });
    });
});
