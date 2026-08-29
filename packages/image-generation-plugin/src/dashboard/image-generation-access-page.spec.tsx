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
        Input: (props: object) => React.createElement('input', props),
        Label: container,
        Page: container,
        PageActionBar: container,
        PageActionBarRight: container,
        PageBlock,
        PageLayout,
        PageTitle: container,
        Skeleton: container,
        Switch: () => React.createElement('button'),
        Tabs: container,
        TabsList: container,
        TabsTrigger: container,
        Textarea: (props: object) => React.createElement('textarea', props),
        api: { mutate: vi.fn(), query: vi.fn() },
        toast: { error: vi.fn(), success: vi.fn() },
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
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
                        providerHealthStatus: 'HEALTHY',
                        providerHealthMessage: '连接正常',
                        priority: 10,
                        weight: 1,
                        cooldownUntil: null,
                        lastUsedAt: null,
                        modelCodes: [],
                    },
                ],
                imageGenerationAdminConfig: { models: [] },
            },
            error: null,
            isLoading: false,
            refetch: vi.fn(),
        }),
    };
});

import { ImageGenerationAccessPage } from './image-generation-pages';

describe('ImageGenerationAccessPage', () => {
    it('exposes credential cards as direct PageLayout blocks', () => {
        const markup = renderToStaticMarkup(<ImageGenerationAccessPage />);

        expect(markup).toContain('data-block-id="image-access-provider-1"');
        expect(markup).toContain('data-block-id="image-access-summary"');
        expect(markup).toContain('Codex / GPT');
        expect(markup).toContain('Gemini');
        expect(markup).toContain('系统不内置或硬编码默认 Key');
        expect(markup).toContain('GPT 主 Key（尾号 1234）');
    });
});
