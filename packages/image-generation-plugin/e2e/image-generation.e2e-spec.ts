import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ContentTranslationPlugin,
    type ContentTranslationProvider,
} from '@vendure/content-translation-plugin';
import {
    Channel,
    ConfigService,
    Customer,
    mergeConfig,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import {
    ReferralWallet,
    ReferralWalletSpendService,
    ReferralWalletUsage,
    StoreManagementPlugin,
} from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { createReadStream, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { IsNull, MoreThan, MoreThanOrEqual } from 'typeorm';
import { SqljsDriver } from 'typeorm/driver/sqljs/SqljsDriver';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { ImageGenerationConfig } from '../src/entities/image-generation-config.entity';
import { ImageGenerationCostEvent } from '../src/entities/image-generation-cost-event.entity';
import { ImageGenerationDispatch } from '../src/entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from '../src/entities/image-generation-job.entity';
import { ImageGenerationOutput } from '../src/entities/image-generation-output.entity';
import { ImageModelConfig } from '../src/entities/image-model-config.entity';
import { ImagePrivateAsset } from '../src/entities/image-private-asset.entity';
import { ImagePromptOptimizationAttempt } from '../src/entities/image-prompt-optimization-attempt.entity';
import { ImagePromptOptimization } from '../src/entities/image-prompt-optimization.entity';
import { ImageUsageQuotaBucket } from '../src/entities/image-usage-quota-bucket.entity';
import { ImageUsageQuotaEvent } from '../src/entities/image-usage-quota-event.entity';
import { ImageGenerationQueueService } from '../src/image-generation-queue.service';
import { ImageGenerationPlugin } from '../src/image-generation.plugin';
import {
    applyImageBillingReview,
    inspectImageBillingTarget,
    type ImageBillingReview,
} from '../src/image-provider-billing-review';
import { ImageUsageQuotaService } from '../src/image-usage-quota.service';
import { ImagePromptEngineService } from '../src/prompt/image-prompt-engine.service';
import { PromptRulesService } from '../src/prompt/prompt-rules.service';
import { AmbiguousImageProviderError } from '../src/provider/image-provider-errors';
import { ImageProviderClient } from '../src/provider/image-provider.client';
import { ImagePrivateStorageService } from '../src/storage/image-private-storage.service';

// Provider requests now use the pinned transport rather than global fetch.
// Keep the full database/API flow local by intercepting that external boundary too.
vi.mock('../src/provider/image-provider-io', async importOriginal => ({
    ...(await importOriginal<typeof import('../src/provider/image-provider-io')>()),
    pinnedProviderRequest: (target: { url: URL }, init: RequestInit) => {
        if (!['1.1.1.1', '8.8.8.8'].includes(target.url.hostname)) {
            throw new Error('Unexpected external request in isolated image test');
        }
        return providerFetch(target.url, init);
    },
}));

const storageRoot = mkdtempSync(path.join(tmpdir(), 'vendure-image-generation-e2e-'));
const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
let generatedPngBase64 = pngBase64;
const referenceFixture = path.join(storageRoot, 'reference-fixture.png');
writeFileSync(referenceFixture, Buffer.from(pngBase64, 'base64'), { mode: 0o600 });
const originalMasterKey = process.env.IMAGE_GENERATION_MASTER_KEY;
const originalFetch = globalThis.fetch;
process.env.IMAGE_GENERATION_MASTER_KEY = 'image-generation-e2e-master-key-over-thirty-two-chars';

const translationProvider: ContentTranslationProvider = {
    name: 'image-generation-e2e-translation',
    isConfigured: () => true,
    translate: request =>
        Promise.resolve({
            provider: 'image-generation-e2e-translation',
            translations: request.segments.map(segment => ({ key: segment.key, text: segment.text })),
        }),
};

const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false },
    plugins: [
        StorefrontCartPlugin,
        ContentTranslationPlugin.init({ provider: translationProvider }),
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'image-generation-e2e-storefront-secret-over-32-chars',
        }),
        ImageGenerationPlugin.init({
            storageRoot,
            downloadSigningSecret: 'image-generation-e2e-download-secret-over-32-chars',
            production: false,
        }),
    ],
});

const { server, adminClient, shopClient } = createTestEnvironment(config);
let providerFailure = false;
let promptCallCount = 0;
let promptFixtureSubject = '白色保温杯';
let providerSawReference = false;
let promptProviderUserContent: unknown;
const providerAuthorizations = new Map<string, string | null>();

const SAVE_CREDENTIAL = gql`
    mutation SaveImageCredentialE2E($input: SaveImageProviderCredentialInput!) {
        saveImageProviderCredential(input: $input) {
            id
            scope
            credentialConfigured
            credentialEnabled
            baseUrl
            apiKeyLast4
            providerHealthStatus
        }
    }
`;

const TEST_PROVIDER = gql`
    mutation TestImageProviderE2E($scope: ImageProviderScope!) {
        testImageProviderConnection(scope: $scope) {
            ok
            message
        }
    }
`;

const PROVIDER_CONFIGS = gql`
    query ImageProviderConfigsE2E {
        imageProviderAdminConfigs {
            scope
            apiKeyLast4
            providerHealthStatus
        }
    }
`;

const PROMPT_ROUTING_CONFIG = gql`
    query ImagePromptRoutingConfigE2E {
        imagePromptRoutingConfig {
            strategy
            primaryCredentialCode
            primaryModelId
            primaryAvailable
            fallbackEnabled
            fallbackCredentialCode
            fallbackModelId
            fallbackAvailable
        }
    }
`;

const SAVE_PROMPT_ROUTING = gql`
    mutation SaveImagePromptRoutingE2E($input: SaveImagePromptRoutingConfigInput!) {
        saveImagePromptRoutingConfig(input: $input) {
            strategy
            primaryCredentialCode
            primaryModelId
            primaryAvailable
            fallbackEnabled
            fallbackCredentialCode
            fallbackModelId
            fallbackAvailable
        }
    }
`;

const TEST_PROMPT_ROUTE = gql`
    mutation TestImagePromptRouteE2E($input: TestImagePromptRouteInput!) {
        testImagePromptRoute(input: $input) {
            ok
            message
        }
    }
`;

const SAVE_MODEL = gql`
    mutation SaveImageModelE2E($input: SaveImageModelInput!) {
        saveImageModel(input: $input) {
            id
            code
            providerModelId
            unitPrice
            currencyCode
            healthStatus
        }
    }
`;

const TEST_MODEL = gql`
    mutation TestImageModelE2E($code: String!) {
        testImageModel(code: $code) {
            ok
            message
        }
    }
`;

const SAVE_CONFIG = gql`
    mutation SaveImageConfigE2E($input: SaveImageGenerationConfigInput!) {
        saveImageGenerationConfig(input: $input) {
            enabled
            defaultModelCode
            models {
                code
                unitPrice
            }
        }
    }
`;

const REGISTER = gql`
    mutation RegisterImageCustomerE2E($input: RegisterCustomerInput!) {
        registerCustomerAccount(input: $input) {
            __typename
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const FIND_CUSTOMER = gql`
    query FindImageCustomerE2E($email: String!) {
        customers(options: { take: 1, filter: { emailAddress: { eq: $email } } }) {
            items {
                id
                emailAddress
            }
        }
    }
`;

const ADJUST_BALANCE = gql`
    mutation AdjustImageBalanceE2E($customerId: ID!, $amount: Money!) {
        adjustReferralBalance(
            customerId: $customerId
            currencyCode: USD
            amount: $amount
            reason: "AI image E2E balance"
        ) {
            availableBalance
            reservedBalance
        }
    }
`;

const STUDIO_CONFIG = gql`
    query ImageStudioConfigE2E {
        imageStudioConfig {
            enabled
            defaultModelCode
            promptOptimizerModelIds
            models {
                code
                displayNameZh
                descriptionZh
                officialModelId
                unitPrice
                currencyCode
            }
        }
        imageStudioBalance
        imageStudioWallet {
            availableBalance
            currencyCode
        }
    }
`;

const OPTIMIZE = gql`
    mutation OptimizeImagePromptE2E($input: OptimizeImagePromptInput!) {
        optimizeImagePrompt(input: $input) {
            originalPrompt
            optimizedPrompt
            source
            optimizerModelId
            recommendedModelCode
            recommendationReason
            promptSkillHash
        }
    }
`;

const CREATE = gql`
    mutation CreateImageGenerationE2E($input: CreateImageGenerationInput!) {
        createImageGeneration(input: $input) {
            id
            state
            quantity
            aspectRatio
            resolution
            reservedAmount
            capturedAmount
            releasedAmount
            freeQuantityReserved
            freeQuantityCaptured
            outputs {
                id
                outputIndex
                state
            }
        }
    }
`;

const UPLOAD_REFERENCE = gql`
    mutation UploadImageReferenceE2E($file: Upload!) {
        uploadImageReference(file: $file, termsAccepted: true) {
            id
            originalName
            mimeType
            width
            height
            expiresAt
            previewUrl
        }
    }
`;

const MY_JOB = gql`
    query MyImageGenerationJobE2E($id: ID!) {
        myImageGenerationJob(id: $id) {
            id
            state
            reservedAmount
            capturedAmount
            releasedAmount
            freeQuantityReserved
            freeQuantityCaptured
            outputs {
                id
                outputIndex
                state
                attemptCount
                imageUrl
                downloadUrl
                errorMessage
                refundedAt
            }
        }
        imageStudioBalance
    }
`;

const REFUND_OUTPUT = gql`
    mutation RefundImageOutputE2E($outputId: ID!) {
        refundImageOutput(outputId: $outputId, reason: "E2E quality refund") {
            id
            state
            refundedAt
        }
    }
`;

const RECONCILE_STALE_OUTPUTS = gql`
    mutation ReconcileStaleImageOutputsE2E {
        reconcileStaleImageGenerationOutputs
    }
`;

const COST_SUMMARY = gql`
    query ImageGenerationCostSummaryE2E {
        imageGenerationCostSummary(days: 30) {
            truncated
            items {
                modelCode
                attempts
                successes
                failures
                missingCostCount
                grossRevenue
                actualCost
                knownCost
                costCurrency
            }
        }
    }
`;

const USAGE_RECORDS = gql`
    query ImageAiUsageRecordsE2E($input: ImageAiUsageRecordListInput) {
        imageAiUsageRecords(input: $input) {
            totalItems
            items {
                id
                recordType
                modelCode
                credentialCode
                state
                billingMode
                freeQuantity
                paidQuantity
                chargedAmount
                missingCost
                customer {
                    emailAddress
                }
            }
        }
    }
`;

const USAGE_RECORD_DETAIL = gql`
    query ImageAiUsageRecordDetailE2E($recordType: String!, $id: ID!) {
        imageAiUsageRecord(recordType: $recordType, id: $id) {
            inputPrompt
            outputPrompt
            providerRequestIds
            costAdjustments {
                id
                batchId
                reviewer
                matchingStatus
                newCostMicrounits
                supplierBills {
                    billId
                }
            }
            record {
                costCompleteness
                missingCostCount
                costBreakdown {
                    amount
                    currency
                }
            }
            attempts {
                callId
                headerRequestId
                modelResponseId
                attemptNumber
                outcome
                costSource
                matchingStatus
            }
            timeline {
                stage
                status
                amount
                keyName
                keyLast4
                message
            }
        }
    }
`;

const DELETE_JOB = gql`
    mutation DeleteImageGenerationJobE2E($id: ID!) {
        deleteMyImageGenerationJob(id: $id)
    }
`;

describe('AI image generation full flow', () => {
    beforeAll(async () => {
        generatedPngBase64 = (
            await sharp({
                create: { width: 1024, height: 1024, channels: 3, background: '#f7f7f7' },
            })
                .png()
                .toBuffer()
        ).toString('base64');
        vi.stubGlobal('fetch', providerFetch);
        await server.init({
            initialData: {
                ...initialData,
                defaultLanguage: LanguageCode.zh_Hans,
                collections: [],
            },
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
        adminClient.setRequestHeader(
            'x-vendure-sensitive-action-password',
            config.authOptions.superadminCredentials.password,
        );

        const credential = await adminClient.query(SAVE_CREDENTIAL, {
            input: {
                scope: 'OPENAI',
                code: 'openai-e2e-primary',
                name: 'OpenAI E2E 主 Key',
                purpose: 'BOTH',
                baseUrl: 'https://1.1.1.1/v1',
                apiKey: 'relay-e2e-secret-key',
                textModelId: 'prompt-e2e-model',
                orchestrationModelId: 'responses-e2e-model',
                enabled: true,
                priority: 10,
                weight: 1,
                modelCodes: [],
            },
        });
        expect(credential.saveImageProviderCredential).toMatchObject({
            scope: 'OPENAI',
            credentialConfigured: true,
            credentialEnabled: false,
            apiKeyLast4: '-key',
            providerHealthStatus: 'UNTESTED',
        });
        expect(credential.saveImageProviderCredential).not.toHaveProperty('apiKey');
        expect(
            (await adminClient.query(TEST_PROVIDER, { scope: 'OPENAI' })).testImageProviderConnection.ok,
        ).toBe(true);

        const geminiCredential = await adminClient.query(SAVE_CREDENTIAL, {
            input: {
                scope: 'GEMINI',
                code: 'gemini-e2e-primary',
                name: 'Gemini E2E 主 Key',
                purpose: 'BOTH',
                baseUrl: 'https://8.8.8.8/v1',
                apiKey: 'gemini-e2e-secret-key',
                textModelId: 'gemini-e2e-text-model',
                enabled: true,
                priority: 10,
                weight: 1,
                modelCodes: [],
            },
        });
        expect(geminiCredential.saveImageProviderCredential).toMatchObject({
            scope: 'GEMINI',
            credentialConfigured: true,
            credentialEnabled: false,
            apiKeyLast4: '-key',
            providerHealthStatus: 'UNTESTED',
        });
        expect(
            (await adminClient.query(TEST_PROVIDER, { scope: 'GEMINI' })).testImageProviderConnection.ok,
        ).toBe(true);
        expect((await adminClient.query(PROVIDER_CONFIGS)).imageProviderAdminConfigs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ scope: 'OPENAI', providerHealthStatus: 'HEALTHY' }),
                expect.objectContaining({ scope: 'GEMINI', providerHealthStatus: 'HEALTHY' }),
            ]),
        );
        expect(providerAuthorizations.get('1.1.1.1')).toBe('Bearer relay-e2e-secret-key');
        expect(providerAuthorizations.get('8.8.8.8')).toBe('Bearer gemini-e2e-secret-key');
        expect((await adminClient.query(PROMPT_ROUTING_CONFIG)).imagePromptRoutingConfig.strategy).toBe(
            'AUTO',
        );
        expect(
            (
                await adminClient.query(TEST_PROMPT_ROUTE, {
                    input: {
                        credentialCode: 'gemini-e2e-primary',
                        modelId: 'gemini-e2e-text-model',
                    },
                })
            ).testImagePromptRoute.ok,
        ).toBe(true);
        expect(
            (
                await adminClient.query(SAVE_PROMPT_ROUTING, {
                    input: {
                        strategy: 'FIXED',
                        primaryCredentialCode: 'gemini-e2e-primary',
                        primaryModelId: 'gemini-e2e-text-model',
                        fallbackEnabled: true,
                        fallbackCredentialCode: 'openai-e2e-primary',
                        fallbackModelId: 'prompt-e2e-model',
                    },
                })
            ).saveImagePromptRoutingConfig,
        ).toMatchObject({
            strategy: 'FIXED',
            primaryCredentialCode: 'gemini-e2e-primary',
            primaryAvailable: false,
            fallbackCredentialCode: 'openai-e2e-primary',
            fallbackAvailable: false,
        });
        expect(
            (
                await adminClient.query(SAVE_PROMPT_ROUTING, {
                    input: { strategy: 'AUTO', fallbackEnabled: false },
                })
            ).saveImagePromptRoutingConfig,
        ).toMatchObject({ strategy: 'AUTO', fallbackEnabled: false });

        await adminClient.query(SAVE_MODEL, {
            input: {
                code: 'OPENAI_HIGH_QUALITY',
                enabled: true,
                displayNameZh: 'OpenAI 高质量',
                displayNameEn: 'OpenAI High Quality',
                descriptionZh: '适合高质量商品图和广告图',
                descriptionEn: 'For high-quality product images and ads',
                providerModelId: 'gpt-image-1',
                protocol: 'OPENAI_RESPONSES_IMAGE',
                unitPrice: 100,
                unitPrice2K: 0,
                unitPrice4K: 0,
                currencyCode: 'USD',
                position: 0,
                isDefault: true,
                supportsIdempotency: false,
                freeImageEnabled: false,
                dailyFreeImageLimit: 0,
                dailyFreeImageUnlimited: false,
                paidAfterFreeEnabled: true,
                dailyGenerationSafetyLimit: 20,
            },
        });
        await adminClient.query(SAVE_CREDENTIAL, {
            input: {
                id: credential.saveImageProviderCredential.id,
                scope: 'OPENAI',
                code: 'openai-e2e-primary',
                name: 'OpenAI E2E 主 Key',
                purpose: 'BOTH',
                baseUrl: 'https://1.1.1.1/v1',
                apiKey: null,
                textModelId: 'prompt-e2e-model',
                orchestrationModelId: 'responses-e2e-model',
                enabled: true,
                priority: 10,
                weight: 1,
                // Empty bindings intentionally exercise supplier/purpose auto-routing.
                modelCodes: [],
            },
        });
        expect((await adminClient.query(TEST_MODEL, { code: 'OPENAI_HIGH_QUALITY' })).testImageModel.ok).toBe(
            true,
        );
        expect(
            (
                await adminClient.query(SAVE_CONFIG, {
                    input: {
                        enabled: true,
                        promptOptimizationEnabled: true,
                        promptRateLimitPerMinute: 3,
                        promptDailyFreeLimit: 20,
                        promptDailyFreeUnlimited: false,
                        paidPromptOptimizationEnabled: false,
                        paidPromptOptimizationPrice: 0,
                        paidPromptOptimizationCurrencyCode: 'USD',
                        defaultModelCode: 'OPENAI_HIGH_QUALITY',
                        termsVersion: 'e2e-2026-08-27',
                        termsZh: '生图 E2E 测试条款，包含参考图与第三方模型数据说明。',
                        termsEn: 'Image E2E terms covering references and third-party model processing.',
                        models: [
                            {
                                code: 'OPENAI_HIGH_QUALITY',
                                enabled: true,
                                displayNameZh: 'OpenAI 高质量',
                                displayNameEn: 'OpenAI High Quality',
                                descriptionZh: '适合高质量商品图和广告图',
                                descriptionEn: 'For high-quality product images and ads',
                                providerModelId: 'gpt-image-1',
                                protocol: 'OPENAI_RESPONSES_IMAGE',
                                unitPrice: 125,
                                unitPrice2K: 0,
                                unitPrice4K: 0,
                                currencyCode: 'USD',
                                position: 0,
                                isDefault: true,
                                supportsIdempotency: false,
                                freeImageEnabled: false,
                                dailyFreeImageLimit: 0,
                                dailyFreeImageUnlimited: false,
                                paidAfterFreeEnabled: true,
                                dailyGenerationSafetyLimit: 20,
                            },
                        ],
                    },
                })
            ).saveImageGenerationConfig,
        ).toMatchObject({
            enabled: true,
            defaultModelCode: 'OPENAI_HIGH_QUALITY',
            models: expect.arrayContaining([
                expect.objectContaining({ code: 'OPENAI_HIGH_QUALITY', unitPrice: 125 }),
            ]),
        });

        // Prompt optimization now has its own model pool; image-provider textModelId is legacy metadata.
        const promptInput = {
            code: 'prompt-e2e-primary',
            name: 'Prompt E2E fixture',
            enabled: true,
            baseUrl: 'https://1.1.1.1/v1',
            apiKey: 'prompt-e2e-fixture-key',
            modelId: 'prompt-e2e-model',
            apiFormat: 'OPENAI',
            priority: 10,
            weight: 1,
        };
        const savePromptModel = gql`
            mutation SavePromptE2E($input: SaveImagePromptModelInput!) {
                saveImagePromptModel(input: $input) {
                    id
                    enabled
                    healthStatus
                }
            }
        `;
        const promptModel = (await adminClient.query(savePromptModel, { input: promptInput }))
            .saveImagePromptModel;
        expect(promptModel).toMatchObject({ enabled: false, healthStatus: 'UNTESTED' });
        expect(
            (
                await adminClient.query(
                    gql`
                        mutation TestPromptE2E($id: ID!) {
                            testImagePromptModel(id: $id) {
                                ok
                            }
                        }
                    `,
                    { id: promptModel.id },
                )
            ).testImagePromptModel.ok,
        ).toBe(true);
        expect(
            (
                await adminClient.query(savePromptModel, {
                    input: { ...promptInput, id: promptModel.id, apiKey: null },
                })
            ).saveImagePromptModel,
        ).toMatchObject({ enabled: true, healthStatus: 'HEALTHY' });

        const registration = await shopClient.query(REGISTER, {
            input: {
                emailAddress: 'image-e2e@example.com',
                firstName: 'Image',
                lastName: 'E2E',
                password: 'ImageE2EPass123!',
            },
        });
        expect(registration.registerCustomerAccount.__typename).toBe('Success');
        const customers = await adminClient.query(FIND_CUSTOMER, { email: 'image-e2e@example.com' });
        const customerId = customers.customers.items[0].id;
        expect(
            (await adminClient.query(ADJUST_BALANCE, { customerId, amount: 500 })).adjustReferralBalance,
        ).toEqual({ availableBalance: 500, reservedBalance: 0 });
        await shopClient.asUserWithCredentials('image-e2e@example.com', 'ImageE2EPass123!');
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
        vi.unstubAllGlobals();
        globalThis.fetch = originalFetch;
        if (originalMasterKey == null) delete process.env.IMAGE_GENERATION_MASTER_KEY;
        else process.env.IMAGE_GENERATION_MASTER_KEY = originalMasterKey;
        await rm(storageRoot, { recursive: true, force: true });
    });

    it('optimizes, recommends, generates, stores, settles, refunds, and releases on failure', async () => {
        const studio = await shopClient.query(STUDIO_CONFIG);
        expect(studio.imageStudioConfig).toMatchObject({
            enabled: true,
            defaultModelCode: 'OPENAI_HIGH_QUALITY',
            promptOptimizerModelIds: ['prompt-e2e-model'],
            models: [
                expect.objectContaining({
                    code: 'OPENAI_HIGH_QUALITY',
                    descriptionZh: '适合高质量商品图和广告图',
                    officialModelId: 'gpt-image-1',
                    unitPrice: 125,
                }),
            ],
        });
        expect(studio.imageStudioBalance).toBe(500);
        expect(studio.imageStudioWallet).toEqual({ availableBalance: 500, currencyCode: 'USD' });

        const optimization = (
            await shopClient.query(OPTIMIZE, {
                input: { prompt: '白色保温杯的高级电商主图', referenceMode: 'NONE' },
            })
        ).optimizeImagePrompt;
        expect(optimization).toMatchObject({
            source: 'MODEL',
            optimizerModelId: 'prompt-e2e-model',
            recommendedModelCode: 'OPENAI_HIGH_QUALITY',
        });
        expect(optimization.promptSkillHash).toMatch(/^[a-f0-9]{64}$/u);

        providerFailure = false;
        const created = (
            await shopClient.query(CREATE, {
                input: {
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    prompt: optimization.originalPrompt,
                    optimizedPrompt: optimization.optimizedPrompt,
                    referenceMode: 'NONE',
                    aspectRatio: '1:1',
                    resolution: '1K',
                    quantity: 2,
                    expectedUnitPrice: 125,
                    expectedChargeAmount: 250,
                    currencyCode: 'USD',
                    idempotencyKey: 'e2e-success-0001',
                    termsAccepted: true,
                },
            })
        ).createImageGeneration;
        expect(created).toMatchObject({
            quantity: 2,
            aspectRatio: '1:1',
            resolution: '1K',
            reservedAmount: 250,
        });

        const succeeded = await waitForJob(created.id, ['SUCCEEDED']);
        expect(succeeded.myImageGenerationJob).toMatchObject({
            state: 'SUCCEEDED',
            capturedAmount: 250,
            releasedAmount: 0,
        });
        expect(succeeded.imageStudioBalance).toBe(250);
        expect(succeeded.myImageGenerationJob.outputs).toHaveLength(2);
        for (const output of succeeded.myImageGenerationJob.outputs) {
            expect(output).toMatchObject({ state: 'SUCCEEDED', attemptCount: 1 });
            expect(output.imageUrl).toMatch(/^\/image-generation\/private\//u);
            expect(output.downloadUrl).toMatch(/^\/image-generation\/private\//u);
        }

        const firstToken = succeeded.myImageGenerationJob.outputs[0].imageUrl.split('/').at(-1);
        const authorized = await server.app
            .get(ImagePrivateStorageService)
            .authorize(firstToken, `localhost:${config.apiOptions.port}`);
        expect(authorized?.asset.mimeType).toBe('image/png');
        expect(authorized?.download).toBe(false);

        const refund = await adminClient.query(REFUND_OUTPUT, {
            outputId: succeeded.myImageGenerationJob.outputs[0].id,
        });
        expect(refund.refundImageOutput).toMatchObject({ state: 'SUCCEEDED' });
        expect(refund.refundImageOutput.refundedAt).toEqual(expect.any(String));
        const afterRefund = await shopClient.query(MY_JOB, { id: created.id });
        expect(afterRefund.myImageGenerationJob).toMatchObject({
            state: 'SUCCEEDED',
            capturedAmount: 125,
            releasedAmount: 125,
        });
        expect(afterRefund.imageStudioBalance).toBe(375);

        providerFailure = true;
        const failedCreated = (
            await shopClient.query(CREATE, {
                input: {
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    prompt: '这次由模拟中转站返回确定性失败',
                    referenceMode: 'NONE',
                    aspectRatio: '1:1',
                    resolution: '1K',
                    quantity: 1,
                    expectedUnitPrice: 125,
                    expectedChargeAmount: 125,
                    currencyCode: 'USD',
                    idempotencyKey: 'e2e-failure-0001',
                    termsAccepted: true,
                },
            })
        ).createImageGeneration;
        const failed = await waitForJob(failedCreated.id, ['FAILED']);
        expect(failed.myImageGenerationJob).toMatchObject({
            state: 'FAILED',
            capturedAmount: 0,
            releasedAmount: 125,
        });
        expect(failed.imageStudioBalance).toBe(375);

        const connection = server.app.get(TransactionalConnection);
        // Match the persisted MySQL datetime precision while retaining the stale interval.
        const staleAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 16 * 60_000);
        const staleOutputId = Number(String(failedCreated.outputs[0].id).replace(/^T_/u, ''));
        const staleJobId = Number(String(failedCreated.id).replace(/^T_/u, ''));
        await connection.rawConnection.getRepository(ImageGenerationOutput).update(
            { id: staleOutputId },
            {
                state: 'UNKNOWN',
                unknownAt: staleAt,
                completedAt: null,
                walletSettled: false,
                billingMode: 'PENDING',
                errorMessage: '中转站响应超时',
            },
        );
        await connection.rawConnection
            .getRepository(ImageGenerationJob)
            .update(
                { id: staleJobId },
                { state: 'UNKNOWN', completedAt: null, errorMessage: '中转站响应超时' },
            );
        const staleOutput = await connection.rawConnection
            .getRepository(ImageGenerationOutput)
            .findOneByOrFail({ id: staleOutputId });
        expect(staleOutput).toMatchObject({ state: 'UNKNOWN', walletSettled: false });
        expect(staleOutput.unknownAt?.getTime()).toBe(staleAt.getTime());
        expect((await adminClient.query(RECONCILE_STALE_OUTPUTS)).reconcileStaleImageGenerationOutputs).toBe(
            1,
        );
        expect((await shopClient.query(MY_JOB, { id: failedCreated.id })).myImageGenerationJob).toMatchObject(
            {
                state: 'FAILED',
                capturedAmount: 0,
                releasedAmount: 125,
                outputs: [
                    expect.objectContaining({
                        state: 'FAILED',
                        errorMessage: '生成结果在 15 分钟内无法确认，已自动退回本张费用',
                    }),
                ],
            },
        );

        const customer = await connection.rawConnection
            .getRepository(Customer)
            .findOneByOrFail({ emailAddress: 'image-e2e@example.com' });
        const wallet = await connection.rawConnection
            .getRepository(ReferralWallet)
            .findOneByOrFail({ customerId: customer.id, currencyCode: CurrencyCode.USD });
        expect(wallet).toMatchObject({ availableBalance: 375, reservedBalance: 0 });
        const usages = await connection.rawConnection.getRepository(ReferralWalletUsage).find({
            where: { customerId: customer.id, resourceType: 'IMAGE_GENERATION_JOB' },
            order: { createdAt: 'ASC' },
        });
        expect(usages).toHaveLength(2);
        expect(usages[0]).toMatchObject({
            amount: 250,
            capturedAmount: 125,
            releasedAmount: 125,
            status: 'PARTIAL',
        });
        expect(usages[1]).toMatchObject({
            amount: 125,
            capturedAmount: 0,
            releasedAmount: 125,
            status: 'RELEASED',
        });

        providerFailure = false;
        providerSawReference = false;
        const upload = await shopClient.fileUploadMutation({
            mutation: UPLOAD_REFERENCE,
            filePaths: [referenceFixture],
            mapVariables: () => ({ file: null }),
        });
        const reference = upload.uploadImageReference;
        expect(reference).toMatchObject({
            originalName: 'reference-fixture.png',
            mimeType: 'image/png',
            width: 1,
            height: 1,
        });
        expect(reference.previewUrl).toMatch(/^\/image-generation\/private\//u);

        // Reference IDs must survive GraphQL decoding and reach the optimizer as image bytes.
        const referenceOptimization = (
            await shopClient.query(OPTIMIZE, {
                input: {
                    prompt: '把图1女人手里的咖啡做成商品图',
                    referenceMode: 'PRODUCT',
                    referenceAssetIds: [reference.id],
                    referenceInstruction: '保留商品包装，去掉人物',
                    idempotencyKey: 'e2e-prompt-reference-0001',
                },
            })
        ).optimizeImagePrompt;
        expect(referenceOptimization.source).toBe('MODEL');
        expect(promptProviderUserContent).toEqual([
            { type: 'text', text: expect.stringContaining('保留商品包装，去掉人物') },
            { type: 'text', text: 'Reference image 1 (图1)' },
            { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/u) } },
        ]);

        const referenceCreated = (
            await shopClient.query(CREATE, {
                input: {
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    prompt: '保留商品外形，把背景改为柔和的米白色影棚',
                    referenceAssetId: reference.id,
                    referenceMode: 'PRODUCT',
                    aspectRatio: '1:1',
                    resolution: '1K',
                    quantity: 1,
                    expectedUnitPrice: 125,
                    expectedChargeAmount: 125,
                    currencyCode: 'USD',
                    idempotencyKey: 'e2e-reference-0001',
                    termsAccepted: true,
                },
            })
        ).createImageGeneration;
        const referenceSucceeded = await waitForJob(referenceCreated.id, ['SUCCEEDED']);
        expect(referenceSucceeded.myImageGenerationJob).toMatchObject({
            state: 'SUCCEEDED',
            capturedAmount: 125,
            releasedAmount: 0,
        });
        expect(referenceSucceeded.imageStudioBalance).toBe(250);
        expect(providerSawReference).toBe(true);

        await adminClient.query(SAVE_MODEL, {
            input: {
                code: 'OPENAI_HIGH_QUALITY',
                enabled: true,
                displayNameZh: 'OpenAI 高质量',
                displayNameEn: 'OpenAI High Quality',
                descriptionZh: '适合高质量商品图和广告图',
                descriptionEn: 'For high-quality product images and ads',
                providerModelId: 'gpt-image-1',
                protocol: 'OPENAI_RESPONSES_IMAGE',
                unitPrice: 100,
                unitPrice2K: 0,
                unitPrice4K: 0,
                currencyCode: 'USD',
                position: 0,
                isDefault: true,
                supportsIdempotency: false,
                freeImageEnabled: true,
                dailyFreeImageLimit: 1,
                dailyFreeImageUnlimited: false,
                paidAfterFreeEnabled: true,
                dailyGenerationSafetyLimit: 20,
            },
        });
        providerFailure = true;
        const freeFailure = (
            await shopClient.query(CREATE, {
                input: {
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    prompt: '免费额度失败后必须释放',
                    referenceMode: 'NONE',
                    aspectRatio: '1:1',
                    resolution: '1K',
                    quantity: 1,
                    expectedUnitPrice: 100,
                    expectedChargeAmount: 0,
                    currencyCode: 'USD',
                    idempotencyKey: 'e2e-free-failure-0001',
                    termsAccepted: true,
                },
            })
        ).createImageGeneration;
        await waitForJob(freeFailure.id, ['FAILED']);
        providerFailure = false;
        const freeSuccess = (
            await shopClient.query(CREATE, {
                input: {
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    prompt: '失败释放后再次使用免费额度',
                    referenceMode: 'NONE',
                    aspectRatio: '1:1',
                    resolution: '1K',
                    quantity: 1,
                    expectedUnitPrice: 100,
                    expectedChargeAmount: 0,
                    currencyCode: 'USD',
                    idempotencyKey: 'e2e-free-success-0001',
                    termsAccepted: true,
                },
            })
        ).createImageGeneration;
        expect(freeSuccess.reservedAmount).toBe(0);
        const freeSucceeded = await waitForJob(freeSuccess.id, ['SUCCEEDED']);
        expect(freeSucceeded.myImageGenerationJob).toMatchObject({
            capturedAmount: 0,
            freeQuantityReserved: 1,
            freeQuantityCaptured: 1,
        });
        expect(freeSucceeded.imageStudioBalance).toBe(250);

        const retainedReference = await connection.rawConnection
            .getRepository(ImagePrivateAsset)
            .findOneByOrFail({ originalName: 'reference-fixture.png', kind: 'REFERENCE' });
        const remainingReferenceMs = retainedReference.expiresAt.getTime() - Date.now();
        expect(remainingReferenceMs).toBeGreaterThan(23 * 60 * 60_000);
        expect(remainingReferenceMs).toBeLessThanOrEqual(24 * 60 * 60_000);

        const costSummary = (await adminClient.query(COST_SUMMARY)).imageGenerationCostSummary;
        expect(costSummary.truncated).toBe(false);
        expect(costSummary.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    attempts: 6,
                    successes: 4,
                    failures: 2,
                    missingCostCount: 6,
                    grossRevenue: 375,
                    actualCost: 0,
                    knownCost: null,
                    costCurrency: 'UNKNOWN',
                }),
            ]),
        );
        await expect(
            connection.rawConnection.getRepository(ImageGenerationDispatch).countBy({ state: 'COMPLETED' }),
        ).resolves.toBe(6);

        const usageRecords = (
            await adminClient.query(USAGE_RECORDS, {
                input: { take: 100, customer: 'image-e2e@example.com' },
            })
        ).imageAiUsageRecords;
        expect(usageRecords.totalItems).toBeGreaterThanOrEqual(6);
        expect(usageRecords.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: freeSuccess.id,
                    recordType: 'IMAGE_GENERATION',
                    credentialCode: 'openai-e2e-primary',
                    state: 'SUCCEEDED',
                    billingMode: 'FREE',
                    freeQuantity: 1,
                    chargedAmount: 0,
                }),
                expect.objectContaining({
                    recordType: 'PROMPT_OPTIMIZATION',
                    state: 'SUCCEEDED',
                    customer: { emailAddress: 'image-e2e@example.com' },
                }),
            ]),
        );
        const usageDetail = (
            await adminClient.query(USAGE_RECORD_DETAIL, {
                recordType: 'IMAGE_GENERATION',
                id: freeSuccess.id,
            })
        ).imageAiUsageRecord;
        const promptUsage = usageRecords.items.find(
            (item: { recordType: string }) => item.recordType === 'PROMPT_OPTIMIZATION',
        );
        const promptDetail = (
            await adminClient.query(USAGE_RECORD_DETAIL, {
                recordType: 'PROMPT_OPTIMIZATION',
                id: promptUsage.id,
            })
        ).imageAiUsageRecord;
        expect(promptDetail.attempts).toHaveLength(1);
        expect(promptDetail.attempts[0].callId).toEqual(expect.any(String));
        const promptRepository = connection.rawConnection.getRepository(ImagePromptOptimization);
        const originalPrompt = await promptRepository.findOneByOrFail({
            id: server.app.get(ConfigService).entityOptions.entityIdStrategy.decodeId(promptUsage.id),
        });
        try {
            await promptRepository.update(originalPrompt.id, {
                attemptLedgerVersion: null,
                upstreamCallCount: 0,
            });
            const missing = (
                await adminClient.query(USAGE_RECORDS, {
                    input: { recordType: 'PROMPT_OPTIMIZATION', missingCostOnly: true, take: 100 },
                })
            ).imageAiUsageRecords;
            expect(missing.items.map((item: { id: string }) => String(item.id))).toContain(
                String(promptUsage.id),
            );
        } finally {
            await promptRepository.update(originalPrompt.id, {
                attemptLedgerVersion: originalPrompt.attemptLedgerVersion,
                upstreamCallCount: originalPrompt.upstreamCallCount,
            });
        }
        expect(usageDetail.inputPrompt).toBe('失败释放后再次使用免费额度');
        expect(usageDetail.record.costCompleteness).toBe('UNKNOWN');
        expect(usageDetail.attempts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    callId: expect.any(String),
                    headerRequestId: 'gateway-e2e-request',
                    modelResponseId: 'image-e2e-provider-request',
                    outcome: 'SUCCEEDED',
                    costSource: 'UNVERIFIED',
                }),
            ]),
        );
        expect(usageDetail.timeline).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ stage: '额度预占' }),
                expect.objectContaining({ stage: '额度消耗' }),
                expect.objectContaining({
                    stage: '选择 Key',
                    keyName: 'OpenAI E2E 主 Key',
                    keyLast4: '-key',
                }),
                expect.objectContaining({ stage: '上游调用', status: '成功' }),
                expect.objectContaining({ stage: '结果保存', status: '成功' }),
            ]),
        );

        expect(
            (await shopClient.query(DELETE_JOB, { id: referenceCreated.id })).deleteMyImageGenerationJob,
        ).toBe(true);
        const deletedJob = await connection.rawConnection
            .getRepository(ImageGenerationJob)
            .findOneByOrFail({ id: Number(String(referenceCreated.id).replace(/^T_/u, '')) });
        expect(deletedJob.customerDeletedAt).toBeInstanceOf(Date);
        await expect(connection.rawConnection.getRepository(ImageGenerationCostEvent).count()).resolves.toBe(
            6,
        );
    }, 30_000);

    it.runIf(config.dbConnectionOptions.type === 'mysql')(
        'reviews historical supplier costs through the real usage API and reopens corrected unknown fees',
        async () => {
            const source = server.app.get(TransactionalConnection).rawConnection;
            const prompts = source.getRepository(ImagePromptOptimization);
            const original = (await prompts.find({ take: 1 }))[0];
            const legacy = await prompts.save(
                new ImagePromptOptimization({
                    ...original,
                    id: undefined,
                    createdAt: undefined,
                    updatedAt: undefined,
                    idempotencyKey: randomUUID(),
                    attemptLedgerVersion: null,
                    upstreamCallCount: 2,
                    actualCostMicrounits: null,
                    costCurrency: null,
                }),
            );
            const image = (await source.getRepository(ImageGenerationCostEvent).find({ take: 1 }))[0];
            const makeReview = async (
                recordType: ImageBillingReview['recordType'],
                recordId: string,
                channelId: string,
            ): Promise<ImageBillingReview> => {
                const snapshot = await inspectImageBillingTarget(source, channelId, recordType, recordId);
                return {
                    batchId: 'api-e2e-review',
                    channelId,
                    recordType,
                    recordId,
                    expectedSnapshotHash: snapshot.snapshotHash,
                    previousAdjustmentId: snapshot.previousAdjustmentId,
                    sourceHash: 'a'.repeat(64),
                    reviewer: 'e2e-operator',
                    authorizationRef: 'e2e-approval',
                    reviewedAt: new Date().toISOString(),
                    reason: 'Fixture billing review',
                    reviewStatus: 'APPROVED',
                    completeRange: true,
                    newCostMicrounits: 2136,
                    newCurrency: 'USD',
                    bills: [
                        {
                            supplierScope: 'e2e',
                            billId: `${recordType}:${recordId}`,
                            amountMicrounits: 2136,
                            currency: 'USD',
                            billedAt: new Date().toISOString(),
                            displayedTime: '2026/09/13 13:00:00',
                            timeZone: 'UTC',
                            evidenceHash: 'b'.repeat(64),
                        },
                    ],
                };
            };
            const promptReview = await makeReview(
                'LEGACY_PROMPT',
                String(legacy.id),
                String(legacy.channelId),
            );
            await applyImageBillingReview(source, promptReview, true);
            await applyImageBillingReview(
                source,
                await makeReview('IMAGE_COST_EVENT', String(image.id), String(image.channelId)),
                true,
            );
            const encode = (id: string | number) =>
                server.app.get(ConfigService).entityOptions.entityIdStrategy.encodeId(id);
            const detail = (
                await adminClient.query(USAGE_RECORD_DETAIL, {
                    recordType: 'PROMPT_OPTIMIZATION',
                    id: encode(legacy.id),
                })
            ).imageAiUsageRecord;
            expect(detail.record.costCompleteness).toBe('COMPLETE');
            expect(detail.attempts).toEqual([]);
            expect(detail.costAdjustments).toEqual([
                expect.objectContaining({
                    batchId: 'api-e2e-review',
                    matchingStatus: 'CROSS_MATCH_REVIEWED',
                }),
            ]);
            const imageDetail = (
                await adminClient.query(USAGE_RECORD_DETAIL, {
                    recordType: 'IMAGE_GENERATION',
                    id: encode(image.jobIdSnapshot),
                })
            ).imageAiUsageRecord;
            expect(imageDetail.attempts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        matchingStatus: 'CROSS_MATCH_REVIEWED',
                        costSource: 'SUPPLIER_BILLING',
                    }),
                ]),
            );
            const missingIds = async () =>
                (
                    await adminClient.query(USAGE_RECORDS, {
                        input: { recordType: 'PROMPT_OPTIMIZATION', missingCostOnly: true, take: 100 },
                    })
                ).imageAiUsageRecords.items.map((item: { id: string }) => item.id);
            expect(await missingIds()).not.toContain(encode(legacy.id));
            // A complete multi-currency ledger has no single aggregate currency, but is not missing cost.
            const multi = await prompts.save(
                new ImagePromptOptimization({
                    ...original,
                    id: undefined,
                    createdAt: undefined,
                    updatedAt: undefined,
                    idempotencyKey: randomUUID(),
                    attemptLedgerVersion: 1,
                    upstreamCallCount: 2,
                    actualCostMicrounits: null,
                    costCurrency: null,
                }),
            );
            const attemptRepo = source.getRepository(ImagePromptOptimizationAttempt);
            const originalAttempt = (await attemptRepo.find({ take: 1 }))[0];
            for (const [index, currency] of ['USD', 'EUR'].entries())
                await attemptRepo.save(
                    new ImagePromptOptimizationAttempt({
                        ...originalAttempt,
                        id: undefined,
                        callId: randomUUID(),
                        optimizationIdSnapshot: String(multi.id),
                        attemptNumber: index + 1,
                        actualCostMicrounits: 1000,
                        costCurrency: currency,
                    }),
                );
            const multiDetail = (
                await adminClient.query(USAGE_RECORD_DETAIL, {
                    recordType: 'PROMPT_OPTIMIZATION',
                    id: encode(multi.id),
                })
            ).imageAiUsageRecord;
            expect(multiDetail.record.costCompleteness).toBe('COMPLETE');
            expect(await missingIds()).not.toContain(encode(multi.id));
            const jobs = source.getRepository(ImageGenerationJob);
            const existingJob = (await jobs.find({ take: 1 }))[0];
            const noCostJob = await jobs.save(
                new ImageGenerationJob({
                    ...existingJob,
                    id: undefined,
                    idempotencyKey: randomUUID(),
                    state: 'SUCCEEDED',
                }),
            );
            const missingImages = (
                await adminClient.query(USAGE_RECORDS, {
                    input: { recordType: 'IMAGE_GENERATION', missingCostOnly: true, take: 100 },
                })
            ).imageAiUsageRecords;
            expect(missingImages.items.map((item: { id: string }) => item.id)).toContain(
                encode(noCostJob.id),
            );
            const revert = {
                ...(await makeReview('LEGACY_PROMPT', String(legacy.id), String(legacy.channelId))),
                batchId: 'api-e2e-revert',
                newCostMicrounits: null,
                newCurrency: null,
                bills: promptReview.bills,
            };
            await applyImageBillingReview(source, revert, true);
            expect(await missingIds()).toContain(encode(legacy.id));
            const reverted = (
                await adminClient.query(USAGE_RECORD_DETAIL, {
                    recordType: 'PROMPT_OPTIMIZATION',
                    id: encode(legacy.id),
                })
            ).imageAiUsageRecord;
            expect(reverted.record.costCompleteness).toBe('UNKNOWN');
            expect(reverted.costAdjustments).toHaveLength(2);
        },
    );

    it('binds private images to the database owner and channel and revokes HTTP links', async () => {
        const upload = await shopClient.fileUploadMutation({
            mutation: UPLOAD_REFERENCE,
            filePaths: [referenceFixture],
            mapVariables: () => ({ file: null }),
        });
        const reference = upload.uploadImageReference;
        const connection = server.app.get(TransactionalConnection);
        const repository = connection.rawConnection.getRepository(ImagePrivateAsset);
        const asset = await repository.findOneByOrFail({
            id: Number(String(reference.id).replace(/^T_/u, '')),
        });
        const channel = await connection.rawConnection
            .getRepository(Channel)
            .findOneByOrFail({ id: asset.channelId });
        const ctx = new RequestContext({
            apiType: 'shop',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: true,
        });
        const otherChannel = new RequestContext({
            apiType: 'shop',
            channel: new Channel({ ...channel, id: 999999 }),
            isAuthorized: true,
            authorizedAsOwnerOnly: true,
        });
        const storage = server.app.get(ImagePrivateStorageService);
        expect(storage.signedUrl(ctx, asset, 999999)).toBeNull();
        expect(await storage.deleteOwned(ctx, asset.id, 999999)).toBe(false);
        expect(await storage.deleteOwned(otherChannel, asset.id, asset.customerId)).toBe(false);
        const url = `http://localhost:${config.apiOptions.port}${reference.previewUrl}`;
        const response = await originalFetch(url);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('image/png');
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
        expect((await response.arrayBuffer()).byteLength).toBe(asset.byteSize);
        expect((await originalFetch(url + 'x')).status).toBe(404);
        await repository.update(asset.id, { expiresAt: new Date(0) });
        expect((await originalFetch(url)).status).toBe(404);
        await repository.update(asset.id, { expiresAt: new Date(Date.now() + 60_000) });
        expect(await storage.deleteOwned(ctx, asset.id, asset.customerId)).toBe(true);
        expect((await originalFetch(url)).status).toBe(404);
    });
    // Audit 06/08/09: reference lifetime and replay use the actual GraphQL/storage path.
    it('protects shared references, returns the replay snapshot and releases unused uploads', async () => {
        const connection = server.app.get(TransactionalConnection);
        await connection.rawConnection
            .getRepository(ImageModelConfig)
            .update(
                { code: 'OPENAI_HIGH_QUALITY' },
                { dailyFreeImageUnlimited: true, dailyFreeImageLimit: 0 },
            );
        const upload = await shopClient.fileUploadMutation({
            mutation: UPLOAD_REFERENCE,
            filePaths: [referenceFixture],
            mapVariables: () => ({ file: null }),
        });
        const reference = upload.uploadImageReference;
        const input = {
            modelCode: 'OPENAI_HIGH_QUALITY',
            prompt: '参考图商品',
            optimizedPrompt: '保留参考图的商品包装',
            referenceMode: 'PRODUCT',
            referenceAssetIds: [reference.id],
            referenceInstruction: '保持包装',
            aspectRatio: '1:1',
            resolution: '1K',
            quantity: 1,
            expectedUnitPrice: 100,
            expectedChargeAmount: 0,
            currencyCode: 'USD',
            termsAccepted: true,
        };
        const a = (
            await shopClient.query(CREATE, { input: { ...input, idempotencyKey: 'e2e-shared-reference-a' } })
        ).createImageGeneration;
        await waitForJob(a.id, ['SUCCEEDED']);
        const queue = server.app.get(ImageGenerationQueueService);
        const pause = vi.spyOn(queue, 'dispatchOutput').mockResolvedValueOnce(undefined);
        const b = (
            await shopClient.query(CREATE, { input: { ...input, idempotencyKey: 'e2e-shared-reference-b' } })
        ).createImageGeneration;
        pause.mockRestore();
        await shopClient.query(
            gql`
                mutation Delete($id: ID!) {
                    deleteMyImageGenerationJob(id: $id)
                }
            `,
            { id: a.id },
        );
        expect(
            (
                await shopClient.query(
                    gql`
                        mutation Release($id: ID!) {
                            releaseImageReference(id: $id)
                        }
                    `,
                    { id: reference.id },
                )
            ).releaseImageReference,
        ).toBe(false);
        await waitForJob(b.id, ['SUCCEEDED']);
        const replay = (
            await shopClient.query(
                gql`
                    query Replay($id: ID!) {
                        myImageGenerationJob(id: $id) {
                            referenceAssetIds
                            referenceAssets {
                                id
                                previewUrl
                            }
                            referenceInstruction
                            optimizedPrompt
                            inputSnapshotVersion
                        }
                    }
                `,
                { id: b.id },
            )
        ).myImageGenerationJob;
        expect(replay).toMatchObject({
            referenceAssetIds: [reference.id],
            referenceInstruction: '保持包装',
            optimizedPrompt: '保留参考图的商品包装',
            inputSnapshotVersion: 1,
        });
        expect(replay.referenceAssets[0].previewUrl).toBeTruthy();
        const unused = (
            await shopClient.fileUploadMutation({
                mutation: UPLOAD_REFERENCE,
                filePaths: [referenceFixture],
                mapVariables: () => ({ file: null }),
            })
        ).uploadImageReference;
        expect(
            (
                await shopClient.query(
                    gql`
                        mutation Release($id: ID!) {
                            releaseImageReference(id: $id)
                        }
                    `,
                    { id: unused.id },
                )
            ).releaseImageReference,
        ).toBe(true);
        expect(
            (
                await shopClient.query(
                    gql`
                        mutation Release($id: ID!) {
                            releaseImageReference(id: $id)
                        }
                    `,
                    { id: unused.id },
                )
            ).releaseImageReference,
        ).toBe(true);
    }, 30_000);

    it.runIf(config.dbConnectionOptions.type === 'mysql')(
        'dispatches immediately across MySQL second rounding and preserves future retry deadlines',
        async () => {
            const queue = server.app.get(ImageGenerationQueueService);
            const connection = server.app.get(TransactionalConnection);
            const dispatches = connection.rawConnection.getRepository(ImageGenerationDispatch);
            const dispatchOutput = queue.dispatchOutput.bind(queue);
            const pause = vi.spyOn(queue, 'dispatchOutput').mockResolvedValue(undefined);
            const jobIds: string[] = [];
            const second = Math.floor(Date.now() / 1000) * 1000;
            try {
                vi.useFakeTimers({ toFake: ['Date'] });
                for (const milliseconds of [100, 900]) {
                    vi.setSystemTime(second + milliseconds);
                    const idempotencyKey = `e2e-dispatch-second-rounding-${milliseconds}`;
                    const jobId = (
                        await shopClient.query(CREATE, {
                            input: {
                                modelCode: 'OPENAI_HIGH_QUALITY',
                                prompt: '即时队列派发回归',
                                aspectRatio: '1:1',
                                resolution: '1K',
                                quantity: 1,
                                expectedUnitPrice: 100,
                                expectedChargeAmount: 0,
                                currencyCode: 'USD',
                                termsAccepted: true,
                                idempotencyKey,
                            },
                        })
                    ).createImageGeneration.id;
                    jobIds.push(jobId);
                    const persisted = await connection.rawConnection
                        .getRepository(ImageGenerationJob)
                        .findOneByOrFail({ idempotencyKey });
                    const output = await connection.rawConnection
                        .getRepository(ImageGenerationOutput)
                        .findOneByOrFail({ jobId: persisted.id });
                    const pending = await dispatches.findOneByOrFail({ outputId: output.id });
                    expect(pending.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());

                    // Re-entering dispatch must not override a persisted retry delay.
                    const future = new Date(second + 60_000);
                    await dispatches.update(pending.id, { nextAttemptAt: future, attemptCount: 2 });
                    await dispatchOutput(output.id);
                    const retry = await dispatches.findOneByOrFail({ outputId: output.id });
                    expect(retry.state).toBe('PENDING');
                    expect(retry.attemptCount).toBe(2);
                    expect(retry.nextAttemptAt).toEqual(future);
                    expect(retry.queueTaskId).toBeNull();

                    await dispatches.update(pending.id, { nextAttemptAt: pending.nextAttemptAt });
                    await dispatchOutput(output.id);
                    const dispatched = await dispatches.findOneByOrFail({ outputId: output.id });
                    expect(dispatched.state).toBe('DISPATCHED');
                    expect(dispatched.queueTaskId).toBeTruthy();
                }
            } finally {
                vi.useRealTimers();
                pause.mockRestore();
            }
            for (const jobId of jobIds) await waitForJob(jobId, ['SUCCEEDED']);
        },
        30_000,
    );

    // Audit 05/07: distinct HTTP requests and real MySQL connections exercise row locks.
    it.runIf(config.dbConnectionOptions.type === 'mysql')(
        'serializes refund and optimization requests across database connections',
        async () => {
            const connection = server.app.get(TransactionalConnection);
            await connection.rawConnection
                .getRepository(ImageGenerationConfig)
                .createQueryBuilder()
                .update()
                .set({
                    promptRateLimitPerMinute: 100,
                    promptDailyFreeUnlimited: true,
                    promptDailyFreeLimit: 0,
                })
                .execute();
            const before = promptCallCount;
            const input = {
                prompt: '并发描述优化',
                referenceMode: 'NONE',
                idempotencyKey: 'e2e-concurrent-prompt',
            };
            const optimizations = await Promise.allSettled([
                shopClient.query(OPTIMIZE, { input }),
                shopClient.query(OPTIMIZE, { input }),
            ]);
            expect(optimizations.some(result => result.status === 'fulfilled')).toBe(true);
            expect(promptCallCount - before).toBe(1);
            expect(
                await connection.rawConnection
                    .getRepository(ImagePromptOptimization)
                    .count({ where: { idempotencyKey: input.idempotencyKey } }),
            ).toBe(1);
            const created = (
                await shopClient.query(CREATE, {
                    input: {
                        modelCode: 'OPENAI_HIGH_QUALITY',
                        prompt: '并发退款三张免费商品图',
                        referenceMode: 'NONE',
                        aspectRatio: '1:1',
                        resolution: '1K',
                        quantity: 3,
                        expectedUnitPrice: 100,
                        expectedChargeAmount: 0,
                        currencyCode: 'USD',
                        termsAccepted: true,
                        idempotencyKey: 'e2e-concurrent-refund',
                    },
                })
            ).createImageGeneration;
            const completed = (await waitForJob(created.id, ['SUCCEEDED'])).myImageGenerationJob;
            const refunds = await Promise.allSettled([
                adminClient.query(REFUND_OUTPUT, { outputId: completed.outputs[0].id }),
                adminClient.query(REFUND_OUTPUT, { outputId: completed.outputs[0].id }),
            ]);
            expect(refunds.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            const job = await connection.rawConnection
                .getRepository(ImageGenerationJob)
                .findOneByOrFail({ idempotencyKey: 'e2e-concurrent-refund' });
            if (!job.quotaEventId) throw new Error('Missing quota event');
            const event = await connection.rawConnection
                .getRepository(ImageUsageQuotaEvent)
                .findOneByOrFail({ id: job.quotaEventId });
            expect(event.consumedAmount).toBe(2);
            expect(event.releasedAmount).toBe(1);
            await Promise.all([
                adminClient.query(REFUND_OUTPUT, { outputId: completed.outputs[1].id }),
                adminClient.query(REFUND_OUTPUT, { outputId: completed.outputs[2].id }),
            ]);
            const fullyRefunded = await connection.rawConnection
                .getRepository(ImageUsageQuotaEvent)
                .findOneByOrFail({ id: job.quotaEventId });
            expect(fullyRefunded.consumedAmount).toBe(0);
            expect(fullyRefunded.releasedAmount).toBe(3);
            expect(
                (
                    await connection.rawConnection
                        .getRepository(ImageGenerationJob)
                        .findOneByOrFail({ id: job.id })
                ).freeQuantityCaptured,
            ).toBe(0);
        },
        30_000,
    );

    it.each(['PAID', 'FREE'])(
        'recovers a live optimization and persists late provider cost with no recapture (%s)',
        async billingMode => {
            const connection = server.app.get(TransactionalConnection);
            const engine = server.app.get(ImagePromptEngineService);
            const rules = server.app.get(PromptRulesService);
            const customer = await connection.rawConnection
                .getRepository(Customer)
                .findOneByOrFail({ emailAddress: 'image-e2e@example.com' });
            const reference = await connection.rawConnection.getRepository(ImagePrivateAsset).findOneOrFail({
                where: {
                    customerId: customer.id,
                    kind: 'REFERENCE',
                    deletedAt: IsNull(),
                    expiresAt: MoreThan(new Date()),
                },
            });
            await connection.rawConnection.getRepository(ImageGenerationConfig).update(
                { channelId: reference.channelId },
                {
                    promptRateLimitPerMinute: 100,
                    promptDailyFreeUnlimited: billingMode === 'FREE',
                    promptDailyFreeLimit: 0,
                    paidPromptOptimizationEnabled: true,
                    paidPromptOptimizationPrice: 50,
                    paidPromptOptimizationCurrencyCode: CurrencyCode.USD,
                },
            );
            const input = {
                prompt: 'Create a product image of the item in image 1',
                referenceMode: 'PRODUCT',
                referenceInstruction: 'Keep the coffee bag packaging and remove the person.',
                referenceAssetIds: [String(reference.id)],
                expectedPrice: 50,
                currencyCode: 'USD',
                idempotencyKey: `e2e-late-prompt-${billingMode}`,
            };
            const reply = deferred<any>();
            const started = deferred<void>();
            const provider = vi
                .spyOn(server.app.get(ImageProviderClient), 'optimizePrompt')
                .mockImplementationOnce(() => {
                    started.resolve();
                    return reply.promise;
                });
            const execution = shopClient.query(OPTIMIZE, { input });
            try {
                await Promise.race([
                    started.promise,
                    execution.then(() => {
                        throw new Error('Provider gate was bypassed');
                    }),
                ]);
                const repository = connection.rawConnection.getRepository(ImagePromptOptimization);
                const pending = await repository.findOneByOrFail({ idempotencyKey: input.idempotencyKey });
                const recovered = await Promise.all([
                    engine.recoverPendingOptimizations(new Date(Date.now() + 10000)),
                    engine.recoverPendingOptimizations(new Date(Date.now() + 10000)),
                ]);
                expect(recovered.reduce((sum, count) => sum + count, 0)).toBe(1);
                const fallback = await repository.findOneByOrFail({ id: pending.id });
                expect(fallback.optimizedPrompt).toBe(pending.optimizedPrompt);
                expect(fallback.optimizedPrompt).toContain(input.referenceInstruction);
                expect(fallback.optimizedPrompt).toContain('Subject:');
                reply.resolve({
                    text: JSON.stringify(rules.fallbackSpec('Coffee bag', 'PRODUCT', 'en')),
                    telemetry: {
                        actualCostMicrounits: 137,
                        costCurrency: 'USD',
                        usage: { input_tokens: 4, output_tokens: 6 },
                    },
                });
                await execution;
                const finished = await repository.findOneByOrFail({ id: pending.id });
                expect(finished).toMatchObject({
                    source: 'FALLBACK',
                    billingMode: billingMode === 'PAID' ? 'REFUNDED' : 'RELEASED',
                    chargedAmount: 0,
                    actualCostMicrounits: 137,
                    costCurrency: 'USD',
                    upstreamCallCount: 1,
                    inputTokens: 4,
                    outputTokens: 6,
                });
                expect(finished.optimizedPrompt).toBe(pending.optimizedPrompt);
                if (billingMode === 'PAID') {
                    if (!finished.walletUsageId) throw new Error('Missing wallet reservation');
                    const usage = await connection.rawConnection
                        .getRepository(ReferralWalletUsage)
                        .findOneByOrFail({ id: finished.walletUsageId });
                    expect(usage.capturedAmount).toBe(0);
                    expect(usage.releasedAmount).toBe(50);
                } else {
                    if (!finished.quotaEventId) throw new Error('Missing quota reservation');
                    const quota = await connection.rawConnection
                        .getRepository(ImageUsageQuotaEvent)
                        .findOneByOrFail({ id: finished.quotaEventId });
                    expect(quota.consumedAmount).toBe(0);
                    expect(quota.releasedAmount).toBe(1);
                }
                await shopClient.query(OPTIMIZE, { input });
                expect(provider).toHaveBeenCalledTimes(1);
                expect((await repository.findOneByOrFail({ id: pending.id })).actualCostMicrounits).toBe(137);
            } finally {
                reply.resolve({ text: '{}' });
                await execution.catch(() => undefined);
                provider.mockRestore();
            }
        },
    );

    it('previews the same final prompt budget before any generation reservation', async () => {
        const connection = server.app.get(TransactionalConnection);
        const jobs = connection.rawConnection.getRepository(ImageGenerationJob);
        const quotas = connection.rawConnection.getRepository(ImageUsageQuotaEvent);
        const before = { jobs: await jobs.count(), quotas: await quotas.count(), calls: promptCallCount };
        const input = {
            prompt: '袋装咖啡',
            optimizedPrompt: '袋'.repeat(7900),
            referenceMode: 'PRODUCT',
            referenceAssetIds: ['1', '2'],
            referenceInstruction: '保留包装'.repeat(50),
        };
        const { previewImageGenerationPrompt: budget } = await shopClient.query(
            gql`
                query Budget($input: OptimizeImagePromptInput!) {
                    previewImageGenerationPrompt(input: $input) {
                        length
                        limit
                        valid
                    }
                }
            `,
            { input },
        );
        expect(budget.length).toBeGreaterThan(8000);
        expect(budget.valid).toBe(false);
        expect(await jobs.count()).toBe(before.jobs);
        expect(await quotas.count()).toBe(before.quotas);
        expect(promptCallCount).toBe(before.calls);
        const shortInput = {
            prompt: '袋装咖啡',
            optimizedPrompt: '白底袋装咖啡商品图',
            referenceMode: 'NONE',
        };
        const { previewImageGenerationPrompt: valid } = await shopClient.query(
            gql`
                query Budget($input: OptimizeImagePromptInput!) {
                    previewImageGenerationPrompt(input: $input) {
                        length
                        limit
                        valid
                    }
                }
            `,
            { input: shortInput },
        );
        const created = (
            await shopClient.query(CREATE, {
                input: {
                    ...shortInput,
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    aspectRatio: '1:1',
                    resolution: '1K',
                    quantity: 1,
                    expectedUnitPrice: 100,
                    expectedChargeAmount: 0,
                    currencyCode: 'USD',
                    termsAccepted: true,
                    idempotencyKey: 'e2e-preview-budget',
                },
            })
        ).createImageGeneration;
        const persisted = await jobs.findOneByOrFail({ idempotencyKey: 'e2e-preview-budget' });
        expect(persisted.finalPrompt.length).toBe(valid.length);
        await waitForJob(created.id, ['SUCCEEDED']);
    });

    it.runIf(config.dbConnectionOptions.type === 'mysql')(
        'does not purge a reference retained by an uncommitted generation',
        async () => {
            const connection = server.app.get(TransactionalConnection);
            const storage = server.app.get(ImagePrivateStorageService);
            const customer = await connection.rawConnection
                .getRepository(Customer)
                .findOneByOrFail({ emailAddress: 'image-e2e@example.com' });
            const channel = await connection.rawConnection
                .getRepository(Channel)
                .findOneByOrFail({ code: '__default_channel__' });
            const ctx = await server.app
                .get(RequestContextService)
                .create({ apiType: 'shop', channelOrToken: channel });
            const asset = await storage.storeReference(ctx, customer.id, {
                filename: 'concurrent.png',
                mimetype: 'image/png',
                createReadStream: () => createReadStream(referenceFixture),
            });
            const repository = connection.rawConnection.getRepository(ImagePrivateAsset);
            const expiry = Date.now() + 3000;
            await repository.update(asset.id, {
                expiresAt: new Date(expiry),
                createdAt: new Date(Date.now() - 120000),
            });
            const storedExpiry = (await repository.findOneByOrFail({ id: asset.id })).expiresAt.getTime();
            const held = deferred<void>();
            const commit = deferred<void>();
            const selected = deferred<void>();
            const retain = storage.retainReferenceWhileActive.bind(storage);
            const retainSpy = vi
                .spyOn(storage, 'retainReferenceWhileActive')
                .mockImplementation(async (tx, id) => {
                    await retain(tx, id);
                    if (String(id) === String(asset.id)) {
                        held.resolve();
                        await commit.promise;
                    }
                });
            const queryBuilder = repository.createQueryBuilder.bind(repository);
            const querySpy = vi.spyOn(repository, 'createQueryBuilder').mockImplementation((...args) => {
                const query = queryBuilder(...args);
                const getMany = query.getMany.bind(query);
                query.getMany = async () => {
                    const found = await getMany();
                    if (found.some(item => String(item.id) === String(asset.id))) selected.resolve();
                    return found;
                };
                return query;
            });
            const creation = shopClient.query(CREATE, {
                input: {
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    prompt: '保留参考图的袋装商品',
                    referenceMode: 'PRODUCT',
                    referenceAssetIds: [String(asset.id)],
                    aspectRatio: '1:1',
                    resolution: '1K',
                    quantity: 1,
                    expectedUnitPrice: 100,
                    expectedChargeAmount: 0,
                    currencyCode: 'USD',
                    termsAccepted: true,
                    idempotencyKey: 'e2e-expiry-create-race',
                },
            });
            let cleanup: Promise<number> | undefined;
            try {
                await Promise.race([
                    held.promise,
                    creation.then(() => {
                        throw new Error('Missing retention gate');
                    }),
                ]);
                await vi.waitFor(() => expect(Date.now()).toBeGreaterThanOrEqual(storedExpiry), {
                    timeout: 5000,
                    interval: 30,
                });
                const beforeSweep = await repository.findOneByOrFail({ id: asset.id });
                expect(beforeSweep.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
                cleanup = storage.purgeExpired();
                await Promise.race([
                    selected.promise,
                    cleanup.then(() => {
                        throw new Error('Cleanup did not select the expiring reference');
                    }),
                ]);
                commit.resolve();
                const created = (await creation).createImageGeneration;
                await cleanup;
                await waitForJob(created.id, ['SUCCEEDED']);
                const retained = await repository.findOneByOrFail({ id: asset.id });
                expect(retained.deletedAt).toBeNull();
                expect(retained.expiresAt.getTime()).toBeGreaterThan(Date.now());
                expect((await storage.read(retained)).length).toBeGreaterThan(0);
            } finally {
                commit.resolve();
                await creation.catch(() => undefined);
                await cleanup?.catch(() => undefined);
                retainSpy.mockRestore();
                querySpy.mockRestore();
            }
        },
        20000,
    );

    // Audit 03: a channel administrator cannot change platform-wide prompt rules.
    it('denies global skill activation to a channel image administrator', async () => {
        const role = (
            await adminClient.query(gql`
                mutation {
                    createRole(
                        input: {
                            code: "image-store-admin"
                            description: "Image audit fixture"
                            permissions: [ReadImageGeneration, UpdateImageGeneration]
                        }
                    ) {
                        id
                    }
                }
            `)
        ).createRole;
        await adminClient.query(
            gql`
                mutation Admin($role: ID!) {
                    createAdministrator(
                        input: {
                            firstName: "Image"
                            lastName: "Audit"
                            emailAddress: "image-admin-e2e@example.com"
                            password: "ImageAdminFixture123!"
                            roleIds: [$role]
                        }
                    ) {
                        id
                    }
                }
            `,
            { role: role.id },
        );
        const releases = (
            await adminClient.query(gql`
                query {
                    imagePromptSkillReleases {
                        id
                    }
                }
            `)
        ).imagePromptSkillReleases;
        const configs = server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(ImageGenerationConfig);
        const current = await configs.findOneByOrFail({ defaultModelCode: 'OPENAI_HIGH_QUALITY' });
        const configInput = {
            enabled: current.enabled,
            promptOptimizationEnabled: current.promptOptimizationEnabled,
            promptRateLimitPerMinute: current.promptRateLimitPerMinute,
            promptDailyFreeLimit: current.promptDailyFreeLimit,
            promptDailyFreeUnlimited: current.promptDailyFreeUnlimited,
            paidPromptOptimizationEnabled: current.paidPromptOptimizationEnabled,
            paidPromptOptimizationPrice: current.paidPromptOptimizationPrice,
            paidPromptOptimizationCurrencyCode: current.paidPromptOptimizationCurrencyCode,
            defaultModelCode: current.defaultModelCode,
            termsVersion: current.termsVersion,
            termsZh: current.termsZh,
            termsEn: current.termsEn,
        };
        await adminClient.asUserWithCredentials('image-admin-e2e@example.com', 'ImageAdminFixture123!');
        try {
            await adminClient.query(SAVE_CONFIG, {
                input: { ...configInput, termsVersion: 'e2e-store-admin-edit' },
            });
            expect((await configs.findOneByOrFail({ id: current.id })).termsVersion).toBe(
                'e2e-store-admin-edit',
            );
            const visible = await adminClient.query(gql`
                query {
                    imagePromptSkillReleases {
                        id
                    }
                }
            `);
            expect(visible.imagePromptSkillReleases).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: releases[0].id })]),
            );
            await expect(
                adminClient.query(
                    gql`
                        mutation Activate($id: ID!) {
                            activateImagePromptSkillRelease(id: $id) {
                                id
                            }
                        }
                    `,
                    { id: releases[0].id },
                ),
            ).rejects.toThrow();
        } finally {
            await adminClient.asSuperAdmin();
            await adminClient.query(SAVE_CONFIG, { input: configInput });
        }
        const activated = await adminClient.query(
            gql`
                mutation Activate($id: ID!) {
                    activateImagePromptSkillRelease(id: $id) {
                        id
                        status
                    }
                }
            `,
            { id: releases[0].id },
        );
        expect(activated.activateImagePromptSkillRelease).toEqual({
            id: releases[0].id,
            status: 'ACTIVE',
        });
    });

    it.runIf(config.dbConnectionOptions.type === 'mysql')(
        'serializes competing uploads at the minute quota using real database locks',
        async () => {
            const connection = server.app.get(TransactionalConnection);
            const customer = await connection.rawConnection
                .getRepository(Customer)
                .findOneByOrFail({ emailAddress: 'image-e2e@example.com' });
            const repository = connection.rawConnection.getRepository(ImagePrivateAsset);
            const where = {
                customerId: customer.id,
                kind: 'REFERENCE',
                createdAt: MoreThanOrEqual(new Date(Date.now() - 60_000)),
            };
            const count = await repository.count({ where });
            const upload = () =>
                shopClient.fileUploadMutation({
                    mutation: UPLOAD_REFERENCE,
                    filePaths: [referenceFixture],
                    mapVariables: () => ({ file: null }),
                });
            for (let index = count; index < 4; index++) await upload();
            const results = await Promise.allSettled([upload(), upload()]);
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            const rejected = results.find(result => result.status === 'rejected');
            expect(rejected?.status === 'rejected' ? String(rejected.reason) : '').toContain(
                '每分钟最多上传 5 张',
            );
            expect(await repository.count({ where })).toBe(5);
        },
    );
    // Audit 05: roll back after the money/quota write, then race independent refund requests.
    it.each(['PAID', 'MIXED', 'FREE'])(
        'rolls back and serializes refunds without duplicating cash or quota (%s)',
        async mode => {
            const connection = server.app.get(TransactionalConnection);
            const customer = await connection.rawConnection
                .getRepository(Customer)
                .findOneByOrFail({ emailAddress: 'image-e2e@example.com' });
            const modelRepository = connection.rawConnection.getRepository(ImageModelConfig);
            const model = await modelRepository.findOneByOrFail({ code: 'OPENAI_HIGH_QUALITY' });
            const restore = {
                freeImageEnabled: model.freeImageEnabled,
                dailyFreeImageUnlimited: model.dailyFreeImageUnlimited,
                dailyFreeImageLimit: model.dailyFreeImageLimit,
                dailyGenerationSafetyLimit: model.dailyGenerationSafetyLimit,
            };
            const bucket = await connection.rawConnection.getRepository(ImageUsageQuotaBucket).findOne({
                where: {
                    customerId: customer.id,
                    channelId: model.channelId,
                    quotaType: 'IMAGE_DAILY_FREE',
                    modelCode: model.code,
                    windowEndsAt: MoreThan(new Date()),
                },
            });
            await modelRepository.update(
                { id: model.id },
                {
                    freeImageEnabled: mode !== 'PAID',
                    dailyFreeImageUnlimited: mode === 'FREE',
                    dailyFreeImageLimit:
                        mode === 'FREE' ? 0 : (bucket?.consumed ?? 0) + (bucket?.reserved ?? 0) + 1,
                    dailyGenerationSafetyLimit: 100,
                },
            );
            const encodedCustomer = (
                await adminClient.query(FIND_CUSTOMER, {
                    email: 'image-e2e@example.com',
                })
            ).customers.items[0].id;
            await adminClient.query(ADJUST_BALANCE, { customerId: encodedCustomer, amount: 1000 });
            const wallets = connection.rawConnection.getRepository(ReferralWallet);
            const before = await wallets.findOneByOrFail({
                customerId: customer.id,
                currencyCode: CurrencyCode.USD,
            });
            const key = `e2e-refund-matrix-${mode}`;
            const charge = mode === 'FREE' ? 0 : mode === 'MIXED' ? 200 : 300;
            try {
                const created = (
                    await shopClient.query(CREATE, {
                        input: {
                            modelCode: model.code,
                            prompt: `Refund matrix ${mode}`,
                            referenceMode: 'NONE',
                            aspectRatio: '1:1',
                            resolution: '1K',
                            quantity: 3,
                            expectedUnitPrice: 100,
                            expectedChargeAmount: charge,
                            currencyCode: 'USD',
                            termsAccepted: true,
                            idempotencyKey: key,
                        },
                    })
                ).createImageGeneration;
                const completed = (await waitForJob(created.id, ['SUCCEEDED'])).myImageGenerationJob;
                const jobs = connection.rawConnection.getRepository(ImageGenerationJob);
                const job = await jobs.findOneByOrFail({ idempotencyKey: key });
                const outputs = connection.rawConnection.getRepository(ImageGenerationOutput);
                const persisted = await outputs.find({
                    where: { jobId: job.id },
                    order: { outputIndex: 'ASC' },
                });
                expect(persisted.filter(output => output.billingMode === 'FREE')).toHaveLength(
                    mode === 'FREE' ? 3 : mode === 'MIXED' ? 1 : 0,
                );
                expect((await wallets.findOneByOrFail({ id: before.id })).availableBalance).toBe(
                    before.availableBalance - charge,
                );
                const target = persisted.find(output => output.billingMode === 'PAID') ?? persisted[0];
                const targetId = completed.outputs.find(
                    (output: any) => output.outputIndex === target.outputIndex,
                ).id;
                const refundOwner =
                    target.billingMode === 'FREE'
                        ? server.app.get(ImageUsageQuotaService)
                        : server.app.get(ReferralWalletSpendService);
                const method = target.billingMode === 'FREE' ? 'refundConsumed' : 'refundCaptured';
                const original = (refundOwner as any)[method].bind(refundOwner);
                const rollback = vi
                    .spyOn(
                        refundOwner as unknown as Record<string, (...args: any[]) => Promise<unknown>>,
                        method,
                    )
                    .mockImplementationOnce(async (...args: any[]) => {
                        await original(...args);
                        throw new Error('e2e rollback after refund write');
                    });
                try {
                    await expect(adminClient.query(REFUND_OUTPUT, { outputId: targetId })).rejects.toThrow(
                        'e2e rollback',
                    );
                } finally {
                    rollback.mockRestore();
                }
                expect((await outputs.findOneByOrFail({ id: target.id })).refundedAt).toBeNull();
                expect((await wallets.findOneByOrFail({ id: before.id })).availableBalance).toBe(
                    before.availableBalance - charge,
                );
                if (job.quotaEventId) {
                    expect(
                        (
                            await connection.rawConnection
                                .getRepository(ImageUsageQuotaEvent)
                                .findOneByOrFail({ id: job.quotaEventId })
                        ).consumedAmount,
                    ).toBe(job.freeQuantityReserved);
                }
                const raced = await Promise.allSettled([
                    adminClient.query(REFUND_OUTPUT, { outputId: targetId }),
                    adminClient.query(REFUND_OUTPUT, { outputId: targetId }),
                ]);
                expect(raced.filter(result => result.status === 'fulfilled')).toHaveLength(1);
                await Promise.all(
                    completed.outputs
                        .filter((output: any) => output.id !== targetId)
                        .map((output: any) => adminClient.query(REFUND_OUTPUT, { outputId: output.id })),
                );
                expect(
                    (await outputs.find({ where: { jobId: job.id } })).every(output => output.refundedAt),
                ).toBe(true);
                expect(await wallets.findOneByOrFail({ id: before.id })).toMatchObject({
                    availableBalance: before.availableBalance,
                    reservedBalance: 0,
                });
                expect(await jobs.findOneByOrFail({ id: job.id })).toMatchObject({
                    capturedAmount: 0,
                    freeQuantityCaptured: 0,
                });
                if (job.walletUsageId) {
                    expect(
                        await connection.rawConnection
                            .getRepository(ReferralWalletUsage)
                            .findOneByOrFail({ id: job.walletUsageId }),
                    ).toMatchObject({ capturedAmount: 0, releasedAmount: charge });
                }
                if (job.quotaEventId) {
                    expect(
                        await connection.rawConnection
                            .getRepository(ImageUsageQuotaEvent)
                            .findOneByOrFail({ id: job.quotaEventId }),
                    ).toMatchObject({ consumedAmount: 0, releasedAmount: job.freeQuantityReserved });
                }
            } finally {
                await modelRepository.update({ id: model.id }, restore);
            }
        },
        30_000,
    );
    it('serializes UNKNOWN retries for two outputs without changing either provider identity', async () => {
        const connection = server.app.get(TransactionalConnection);
        const modelRepository = connection.rawConnection.getRepository(ImageModelConfig);
        const model = await modelRepository.findOneByOrFail({ code: 'OPENAI_HIGH_QUALITY' });
        await modelRepository.update(
            { id: model.id },
            {
                supportsIdempotency: true,
                unitPrice: 100,
                freeImageEnabled: false,
                dailyFreeImageUnlimited: false,
                dailyFreeImageLimit: 0,
                dailyGenerationSafetyLimit: 100,
            },
        );
        const calls: Array<{ code: string; key: string; protocol: string }> = [];
        let unknown = true;
        const provider = vi
            .spyOn(server.app.get(ImageProviderClient), 'generate')
            .mockImplementation((credential, protocol, input) => {
                calls.push({ code: credential.code, key: input.idempotencyKey, protocol });
                if (unknown)
                    return Promise.reject(
                        new AmbiguousImageProviderError('e2e provider result unknown', {
                            retryAfterSeconds: 0,
                        }),
                    );
                return Promise.resolve({
                    bytes: Buffer.from(generatedPngBase64, 'base64'),
                    mimeType: 'image/png',
                });
            });
        const retry = gql`
            mutation RetryUnknown($outputId: ID!) {
                retryUnknownImageOutput(outputId: $outputId) {
                    id
                    state
                }
            }
        `;
        try {
            const created = (
                await shopClient.query(CREATE, {
                    input: {
                        modelCode: model.code,
                        prompt: 'UNKNOWN multi-output identity',
                        referenceMode: 'NONE',
                        aspectRatio: '1:1',
                        resolution: '1K',
                        quantity: 2,
                        expectedUnitPrice: 100,
                        expectedChargeAmount: 200,
                        currencyCode: 'USD',
                        termsAccepted: true,
                        idempotencyKey: 'e2e-unknown-multi-output',
                    },
                })
            ).createImageGeneration;
            let pending = (await waitForJob(created.id, ['UNKNOWN'])).myImageGenerationJob;
            await vi.waitFor(
                async () => {
                    pending = (await shopClient.query(MY_JOB, { id: created.id })).myImageGenerationJob;
                    expect(pending.outputs.map((output: any) => output.state)).toEqual([
                        'UNKNOWN',
                        'UNKNOWN',
                    ]);
                },
                { timeout: 5000, interval: 50 },
            );
            const repository = connection.rawConnection.getRepository(ImageGenerationJob);
            const before = await repository.findOneByOrFail({ idempotencyKey: 'e2e-unknown-multi-output' });
            unknown = false;
            const attempts = await Promise.allSettled(
                pending.outputs.flatMap((output: any) => [
                    adminClient.query(retry, { outputId: output.id }),
                    adminClient.query(retry, { outputId: output.id }),
                ]),
            );
            expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(2);
            const completed = (await waitForJob(created.id, ['SUCCEEDED'])).myImageGenerationJob;
            expect(completed.capturedAmount).toBe(200);
            const after = await repository.findOneByOrFail({ id: before.id });
            expect(after.providerCredentialCodeSnapshot).toBe(before.providerCredentialCodeSnapshot);
            expect(after.providerCredentialFingerprint).toBe(before.providerCredentialFingerprint);
            expect(calls).toHaveLength(4);
            for (const first of calls.slice(0, 2)) {
                const attemptsForKey = calls.filter(call => call.key === first.key);
                expect(attemptsForKey).toHaveLength(2);
                expect(attemptsForKey[1]).toEqual(first);
            }
            expect(new Set(calls.map(call => call.code))).toEqual(
                new Set([before.providerCredentialCodeSnapshot]),
            );
        } finally {
            provider.mockRestore();
        }
    }, 30_000);

    // Optional cross-package acceptance uses the storefront's existing Playwright/Vite dependencies.
    it.runIf(process.env.E2E_IMAGE_STUDIO_BROWSER === '1')(
        'completes browser upload, optimization, generation, private download and replay against real APIs',
        async () => {
            await adminClient.asSuperAdmin();
            const credentials = { email: 'browser-image-e2e@example.com', password: randomUUID() };
            await shopClient.query(REGISTER, {
                input: {
                    emailAddress: credentials.email,
                    password: credentials.password,
                    firstName: 'Browser',
                    lastName: 'Fixture',
                },
            });
            const customerId = (await adminClient.query(FIND_CUSTOMER, { email: credentials.email }))
                .customers.items[0].id;
            await adminClient.query(ADJUST_BALANCE, { customerId, amount: 1000 });
            const connection = server.app.get(TransactionalConnection);
            const model = await connection.rawConnection
                .getRepository(ImageModelConfig)
                .findOneByOrFail({ code: 'OPENAI_HIGH_QUALITY' });
            await connection.rawConnection.getRepository(ImageModelConfig).update(
                { id: model.id },
                {
                    freeImageEnabled: false,
                    dailyFreeImageUnlimited: false,
                    dailyFreeImageLimit: 0,
                    dailyGenerationSafetyLimit: 100,
                },
            );
            await connection.rawConnection.getRepository(ImageGenerationConfig).update(
                { channelId: model.channelId },
                {
                    promptDailyFreeUnlimited: false,
                    promptDailyFreeLimit: 0,
                    paidPromptOptimizationEnabled: true,
                    paidPromptOptimizationPrice: 50,
                    paidPromptOptimizationCurrencyCode: CurrencyCode.USD,
                },
            );
            await connection.rawConnection
                .getRepository(ImageModelConfig)
                .update({ id: model.id }, { unitPrice: 100 });
            promptFixtureSubject = '袋装咖啡包装';
            const runnerUrl = new URL('../../storefront/e2e/ai-image-studio/verify.mjs', import.meta.url);
            const { verifyImageStudioApi } = await import(runnerUrl.href);
            const result = await verifyImageStudioApi({
                backendOrigin: `http://127.0.0.1:${config.apiOptions.port}`,
                credentials,
                referencePath: referenceFixture,
                outputDirectory: path.resolve(__dirname, '../../../reports/ai-image-studio-audit-20260913'),
            });
            const customer = await connection.rawConnection
                .getRepository(Customer)
                .findOneByOrFail({ emailAddress: credentials.email });
            const jobs = await connection.rawConnection.getRepository(ImageGenerationJob).find({
                where: { customerId: customer.id },
                relations: { outputs: true },
                order: { createdAt: 'ASC' },
            });
            expect(jobs).toHaveLength(2);
            expect(jobs.every(job => job.state === 'SUCCEEDED' && job.capturedAmount === 100)).toBe(true);
            expect(jobs.every(job => job.referenceAssetId && job.referenceMode === 'PRODUCT')).toBe(true);
            expect(String(jobs[0].referenceAssetId)).toBe(String(jobs[1].referenceAssetId));
            expect(jobs[1].finalPrompt).toContain('背景改为浅灰色');
            const optimization = await connection.rawConnection
                .getRepository(ImagePromptOptimization)
                .findOneByOrFail({ customerId: customer.id });
            expect(optimization).toMatchObject({ billingMode: 'PAID', chargedAmount: 50, source: 'MODEL' });
            expect(
                await connection.rawConnection
                    .getRepository(ReferralWallet)
                    .findOneByOrFail({ customerId: customer.id, currencyCode: CurrencyCode.USD }),
            ).toMatchObject({ availableBalance: 750, reservedBalance: 0 });
            expect((await sharp(result.downloadPath).metadata()).format).toBe('png');
            expect(providerSawReference).toBe(true);
        },
        120_000,
    );
    it('recovers a committed image after the server restarts with pending cost bookkeeping', async () => {
        const connection = server.app.get(TransactionalConnection);
        const queue = server.app.get(ImageGenerationQueueService);
        const model = await connection.rawConnection
            .getRepository(ImageModelConfig)
            .findOneByOrFail({ code: 'OPENAI_HIGH_QUALITY' });
        await connection.rawConnection.getRepository(ImageModelConfig).update(
            { id: model.id },
            {
                unitPrice: 100,
                freeImageEnabled: false,
                dailyFreeImageUnlimited: false,
                dailyFreeImageLimit: 0,
                dailyGenerationSafetyLimit: 100,
            },
        );
        const originalRecordCost = (queue as any).recordCost.bind(queue);
        const costFailure = vi
            .spyOn(queue as unknown as { recordCost: (...args: any[]) => Promise<unknown> }, 'recordCost')
            .mockImplementation(async (...args: any[]) => {
                if (args[2] === 'UNKNOWN') return await originalRecordCost(...args);
                throw new Error('e2e cost storage unavailable before restart');
            });
        const generate = vi.spyOn(server.app.get(ImageProviderClient), 'generate');
        try {
            const created = (
                await shopClient.query(CREATE, {
                    input: {
                        modelCode: model.code,
                        prompt: 'Recover committed image after restart',
                        referenceMode: 'NONE',
                        aspectRatio: '1:1',
                        resolution: '1K',
                        quantity: 1,
                        expectedUnitPrice: 100,
                        expectedChargeAmount: 100,
                        currencyCode: 'USD',
                        termsAccepted: true,
                        idempotencyKey: 'e2e-restart-cost-recovery',
                    },
                })
            ).createImageGeneration;
            const completed = (await waitForJob(created.id, ['SUCCEEDED'])).myImageGenerationJob;
            expect(generate).toHaveBeenCalledTimes(1);
            const job = await connection.rawConnection
                .getRepository(ImageGenerationJob)
                .findOneByOrFail({ idempotencyKey: 'e2e-restart-cost-recovery' });
            const output = await connection.rawConnection
                .getRepository(ImageGenerationOutput)
                .findOneByOrFail({ jobId: job.id });
            const dispatches = connection.rawConnection.getRepository(ImageGenerationDispatch);
            await vi.waitFor(async () => {
                const dispatch = await dispatches.findOneByOrFail({ outputId: output.id });
                expect(dispatch).toMatchObject({ state: 'DISPATCHED', processingStage: 'SETTLED' });
                expect(dispatch.lastError).toContain('e2e cost storage unavailable');
            });
            const pendingCosts = await connection.rawConnection
                .getRepository(ImageGenerationCostEvent)
                .find({ where: { outputIdSnapshot: String(output.id) } });
            if (config.dbConnectionOptions.type === 'mysql') {
                expect(pendingCosts).toHaveLength(1);
                expect(pendingCosts[0]).toMatchObject({
                    outcome: 'UNKNOWN',
                    providerStage: 'REQUEST_STARTED',
                });
            } else {
                expect(pendingCosts).toHaveLength(0);
            }
            const beforeWallet = await connection.rawConnection
                .getRepository(ReferralWallet)
                .findOneByOrFail({ customerId: job.customerId, currencyCode: CurrencyCode.USD });
            const downloadUrl = new URL(
                completed.outputs[0].downloadUrl,
                `http://localhost:${config.apiOptions.port}`,
            );
            const response = await originalFetch(downloadUrl);
            expect(response.status).toBe(200);
            const bytes = Buffer.from(await response.arrayBuffer());
            await dispatches.update({ outputId: output.id }, { heartbeatAt: new Date(Date.now() - 180_000) });
            if (connection.rawConnection.driver instanceof SqljsDriver) {
                const restartDatabasePath = path.join(storageRoot, 'restart-recovery.sqlite');
                writeFileSync(restartDatabasePath, connection.rawConnection.driver.export());
                config.dbConnectionOptions = {
                    ...config.dbConnectionOptions,
                    type: 'sqljs',
                    database: undefined,
                    location: restartDatabasePath,
                    autoSave: false,
                };
            }
            await server.destroy();
            costFailure.mockRestore();
            generate.mockRestore();
            await server.bootstrap();
            const recoveredQueue = server.app.get(ImageGenerationQueueService);
            const recoveredConnection = server.app.get(TransactionalConnection);
            expect(recoveredQueue).not.toBe(queue);
            expect(recoveredConnection.rawConnection).not.toBe(connection.rawConnection);
            const unexpectedGenerate = vi.spyOn(server.app.get(ImageProviderClient), 'generate');
            try {
                await recoveredQueue.reconcileUnknown();
                await recoveredQueue.reconcileUnknown();
                expect(unexpectedGenerate).not.toHaveBeenCalled();
                const recoveredOutput = await recoveredConnection.rawConnection
                    .getRepository(ImageGenerationOutput)
                    .findOneByOrFail({ id: output.id });
                expect(recoveredOutput).toMatchObject({
                    state: 'SUCCEEDED',
                    walletSettled: true,
                    chargeAmount: 100,
                    assetId: output.assetId,
                });
                expect(
                    await recoveredConnection.rawConnection
                        .getRepository(ImageGenerationDispatch)
                        .findOneByOrFail({ outputId: output.id }),
                ).toMatchObject({ state: 'COMPLETED', lastError: null });
                const costs = await recoveredConnection.rawConnection
                    .getRepository(ImageGenerationCostEvent)
                    .find({ where: { outputIdSnapshot: String(output.id) } });
                expect(costs).toHaveLength(1);
                expect(costs[0].outcome).toBe('SUCCEEDED');
                expect(
                    await recoveredConnection.rawConnection
                        .getRepository(ReferralWallet)
                        .findOneByOrFail({ id: beforeWallet.id }),
                ).toMatchObject({ availableBalance: beforeWallet.availableBalance, reservedBalance: 0 });
                const restoredFile = await originalFetch(downloadUrl);
                expect(restoredFile.status).toBe(200);
                expect(Buffer.from(await restoredFile.arrayBuffer()).equals(bytes)).toBe(true);
            } finally {
                unexpectedGenerate.mockRestore();
            }
        } finally {
            costFailure.mockRestore();
            generate.mockRestore();
        }
    }, 60_000);
});

function deferred<T>() {
    let finish: (value: T) => void = () => undefined;
    const promise = new Promise<T>(resolve => {
        finish = resolve;
    });
    return { promise, resolve: (value: T) => finish(value) };
}

async function waitForJob(id: string, terminalStates: string[]) {
    const deadline = Date.now() + 12_000;
    let result = await shopClient.query(MY_JOB, { id });
    while (!terminalStates.includes(result.myImageGenerationJob.state) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        // The test server has no scheduler process; run the production reconciliation tick locally.
        await server.app.get(ImageGenerationQueueService).reconcileUnknown();
        result = await shopClient.query(MY_JOB, { id });
    }
    expect(terminalStates).toContain(result.myImageGenerationJob.state);
    return result;
}

async function providerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['1.1.1.1', '8.8.8.8'].includes(url.hostname)) return originalFetch(input, init);
    providerAuthorizations.set(url.hostname, new Headers(init?.headers).get('authorization'));
    if (init?.method === 'GET' || !init?.method) {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-image-1' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (url.pathname.endsWith('/chat/completions')) {
        promptCallCount += 1;
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON prompt request');
        const request = JSON.parse(init.body) as {
            messages: Array<{ role: string; content: unknown }>;
        };
        promptProviderUserContent = request.messages.find(message => message.role === 'user')?.content;
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                useCase: 'product-photo',
                                subject: promptFixtureSubject,
                                scene: '浅色电商摄影棚',
                                composition: '居中主体，留有呼吸感',
                                lighting: '柔和侧光',
                                camera: '50mm product photography',
                                style: '高级电商摄影',
                                colors: ['白色', '浅灰'],
                                materials: [promptFixtureSubject === '白色保温杯' ? '金属' : '包装袋材质'],
                                exactText: [],
                                preserve: [
                                    promptFixtureSubject === '白色保温杯' ? '保温杯外形' : '咖啡袋包装外形',
                                ],
                                avoid: ['畸变', '多余商标'],
                                referenceMode: 'NONE',
                            }),
                        },
                    },
                ],
            }),
            {
                status: 200,
                headers: { 'content-type': 'application/json', 'x-request-id': 'gateway-e2e-request' },
            },
        );
    }
    if (providerFailure) {
        return new Response('{"error":"mock definitive failure"}', {
            status: 400,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (init?.body instanceof FormData) {
        const reference = init.body.get('image');
        providerSawReference = reference instanceof Blob && reference.type === 'image/png';
    }
    if (url.pathname.endsWith('/responses') && typeof init?.body === 'string') {
        const payload = JSON.parse(init.body) as {
            input?: Array<{ content?: Array<{ type?: string; image_url?: string }> }>;
        };
        providerSawReference = Boolean(
            payload.input?.[0]?.content?.some(
                item => item.type === 'input_image' && item.image_url?.startsWith('data:image/png;base64,'),
            ),
        );
        return new Response(
            JSON.stringify({
                id: 'image-e2e-provider-request',
                output: [{ type: 'image_generation_call', result: generatedPngBase64 }],
                usage: { total_cost: 0.004672, output_images: 1 },
            }),
            {
                status: 200,
                headers: { 'content-type': 'application/json', 'x-request-id': 'gateway-e2e-request' },
            },
        );
    }
    return new Response(
        JSON.stringify({
            id: 'image-e2e-provider-request',
            data: [
                {
                    b64_json: generatedPngBase64,
                },
            ],
        }),
        {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-request-id': 'gateway-e2e-request' },
        },
    );
}
