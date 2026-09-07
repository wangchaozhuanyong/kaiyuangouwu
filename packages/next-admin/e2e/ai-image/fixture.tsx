import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import type {
    ImageGenerationConfigRecord,
    ImageModelRecord,
    ImageProviderRecord,
} from '../../src/graphql/plugins.graphql';
import '../../src/index.css';
import { AiImageAccessModule } from '../../src/pages/Plugins/AiImageAccessModule';
import { AiImageSettingsModule } from '../../src/pages/Plugins/AiImageSettingsModule';

const operations: Array<{ name: string; variables: Record<string, unknown> }> = [];
const fixturePage = new URLSearchParams(location.search).get('page');

const createModel = (overrides: Partial<ImageModelRecord> = {}): ImageModelRecord => ({
    __typename: 'ImageStudioModel',
    id: 'model-1',
    code: 'GEMINI_FLASH',
    enabled: true,
    displayNameZh: 'Gemini 闪电',
    displayNameEn: 'Gemini Flash',
    descriptionZh: '快速生成营销与商品图片',
    descriptionEn: 'Fast image generation',
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
    healthMessage: '模型连接正常',
    lastTestedAt: '2026-09-07T06:00:00.000Z',
    supportsIdempotency: false,
    freeImageEnabled: true,
    dailyFreeImageLimit: 2,
    dailyFreeImageUnlimited: false,
    paidAfterFreeEnabled: true,
    dailyGenerationSafetyLimit: 20,
    ...overrides,
});

const firstModel = createModel();
let config: ImageGenerationConfigRecord = {
    __typename: 'ImageGenerationAdminConfig',
    id: 'config-1',
    enabled: true,
    promptOptimizationEnabled: true,
    promptRateLimitPerMinute: 3,
    promptDailyFreeLimit: 20,
    promptDailyFreeUnlimited: false,
    paidPromptOptimizationEnabled: true,
    paidPromptOptimizationPrice: 10,
    paidPromptOptimizationCurrencyCode: 'CNY',
    defaultModelCode: firstModel.code,
    termsVersion: '2026-09',
    termsZh: '使用 AI 图片工坊即表示同意合理使用生成内容。',
    termsEn: 'Using AI Image Studio means accepting responsible use of generated content.',
    credentialEnabled: true,
    activeSkillHash: 'fixture-skill',
    models: [
        firstModel,
        createModel({
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
            healthMessage: null,
            lastTestedAt: null,
        }),
    ],
};
let providers: ImageProviderRecord[] = [
    {
        __typename: 'ImageProviderAdminConfig',
        id: 'provider-openai',
        code: 'openai-primary',
        name: 'OpenAI 主用服务商',
        purpose: 'BOTH',
        scope: 'OPENAI',
        priority: 100,
        weight: 1,
        modelCodes: ['OPENAI_IMAGE'],
        credentialConfigured: true,
        credentialEnabled: true,
        baseUrl: 'https://api.example.com/v1',
        apiKeyLast4: '1234',
        textModelId: 'gpt-5-mini',
        orchestrationModelId: '',
        providerHealthStatus: 'HEALTHY',
        providerHealthMessage: 'OpenAI 协议网关连接正常',
    },
    {
        __typename: 'ImageProviderAdminConfig',
        id: 'provider-gemini',
        code: 'gemini-primary',
        name: 'Gemini 主用服务商',
        purpose: 'BOTH',
        scope: 'GEMINI',
        priority: 100,
        weight: 1,
        modelCodes: ['GEMINI_FLASH'],
        credentialConfigured: false,
        credentialEnabled: false,
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKeyLast4: '',
        textModelId: 'gemini-2.5-flash',
        orchestrationModelId: '',
        providerHealthStatus: 'UNCONFIGURED',
        providerHealthMessage: null,
    },
];

Object.assign(window, {
    aiImageFixture: {
        operations,
        state: () => structuredClone(config),
        providerState: () => structuredClone(providers),
    },
});

const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                const timer = setTimeout(() => {
                    try {
                        const name = operation.operationName;
                        operations.push({ name, variables: structuredClone(operation.variables) });
                        let data: Record<string, unknown>;
                        if (name === 'NextAdminImageGeneration') {
                            data = {
                                activeChannel: {
                                    __typename: 'Channel',
                                    id: 'channel-1',
                                    code: 'fixture',
                                    defaultCurrencyCode: 'CNY',
                                },
                                imageGenerationAdminConfig: config,
                                imageGenerationJobs: { totalItems: 0, items: [] },
                                imagePromptSkillReleases: [],
                            };
                        } else if (name === 'NextAdminSaveImageGenerationConfig') {
                            config = { ...config, ...operation.variables.input };
                            data = { saveImageGenerationConfig: config };
                        } else if (name === 'NextAdminSaveImageModel') {
                            const input = operation.variables.input as Partial<ImageModelRecord> & {
                                code: string;
                            };
                            const saved = {
                                ...config.models.find(model => model.code === input.code)!,
                                ...input,
                            };
                            config = {
                                ...config,
                                models: config.models.map(model =>
                                    model.code === saved.code ? saved : model,
                                ),
                            };
                            data = { saveImageModel: saved };
                        } else if (name === 'NextAdminTestImageModel') {
                            data = {
                                testImageModel: {
                                    ok: true,
                                    message: '本地示例模型连接正常',
                                    testedAt: new Date().toISOString(),
                                },
                            };
                        } else if (name === 'NextAdminImageProviders') {
                            data = { imageProviderAdminConfigs: providers };
                        } else if (name === 'NextAdminSaveImageProvider') {
                            const input = operation.variables.input as {
                                id: string;
                                baseUrl: string;
                                apiKey: string | null;
                                textModelId: string;
                                enabled: boolean;
                            };
                            const previous = providers.find(provider => provider.id === input.id)!;
                            const saved: ImageProviderRecord = {
                                ...previous,
                                credentialConfigured: previous.credentialConfigured || Boolean(input.apiKey),
                                credentialEnabled: input.enabled,
                                baseUrl: input.baseUrl,
                                apiKeyLast4: input.apiKey ? input.apiKey.slice(-4) : previous.apiKeyLast4,
                                textModelId: input.textModelId,
                                providerHealthStatus: 'UNTESTED',
                                providerHealthMessage: null,
                            };
                            providers = providers.map(provider =>
                                provider.id === saved.id ? saved : provider,
                            );
                            data = { saveImageProviderCredential: saved };
                        } else if (name === 'NextAdminTestImageProvider') {
                            const id = operation.variables.id as string;
                            providers = providers.map(provider =>
                                provider.id === id
                                    ? {
                                          ...provider,
                                          providerHealthStatus: 'HEALTHY',
                                          providerHealthMessage: '本地示例服务商连接正常',
                                      }
                                    : provider,
                            );
                            data = {
                                testImageProviderCredential: {
                                    ok: true,
                                    message: '本地示例服务商连接正常',
                                    testedAt: new Date().toISOString(),
                                },
                            };
                        } else {
                            throw new Error('Unexpected fixture operation: ' + name);
                        }
                        observer.next({ data: structuredClone(data) });
                        observer.complete();
                    } catch (error) {
                        observer.error(error);
                    }
                }, 60);
                return () => clearTimeout(timer);
            }),
    ),
});

createRoot(document.getElementById('root')!).render(
    <React.Fragment>
        <ApolloProvider client={client}>
            <MemoryRouter>
                <FeatureHelpProvider>
                    <div style={{ height: '100dvh' }}>
                        {fixturePage === 'provider' ? <AiImageAccessModule /> : <AiImageSettingsModule />}
                    </div>
                </FeatureHelpProvider>
            </MemoryRouter>
        </ApolloProvider>
    </React.Fragment>,
);
