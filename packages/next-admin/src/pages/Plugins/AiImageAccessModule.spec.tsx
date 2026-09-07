// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import {
    SAVE_IMAGE_PROVIDER_MUTATION,
    TEST_IMAGE_PROVIDER_MUTATION,
    type ImageProviderRecord,
} from '../../graphql/plugins.graphql';
import { AiImageAccessModule } from './AiImageAccessModule';

const apolloMocks = vi.hoisted(() => ({ useQuery: vi.fn(), useMutation: vi.fn() }));
vi.mock('@apollo/client/react', () => apolloMocks);

const primary: ImageProviderRecord = {
    id: '2',
    code: 'gemini-primary',
    name: 'Gemini 主用 Key',
    scope: 'GEMINI',
    purpose: 'BOTH',
    priority: 100,
    weight: 3,
    modelCodes: ['GEMINI_FLASH'],
    credentialConfigured: true,
    credentialEnabled: true,
    baseUrl: 'https://gateway.example/gemini',
    apiKeyLast4: '1234',
    textModelId: 'text-model',
    orchestrationModelId: '',
    providerHealthStatus: 'HEALTHY',
    providerHealthMessage: null,
};
const backup: ImageProviderRecord = {
    ...primary,
    id: '4',
    code: 'gemini-backup',
    name: 'Gemini 备用 Key',
    purpose: 'IMAGE',
    priority: 200,
    weight: 1,
    textModelId: '',
};

const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;
let save: ReturnType<typeof vi.fn>;
let test: ReturnType<typeof vi.fn>;
let refetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    save = vi.fn().mockResolvedValue({ data: { saveImageProviderCredential: backup } });
    test = vi.fn().mockResolvedValue({
        data: {
            testImageProviderCredential: { ok: true, message: '备用凭据连接正常', testedAt: '2026-09-07' },
        },
    });
    refetch = vi.fn().mockResolvedValue({});
    apolloMocks.useQuery.mockReturnValue({
        data: { imageProviderAdminConfigs: [primary, backup] },
        loading: false,
        refetch,
    });
    apolloMocks.useMutation.mockImplementation(document => {
        if (document === SAVE_IMAGE_PROVIDER_MUTATION) return [save, { loading: false }];
        if (document === TEST_IMAGE_PROVIDER_MUTATION) return [test, { loading: false }];
        throw new Error('Unexpected mutation');
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
});

async function renderModule() {
    await act(async () => {
        root.render(
            <FeatureHelpProvider>
                <AiImageAccessModule />
            </FeatureHelpProvider>,
        );
    });
}

function providerRow(name: string) {
    const row = [...container.querySelectorAll('article')].find(article =>
        article.querySelector('h3')?.textContent?.includes(name),
    );
    expect(row).toBeDefined();
    return row as HTMLElement;
}

function drawer() {
    return container.querySelector<HTMLElement>('[role="dialog"]');
}

async function clickButton(section: ParentNode, label: string) {
    const button = [...section.querySelectorAll('button')].find(
        button => button.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
}

async function openProvider(name: string) {
    await clickButton(providerRow(name), '设置修改');
    expect(drawer()).not.toBeNull();
    return drawer()!;
}

describe('AiImageAccessModule credential controls', () => {
    it('keeps provider forms out of the overview until a right-side drawer is opened', async () => {
        await renderModule();

        expect(container.querySelectorAll('article')).toHaveLength(2);
        expect(
            [...container.querySelectorAll('button')].filter(
                button => button.textContent?.trim() === '设置修改',
            ),
        ).toHaveLength(2);
        expect(container.querySelector('input')).toBeNull();

        const panel = await openProvider(backup.name);
        expect(panel.className).toContain('justify-end');
        expect(panel.getAttribute('aria-label')).toBe(`设置服务商：${backup.name}`);
        expect(panel.textContent).toContain('API Base URL');
        expect(panel.textContent).toContain('保存凭据');

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(drawer()).toBeNull();
    });

    it('tests the selected backup by ID when two Gemini keys share the same visible suffix', async () => {
        await renderModule();
        const panel = await openProvider(backup.name);
        await clickButton(panel, '测试连通性');

        expect(test).toHaveBeenCalledExactlyOnceWith({ variables: { id: '4' } });
        expect(providerRow(primary.name).querySelector('h3')?.textContent).toBe(primary.name);
        expect(providerRow(backup.name).querySelector('h3')?.textContent).toBe(backup.name);
        expect(panel.textContent).toContain('备用凭据连接正常');
        expect(refetch).toHaveBeenCalledOnce();
        expect(save).not.toHaveBeenCalled();
    });

    it.each([backup, { ...backup, scope: 'OPENAI' as const, orchestrationModelId: 'image-orchestrator' }])(
        'preserves routing and model settings when saving a $scope image credential',
        async credential => {
            apolloMocks.useQuery.mockReturnValue({
                data: { imageProviderAdminConfigs: [primary, credential] },
                loading: false,
                refetch,
            });
            await renderModule();
            const panel = await openProvider(credential.name);
            await act(async () => panel.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
            await clickButton(panel, '保存凭据');

            expect(save).toHaveBeenCalledExactlyOnceWith({
                variables: {
                    input: {
                        id: credential.id,
                        code: credential.code,
                        name: credential.name,
                        scope: credential.scope,
                        purpose: credential.purpose,
                        priority: credential.priority,
                        weight: credential.weight,
                        modelCodes: credential.modelCodes,
                        baseUrl: credential.baseUrl,
                        apiKey: null,
                        textModelId: '',
                        orchestrationModelId: credential.orchestrationModelId,
                        enabled: false,
                    },
                },
            });
            expect(refetch).toHaveBeenCalledOnce();
            expect(drawer()).toBeNull();
        },
    );

    it('uses the saved canonical URL so a trimmed edit no longer blocks connection testing', async () => {
        await renderModule();
        let panel = await openProvider(backup.name);
        const input = panel.querySelector('input')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                input,
                `${backup.baseUrl}/`,
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await clickButton(panel, '保存凭据');

        panel = await openProvider(backup.name);
        expect(panel.querySelector('input')?.value).toBe(backup.baseUrl);
        await clickButton(panel, '测试连通性');
        expect(test).toHaveBeenCalledExactlyOnceWith({ variables: { id: backup.id } });
    });

    it('keeps an API failure visible without reporting a successful save', async () => {
        save.mockRejectedValue(new Error('保存失败，请重试'));
        await renderModule();
        const panel = await openProvider(primary.name);
        await act(async () => panel.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
        await clickButton(panel, '保存凭据');

        expect(container.textContent).toContain('保存失败，请重试');
        expect(container.textContent).not.toContain('凭据已加密保存');
        expect(refetch).not.toHaveBeenCalled();
    });
});
