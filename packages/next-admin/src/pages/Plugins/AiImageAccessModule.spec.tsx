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

function card(index: number) {
    return [...container.querySelectorAll('section')].filter(section => section.querySelector('h2'))[index];
}

async function clickButton(section: HTMLElement, label: string) {
    const button = [...section.querySelectorAll('button')].find(button => button.textContent === label);
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
}

describe('AiImageAccessModule credential controls', () => {
    it('tests the selected backup by ID when two Gemini keys share the same visible suffix', async () => {
        await renderModule();
        await clickButton(card(1), '测试连通性');

        expect(test).toHaveBeenCalledExactlyOnceWith({ variables: { id: '4' } });
        expect(card(0).querySelector('h2')?.textContent).toBe(primary.name);
        expect(card(1).querySelector('h2')?.textContent).toBe(backup.name);
        expect(card(1).textContent).toContain('备用凭据连接正常');
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
            await act(async () => card(1).querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
            await clickButton(card(1), '保存凭据');

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
            expect(card(0).querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
            expect(refetch).toHaveBeenCalledOnce();
        },
    );

    it('uses the saved canonical URL so a trimmed edit no longer blocks connection testing', async () => {
        await renderModule();
        const input = card(1).querySelector('input')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                input,
                `${backup.baseUrl}/`,
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await clickButton(card(1), '保存凭据');

        expect(card(1).querySelector('input')?.value).toBe(backup.baseUrl);
        await clickButton(card(1), '测试连通性');
        expect(test).toHaveBeenCalledExactlyOnceWith({ variables: { id: backup.id } });
    });

    it('keeps an API failure visible without reporting a successful save', async () => {
        save.mockRejectedValue(new Error('保存失败，请重试'));
        await renderModule();
        await act(async () => card(0).querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
        await clickButton(card(0), '保存凭据');

        expect(container.textContent).toContain('保存失败，请重试');
        expect(container.textContent).not.toContain('凭据已加密保存');
        expect(refetch).not.toHaveBeenCalled();
    });
});
