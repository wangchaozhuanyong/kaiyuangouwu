import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Job,
    JobQueue,
    JobQueueService,
    ProcessContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { ReferralWalletUsage } from '@vendure/store-management-plugin';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { In, LessThan, LessThanOrEqual } from 'typeorm';

import {
    IMAGE_DISPATCH_MAX_AGE_MS,
    IMAGE_DISPATCH_REQUEUE_AGE_MS,
    IMAGE_GENERATION_LOGGER_CTX,
    IMAGE_GENERATION_QUEUE,
    IMAGE_UNKNOWN_MAX_AGE_MS,
    IMAGE_WORKER_HEARTBEAT_INTERVAL_MS,
} from './constants';
import { ImageGenerationCostEvent } from './entities/image-generation-cost-event.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageGenerationRuntimeStatus } from './entities/image-generation-runtime-status.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';
import { ImageUsageQuotaEvent } from './entities/image-usage-quota-event.entity';
import { ImageGenerationConfigService } from './image-generation-config.service';
import { classifyImageGenerationFailure, safeDiagnosticMessage } from './image-generation-failure';
import {
    decideImageOutputFailure,
    imageDispatchReadyAt,
    imageOutboxRetryDelayMs,
    interruptedImageStageAction,
    preserveProviderCostTelemetry,
} from './image-generation-state';
import { ImageGenerationService } from './image-generation.service';
import { traceValues } from './prompt/image-prompt-attempt';
import {
    DefinitiveImageProviderError,
    ImageProviderClient,
    LocalImageProcessingError,
    RetryableImageProviderError,
} from './provider/image-provider.client';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';
import {
    ImageGenerationProcessingStage,
    ImageProviderProtocol,
    ImageProviderScope,
    ProviderTelemetry,
} from './types';

interface ImageOutputJobData {
    outputId: string;
}

@Injectable()
export class ImageGenerationQueueService implements OnApplicationBootstrap, OnApplicationShutdown {
    private settlementCursor?: ID;
    private queue: JobQueue<ImageOutputJobData>;
    private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    private activeJobs = 0;
    private readonly workerId = `${hostname()}:${process.pid}`;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly requestContextService: RequestContextService,
        private readonly jobQueueService: JobQueueService,
        private readonly processContext: ProcessContext,
        private readonly configService: ImageGenerationConfigService,
        private readonly providerClient: ImageProviderClient,
        private readonly storage: ImagePrivateStorageService,
        private readonly generations: ImageGenerationService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.queue = await this.jobQueueService.createQueue({
            name: IMAGE_GENERATION_QUEUE,
            process: async job => {
                this.activeJobs += 1;
                await this.writeWorkerHeartbeat('RUNNING').catch(() => undefined);
                try {
                    return await this.process(job);
                } finally {
                    this.activeJobs = Math.max(0, this.activeJobs - 1);
                    await this.writeWorkerHeartbeat('RUNNING').catch(() => undefined);
                }
            },
        });
        this.generations.registerEnqueuer(outputId => this.dispatchOutput(outputId));
        if (this.processContext.isWorker) {
            await this.writeWorkerHeartbeat('RUNNING').catch(error =>
                Logger.warn(`worker heartbeat: ${safeError(error)}`, IMAGE_GENERATION_LOGGER_CTX),
            );
            this.heartbeatTimer = setInterval(() => {
                void this.writeWorkerHeartbeat('RUNNING').catch(error =>
                    Logger.warn(`worker heartbeat: ${safeError(error)}`, IMAGE_GENERATION_LOGGER_CTX),
                );
            }, IMAGE_WORKER_HEARTBEAT_INTERVAL_MS);
            this.heartbeatTimer.unref?.();
        }
    }

    async onApplicationShutdown(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.processContext.isWorker) {
            await this.writeWorkerHeartbeat('STOPPED').catch(() => undefined);
        }
    }

    async reconcileUnknown(): Promise<number> {
        const dispatched = await this.reconcileDispatches();
        const cutoff = new Date(Date.now() - IMAGE_UNKNOWN_MAX_AGE_MS);
        const rawRepository = this.connection.rawConnection.getRepository(ImageGenerationOutput);
        const stale = await rawRepository
            .createQueryBuilder('output')
            .innerJoinAndSelect('output.job', 'job')
            .innerJoinAndSelect('job.channel', 'channel')
            .where('(output.state = :unknown AND COALESCE(output.unknownAt, output.updatedAt) <= :cutoff)', {
                unknown: 'UNKNOWN',
                cutoff,
            })
            .orWhere('(output.state = :running AND output.updatedAt <= :cutoff)', {
                running: 'RUNNING',
                cutoff,
            })
            .take(100)
            .getMany();
        let released = 0;
        const handledChannels = new Set<string>();
        for (const output of stale) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: output.job.channel,
            });
            if (output.state === 'RUNNING') {
                const transition = await this.connection
                    .getRepository(ctx, ImageGenerationOutput)
                    .update(
                        { id: output.id, state: 'RUNNING', walletSettled: false },
                        { state: 'UNKNOWN', unknownAt: output.updatedAt },
                    );
                if (transition.affected === 1) {
                    output.state = 'UNKNOWN';
                    output.unknownAt = output.updatedAt;
                }
            }
            const channelId = String(output.job.channelId);
            if (!handledChannels.has(channelId)) {
                handledChannels.add(channelId);
                released += await this.generations.releaseUnknownOlderThan(ctx, cutoff);
            }
        }
        const unsettledTerminal = await rawRepository.find({
            where: { state: In(['FAILED', 'CANCELLED']), walletSettled: false },
            relations: { job: { channel: true } },
            take: 100,
        });
        for (const output of unsettledTerminal) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: output.job.channel,
            });
            if (await this.generations.settleUnreleasedTerminalOutput(ctx, output.id)) released += 1;
        }
        return released + dispatched + (await this.reconcileTerminalJobs());
    }

    /** Repair earlier interrupted releases/refunds from persisted output and wallet facts. */
    private async reconcileTerminalJobs(): Promise<number> {
        // Bound each sweep even when compliance history has grown beyond image retention.
        const scan = this.connection.rawConnection
            .getRepository(ImageGenerationJob)
            .createQueryBuilder('job')
            .select('job.id')
            .orderBy('job.id', 'ASC')
            .take(100);
        if (this.settlementCursor != null) scan.where('job.id > :after', { after: this.settlementCursor });
        const batch = await scan.getMany();
        this.settlementCursor = batch.length === 100 ? batch[batch.length - 1].id : undefined;
        if (!batch.length) return 0;
        const settlementJobIds = batch.map(job => job.id);
        const jobs = await this.connection.rawConnection
            .getRepository(ImageGenerationJob)
            .createQueryBuilder('job')
            .innerJoinAndSelect('job.channel', 'channel')
            .innerJoin(
                query =>
                    query
                        .select('output.jobId', 'jobId')
                        .addSelect('COUNT(*)', 'outputCount')
                        .addSelect(
                            "SUM(CASE WHEN output.state IN ('QUEUED', 'RUNNING', 'UNKNOWN') THEN 1 ELSE 0 END)",
                            'activeCount',
                        )
                        .addSelect(
                            "SUM(CASE WHEN output.state = 'SUCCEEDED' AND output.refundedAt IS NULL THEN output.chargeAmount ELSE 0 END)",
                            'capturedAmount',
                        )
                        .from(ImageGenerationOutput, 'output')
                        .where('output.jobId IN (:...settlementJobIds)', { settlementJobIds })
                        .groupBy('output.jobId'),
                'settlement',
                'settlement.jobId = job.id',
            )
            .leftJoin(ReferralWalletUsage, 'usage', 'usage.id = job.walletUsageId')
            .leftJoin(ImageUsageQuotaEvent, 'quota', 'quota.id = job.quotaEventId')
            .where('settlement.activeCount = 0 AND settlement.outputCount = job.quantity')
            .andWhere('job.id IN (:...settlementJobIds)', { settlementJobIds })
            .andWhere(
                `(job.state NOT IN ('SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED')
                OR job.completedAt IS NULL
                OR job.capturedAmount <> settlement.capturedAmount
                OR job.releasedAmount <> CASE WHEN job.expectedChargeAmount > settlement.capturedAmount
                    THEN job.expectedChargeAmount - settlement.capturedAmount ELSE 0 END
                OR usage.amount > usage.capturedAmount + usage.releasedAmount
                OR quota.amount > quota.consumedAmount + quota.releasedAmount)`,
            )
            .orderBy('job.id', 'ASC')
            .take(100)
            .getMany();
        let repaired = 0;
        for (const job of jobs) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: job.channel,
            });
            try {
                await this.generations.refreshJob(ctx, job.id);
                repaired += 1;
            } catch (error) {
                Logger.warn(`settlement ${String(job.id)}: ${safeError(error)}`, IMAGE_GENERATION_LOGGER_CTX);
            }
        }
        return repaired;
    }

    async dispatchOutput(outputId: ID): Promise<void> {
        const dispatchRepository = this.connection.rawConnection.getRepository(ImageGenerationDispatch);
        await dispatchRepository
            .insert(
                new ImageGenerationDispatch({
                    outputId,
                    state: 'PENDING',
                    attemptCount: 0,
                    nextAttemptAt: imageDispatchReadyAt(),
                    dispatchedAt: null,
                    queueTaskId: null,
                    processingStage: null,
                    heartbeatAt: null,
                    stagedAssetId: null,
                    lastError: null,
                }),
            )
            .catch(() => undefined);
        const output = await this.connection.rawConnection.getRepository(ImageGenerationOutput).findOne({
            where: { id: outputId },
        });
        if (!output || output.state !== 'QUEUED') {
            await dispatchRepository.update({ outputId }, { state: 'COMPLETED', lastError: null });
            return;
        }
        const claim = await dispatchRepository.update(
            { outputId, state: 'PENDING', nextAttemptAt: LessThanOrEqual(new Date()) },
            { state: 'DISPATCHING', lastError: null },
        );
        if (claim.affected !== 1) return;
        try {
            const queued = await this.queue.add({ outputId: String(outputId) }, { retries: 0 });
            await dispatchRepository.update(
                { outputId, state: 'DISPATCHING' },
                {
                    state: 'DISPATCHED',
                    dispatchedAt: new Date(),
                    queueTaskId: queued.id == null ? null : String(queued.id),
                    lastError: null,
                },
            );
        } catch (error) {
            const current = await dispatchRepository.findOne({ where: { outputId } });
            const attemptCount = (current?.attemptCount ?? 0) + 1;
            await dispatchRepository.update(
                { outputId, state: 'DISPATCHING' },
                {
                    state: 'PENDING',
                    attemptCount,
                    nextAttemptAt: new Date(Date.now() + dispatchBackoffMs(attemptCount)),
                    lastError: safeError(error),
                },
            );
            throw error;
        }
    }

    private async reconcileDispatches(): Promise<number> {
        const rawConnection = this.connection.rawConnection;
        const dispatchRepository = rawConnection.getRepository(ImageGenerationDispatch);
        // Old retry writes could commit QUEUED while leaving a completed dispatch.
        // Return these to UNKNOWN; the normal approval path rechecks the pinned credential.
        const interruptedRetries = await rawConnection
            .getRepository(ImageGenerationOutput)
            .createQueryBuilder('output')
            .innerJoin(ImageGenerationDispatch, 'dispatch', 'dispatch.outputId = output.id')
            .innerJoinAndSelect('output.job', 'job')
            .innerJoinAndSelect('job.channel', 'channel')
            .where('output.state = :state AND output.walletSettled = :settled', {
                state: 'QUEUED',
                settled: false,
            })
            .andWhere('output.failureCode = :failure', { failure: 'UNKNOWN_RETRY' })
            .andWhere('dispatch.state IN (:...dispatchStates)', { dispatchStates: ['COMPLETED', 'FAILED'] })
            .take(100)
            .getMany();
        for (const output of interruptedRetries) {
            const restored = await rawConnection.getRepository(ImageGenerationOutput).update(
                { id: output.id, state: 'QUEUED', walletSettled: false, failureCode: 'UNKNOWN_RETRY' },
                {
                    state: 'UNKNOWN',
                    unknownAt: output.updatedAt,
                    errorMessage: '上次重试未完成，请确认后重新重试',
                },
            );
            if (restored.affected === 1) {
                const ctx = await this.requestContextService.create({
                    apiType: 'admin',
                    channelOrToken: output.job.channel,
                });
                await this.generations.refreshJob(ctx, output.jobId);
            }
        }
        const missing = await rawConnection
            .getRepository(ImageGenerationOutput)
            .createQueryBuilder('output')
            .leftJoin(ImageGenerationDispatch, 'dispatch', 'dispatch.outputId = output.id')
            .where('output.state = :state', { state: 'QUEUED' })
            .andWhere('dispatch.id IS NULL')
            .take(100)
            .getMany();
        for (const output of missing) {
            await dispatchRepository
                .insert(
                    new ImageGenerationDispatch({
                        outputId: output.id,
                        state: 'PENDING',
                        attemptCount: 0,
                        nextAttemptAt: imageDispatchReadyAt(),
                        dispatchedAt: null,
                        queueTaskId: null,
                        processingStage: null,
                        heartbeatAt: null,
                        stagedAssetId: null,
                        lastError: null,
                    }),
                )
                .catch(() => undefined);
        }
        await dispatchRepository.update(
            { state: 'DISPATCHING', updatedAt: LessThan(new Date(Date.now() - 60_000)) },
            {
                state: 'PENDING',
                nextAttemptAt: imageDispatchReadyAt(),
                lastError: '入队进程中断，已安排自动重试',
            },
        );
        const lostDispatchCutoff = new Date(Date.now() - IMAGE_DISPATCH_REQUEUE_AGE_MS);
        const lostDispatched = await dispatchRepository
            .createQueryBuilder('dispatch')
            .innerJoinAndSelect('dispatch.output', 'output')
            .where('dispatch.state = :state', { state: 'DISPATCHED' })
            .andWhere('dispatch.processingStage IS NULL')
            .andWhere('output.state = :outputState', { outputState: 'QUEUED' })
            .andWhere('dispatch.dispatchedAt <= :cutoff', { cutoff: lostDispatchCutoff })
            .take(100)
            .getMany();
        for (const dispatch of lostDispatched) {
            await dispatchRepository.update(
                { id: dispatch.id, state: 'DISPATCHED' },
                {
                    state: 'PENDING',
                    nextAttemptAt: imageDispatchReadyAt(),
                    queueTaskId: null,
                    lastError: '队列任务超过 2 分钟未被领取，已安排重新入队',
                },
            );
        }
        const staleStageCutoff = new Date(Date.now() - IMAGE_DISPATCH_REQUEUE_AGE_MS);
        const recoveredStages = await this.recoverInterruptedStages(staleStageCutoff);
        const due = await dispatchRepository.find({
            where: { state: 'PENDING', nextAttemptAt: LessThanOrEqual(new Date()) },
            relations: { output: { job: { channel: true } } },
            order: { nextAttemptAt: 'ASC' },
            take: 100,
        });
        let handled = 0;
        for (const dispatch of due) {
            if (dispatch.output.state !== 'QUEUED') {
                await dispatchRepository.update({ id: dispatch.id }, { state: 'COMPLETED' });
                continue;
            }
            if (dispatch.output.updatedAt.getTime() <= Date.now() - IMAGE_DISPATCH_MAX_AGE_MS) {
                const ctx = await this.requestContextService.create({
                    apiType: 'admin',
                    channelOrToken: dispatch.output.job.channel,
                });
                await this.generations.failQueuedOutput(
                    ctx,
                    dispatch.outputId,
                    '生图任务持续无法进入队列，已自动退回本张费用',
                    'QUEUE_DISPATCH',
                );
                await dispatchRepository.update(
                    { id: dispatch.id },
                    { state: 'FAILED', lastError: '超过自动入队时限' },
                );
                handled += 1;
                continue;
            }
            try {
                await this.dispatchOutput(dispatch.outputId);
                handled += 1;
            } catch (error) {
                Logger.warn(
                    `dispatch ${String(dispatch.outputId)}: ${safeError(error)}`,
                    IMAGE_GENERATION_LOGGER_CTX,
                );
            }
        }
        await this.writeWorkerHeartbeat('RUNNING', new Date()).catch(() => undefined);
        return handled + lostDispatched.length + recoveredStages + interruptedRetries.length;
    }

    private async process(
        jobQueueItem: Job<ImageOutputJobData>,
    ): Promise<{ outputId: string; state: string }> {
        const rawRepository = this.connection.rawConnection.getRepository(ImageGenerationOutput);
        const claim = await rawRepository.update(
            { id: jobQueueItem.data.outputId as ID, state: 'QUEUED' },
            { state: 'RUNNING', errorMessage: null },
        );
        if (claim.affected !== 1) {
            const current = await rawRepository.findOne({ where: { id: jobQueueItem.data.outputId as ID } });
            if (current && !['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(current.state)) {
                await this.completeDispatch(current.id);
            }
            return { outputId: jobQueueItem.data.outputId, state: current?.state ?? 'MISSING' };
        }
        const output = await rawRepository.findOne({
            where: { id: jobQueueItem.data.outputId as ID },
            relations: { job: { channel: true, referenceAsset: true } },
        });
        if (!output) return { outputId: jobQueueItem.data.outputId, state: 'MISSING' };
        const ctx = await this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: output.job.channel,
        });
        await this.updateDispatchStage(output.id, 'CLAIMED');
        output.attemptCount += 1;
        await this.connection.getRepository(ctx, ImageGenerationOutput).save(output, { reload: false });
        await this.generations.refreshJob(ctx, output.jobId);
        const taskHeartbeat = setInterval(() => {
            void this.touchDispatch(output.id);
        }, IMAGE_WORKER_HEARTBEAT_INTERVAL_MS);
        taskHeartbeat.unref?.();

        let storedAsset: ImagePrivateAsset | undefined;
        let providerTelemetry: ProviderTelemetry | undefined;
        let providerStage: ImageGenerationProcessingStage = 'CLAIMED';
        let providerStartedAt = Date.now();
        let selectedCredential: ImageProviderCredential | null = null;
        try {
            selectedCredential = output.job.providerCredentialCodeSnapshot
                ? await this.configService.credentialByCode(ctx, output.job.providerCredentialCodeSnapshot)
                : null;
            if (
                !selectedCredential?.enabled ||
                selectedCredential.healthStatus !== 'HEALTHY' ||
                (selectedCredential.cooldownUntil?.getTime() ?? 0) > Date.now()
            ) {
                // Routing is frozen when the job is created. Changing a shared job snapshot
                // here also changes the identity of sibling outputs and UNKNOWN retries.
                throw new DefinitiveImageProviderError('原任务账号暂不可用，请等待恢复后再试');
            }
            const credential = selectedCredential;
            const currentFingerprint = this.configService.credentialFingerprint(credential);
            if (
                output.job.providerCredentialFingerprint &&
                output.job.providerCredentialFingerprint !== currentFingerprint
            ) {
                throw new DefinitiveImageProviderError(
                    '中转站账号或地址已更换，已拒绝使用旧任务参数发起请求',
                );
            }
            const referenceAssetIds = generationReferenceAssetIds(output.job);
            const generationOwnerId =
                output.job.origin === 'ADMIN_PRODUCT_IMAGE'
                    ? output.job.administratorUserId
                    : output.job.customerId;
            if (!generationOwnerId) {
                throw new DefinitiveImageProviderError('生图任务缺少所有者，已拒绝调用中转站');
            }
            const referenceOwner =
                output.job.origin === 'ADMIN_PRODUCT_IMAGE'
                    ? { administratorUserId: generationOwnerId }
                    : { customerId: generationOwnerId };
            const loadedReferences = referenceAssetIds.length
                ? await this.connection.getRepository(ctx, ImagePrivateAsset).find({
                      where: {
                          id: In(referenceAssetIds),
                          channelId: output.job.channelId,
                          ...referenceOwner,
                          kind: 'REFERENCE',
                      },
                  })
                : [];
            const referencesById = new Map(loadedReferences.map(asset => [String(asset.id), asset]));
            const orderedReferences = referenceAssetIds.map(id => referencesById.get(String(id)));
            if (
                orderedReferences.some(
                    asset => !asset || asset.deletedAt || asset.expiresAt.getTime() <= Date.now(),
                )
            ) {
                throw new DefinitiveImageProviderError('参考图不存在或已过期');
            }
            const references = await Promise.all(
                (orderedReferences as ImagePrivateAsset[]).map(async asset => ({
                    bytes: await this.storage.read(asset),
                    mimeType: asset.mimeType,
                })),
            );
            providerTelemetry = { callId: randomUUID() };
            providerStartedAt = Date.now();
            // Persist the attempt before dispatch. Missing completion remains UNKNOWN.
            await this.recordCost(
                ctx,
                output,
                'UNKNOWN',
                providerStartedAt,
                providerTelemetry,
                undefined,
                null,
                'REQUEST_STARTED',
            );
            providerStage = 'REQUEST_STARTED';
            await this.updateDispatchStage(output.id, providerStage);
            providerStartedAt = Date.now();
            const result = await this.providerClient.generate(
                credential,
                output.job.protocolSnapshot as ImageProviderProtocol,
                {
                    providerModelId: output.job.providerModelIdSnapshot,
                    prompt: output.job.finalPrompt,
                    aspectRatio: output.job.aspectRatio,
                    resolution: output.job.resolution,
                    references,
                    idempotencyKey: output.providerIdempotencyKey,
                },
            );
            providerStage = 'RESPONSE_RECEIVED';
            providerTelemetry = { ...result.telemetry, callId: providerTelemetry.callId };
            result.telemetry = providerTelemetry;
            output.providerRequestId =
                result.providerRequestId ?? result.telemetry?.providerRequestId ?? null;
            await this.connection
                .getRepository(ctx, ImageGenerationOutput)
                .update({ id: output.id, state: 'RUNNING' }, { providerRequestId: output.providerRequestId });
            await this.updateDispatchStage(output.id, providerStage);
            const storedResult = {
                ...result,
                metadata: { ...result.metadata, settlementTelemetry: result.telemetry },
            };
            storedAsset =
                output.job.origin === 'ADMIN_PRODUCT_IMAGE'
                    ? await this.storage.storeAdminGenerated(
                          ctx,
                          generationOwnerId,
                          storedResult,
                          `catalog-ai-${String(output.job.id)}-${output.outputIndex + 1}.png`,
                          output.job.resolution,
                      )
                    : await this.storage.storeGenerated(
                          ctx,
                          generationOwnerId,
                          storedResult,
                          `ai-${String(output.job.id)}-${output.outputIndex + 1}.png`,
                          output.job.resolution,
                      );
            providerStage = 'ASSET_STORED';
            await this.updateDispatchStage(output.id, 'ASSET_STORED', storedAsset.id);
            const generatedAsset = storedAsset;
            const settled = await this.generations.settleSuccessfulOutput(
                ctx,
                output.id,
                generatedAsset.id,
                result.providerRequestId,
            );
            Object.assign(output, settled, { asset: generatedAsset });
            await this.updateDispatchStage(output.id, 'SETTLED', generatedAsset.id);
            providerStage = 'SETTLED';
            await this.recordCost(
                ctx,
                output,
                'SUCCEEDED',
                providerStartedAt,
                providerTelemetry,
                undefined,
                null,
                providerStage,
            );
            await this.configService
                .recordRuntimeResult(ctx, output.job.modelConfigId, { ok: true })
                .catch(() => undefined);
            if (selectedCredential) {
                await this.configService
                    .recordCredentialRuntimeSuccess(ctx, selectedCredential)
                    .catch(() => undefined);
            }
            await this.completeDispatch(output.id);
        } catch (error) {
            // Once an asset exists, settlement may already have committed even when the
            // caller saw a database error. Preserve it and let the outbox finish locally.
            if (storedAsset) {
                await this.updateDispatchStage(
                    output.id,
                    providerStage === 'SETTLED' ? 'SETTLED' : 'ASSET_STORED',
                    storedAsset.id,
                ).catch(() => undefined);
                await this.connection
                    .getRepository(ctx, ImageGenerationDispatch)
                    .update({ outputId: output.id }, { lastError: safeDiagnosticMessage(error) })
                    .catch(() => undefined);
                Logger.warn(
                    `settlement ${String(output.id)}: ${safeDiagnosticMessage(error)}`,
                    IMAGE_GENERATION_LOGGER_CTX,
                );
                await this.generations.refreshJob(ctx, output.jobId).catch(() => undefined);
                return { outputId: String(output.id), state: output.state };
            }
            if (output.failureCode === 'UNKNOWN_RETRY' && providerStage === 'CLAIMED') {
                await this.connection.getRepository(ctx, ImageGenerationOutput).update(
                    { id: output.id, state: 'RUNNING', walletSettled: false },
                    {
                        state: 'UNKNOWN',
                        unknownAt: new Date(),
                        failureCode: 'UNKNOWN_RESULT',
                        errorMessage: '原任务账号或参考图不可用，保留待核对状态',
                    },
                );
                await this.completeDispatch(output.id);
                await this.generations.refreshJob(ctx, output.jobId);
                return { outputId: String(output.id), state: 'UNKNOWN' };
            }
            const errorTelemetry = providerErrorDetails(error);
            const auditStage: ImageGenerationProcessingStage =
                providerStage === 'REQUEST_STARTED' &&
                typeof errorTelemetry.httpStatus === 'number' &&
                errorTelemetry.httpStatus >= 200 &&
                errorTelemetry.httpStatus < 300
                    ? 'RESPONSE_RECEIVED'
                    : providerStage;
            const classified = classifyImageGenerationFailure(error, auditStage);
            const failureDetails = classified.telemetry;
            const affectsCredentialHealth = classified.affectsCredentialHealth;
            const affectsModelHealth = classified.affectsModelHealth;
            const safelyRejected = failureDetails.httpStatus === 401 || failureDetails.httpStatus === 403;
            const failureDecision = decideImageOutputFailure({
                retryable: classified.retryable || safelyRejected,
                ambiguous: classified.ambiguous,
                attempts: output.attemptCount,
                retries: 2,
            });
            const failureMessage = classified.publicMessage;
            if (selectedCredential && providerStage !== 'CLAIMED' && affectsCredentialHealth) {
                await this.configService
                    .recordCredentialRuntimeFailure(ctx, selectedCredential, {
                        httpStatus: failureDetails.httpStatus,
                        retryAfterSeconds: failureDetails.retryAfterSeconds,
                        message: classified.rawMessage,
                    })
                    .catch(() => undefined);
            }
            if (providerStage !== 'CLAIMED') {
                await this.recordCost(
                    ctx,
                    output,
                    failureDecision === 'FAIL' ? 'FAILED' : failureDecision,
                    providerStartedAt,
                    providerTelemetry,
                    error,
                    classified.code,
                    auditStage,
                );
            }
            if (
                affectsModelHealth &&
                !(error instanceof RetryableImageProviderError) &&
                (providerStage === 'REQUEST_STARTED' || providerStage === 'RESPONSE_RECEIVED')
            ) {
                await this.configService
                    .recordRuntimeResult(ctx, output.job.modelConfigId, {
                        ok: false,
                        message: classified.rawMessage,
                        credentialScope: output.job.providerScopeSnapshot as ImageProviderScope,
                        authFailure: failureDetails.httpStatus === 401 || failureDetails.httpStatus === 403,
                    })
                    .catch(() => undefined);
            }
            const settlementPending = providerStage === 'ASSET_STORED';
            if (!settlementPending && failureDecision === 'RETRY') {
                const retry = await this.connection
                    .getRepository(ctx, ImageGenerationOutput)
                    .update(
                        { id: output.id, state: 'RUNNING', walletSettled: false },
                        { state: 'QUEUED', errorMessage: failureMessage, failureCode: classified.code },
                    );
                if (retry.affected === 1) {
                    output.state = 'QUEUED';
                    output.errorMessage = failureMessage;
                    output.failureCode = classified.code;
                    const retryAfterMs = imageOutboxRetryDelayMs(
                        failureDetails.httpStatus,
                        failureDetails.retryAfterSeconds,
                    );
                    await this.connection.rawConnection.getRepository(ImageGenerationDispatch).update(
                        { outputId: output.id },
                        {
                            state: 'PENDING',
                            nextAttemptAt: new Date(Date.now() + retryAfterMs),
                            queueTaskId: null,
                            processingStage: null,
                            heartbeatAt: null,
                            lastError: classified.rawMessage,
                        },
                    );
                    await this.generations.refreshJob(ctx, output.jobId);
                }
                const current = await this.connection
                    .getRepository(ctx, ImageGenerationOutput)
                    .findOne({ where: { id: output.id } });
                if (current) Object.assign(output, current);
            }
            if (!settlementPending && failureDecision === 'UNKNOWN') {
                const unknownAt = new Date();
                const transition = await this.connection.getRepository(ctx, ImageGenerationOutput).update(
                    { id: output.id, state: 'RUNNING', walletSettled: false },
                    {
                        state: 'UNKNOWN',
                        unknownAt,
                        errorMessage: failureMessage,
                        failureCode: classified.code,
                    },
                );
                if (transition.affected === 1) {
                    output.state = 'UNKNOWN';
                    output.unknownAt = unknownAt;
                    output.errorMessage = failureMessage;
                    output.failureCode = classified.code;
                } else {
                    const current = await this.connection
                        .getRepository(ctx, ImageGenerationOutput)
                        .findOne({ where: { id: output.id } });
                    if (current) Object.assign(output, current);
                }
            } else if (!settlementPending && failureDecision !== 'RETRY') {
                const failed = await this.generations.failRunningOutput(
                    ctx,
                    output.id,
                    failureMessage,
                    classified.code,
                );
                if (failed) {
                    output.state = 'FAILED';
                    output.completedAt = new Date();
                    output.errorMessage = failureMessage;
                    output.failureCode = classified.code;
                    output.walletSettled = true;
                } else {
                    const current = await this.connection
                        .getRepository(ctx, ImageGenerationOutput)
                        .findOne({ where: { id: output.id } });
                    if (current) Object.assign(output, current);
                }
            }
            if (settlementPending) {
                await this.connection
                    .getRepository(ctx, ImageGenerationOutput)
                    .update(
                        { id: output.id, state: 'RUNNING' },
                        { errorMessage: classified.publicMessage, failureCode: 'SETTLEMENT' },
                    );
                output.state = 'RUNNING';
                output.errorMessage = classified.publicMessage;
                output.failureCode = 'SETTLEMENT';
            } else if (failureDecision !== 'RETRY') {
                await this.completeDispatch(output.id);
            }
            Logger.warn(
                `${String(output.id)} stage=${auditStage} code=${classified.code} type=${diagnosticErrorType(error)}: ${classified.rawMessage}`,
                IMAGE_GENERATION_LOGGER_CTX,
            );
        } finally {
            clearInterval(taskHeartbeat);
        }
        await this.generations.refreshJob(ctx, output.jobId);
        return { outputId: String(output.id), state: output.state };
    }

    private async completeDispatch(outputId: ID): Promise<void> {
        await this.connection.rawConnection
            .getRepository(ImageGenerationDispatch)
            .update(
                { outputId },
                { state: 'COMPLETED', processingStage: 'SETTLED', heartbeatAt: new Date(), lastError: null },
            );
    }

    private async updateDispatchStage(
        outputId: ID,
        stage: ImageGenerationProcessingStage,
        stagedAssetId?: ID,
    ): Promise<void> {
        await this.connection.rawConnection.getRepository(ImageGenerationDispatch).update(
            { outputId, state: 'DISPATCHED' },
            {
                processingStage: stage,
                heartbeatAt: new Date(),
                ...(stagedAssetId == null ? {} : { stagedAssetId }),
                lastError: null,
            },
        );
    }

    private async touchDispatch(outputId: ID): Promise<void> {
        await this.connection.rawConnection
            .getRepository(ImageGenerationDispatch)
            .update({ outputId, state: 'DISPATCHED' }, { heartbeatAt: new Date() })
            .catch(() => undefined);
    }

    private async recoverInterruptedStages(cutoff: Date): Promise<number> {
        const dispatchRepository = this.connection.rawConnection.getRepository(ImageGenerationDispatch);
        const stale = await dispatchRepository.find({
            where: {
                state: 'DISPATCHED',
                processingStage: In([
                    'CLAIMED',
                    'REQUEST_STARTED',
                    'RESPONSE_RECEIVED',
                    'ASSET_STORED',
                    'SETTLED',
                ]),
                heartbeatAt: LessThanOrEqual(cutoff),
            },
            relations: { output: { job: { channel: true } }, stagedAsset: true },
            take: 100,
        });
        let handled = 0;
        for (const dispatch of stale) {
            const output = dispatch.output;
            if (!output || !['RUNNING', 'SUCCEEDED'].includes(output.state)) {
                if (output?.state !== 'QUEUED') await this.completeDispatch(dispatch.outputId);
                continue;
            }
            const recoveryAction = interruptedImageStageAction(dispatch.processingStage, output.state);
            if (recoveryAction === 'REQUEUE') {
                const reset = await this.connection.rawConnection
                    .getRepository(ImageGenerationOutput)
                    .update(
                        { id: output.id, state: 'RUNNING', walletSettled: false },
                        { state: 'QUEUED', errorMessage: null, failureCode: null },
                    );
                if (reset.affected === 1) {
                    await dispatchRepository.update(
                        { id: dispatch.id, state: 'DISPATCHED' },
                        {
                            state: 'PENDING',
                            nextAttemptAt: imageDispatchReadyAt(),
                            queueTaskId: null,
                            processingStage: null,
                            heartbeatAt: null,
                            lastError: '请求发出前 Worker 中断，已安全重新入队',
                        },
                    );
                    handled += 1;
                }
                continue;
            }
            if (recoveryAction === 'UNKNOWN') {
                const unknownAt = new Date();
                const marked = await this.connection.rawConnection
                    .getRepository(ImageGenerationOutput)
                    .update(
                        { id: output.id, state: 'RUNNING', walletSettled: false },
                        {
                            state: 'UNKNOWN',
                            unknownAt,
                            failureCode: 'UNKNOWN_RESULT',
                            errorMessage: '生成结果暂时无法确认，系统正在核对，请勿重复提交',
                        },
                    );
                if (marked.affected === 1) {
                    await dispatchRepository.update(
                        { id: dispatch.id },
                        { state: 'COMPLETED', lastError: '请求发出后 Worker 中断，转为 UNKNOWN 核对' },
                    );
                    handled += 1;
                }
                continue;
            }
            if (recoveryAction === 'SETTLE') {
                const asset = dispatch.stagedAsset;
                if (!asset || asset.deletedAt) continue;
                const ctx = await this.requestContextService.create({
                    apiType: 'admin',
                    channelOrToken: output.job.channel,
                });
                try {
                    const settled = await this.generations.settleSuccessfulOutput(
                        ctx,
                        output.id,
                        asset.id,
                        output.providerRequestId ?? undefined,
                    );
                    Object.assign(output, settled, { asset });
                    await this.recordCost(
                        ctx,
                        output,
                        'SUCCEEDED',
                        Date.now(),
                        {
                            ...asset.providerMetadata?.settlementTelemetry,
                            providerRequestId: output.providerRequestId ?? undefined,
                        },
                        undefined,
                        null,
                        'ASSET_STORED',
                    );
                    await this.completeDispatch(output.id);
                    await this.generations.refreshJob(ctx, output.jobId);
                    handled += 1;
                } catch (error) {
                    await dispatchRepository.update(
                        { id: dispatch.id },
                        { heartbeatAt: new Date(), lastError: safeDiagnosticMessage(error) },
                    );
                    Logger.warn(
                        `${String(output.id)} stage=ASSET_STORED code=SETTLEMENT type=${diagnosticErrorType(error)}: ${safeDiagnosticMessage(error)}`,
                        IMAGE_GENERATION_LOGGER_CTX,
                    );
                }
                continue;
            }
            if (recoveryAction === 'COMPLETE') {
                try {
                    if (output.state === 'SUCCEEDED') {
                        const ctx = await this.requestContextService.create({
                            apiType: 'admin',
                            channelOrToken: output.job.channel,
                        });
                        await this.recordCost(
                            ctx,
                            output,
                            'SUCCEEDED',
                            Date.now(),
                            {
                                ...dispatch.stagedAsset?.providerMetadata?.settlementTelemetry,
                                providerRequestId: output.providerRequestId ?? undefined,
                            },
                            undefined,
                            null,
                            'ASSET_STORED',
                        );
                        await this.generations.refreshJob(ctx, output.jobId);
                    }
                    await this.completeDispatch(output.id);
                    handled += 1;
                } catch (error) {
                    await dispatchRepository.update(
                        { id: dispatch.id },
                        { heartbeatAt: new Date(), lastError: safeDiagnosticMessage(error) },
                    );
                }
            }
        }
        return handled;
    }

    private async writeWorkerHeartbeat(status: string, lastReconcileAt?: Date): Promise<void> {
        if (!this.processContext.isWorker) return;
        const repository = this.connection.rawConnection.getRepository(ImageGenerationRuntimeStatus);
        let runtime = await repository.findOne({ where: { queueName: IMAGE_GENERATION_QUEUE } });
        const values = {
            workerId: this.workerId,
            status,
            heartbeatAt: new Date(),
            activeJobs: this.activeJobs,
            ...(lastReconcileAt ? { lastReconcileAt } : {}),
            lastError: null,
        };
        if (!runtime) {
            runtime = await repository
                .save(new ImageGenerationRuntimeStatus({ queueName: IMAGE_GENERATION_QUEUE, ...values }))
                .catch(async () => repository.findOneByOrFail({ queueName: IMAGE_GENERATION_QUEUE }));
        }
        await repository.update({ id: runtime.id }, values);
    }

    private async recordCost(
        ctx: Awaited<ReturnType<RequestContextService['create']>>,
        output: ImageGenerationOutput,
        outcome: string,
        startedAt: number,
        telemetry?: ProviderTelemetry,
        error?: unknown,
        failureCode?: string | null,
        providerStage?: string | null,
    ): Promise<void> {
        const details = providerErrorDetails(error);
        const repository = this.connection.getRepository(ctx, ImageGenerationCostEvent);
        const values = new ImageGenerationCostEvent({
            channelId: output.job.channelId,
            jobIdSnapshot: String(output.job.id),
            outputIdSnapshot: String(output.id),
            attemptNumber: output.attemptCount,
            modelCodeSnapshot: output.job.modelCodeSnapshot,
            providerScopeSnapshot: output.job.providerScopeSnapshot,
            credentialFingerprint: output.job.providerCredentialFingerprint,
            credentialCodeSnapshot: output.job.providerCredentialCodeSnapshot,
            credentialNameSnapshot: output.job.providerCredentialNameSnapshot,
            credentialLast4Snapshot: output.job.providerCredentialLast4Snapshot,
            credentialSelectionReason: output.job.providerSelectionReason,
            saleUnitPriceSnapshot: output.chargeAmount,
            saleCurrencyCode: output.job.currencyCode,
            outcome,
            ...traceValues({ ...details, ...telemetry }),
            httpStatus: telemetry?.httpStatus ?? details.httpStatus ?? null,
            providerRequestId:
                (telemetry?.providerRequestId ?? details.providerRequestId)?.slice(0, 200) ?? null,
            latencyMs: Math.min(2_147_483_647, Math.max(0, Date.now() - startedAt)),
            actualCostMicrounits: telemetry?.actualCostMicrounits ?? details.actualCostMicrounits ?? null,
            costCurrency:
                (telemetry?.costCurrency ?? details.costCurrency)?.slice(0, 3).toUpperCase() ?? null,
            usage: telemetry?.usage ?? details.usage ?? null,
            errorMessage: error ? safeDiagnosticMessage(error) : null,
            failureCode: failureCode ?? null,
            providerStage: providerStage ?? null,
        });
        const existing = await repository.findOne({
            where: { outputIdSnapshot: String(output.id), attemptNumber: output.attemptCount },
        });
        const operation = existing
            ? repository.update({ id: existing.id }, preserveProviderCostTelemetry(existing, values))
            : repository.insert(values);
        await operation.catch(costError => {
            Logger.warn(
                `cost ${String(output.id)}#${output.attemptCount}: ${safeError(costError)}`,
                IMAGE_GENERATION_LOGGER_CTX,
            );
            throw costError;
        });
    }
}

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function diagnosticErrorType(error: unknown): string {
    if (error instanceof LocalImageProcessingError) {
        return `${error.name}/${error.sourceErrorName}`.slice(0, 200);
    }
    return (error instanceof Error ? error.name : typeof error).slice(0, 200);
}

function providerErrorDetails(error: unknown): ProviderTelemetry {
    if (!error || typeof error !== 'object' || !('details' in error)) return {};
    const details = (error as { details?: unknown }).details;
    return details && typeof details === 'object' ? details : {};
}

function generationReferenceAssetIds(job: ImageGenerationJob): ID[] {
    const snapshotIds = job.promptSpec?.referenceAssetIds;
    if (Array.isArray(snapshotIds)) {
        const ids = snapshotIds.map(String).filter(Boolean);
        if (ids.length) return ids;
    }
    return job.referenceAssetId ? [job.referenceAssetId] : [];
}

function dispatchBackoffMs(attemptCount: number): number {
    return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(6, Math.max(0, attemptCount - 1)));
}
