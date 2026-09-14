/* eslint-disable @typescript-eslint/require-await -- Repository and provider fixtures return promises. */
import { Customer } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ImageGenerationCostEvent } from './entities/image-generation-cost-event.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { ImagePromptOptimizationAttempt } from './entities/image-prompt-optimization-attempt.entity';
import { ImagePromptOptimization } from './entities/image-prompt-optimization.entity';
import { ImageUsageQuotaEvent } from './entities/image-usage-quota-event.entity';
import { ImageGenerationQueueService } from './image-generation-queue.service';
import { ImageGenerationService } from './image-generation.service';
import { ImageUsageQuotaService } from './image-usage-quota.service';
import { ImagePromptEngineService } from './prompt/image-prompt-engine.service';
import { PromptRulesService } from './prompt/prompt-rules.service';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';

// Regression cases converted from the 2026-09-13 audit fault probes.
// In-memory collaborators inject failures; MySQL E2E covers real row locks.
const ctx: any = {
    channelId: 'channel-1',
    activeUserId: 'user-1',
    currencyCode: 'CNY',
    languageCode: 'zh_Hans',
    channel: { defaultCurrencyCode: 'CNY', customFields: {} },
};
function serialTransactions() {
    let tail = Promise.resolve();
    return (_ctx: unknown, callback: (tx: any) => Promise<unknown>) => {
        const next = tail.then(() => callback({ ...ctx, transaction: true }));
        tail = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    };
}
function query(result: () => unknown): any {
    const builder: any = { getOne: () => Promise.resolve(result()) };
    for (const name of ['setLock', 'where', 'andWhere', 'innerJoinAndSelect']) builder[name] = () => builder;
    return builder;
}

describe('Image studio lifecycle regression', () => {
    it.each(['cost-query', 'cost-insert', 'mark-settled', 'dispatch-complete', 'settlement-return'])(
        'preserves and finishes a committed image after %s fails',
        async failurePoint => {
            const output: any = {
                id: 'output-1',
                jobId: 'job-1',
                state: 'QUEUED',
                attemptCount: 0,
                walletSettled: false,
                providerIdempotencyKey: 'image-job-1-0',
                outputIndex: 0,
                job: {
                    id: 'job-1',
                    customerId: 'customer-1',
                    channelId: 'channel-1',
                    channel: {},
                    providerScopeSnapshot: 'OPENAI',
                    providerCredentialCodeSnapshot: 'fixture',
                    providerCredentialFingerprint: 'fingerprint',
                    protocolSnapshot: 'OPENAI_IMAGES',
                    modelConfigId: 'model-1',
                    providerModelIdSnapshot: 'fixture-image-model',
                    finalPrompt: '袋装咖啡商品图',
                    aspectRatio: '1:1',
                    resolution: '1K',
                    promptSpec: {},
                },
            };
            const repository = {
                update: vi.fn(async (where: any, patch: any) => {
                    if (where.state && where.state !== output.state) return { affected: 0 };
                    Object.assign(output, patch);
                    return { affected: 1 };
                }),
                findOne: vi.fn(async () => output),
                save: vi.fn(async () => output),
            };
            const stored: any = { id: 'asset-1', deletedAt: null };
            const deleteOwned = vi.fn(async () => {
                stored.deletedAt = new Date();
                return true;
            });
            let cost: any = null;
            const costRepository = {
                findOne: vi.fn(async () => cost),
                insert: vi.fn(async (values: any) => {
                    cost = { ...values, id: 'cost-1' };
                }),
                update: vi.fn(async (_where: any, values: any) => {
                    Object.assign(cost, values);
                }),
            };
            const fault = new Error(`simulated ${failurePoint} failure`);
            if (failurePoint === 'cost-query')
                costRepository.findOne.mockResolvedValueOnce(null).mockRejectedValueOnce(fault);
            if (failurePoint === 'cost-insert') costRepository.update.mockRejectedValueOnce(fault);
            let stageFailed = false;
            const queue: any = Object.create(ImageGenerationQueueService.prototype);
            Object.assign(queue, {
                connection: {
                    rawConnection: { getRepository: () => repository },
                    getRepository: (_ctx: any, entity: any) =>
                        entity === ImageGenerationCostEvent ? costRepository : repository,
                },
                requestContextService: { create: async () => ctx },
                updateDispatchStage: async (_id: string, stage: string) => {
                    if (failurePoint === 'mark-settled' && stage === 'SETTLED' && !stageFailed) {
                        stageFailed = true;
                        throw fault;
                    }
                },
                touchDispatch: async () => undefined,
                completeDispatch: vi.fn().mockResolvedValue(undefined),
                configService: {
                    credentialByCode: async () => ({ enabled: true, healthStatus: 'HEALTHY' }),
                    credentialFingerprint: () => 'fingerprint',
                    recordRuntimeResult: async () => undefined,
                    recordCredentialRuntimeSuccess: async () => undefined,
                },
                providerClient: {
                    generate: async () => ({ bytes: Buffer.from('fixture-output'), mimeType: 'image/png' }),
                },
                storage: { storeGenerated: async () => stored, deleteOwned },
                generations: {
                    refreshJob: async () => undefined,
                    settleSuccessfulOutput: async () => {
                        Object.assign(output, {
                            state: 'SUCCEEDED',
                            walletSettled: true,
                            chargeAmount: 100,
                            assetId: stored.id,
                        });
                        if (failurePoint === 'settlement-return') throw fault;
                        return output;
                    },
                    failRunningOutput: async () => false,
                },
            });
            if (failurePoint === 'dispatch-complete') queue.completeDispatch.mockRejectedValueOnce(fault);
            const generate = vi.spyOn(queue.providerClient, 'generate');
            const result = await queue.process({ data: { outputId: output.id } });
            expect(result.state).toBe('SUCCEEDED');
            expect(output.walletSettled).toBe(true);
            expect(deleteOwned).not.toHaveBeenCalled();
            expect(stored.deletedAt).toBeNull();
            queue.connection.rawConnection.getRepository = () => ({
                find: async () => [
                    { id: 'dispatch-1', processingStage: 'SETTLED', output, stagedAsset: stored },
                ],
                update: vi.fn(),
            });
            expect(await queue.recoverInterruptedStages(new Date())).toBe(1);
            expect(costRepository.insert).toHaveBeenCalledTimes(1);
            expect(cost.outcome).toBe('SUCCEEDED');
            expect(generate).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        ['HEALTHY', 'BEFORE'],
        ...['UNHEALTHY', 'DISABLED', 'COOLDOWN', 'REPLACED', 'ARCHIVED'].flatMap(state =>
            ['BEFORE', 'AFTER'].map(timing => [state, timing]),
        ),
        ['MISSING_SNAPSHOT', 'BEFORE'],
    ])('keeps UNKNOWN retries on the original account: %s %s approval', async (state, timing) => {
        const original = {
            code: 'original',
            enabled: true,
            healthStatus: 'HEALTHY',
            fingerprint: 'old-fingerprint',
            cooldownUntil: null as Date | null,
        };
        let archived = false;
        const replacement = {
            code: 'replacement',
            enabled: true,
            healthStatus: 'HEALTHY',
            fingerprint: 'new-fingerprint',
        };
        const output: any = {
            id: 'output-2',
            jobId: 'job-2',
            state: 'UNKNOWN',
            attemptCount: 1,
            walletSettled: false,
            providerIdempotencyKey: 'original-request-key',
            outputIndex: 0,
            job: {
                id: 'job-2',
                customerId: 'customer-1',
                channelId: 'channel-1',
                channel: {},
                providerScopeSnapshot: 'OPENAI',
                providerCredentialCodeSnapshot: 'original',
                providerCredentialFingerprint: 'old-fingerprint',
                providerIdempotencySupportedSnapshot: true,
                protocolSnapshot: 'OPENAI_IMAGES',
                modelConfigId: 'model-1',
                providerModelIdSnapshot: 'fixture-image-model',
                finalPrompt: '商品图',
                aspectRatio: '1:1',
                resolution: '1K',
                promptSpec: {},
            },
        };
        const repository = {
            update: async (where: any, patch: any) => {
                if (where.state && where.state !== output.state) return { affected: 0 };
                Object.assign(output, patch);
                return { affected: 1 };
            },
            findOne: async () => output,
            findOneByOrFail: async () => output,
            save: async (value: any) => value,
            upsert: async () => undefined,
        };
        const connection = {
            rawConnection: { getRepository: () => repository },
            getRepository: () => repository,
            withTransaction: serialTransactions(),
        };
        const configService = {
            credentialByCode: async () => (archived ? null : original),
            routeCredential: vi.fn(async () => ({ credential: replacement, selectionReason: 'alternate' })),
            credentialFingerprint: (credential: any) => credential.fingerprint,
            recordRuntimeResult: async () => undefined,
            recordCredentialRuntimeSuccess: async () => undefined,
        };
        const generate = vi.fn(async () => ({ bytes: Buffer.from('fixture'), mimeType: 'image/png' }));
        const queue: any = Object.create(ImageGenerationQueueService.prototype);
        Object.assign(queue, {
            connection,
            configService,
            requestContextService: { create: async () => ctx },
            updateDispatchStage: async () => undefined,
            touchDispatch: async () => undefined,
            completeDispatch: async () => undefined,
            recordCost: async () => undefined,
            providerClient: { generate },
            storage: { storeGenerated: async () => ({ id: 'asset-2' }) },
            generations: {
                refreshJob: async () => undefined,
                settleSuccessfulOutput: async () => {
                    Object.assign(output, { state: 'SUCCEEDED', walletSettled: true });
                    return output;
                },
            },
        });
        const changeAccount = () => {
            if (state === 'UNHEALTHY') original.healthStatus = 'UNHEALTHY';
            if (state === 'DISABLED') original.enabled = false;
            if (state === 'COOLDOWN') original.cooldownUntil = new Date(Date.now() + 60_000);
            if (state === 'REPLACED') original.fingerprint = 'replacement-fingerprint';
            if (state === 'ARCHIVED') archived = true;
            if (state === 'MISSING_SNAPSHOT') output.job.providerCredentialFingerprint = null;
        };
        const service: any = Object.create(ImageGenerationService.prototype);
        Object.assign(service, {
            connection,
            configService,
            enqueueOutput: async () => {
                if (timing === 'AFTER') changeAccount();
                return queue.process({ data: { outputId: output.id } });
            },
            refreshJob: async () => undefined,
            refreshJobSettlement: async () => undefined,
        });
        if (timing === 'BEFORE') changeAccount();
        const attempts = await Promise.allSettled([
            service.adminRetryUnknown(ctx, output.id),
            service.adminRetryUnknown(ctx, output.id),
        ]);
        if (state === 'HEALTHY') {
            expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            expect(generate).toHaveBeenCalledTimes(1);
            expect(generate).toHaveBeenCalledWith(
                original,
                'OPENAI_IMAGES',
                expect.objectContaining({ idempotencyKey: 'original-request-key' }),
            );
            expect(output.state).toBe('SUCCEEDED');
        } else {
            expect(generate).not.toHaveBeenCalled();
            expect(output.state).toBe('UNKNOWN');
            if (timing === 'BEFORE')
                expect(attempts.every(result => result.status === 'rejected')).toBe(true);
        }
        expect(configService.routeCredential).not.toHaveBeenCalled();
        expect(output.job.providerCredentialCodeSnapshot).toBe('original');
    });

    it('retains a shared reference while another generation still needs it', async () => {
        const completed = {
            id: 'job-1',
            state: 'SUCCEEDED',
            outputs: [],
            promptSpec: { referenceAssetIds: ['shared-ref'] },
        };
        const active = { id: 'job-2', state: 'QUEUED', promptSpec: { referenceAssetIds: ['shared-ref'] } };
        const repository = {
            findOne: vi.fn(async () => completed),
            find: vi.fn(async () => [active]),
            update: vi.fn(async () => ({ affected: 1 })),
        };
        const shared: any = { id: 'shared-ref', deletedAt: null };
        const storage: any = Object.create(ImagePrivateStorageService.prototype);
        const assetRepository = { findOne: async () => shared, save: vi.fn() };
        Object.assign(storage, {
            connection: {
                withTransaction: serialTransactions(),
                rawConnection: { options: { type: 'mysql' } },
                getRepository: (_ctx: any, entity: any) =>
                    entity === Customer
                        ? { createQueryBuilder: () => query(() => ({})) }
                        : entity === ImagePrivateAsset
                          ? assetRepository
                          : repository,
            },
        });
        const service: any = Object.create(ImageGenerationService.prototype);
        Object.assign(service, {
            activeCustomer: async () => ({ id: 'customer-1' }),
            connection: { getRepository: () => repository },
            storage,
        });
        await service.deleteJob(ctx, 'job-1');
        expect(shared.deletedAt).toBeNull();
        expect(assetRepository.save).not.toHaveBeenCalled();
        expect(repository.find).toHaveBeenCalled();
        expect(active.state).toBe('QUEUED');
    });

    it('executes one upstream request when the same optimization key is submitted concurrently', async () => {
        const rules = new PromptRulesService();
        let record: any = null;
        let releaseProvider!: () => void;
        const providerBarrier = new Promise<void>(resolve => {
            releaseProvider = resolve;
        });
        const attemptRows: any[] = [];
        const attemptRepository = {
            insert: async (attempt: any) => {
                attemptRows.push({ ...attempt });
            },
            update: async (where: any, values: any) => {
                Object.assign(
                    attemptRows.find(item => item.callId === where.callId),
                    values,
                );
            },
            find: async () => attemptRows,
        };
        let providerCalls = 0;
        const provider = {
            optimizePrompt: vi.fn(async () => {
                providerCalls++;
                await providerBarrier;
                return { text: JSON.stringify(rules.fallbackSpec('袋装咖啡商品图')) };
            }),
        };
        const repository = {
            createQueryBuilder: () => query(() => record),
            findOne: async () => record,
            save: async (value: any) => {
                value.id ??= 'optimization-1';
                record = structuredClone(value);
                return value;
            },
        };
        const config = {
            promptDailyFreeLimit: 20,
            promptDailyFreeUnlimited: false,
            paidPromptOptimizationPrice: 0,
            paidPromptOptimizationCurrencyCode: 'CNY',
            promptRateLimitPerMinute: 3,
        };
        const engine: any = Object.create(ImagePromptEngineService.prototype);
        Object.assign(engine, {
            connection: {
                rawConnection: { options: { type: 'mysql' } },
                withTransaction: serialTransactions(),
                getRepository: (_ctx: any, entity: any) =>
                    entity === ImagePromptOptimizationAttempt
                        ? attemptRepository
                        : entity === ImagePromptOptimization
                          ? repository
                          : {
                                findOne: async () => config,
                                createQueryBuilder: () => query(() => ({ id: 'customer-1' })),
                            },
            },
            customerService: { findOneByUserId: async () => ({ id: 'customer-1' }) },
            configService: {
                shopConfig: async () => ({ enabled: true, promptOptimizationEnabled: true }),
                selectPromptModel: async () => ({ config: { id: 'model-1', modelId: 'fixture-text' } }),
                promptModelAsCredential: () => ({}),
                recordPromptModelSuccess: async () => undefined,
                recordPromptModelFailure: async () => undefined,
            },
            quota: {
                reserve: async () => ({ id: 'quota-1' }),
                consumeAttempt: async () => undefined,
                capture: async () => undefined,
            },
            rules,
            providerClient: provider,
            recommendEnabledModel: async () => ({ model: { code: 'OPENAI_IMAGE_2' }, reason: 'fixture' }),
            optimizationResult: (_ctx: any, _customer: any, result: any) => result,
        });
        const input = {
            prompt: '袋装咖啡商品图',
            referenceMode: 'NONE',
            idempotencyKey: 'duplicate-prompt-1',
        };
        const first = engine.optimize(ctx, input);
        const second = engine.optimize(ctx, input);
        const settled = Promise.allSettled([first, second]);
        await vi.waitFor(() => expect(providerCalls).toBe(1));
        releaseProvider();
        const results = await settled;
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(provider.optimizePrompt).toHaveBeenCalledTimes(1);
        expect(record.id).toBe('optimization-1');
    });

    it('refunds the same free output only once under concurrent admin requests', async () => {
        const quotaEvent: any = {
            id: 'quota-1',
            bucketId: 'bucket-1',
            amount: 2,
            consumedAmount: 2,
            releasedAmount: 0,
        };
        const bucket: any = { id: 'bucket-1', consumed: 2, released: 0 };
        const output: any = {
            id: 'output-1',
            jobId: 'job-1',
            state: 'SUCCEEDED',
            walletSettled: true,
            refundedAt: null,
            billingMode: 'FREE',
            job: { id: 'job-1', channelId: ctx.channelId, quotaEventId: 'quota-1', freeQuantityCaptured: 2 },
        };
        const outputRepository = {
            createQueryBuilder: () => query(() => structuredClone(output)),
            findOne: async () => structuredClone(output),
            save: async (value: any) => {
                Object.assign(output, value);
                return value;
            },
        };
        const service: any = Object.create(ImageGenerationService.prototype);
        const quota: any = Object.create(ImageUsageQuotaService.prototype);
        quota.connection = {
            rawConnection: { options: { type: 'mysql' } },
            getRepository: (_ctx: any, entity: any) => {
                const value = entity === ImageUsageQuotaEvent ? quotaEvent : bucket;
                return { createQueryBuilder: () => query(() => value), save: async () => value };
            },
        };
        Object.assign(service, {
            connection: {
                rawConnection: { options: { type: 'mysql' } },
                withTransaction: serialTransactions(),
                getRepository: (_ctx: any, entity: any) =>
                    entity === ImageGenerationOutput
                        ? outputRepository
                        : {
                              createQueryBuilder: () => query(() => structuredClone(output.job)),
                              save: async (value: any) => value,
                          },
            },
            quota,
            refreshJob: async () => undefined,
            refreshJobSettlement: async () => undefined,
        });
        const refunds = await Promise.allSettled([
            service.adminRefundOutput(ctx, 'output-1', 'fixture refund'),
            service.adminRefundOutput(ctx, 'output-1', 'fixture refund'),
        ]);
        expect(refunds.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(quotaEvent.consumedAmount).toBe(1);
        expect(bucket.released).toBe(1);
        expect(output.refundedAt).toBeInstanceOf(Date);
    });
});
