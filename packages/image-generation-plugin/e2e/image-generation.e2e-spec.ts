import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ContentTranslationPlugin,
    type ContentTranslationProvider,
} from '@vendure/content-translation-plugin';
import { Customer, mergeConfig, TransactionalConnection } from '@vendure/core';
import { ReferralWallet, ReferralWalletUsage, StoreManagementPlugin } from '@vendure/store-management-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { ImageGenerationCostEvent } from '../src/entities/image-generation-cost-event.entity';
import { ImageGenerationDispatch } from '../src/entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from '../src/entities/image-generation-job.entity';
import { ImageGenerationOutput } from '../src/entities/image-generation-output.entity';
import { ImagePrivateAsset } from '../src/entities/image-private-asset.entity';
import { ImageGenerationPlugin } from '../src/image-generation.plugin';
import { ImagePrivateStorageService } from '../src/storage/image-private-storage.service';

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
let providerSawReference = false;
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

        const credential = await adminClient.query(SAVE_CREDENTIAL, {
            input: {
                scope: 'OPENAI',
                code: 'openai-e2e-primary',
                name: 'OpenAI E2E 主 Key',
                purpose: 'BOTH',
                baseUrl: 'https://1.1.1.1/v1',
                apiKey: 'relay-e2e-secret-key',
                textModelId: 'prompt-e2e-model',
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
                enabled: true,
                priority: 10,
                weight: 1,
                modelCodes: ['OPENAI_HIGH_QUALITY'],
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
                    },
                })
            ).saveImageGenerationConfig,
        ).toEqual({ enabled: true, defaultModelCode: 'OPENAI_HIGH_QUALITY' });

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
                    unitPrice: 100,
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
                    expectedUnitPrice: 100,
                    expectedChargeAmount: 200,
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
            reservedAmount: 200,
        });

        const succeeded = await waitForJob(created.id, ['SUCCEEDED']);
        expect(succeeded.myImageGenerationJob).toMatchObject({
            state: 'SUCCEEDED',
            capturedAmount: 200,
            releasedAmount: 0,
        });
        expect(succeeded.imageStudioBalance).toBe(300);
        expect(succeeded.myImageGenerationJob.outputs).toHaveLength(2);
        for (const output of succeeded.myImageGenerationJob.outputs) {
            expect(output).toMatchObject({ state: 'SUCCEEDED', attemptCount: 1 });
            expect(output.imageUrl).toMatch(/^\/image-generation\/private\//u);
            expect(output.downloadUrl).toMatch(/^\/image-generation\/private\//u);
        }

        const firstToken = succeeded.myImageGenerationJob.outputs[0].imageUrl.split('/').at(-1);
        const authorized = await server.app.get(ImagePrivateStorageService).authorize(firstToken);
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
            capturedAmount: 100,
            releasedAmount: 100,
        });
        expect(afterRefund.imageStudioBalance).toBe(400);

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
                    expectedUnitPrice: 100,
                    expectedChargeAmount: 100,
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
            releasedAmount: 100,
        });
        expect(failed.imageStudioBalance).toBe(400);

        const connection = server.app.get(TransactionalConnection);
        const staleAt = new Date(Date.now() - 16 * 60_000);
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
                releasedAmount: 100,
                outputs: [
                    expect.objectContaining({
                        state: 'FAILED',
                        errorMessage: '中转站结果在 15 分钟内无法确认，已自动退回本张费用',
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
        expect(wallet).toMatchObject({ availableBalance: 400, reservedBalance: 0 });
        const usages = await connection.rawConnection.getRepository(ReferralWalletUsage).find({
            where: { customerId: customer.id, resourceType: 'IMAGE_GENERATION_JOB' },
            order: { createdAt: 'ASC' },
        });
        expect(usages).toHaveLength(2);
        expect(usages[0]).toMatchObject({
            amount: 200,
            capturedAmount: 100,
            releasedAmount: 100,
            status: 'PARTIAL',
        });
        expect(usages[1]).toMatchObject({
            amount: 100,
            capturedAmount: 0,
            releasedAmount: 100,
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
                    expectedUnitPrice: 100,
                    expectedChargeAmount: 100,
                    currencyCode: 'USD',
                    idempotencyKey: 'e2e-reference-0001',
                    termsAccepted: true,
                },
            })
        ).createImageGeneration;
        const referenceSucceeded = await waitForJob(referenceCreated.id, ['SUCCEEDED']);
        expect(referenceSucceeded.myImageGenerationJob).toMatchObject({
            state: 'SUCCEEDED',
            capturedAmount: 100,
            releasedAmount: 0,
        });
        expect(referenceSucceeded.imageStudioBalance).toBe(300);
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
        expect(freeSucceeded.imageStudioBalance).toBe(300);

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
                    attempts: 4,
                    successes: 4,
                    failures: 0,
                    missingCostCount: 0,
                    grossRevenue: 300,
                    actualCost: 0.018688,
                    costCurrency: 'USD',
                }),
                expect.objectContaining({
                    modelCode: 'OPENAI_HIGH_QUALITY',
                    attempts: 2,
                    successes: 0,
                    failures: 2,
                    missingCostCount: 2,
                    grossRevenue: 0,
                    actualCost: 0,
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
        expect(usageDetail.inputPrompt).toBe('失败释放后再次使用免费额度');
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
        const deletedRows = await connection.rawConnection.query(
            'SELECT id, customerDeletedAt FROM image_generation_job ORDER BY id',
        );
        expect(deletedRows).toEqual(
            expect.arrayContaining([expect.objectContaining({ customerDeletedAt: expect.any(String) })]),
        );
        await expect(connection.rawConnection.getRepository(ImageGenerationCostEvent).count()).resolves.toBe(
            6,
        );
    }, 30_000);
});

async function waitForJob(id: string, terminalStates: string[]) {
    const deadline = Date.now() + 12_000;
    let result = await shopClient.query(MY_JOB, { id });
    while (!terminalStates.includes(result.myImageGenerationJob.state) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
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
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                useCase: 'product-photo',
                                subject: '白色保温杯',
                                scene: '浅色电商摄影棚',
                                composition: '居中主体，留有呼吸感',
                                lighting: '柔和侧光',
                                camera: '50mm product photography',
                                style: '高级电商摄影',
                                colors: ['白色', '浅灰'],
                                materials: ['金属'],
                                exactText: [],
                                preserve: ['保温杯外形'],
                                avoid: ['畸变', '多余商标'],
                                referenceMode: 'NONE',
                            }),
                        },
                    },
                ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
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
            { status: 200, headers: { 'content-type': 'application/json' } },
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
        { status: 200, headers: { 'content-type': 'application/json' } },
    );
}
