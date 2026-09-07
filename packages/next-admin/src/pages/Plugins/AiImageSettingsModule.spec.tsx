// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import type { ImageGenerationAdminResult, ImageModelRecord } from '../../graphql/plugins.graphql';
import { AiImageSettingsModule } from './AiImageSettingsModule';

const mocks = vi.hoisted(() => ({
    data: undefined as ImageGenerationAdminResult | undefined,
    mutate: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@apollo/client/react', () => ({
    useQuery: () => ({
        data: mocks.data,
        loading: false,
        error: undefined,
        refetch: mocks.refetch,
    }),
    useMutation: () => [mocks.mutate, { loading: false }],
}));

const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    mocks.mutate.mockReset();
    mocks.refetch.mockClear();
});

function model(overrides: Partial<ImageModelRecord> = {}): ImageModelRecord {
    return {
        id: 'model-1',
        code: 'GEMINI_FLASH',
        enabled: true,
        displayNameZh: 'Gemini 闪电',
        displayNameEn: 'Gemini Flash',
        descriptionZh: '快速生图模型',
        descriptionEn: 'Fast image model',
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
        ...overrides,
    };
}

async function renderModule() {
    const primaryModel = model();
    mocks.data = {
        activeChannel: { id: 'channel-1', code: 'default', defaultCurrencyCode: 'CNY' },
        imageGenerationAdminConfig: {
            id: 'config-1',
            enabled: true,
            promptOptimizationEnabled: true,
            promptRateLimitPerMinute: 3,
            promptDailyFreeLimit: 20,
            promptDailyFreeUnlimited: false,
            paidPromptOptimizationEnabled: true,
            paidPromptOptimizationPrice: 10,
            paidPromptOptimizationCurrencyCode: 'CNY',
            defaultModelCode: primaryModel.code,
            termsVersion: '2026-09',
            termsZh: '中文服务条款',
            termsEn: 'English terms',
            credentialEnabled: true,
            activeSkillHash: 'active-skill',
            models: [
                primaryModel,
                model({
                    id: 'model-2',
                    code: 'OPENAI_IMAGE',
                    displayNameZh: 'OpenAI 图片模型',
                    displayNameEn: 'OpenAI Image',
                    officialModelId: 'gpt-image-2',
                    providerModelId: 'gpt-image-2',
                    protocol: 'OPENAI_IMAGES',
                    unitPrice: 50,
                    position: 2,
                    isDefault: false,
                    healthStatus: 'UNTESTED',
                }),
            ],
        },
        imageGenerationJobs: { totalItems: 0, items: [] },
        imagePromptSkillReleases: [],
    };
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    await act(async () => {
        root.render(
            <MemoryRouter>
                <FeatureHelpProvider>
                    <AiImageSettingsModule />
                </FeatureHelpProvider>
            </MemoryRouter>,
        );
    });
    return container;
}

describe('AI 图片工坊运营配置', () => {
    it('先显示紧凑设置清单，再从右侧抽屉打开对应表单', async () => {
        const container = await renderModule();
        const settingButtons = Array.from(container.querySelectorAll('button')).filter(
            button => button.textContent?.trim() === '设置修改',
        );

        expect(settingButtons).toHaveLength(4);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelector('input')).toBeNull();
        expect(container.textContent).toContain('店铺服务开关');
        expect(container.textContent).toContain('买家服务条款与免责声明');
        expect(container.textContent).toContain('OpenAI 图片模型');

        await act(async () => settingButtons[0].click());
        const serviceDrawer = container.querySelector('[role="dialog"]');
        expect(serviceDrawer?.className).toContain('justify-end');
        expect(serviceDrawer?.textContent).toContain('开放 AI 图片工坊');
        expect(serviceDrawer?.textContent).toContain('默认生图模型');

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(container.querySelector('[role="dialog"]')).toBeNull();

        await act(async () => settingButtons[2].click());
        const modelDrawer = container.querySelector('[role="dialog"]');
        expect(modelDrawer?.textContent).toContain('设置模型：Gemini 闪电');
        expect(modelDrawer?.textContent).toContain('服务商模型 ID');
        expect(modelDrawer?.textContent).toContain('保存模型');
    });
});
