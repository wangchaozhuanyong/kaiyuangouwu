import { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ImagePrivateAsset } from '../entities/image-private-asset.entity';
import { ImagePromptOptimizationAttempt } from '../entities/image-prompt-optimization-attempt.entity';
import { ImagePromptOptimization } from '../entities/image-prompt-optimization.entity';
import { ImageProviderCredential } from '../entities/image-provider-credential.entity';
import { ImageProviderTransport } from '../provider/image-provider-transport';
import { ImageProviderClient } from '../provider/image-provider.client';
import { ImageProviderCipherService } from '../security/image-provider-cipher.service';
import { SafeProviderUrlService } from '../security/safe-provider-url.service';
import { OptimizeImagePromptInput } from '../types';

import {
    aggregatePromptTelemetry,
    firstSuccessfulPromptModel,
    ImagePromptEngineService,
    optimizerSystemPrompt,
    shouldFailoverPromptModel,
    startOfBeijingDay,
} from './image-prompt-engine.service';
import { PromptRulesService } from './prompt-rules.service';

describe('ImagePromptEngineService safety gate', () => {
    const engine = Object.create(ImagePromptEngineService.prototype) as ImagePromptEngineService;

    it('allows ordinary adult portrait requests', () => {
        expect(() => engine.assertSafe('成年女性商业人像，柔和影棚光')).not.toThrow();
    });

    it.each([
        '未成年儿童裸露照片',
        '给明星换脸到广告中',
        '移除这张图的水印',
        '制作 deepfake 冒充对方进行诈骗',
    ])('blocks prohibited request: %s', prompt => {
        expect(() => engine.assertSafe(prompt)).toThrow();
    });
});

describe('prompt optimization daily quota boundary', () => {
    it('resets at midnight in the configured Beijing business timezone', () => {
        expect(startOfBeijingDay(Date.parse('2026-08-27T15:59:59.000Z'))).toEqual(
            new Date('2026-08-26T16:00:00.000Z'),
        );
        expect(startOfBeijingDay(Date.parse('2026-08-27T16:00:00.000Z'))).toEqual(
            new Date('2026-08-27T16:00:00.000Z'),
        );
    });
});

describe('prompt provider failover', () => {
    it.each([
        ['network error', new Error('socket closed')],
        ['server error', Object.assign(new Error('upstream unavailable'), { details: { httpStatus: 503 } })],
        ['rate limit', Object.assign(new Error('rate limited'), { details: { httpStatus: 429 } })],
    ])('uses a distinct fallback model after a %s', async (_label, firstError) => {
        const attempts: string[] = [];
        const exclusions: string[][] = [];
        const failures: string[] = [];
        const routes = [
            { config: { id: 'model-1' }, code: 'gemini-primary' },
            { config: { id: 'model-2' }, code: 'openai-fallback' },
        ];

        const selected = await firstSuccessfulPromptModel(
            3,
            excludedIds => {
                exclusions.push([...excludedIds]);
                const route = routes[excludedIds.length];
                if (!route) throw new Error('missing test route');
                return Promise.resolve(route);
            },
            route => {
                attempts.push(route.code);
                return route.config.id === 'model-1'
                    ? Promise.reject(firstError)
                    : Promise.resolve('gpt-5.4-mini');
            },
            route => {
                failures.push(route.code);
                return Promise.resolve();
            },
        );

        expect(selected.result).toBe('gpt-5.4-mini');
        expect(selected.route.config.id).toBe('model-2');
        expect(attempts).toEqual(['gemini-primary', 'openai-fallback']);
        expect(exclusions).toEqual([[], ['model-1']]);
        expect(failures).toEqual(['gemini-primary']);
    });

    it('does not send invalid requests to another provider', async () => {
        const attempts: string[] = [];
        const invalidRequest = Object.assign(new Error('invalid prompt payload'), {
            details: { httpStatus: 422 },
        });

        await expect(
            firstSuccessfulPromptModel(
                3,
                excludedIds => Promise.resolve({ config: { id: `model-${excludedIds.length + 1}` } }),
                route => {
                    attempts.push(String(route.config.id));
                    return Promise.reject(invalidRequest);
                },
                () => Promise.resolve(),
            ),
        ).rejects.toThrow('invalid prompt payload');

        expect(attempts).toEqual(['model-1']);
    });

    it('classifies bounded failover statuses', () => {
        expect(shouldFailoverPromptModel(new Error('network error'))).toBe(true);
        expect(shouldFailoverPromptModel({ details: { httpStatus: 502 } })).toBe(true);
        expect(shouldFailoverPromptModel({ details: { httpStatus: 401 } })).toBe(true);
        expect(shouldFailoverPromptModel({ details: { httpStatus: 422 } })).toBe(false);
    });
});

describe('prompt optimizer language instruction', () => {
    it('requires Chinese descriptive fields for Chinese input', () => {
        const prompt = optimizerSystemPrompt('zh');

        expect(prompt).toContain('entirely in Simplified Chinese');
        expect(prompt).toContain('exact user text, brand names, product names, and model names');
    });

    it('requires English descriptive fields for English input', () => {
        expect(optimizerSystemPrompt('en')).toContain('entirely in English');
    });
});

describe('prompt optimizer reference grounding', () => {
    const request: OptimizeImagePromptInput = {
        prompt: '把图1女人手里的咖啡做成商品图',
        referenceMode: 'PRODUCT',
        referenceAssetIds: ['reference-1', 'reference-2'],
        referenceInstruction: '保留袋装包装，使用图2背景，去掉人物',
        idempotencyKey: 'prompt-reference-test',
    };
    const ctx = {
        activeUserId: 'user-1',
        channelId: 'channel-1',
        languageCode: 'zh_Hans',
    } as unknown as RequestContext;

    function setup() {
        const rules = new PromptRulesService();
        const assets = ['reference-2', 'reference-1'].map(
            id =>
                new ImagePrivateAsset({
                    id,
                    channelId: ctx.channelId,
                    customerId: 'customer-1',
                    kind: 'REFERENCE',
                    mimeType: 'image/png',
                    expiresAt: new Date(Date.now() + 60_000),
                    deletedAt: null,
                }),
        );
        const assetRepository = { find: vi.fn().mockResolvedValue(assets) };
        const lockedRead = vi.fn().mockResolvedValue({ id: 'optimization-1', source: 'PENDING' });
        const repository = {
            find: vi.fn().mockResolvedValue([]),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            createQueryBuilder: () => {
                const query = {
                    where: () => query,
                    setLock: () => query,
                    getOne: lockedRead,
                };
                return query;
            },
            findOne: vi.fn().mockResolvedValue(null),
            save: vi.fn().mockResolvedValue(null),
        };
        const attempts: ImagePromptOptimizationAttempt[] = [];
        const attemptRepository = {
            insert: vi.fn((value: ImagePromptOptimizationAttempt) => {
                attempts.push({ ...value });
                return Promise.resolve();
            }),
            update: vi.fn((where: { callId: string }, value: Partial<ImagePromptOptimizationAttempt>) => {
                const attempt = attempts.find(item => item.callId === where.callId);
                if (!attempt) throw new Error('Missing attempt fixture');
                Object.assign(attempt, value);
                return Promise.resolve({ affected: 1 });
            }),
            find: vi.fn(() => Promise.resolve(attempts)),
        };
        const storage = {
            read: vi.fn((asset: ImagePrivateAsset) => Promise.resolve(Buffer.from(String(asset.id)))),
        };
        const spec = rules.fallbackSpec('图1中女人手持的袋装咖啡，保留包装外形、配色和标签', 'PRODUCT');
        const provider = { optimizePrompt: vi.fn().mockResolvedValue({ text: JSON.stringify(spec) }) };
        const reserve = vi.fn().mockResolvedValue(
            new ImagePromptOptimization({
                id: 'optimization-1',
                source: 'PENDING',
                billingMode: 'RELEASED',
            }),
        );
        const consume = vi.fn();
        const engine = Object.create(ImagePromptEngineService.prototype) as ImagePromptEngineService;
        Object.assign(engine, {
            connection: {
                rawConnection: { options: { type: 'sqljs' }, getRepository: () => repository },
                getRepository: (_ctx: RequestContext, entity: unknown) =>
                    entity === ImagePrivateAsset
                        ? assetRepository
                        : entity === ImagePromptOptimizationAttempt
                          ? attemptRepository
                          : repository,
                withTransaction: async (
                    _ctx: RequestContext,
                    work: (tx: RequestContext) => Promise<unknown>,
                ) => work(ctx),
            },
            requestContextService: { create: vi.fn().mockResolvedValue(ctx) },
            walletSpend: { capture: vi.fn(), release: vi.fn() },
            quota: { capture: vi.fn(), release: vi.fn() },
            customerService: { findOneByUserId: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
            configService: {
                shopConfig: vi.fn().mockResolvedValue({ enabled: true, promptOptimizationEnabled: true }),
                selectPromptModel: vi
                    .fn()
                    .mockResolvedValue({ config: { id: 'model-1', modelId: 'vision-model' } }),
                promptModelAsCredential: vi.fn().mockReturnValue({}),
                recordPromptModelSuccess: vi.fn().mockResolvedValue(undefined),
                recordPromptModelFailure: vi.fn().mockResolvedValue(undefined),
            },
            rules,
            storage,
            providerClient: provider,
            reserveOptimization: reserve,
            consumeMinuteLimit: consume,
            recommendEnabledModel: vi
                .fn()
                .mockResolvedValue({ model: { code: 'OPENAI_IMAGE_2' }, reason: 'reference' }),
            optimizationResult: (_ctx: RequestContext, _customer: unknown, record: ImagePromptOptimization) =>
                record,
        });
        return {
            engine,
            provider,
            spec,
            assets,
            assetRepository,
            storage,
            reserve,
            consume,
            repository,
            lockedRead,
            attempts,
            attemptRepository,
        };
    }

    it('does not call or fail over when the attempt cannot be persisted', async () => {
        const { engine, provider, attemptRepository } = setup();
        attemptRepository.insert.mockRejectedValueOnce(new Error('database unavailable'));
        const result = await engine.optimize(ctx, request);
        expect(provider.optimizePrompt).not.toHaveBeenCalled();
        expect(result.source).toBe('FALLBACK');
        expect(result).toMatchObject({ upstreamCallCount: 0 });
    });

    it('leaves durable UNKNOWN and stops failover if completion cannot be persisted', async () => {
        const { engine, provider, attemptRepository, attempts } = setup();
        attemptRepository.update.mockRejectedValueOnce(new Error('database unavailable'));
        const result = await engine.optimize(ctx, request);
        expect(provider.optimizePrompt).toHaveBeenCalledTimes(1);
        expect(attempts[0].outcome).toBe('UNKNOWN');
        expect(result.actualCostMicrounits).toBeNull();
        expect(result).toMatchObject({ upstreamCallCount: 1 });
    });

    it.each(['PAID', 'FREE'])(
        'preserves fallback input and accounts for a late provider result without charging again (%s)',
        async billingMode => {
            const { engine, provider, reserve, repository, lockedRead, spec } = setup();
            const rules = new PromptRulesService();
            const fallback = rules.fallbackSpec(
                `${request.prompt}\n${request.referenceInstruction}`,
                'PRODUCT',
                'zh',
            );
            const stored = new ImagePromptOptimization({
                id: 'optimization-1',
                source: 'PENDING',
                inputPrompt: request.prompt,
                optimizedPrompt: rules.render(fallback, 'zh'),
                billingMode,
                chargedAmount: billingMode === 'PAID' ? 50 : 0,
                walletUsageId: 'wallet-1',
                quotaEventId: 'quota-1',
                createdAt: new Date(Date.now() - 600000),
                updatedAt: new Date(Date.now() - 600000),
                upstreamCallCount: 0,
            });
            stored.promptSpec = fallback;
            reserve.mockResolvedValue(new ImagePromptOptimization({ ...stored }));
            repository.find.mockResolvedValue([stored]);
            lockedRead.mockResolvedValue(stored);
            repository.update.mockImplementation((_id, values) => {
                Object.assign(stored, values);
                return Promise.resolve({ affected: 1 });
            });
            let finish: (value: unknown) => void = () => undefined;
            provider.optimizePrompt.mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        finish = resolve;
                    }),
            );
            const execution = engine.optimize(ctx, request);
            await vi.waitFor(() => expect(provider.optimizePrompt).toHaveBeenCalledTimes(1));
            expect(await engine.recoverPendingOptimizations()).toBe(1);
            const recoveredPrompt = stored.optimizedPrompt;
            expect(recoveredPrompt).toContain(request.referenceInstruction);
            expect(stored.source).toBe('FALLBACK');
            expect(await engine.recoverPendingOptimizations()).toBe(0);
            finish({
                text: JSON.stringify(spec),
                telemetry: {
                    actualCostMicrounits: 71,
                    costCurrency: 'USD',
                    usage: { input_tokens: 2, output_tokens: 3 },
                },
            });
            const result = await execution;
            expect(result).toMatchObject({
                source: 'FALLBACK',
                billingMode: billingMode === 'PAID' ? 'REFUNDED' : 'RELEASED',
                chargedAmount: 0,
                actualCostMicrounits: 71,
                costCurrency: 'USD',
                upstreamCallCount: 1,
                inputTokens: 2,
                outputTokens: 3,
            });
            expect(result.optimizedPrompt).toBe(recoveredPrompt);
            expect((engine as any).walletSpend.capture).not.toHaveBeenCalled();
            expect((engine as any).quota.capture).not.toHaveBeenCalled();
            expect(
                (engine as any)[billingMode === 'PAID' ? 'walletSpend' : 'quota'].release,
            ).toHaveBeenCalledTimes(1);
            expect(repository.update).toHaveBeenCalledTimes(1);
        },
    );

    it.each([false, true])(
        'retains paid empty-response costs through bounded failover (all fail: %s)',
        async allFail => {
            const { engine, spec, repository, reserve, attempts } = setup();
            const safeUrls = {
                validate: (value: string) => Promise.resolve(new URL(value)),
                endpoint: (base: URL, pathname: string) => new URL(`${base.href}/${pathname}`),
            } as unknown as SafeProviderUrlService;
            const cipher = { decrypt: () => 'test-key' } as unknown as ImageProviderCipherService;
            const client = new ImageProviderClient(cipher, safeUrls);
            let attempt = 0;
            const transport = vi
                .spyOn(ImageProviderTransport.prototype, 'requestJson')
                .mockImplementation(() => {
                    attempt += 1;
                    const valid = !allFail && attempt === 2;
                    return Promise.resolve({
                        payload: { choices: [{ message: { content: valid ? JSON.stringify(spec) : null } }] },
                        telemetry: {
                            httpStatus: 200,
                            providerRequestId: `attempt-${attempt}`,
                            actualCostMicrounits: valid ? 20_000 : 15_000,
                            costCurrency: 'USD',
                            usage: valid
                                ? { input_tokens: 14, output_tokens: 6, total_tokens: 20 }
                                : { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
                        },
                    });
                });
            reserve.mockResolvedValue(
                new ImagePromptOptimization({
                    id: 'optimization-1',
                    source: 'PENDING',
                    billingMode: 'PAID',
                    chargedAmount: 50,
                    walletUsageId: 'wallet-1',
                }),
            );
            const config = (engine as any).configService;
            config.selectPromptModel.mockImplementation((_: unknown, excluded: string[]) =>
                Promise.resolve({
                    config: { id: `model-${excluded.length + 1}`, modelId: 'vision-model' },
                }),
            );
            config.promptModelAsCredential.mockReturnValue(
                new ImageProviderCredential({
                    scope: 'OPENAI',
                    enabled: true,
                    baseUrl: 'https://relay.example.com/v1',
                    encryptedApiKey: 'test-encrypted-key',
                }),
            );
            Object.assign(engine, { providerClient: client });
            try {
                const result = await engine.optimize(ctx, request);
                expect(result).toMatchObject({
                    source: allFail ? 'FALLBACK' : 'MODEL',
                    billingMode: allFail ? 'REFUNDED' : 'PAID',
                    chargedAmount: allFail ? 0 : 50,
                    upstreamCallCount: allFail ? 3 : 2,
                    actualCostMicrounits: allFail ? 45_000 : 35_000,
                    costCurrency: 'USD',
                    inputTokens: allFail ? 36 : 26,
                    outputTokens: 9,
                    totalTokens: allFail ? 45 : 35,
                });
                expect(transport).toHaveBeenCalledTimes(allFail ? 3 : 2);
                expect(attempts).toHaveLength(allFail ? 3 : 2);
                expect(new Set(attempts.map(item => item.callId)).size).toBe(attempts.length);
                expect(attempts[0].outcome).toBe('FAILED');
                expect(attempts.at(-1)?.stage).toBe('FAILOVER');
                expect(attempts.every(item => item.completedAt != null)).toBe(true);
                expect(config.recordPromptModelFailure).toHaveBeenCalledTimes(allFail ? 3 : 1);
                expect((engine as any).walletSpend.capture).toHaveBeenCalledTimes(allFail ? 0 : 1);
                expect((engine as any).walletSpend.release).toHaveBeenCalledTimes(allFail ? 1 : 0);
                expect(repository.save).toHaveBeenCalledWith(result, { reload: false });
            } finally {
                transport.mockRestore();
            }
        },
    );

    it('loads owned references in user order and forwards images and requirements together', async () => {
        const { engine, provider, assetRepository, storage } = setup();
        const result = await engine.optimize(ctx, request);

        expect(assetRepository.find).toHaveBeenCalledWith({
            where: expect.objectContaining({
                channelId: 'channel-1',
                customerId: 'customer-1',
                kind: 'REFERENCE',
            }),
        });
        expect(storage.read.mock.calls.map(([asset]) => asset.id)).toEqual(request.referenceAssetIds);
        const call = provider.optimizePrompt.mock.calls[0];
        expect(JSON.parse(call[3])).toMatchObject({
            prompt: request.prompt,
            referenceMode: 'PRODUCT',
            referenceImageCount: 2,
            referenceInstruction: request.referenceInstruction,
        });
        expect(call[4]).toEqual([
            { bytes: Buffer.from('reference-1'), mimeType: 'image/png' },
            { bytes: Buffer.from('reference-2'), mimeType: 'image/png' },
        ]);
        expect(result.source).toBe('MODEL');
        expect(result.optimizedPrompt).toContain('袋装咖啡');
    });

    it('keeps the same references and requirements when repairing invalid model JSON', async () => {
        const { engine, provider } = setup();
        provider.optimizePrompt.mockResolvedValueOnce({ text: 'invalid JSON' });
        await engine.optimize(ctx, request);
        expect(provider.optimizePrompt).toHaveBeenCalledTimes(2);
        const [first, repair] = provider.optimizePrompt.mock.calls;
        expect(repair[4]).toEqual(first[4]);
        expect(JSON.parse(repair[3])).toMatchObject({
            prompt: request.prompt,
            referenceInstruction: request.referenceInstruction,
            referenceImageCount: 2,
        });
    });

    it.each(['missing', 'deleted', 'expired'] as const)(
        'rejects a %s reference before upstream or quota use',
        async state => {
            const { engine, assets, assetRepository, provider, storage, reserve, consume } = setup();
            if (state === 'missing') assetRepository.find.mockResolvedValue([assets[0]]);
            if (state === 'deleted') assets[0].deletedAt = new Date();
            if (state === 'expired') assets[0].expiresAt = new Date(0);
            await expect(engine.optimize(ctx, request)).rejects.toThrow('参考图不存在或已过期');
            expect(storage.read).not.toHaveBeenCalled();
            expect(provider.optimizePrompt).not.toHaveBeenCalled();
            expect(consume).not.toHaveBeenCalled();
            expect(reserve).not.toHaveBeenCalled();
        },
    );

    it('fails explicitly on unreadable image storage before quota use', async () => {
        const { engine, storage, provider, reserve } = setup();
        storage.read.mockRejectedValue(new Error('图片完整性校验失败'));
        await expect(engine.optimize(ctx, request)).rejects.toThrow('图片完整性校验失败');
        expect(provider.optimizePrompt).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
    });

    it('retains the original target and reference instructions in the local fallback', async () => {
        const { engine, provider } = setup();
        provider.optimizePrompt.mockRejectedValue(new Error('vision unavailable'));
        const result = await engine.optimize(ctx, request);
        expect(result.source).toBe('FALLBACK');
        expect(result.optimizedPrompt).toContain(request.prompt);
        expect(result.optimizedPrompt).toContain(request.referenceInstruction);
        expect(result.optimizedPrompt).not.toContain('咖啡杯');
    });

    it('rejects oversized reference lists and instructions without an image', async () => {
        const { engine, provider } = setup();
        await expect(
            engine.optimize(ctx, { ...request, referenceAssetIds: ['1', '2', '3', '4'] }),
        ).rejects.toThrow('最多');
        await expect(engine.optimize(ctx, { ...request, referenceAssetIds: [] })).rejects.toThrow(
            '先上传参考图',
        );
        expect(provider.optimizePrompt).not.toHaveBeenCalled();
    });
});

describe('optimization attempt accounting', () => {
    it('keeps native Gemini token totals including thinking usage', () => {
        expect(
            aggregatePromptTelemetry([
                {
                    usage: {
                        promptTokenCount: 10,
                        candidatesTokenCount: 20,
                        thoughtsTokenCount: 7,
                        totalTokenCount: 37,
                    },
                },
            ]),
        ).toMatchObject({ inputTokens: 10, outputTokens: 27, totalTokens: 37 });
    });

    it('adds reported Gemini and OpenAI totals without inventing missing breakdowns', () => {
        expect(
            aggregatePromptTelemetry([
                { usage: { totalTokenCount: 42 } },
                { usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 } },
            ]),
        ).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: 50 });
    });

    it('adds first and repair request costs and tokens', () => {
        expect(
            aggregatePromptTelemetry([
                {
                    actualCostMicrounits: 10,
                    costCurrency: 'USD',
                    usage: { input_tokens: 2, output_tokens: 3 },
                },
                {
                    actualCostMicrounits: 20,
                    costCurrency: 'USD',
                    usage: { input_tokens: 4, output_tokens: 5 },
                },
            ]),
        ).toMatchObject({ actualCostMicrounits: 30, inputTokens: 6, outputTokens: 8, totalTokens: 14 });
    });
    it.each([
        [{ actualCostMicrounits: 10, costCurrency: 'USD' }, undefined],
        [
            { actualCostMicrounits: 10, costCurrency: 'USD' },
            { actualCostMicrounits: 20, costCurrency: 'CNY' },
        ],
        [{ actualCostMicrounits: null, costCurrency: 'USD' }],
        [
            { actualCostMicrounits: 2147483647, costCurrency: 'USD' },
            { actualCostMicrounits: 1, costCurrency: 'USD' },
        ],
    ])('does not label incomplete, mixed currency or overflowing costs as a known total', (...attempts) => {
        expect(aggregatePromptTelemetry(attempts).actualCostMicrounits).toBeNull();
    });
});
