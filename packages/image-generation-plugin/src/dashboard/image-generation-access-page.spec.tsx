import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@vendure/dashboard', async () => {
    const React = await import('react');
    const container = ({ children }: Readonly<{ children?: React.ReactNode }>) =>
        React.createElement('div', null, children);
    const PageLayout = ({ children }: Readonly<{ children?: React.ReactNode }>) => {
        const blocks: React.ReactElement[] = [];
        React.Children.forEach(children, child => {
            if (
                React.isValidElement(child) &&
                ('column' in (child.props as object) || 'blockId' in (child.props as object))
            ) {
                blocks.push(child);
            }
        });
        return React.createElement('div', null, blocks);
    };
    const PageBlock = ({
        blockId,
        title,
        description,
        children,
    }: Readonly<{
        blockId?: string;
        title?: React.ReactNode;
        description?: React.ReactNode;
        children?: React.ReactNode;
    }>) => React.createElement('section', { 'data-block-id': blockId }, title, description, children);

    return {
        Alert: container,
        AlertDescription: container,
        Badge: container,
        Button: ({ children }: Readonly<{ children?: React.ReactNode }>) =>
            React.createElement('button', null, children),
        Dialog: container,
        DialogContent: container,
        DialogDescription: container,
        DialogFooter: container,
        DialogHeader: container,
        DialogTitle: container,
        Input: (props: object) => React.createElement('input', props),
        Label: container,
        Page: container,
        PageActionBar: container,
        PageActionBarRight: container,
        PageBlock,
        PageLayout,
        PageTitle: container,
        Sheet: container,
        SheetContent: container,
        SheetDescription: container,
        SheetFooter: container,
        SheetHeader: container,
        SheetTitle: container,
        Skeleton: container,
        Switch: () => React.createElement('button'),
        Tabs: container,
        TabsList: container,
        TabsTrigger: container,
        Textarea: (props: object) => React.createElement('textarea', props),
        UnsavedChangesConfirmation: container,
        api: { mutate: vi.fn(), query: vi.fn() },
        toast: { error: vi.fn(), success: vi.fn() },
        useChannel: () => ({ activeChannel: { id: 'channel-1' } }),
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        usePermissions: () => ({ hasPermissions: () => true }),
        useQuery: () => ({
            data: {
                imageProviderAdminConfigs: [
                    {
                        id: 'provider-1',
                        code: 'openai-primary',
                        name: 'GPT 主 Key',
                        purpose: 'BOTH',
                        scope: 'OPENAI',
                        credentialConfigured: true,
                        credentialEnabled: true,
                        baseUrl: 'https://relay.example.com/v1',
                        apiKeyLast4: '1234',
                        textModelId: 'gpt-5.4-mini',
                        orchestrationModelId: 'gpt-5.4-mini',
                        providerHealthStatus: 'HEALTHY',
                        providerHealthMessage: '连接正常',
                        priority: 10,
                        weight: 1,
                        cooldownUntil: null,
                        lastUsedAt: null,
                        modelCodes: [],
                    },
                ],
                imagePromptRoutingConfig: {
                    id: 'routing-1',
                    strategy: 'FIXED',
                    primaryCredentialCode: 'openai-primary',
                    primaryModelId: 'gpt-5.4-mini',
                    primaryAvailable: true,
                    fallbackEnabled: false,
                    fallbackCredentialCode: null,
                    fallbackModelId: null,
                    fallbackAvailable: false,
                },
                imageGenerationAdminConfig: { models: [] },
            },
            error: null,
            isLoading: false,
            refetch: vi.fn(),
        }),
    };
});

import {
    ImageGenerationAccessPage,
    ProviderCredentialEditorSheet,
    reconcileImageAdminConfig,
    toLocalDayBoundary,
} from './image-generation-pages';
import { ImageAdminConfigRecord } from './image-generation.graphql';

describe('ImageGenerationAccessPage', () => {
    it('renders the unified prompt routing settings separately from the Key pool', () => {
        const markup = renderToStaticMarkup(<ImageGenerationAccessPage />);

        expect(markup).toContain('提示词优化统一设置');
        expect(markup).toContain('实际主路由');
        expect(markup).toContain('gpt-5.4-mini');
    });

    it('converts date filters from the browser local day to API timestamps', () => {
        expect(toLocalDayBoundary('2026-08-30', false)).toBe(new Date(2026, 7, 30, 0, 0, 0, 0).toISOString());
        expect(toLocalDayBoundary('2026-08-30', true)).toBe(
            new Date(2026, 7, 30, 23, 59, 59, 999).toISOString(),
        );
        expect(toLocalDayBoundary('2026-02-30', false)).toBeNull();
    });

    it('keeps dirty fields while accepting fresh server health and readiness fields', () => {
        const baseline = adminConfig();
        const current = structuredClone(baseline);
        current.termsZh = '尚未保存的新条款';
        current.models[0].unitPrice = 250;
        const incoming = structuredClone(baseline);
        incoming.credentialEnabled = true;
        incoming.models[0].healthStatus = 'HEALTHY';

        const reconciled = reconcileImageAdminConfig(current, baseline, incoming);

        expect(reconciled.termsZh).toBe('尚未保存的新条款');
        expect(reconciled.models[0].unitPrice).toBe(250);
        expect(reconciled.credentialEnabled).toBe(true);
        expect(reconciled.models[0].healthStatus).toBe('HEALTHY');
    });

    it('renders provider summaries and a compact credential management table', () => {
        const markup = renderToStaticMarkup(<ImageGenerationAccessPage />);

        expect(markup).toContain('data-block-id="image-access-summary"');
        expect(markup).toContain('data-block-id="image-access-credentials"');
        expect(markup).toContain('Codex / GPT');
        expect(markup).toContain('Gemini');
        expect(markup).toContain('系统不内置或硬编码默认 Key');
        expect(markup).toContain('GPT 主 Key');
        expect(markup).toContain('openai-primary');
        expect(markup).toContain('••••1234');
        expect(markup).toContain('aria-label="搜索 Key"');
        expect(markup).toContain('测试');
        expect(markup).toContain('编辑');
        expect(markup).not.toContain('data-block-id="image-access-provider-1"');
        expect(markup).not.toContain('API Base URL');
    });

    it('keeps the full credential form inside the editor sheet', () => {
        const markup = renderToStaticMarkup(
            <ProviderCredentialEditorSheet
                config={{
                    id: 'provider-1',
                    code: 'openai-primary',
                    name: 'GPT 主 Key',
                    purpose: 'BOTH',
                    scope: 'OPENAI',
                    credentialConfigured: true,
                    credentialEnabled: true,
                    baseUrl: 'https://relay.example.com/v1',
                    apiKeyLast4: '1234',
                    textModelId: 'gpt-5.4-mini',
                    orchestrationModelId: 'gpt-5.4-mini',
                    providerHealthStatus: 'HEALTHY',
                    providerHealthMessage: '连接正常',
                    priority: 10,
                    weight: 1,
                    cooldownUntil: null,
                    lastUsedAt: null,
                    modelCodes: ['gpt-image-1'],
                }}
                models={[{ code: 'gpt-image-1', displayNameZh: 'Codex 图片 1' }]}
                onChanged={vi.fn()}
                onClose={vi.fn()}
            />,
        );

        expect(markup).toContain('编辑 GPT 主 Key');
        expect(markup).toContain('基础信息');
        expect(markup).toContain('接入配置');
        expect(markup).toContain('路由配置');
        expect(markup).toContain('明确绑定的生图模型');
        expect(markup).toContain('留空表示不更换');
        expect(markup).toContain('保存并测试');
        expect(markup).toContain('归档 Key');
        expect(markup).toContain('id="provider-key-code"');
        expect(markup).toMatch(/id="provider-key-code"[^>]*disabled=""/u);
        expect(markup).toContain('创建后不可修改');
    });
});

function adminConfig(): ImageAdminConfigRecord {
    return {
        id: 'config-1',
        enabled: false,
        promptOptimizationEnabled: true,
        promptRateLimitPerMinute: 3,
        promptDailyFreeLimit: 20,
        promptDailyFreeUnlimited: false,
        paidPromptOptimizationEnabled: false,
        paidPromptOptimizationPrice: 0,
        paidPromptOptimizationCurrencyCode: 'CNY',
        defaultModelCode: 'OPENAI_HIGH_QUALITY',
        termsVersion: 'test',
        termsZh: '原条款',
        termsEn: 'Original terms',
        credentialEnabled: false,
        activeSkillHash: 'hash',
        skillAutoActivateEnabled: true,
        models: [
            {
                id: 'model-1',
                code: 'OPENAI_HIGH_QUALITY',
                enabled: true,
                displayNameZh: '高质量',
                displayNameEn: 'High quality',
                descriptionZh: '说明',
                descriptionEn: 'Description',
                officialModelId: 'gpt-image-1',
                providerModelId: 'gpt-image-1',
                protocol: 'OPENAI_RESPONSES_IMAGE',
                unitPrice: 100,
                unitPrice2K: 0,
                unitPrice4K: 0,
                resolutionOptions: [],
                currencyCode: 'CNY',
                position: 0,
                isDefault: true,
                healthStatus: 'UNTESTED',
                healthMessage: null,
                lastTestedAt: null,
                supportsIdempotency: false,
                freeImageEnabled: false,
                dailyFreeImageLimit: 0,
                dailyFreeImageUnlimited: false,
                paidAfterFreeEnabled: true,
                dailyGenerationSafetyLimit: 20,
            },
        ],
    };
}
