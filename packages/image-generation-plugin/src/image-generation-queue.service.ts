import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Job,
    JobQueue,
    JobQueueService,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { In, LessThan, LessThanOrEqual } from 'typeorm';

import { IMAGE_DISPATCH_MAX_AGE_MS, IMAGE_GENERATION_LOGGER_CTX, IMAGE_GENERATION_QUEUE } from './constants';
import { ImageGenerationCostEvent } from './entities/image-generation-cost-event.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';
import { ImageGenerationConfigService, providerScopeForModel } from './image-generation-config.service';
import { decideImageOutputFailure } from './image-generation-state';
import { ImageGenerationService } from './image-generation.service';
import {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    ImageProviderClient,
    RetryableImageProviderError,
} from './provider/image-provider.client';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';
import { ImageProviderProtocol, ImageProviderScope, ProviderTelemetry } from './types';

interface ImageOutputJobData {
    outputId: string;
}

@Injectable()
export class ImageGenerationQueueService implements OnApplicationBootstrap {
    private queue: JobQueue<ImageOutputJobData>;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly requestContextService: RequestContextService,
        private readonly jobQueueService: JobQueueService,
        private readonly configService: ImageGenerationConfigService,
        private readonly providerClient: ImageProviderClient,
        private readonly storage: ImagePrivateStorageService,
        private readonly generations: ImageGenerationService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.queue = await this.jobQueueService.createQueue({
            name: IMAGE_GENERATION_QUEUE,
            process: job => this.process(job),
        });
        this.generations.registerEnqueuer(outputId => this.dispatchOutput(outputId));
    }

    async reconcileUnknown(): Promise<number> {
        const dispatched = await this.reconcileDispatches();
        const cutoff = new Date(Date.now() - 15 * 60_000);
        const rawRepository = this.connection.rawConnection.getRepository(ImageGenerationOutput);
        const stale = await rawRepository
            .createQueryBuilder('output')
            .innerJoinAndSelect('output.job', 'job')
            .innerJoinAndSelect('job.channel', 'channel')
            .where('(output.state = :unknown AND output.unknownAt <= :cutoff)', {
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
        return released + dispatched;
    }

    async dispatchOutput(outputId: ID): Promise<void> {
        const dispatchRepository = this.connection.rawConnection.getRepository(ImageGenerationDispatch);
        await dispatchRepository
            .insert(
                new ImageGenerationDispatch({
                    outputId,
                    state: 'PENDING',
                    attemptCount: 0,
                    nextAttemptAt: new Date(),
                    dispatchedAt: null,
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
            await this.queue.add({ outputId: String(outputId) }, { retries: 2 });
            await dispatchRepository.update(
                { outputId, state: 'DISPATCHING' },
                { state: 'DISPATCHED', dispatchedAt: new Date(), lastError: null },
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
                        nextAttemptAt: new Date(),
                        dispatchedAt: null,
                        lastError: null,
                    }),
                )
                .catch(() => undefined);
        }
        await dispatchRepository.update(
            { state: 'DISPATCHING', updatedAt: LessThan(new Date(Date.now() - 60_000)) },
            {
                state: 'PENDING',
                nextAttemptAt: new Date(),
                lastError: '入队进程中断，已安排自动重试',
            },
        );
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
        return handled;
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
            if (current && current.state !== 'QUEUED' && current.state !== 'RUNNING') {
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
        output.attemptCount += 1;
        await this.connection.getRepository(ctx, ImageGenerationOutput).save(output, { reload: false });
        await this.generations.refreshJob(ctx, output.jobId);

        let storedAsset: ImagePrivateAsset | undefined;
        let providerTelemetry: ProviderTelemetry | undefined;
        let providerStage: 'NOT_CALLED' | 'CALLING' | 'RETURNED' | 'STORED' = 'NOT_CALLED';
        let providerStartedAt = Date.now();
        let selectedCredential: ImageProviderCredential | null = null;
        try {
            const providerScope =
                (output.job.providerScopeSnapshot as ImageProviderScope | undefined) ??
                providerScopeForModel(
                    output.job.protocolSnapshot as ImageProviderProtocol,
                    output.job.providerModelIdSnapshot,
                );
            selectedCredential = output.job.providerCredentialCodeSnapshot
                ? await this.configService.credentialByCode(ctx, output.job.providerCredentialCodeSnapshot)
                : null;
            if (
                !selectedCredential?.enabled ||
                selectedCredential.healthStatus !== 'HEALTHY' ||
                (selectedCredential.cooldownUntil?.getTime() ?? 0) > Date.now()
            ) {
                const route = await this.configService.routeCredential(
                    ctx,
                    providerScope,
                    output.job.modelConfigId,
                    'IMAGE',
                );
                selectedCredential = route.credential;
                Object.assign(output.job, {
                    providerCredentialCodeSnapshot: route.credential.code,
                    providerCredentialNameSnapshot: route.credential.name,
                    providerCredentialLast4Snapshot: route.credential.apiKeyLast4,
                    providerCredentialFingerprint: this.configService.credentialFingerprint(route.credential),
                    providerSelectionReason: route.selectionReason,
                });
                await this.connection.getRepository(ctx, ImageGenerationJob).save(output.job, {
                    reload: false,
                });
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
            const reference = output.job.referenceAsset
                ? {
                      bytes: await this.storage.read(output.job.referenceAsset),
                      mimeType: output.job.referenceAsset.mimeType,
                  }
                : undefined;
            providerStage = 'CALLING';
            providerStartedAt = Date.now();
            const result = await this.providerClient.generate(
                credential,
                output.job.protocolSnapshot as ImageProviderProtocol,
                {
                    providerModelId: output.job.providerModelIdSnapshot,
                    prompt: output.job.finalPrompt,
                    aspectRatio: output.job.aspectRatio,
                    reference,
                    idempotencyKey: output.providerIdempotencyKey,
                },
            );
            providerStage = 'RETURNED';
            providerTelemetry = result.telemetry;
            storedAsset = await this.storage.storeGenerated(
                ctx,
                output.job.customerId,
                result,
                `ai-${String(output.job.id)}-${output.outputIndex + 1}.png`,
            );
            providerStage = 'STORED';
            const generatedAsset = storedAsset;
            const settled = await this.generations.settleSuccessfulOutput(
                ctx,
                output.id,
                generatedAsset.id,
                result.providerRequestId,
            );
            Object.assign(output, settled, { asset: generatedAsset });
            await this.recordCost(ctx, output, 'SUCCEEDED', providerStartedAt, providerTelemetry);
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
            if (storedAsset) {
                await this.storage.deleteOwned(ctx, storedAsset.id, output.job.customerId).catch(() => false);
                storedAsset = undefined;
            }
            const failureDetails = providerErrorDetails(error);
            const safelyRejected = failureDetails.httpStatus === 401 || failureDetails.httpStatus === 403;
            const failureDecision = decideImageOutputFailure({
                retryable: error instanceof RetryableImageProviderError || safelyRejected,
                ambiguous: error instanceof AmbiguousImageProviderError,
                attempts: jobQueueItem.attempts,
                retries: jobQueueItem.retries,
            });
            const failureMessage = safeError(error);
            if (selectedCredential && providerStage !== 'NOT_CALLED') {
                await this.configService
                    .recordCredentialRuntimeFailure(ctx, selectedCredential, {
                        httpStatus: failureDetails.httpStatus,
                        retryAfterSeconds: failureDetails.retryAfterSeconds,
                        message: failureMessage,
                    })
                    .catch(() => undefined);
            }
            if (providerStage !== 'NOT_CALLED') {
                await this.recordCost(
                    ctx,
                    output,
                    failureDecision === 'FAIL' ? 'FAILED' : failureDecision,
                    providerStartedAt,
                    providerTelemetry,
                    error,
                );
            }
            if (
                !(error instanceof RetryableImageProviderError) &&
                (providerStage === 'CALLING' || providerStage === 'RETURNED')
            ) {
                await this.configService
                    .recordRuntimeResult(ctx, output.job.modelConfigId, {
                        ok: false,
                        message: failureMessage,
                        credentialScope: output.job.providerScopeSnapshot as ImageProviderScope,
                        authFailure: failureDetails.httpStatus === 401 || failureDetails.httpStatus === 403,
                    })
                    .catch(() => undefined);
            }
            if (failureDecision === 'RETRY') {
                const retry = await this.connection
                    .getRepository(ctx, ImageGenerationOutput)
                    .update(
                        { id: output.id, state: 'RUNNING', walletSettled: false },
                        { state: 'QUEUED', errorMessage: failureMessage },
                    );
                if (retry.affected === 1) {
                    output.state = 'QUEUED';
                    output.errorMessage = failureMessage;
                    await this.generations.refreshJob(ctx, output.jobId);
                    throw error;
                }
                const current = await this.connection
                    .getRepository(ctx, ImageGenerationOutput)
                    .findOne({ where: { id: output.id } });
                if (current) Object.assign(output, current);
            }
            if (failureDecision === 'UNKNOWN') {
                const unknownAt = new Date();
                const transition = await this.connection
                    .getRepository(ctx, ImageGenerationOutput)
                    .update(
                        { id: output.id, state: 'RUNNING', walletSettled: false },
                        { state: 'UNKNOWN', unknownAt, errorMessage: safeError(error) },
                    );
                if (transition.affected === 1) {
                    output.state = 'UNKNOWN';
                    output.unknownAt = unknownAt;
                    output.errorMessage = safeError(error);
                } else {
                    const current = await this.connection
                        .getRepository(ctx, ImageGenerationOutput)
                        .findOne({ where: { id: output.id } });
                    if (current) Object.assign(output, current);
                }
            } else {
                const message =
                    error instanceof DefinitiveImageProviderError
                        ? error.message.slice(0, 500)
                        : safeError(error);
                const failed = await this.generations.failRunningOutput(ctx, output.id, message);
                if (failed) {
                    output.state = 'FAILED';
                    output.completedAt = new Date();
                    output.errorMessage = message;
                    output.walletSettled = true;
                } else {
                    const current = await this.connection
                        .getRepository(ctx, ImageGenerationOutput)
                        .findOne({ where: { id: output.id } });
                    if (current) Object.assign(output, current);
                }
            }
            if (failureDecision !== 'RETRY') await this.completeDispatch(output.id);
            Logger.warn(`${String(output.id)}: ${safeError(error)}`, IMAGE_GENERATION_LOGGER_CTX);
        }
        await this.generations.refreshJob(ctx, output.jobId);
        return { outputId: String(output.id), state: output.state };
    }

    private async completeDispatch(outputId: ID): Promise<void> {
        await this.connection.rawConnection
            .getRepository(ImageGenerationDispatch)
            .update({ outputId }, { state: 'COMPLETED', lastError: null });
    }

    private async recordCost(
        ctx: Awaited<ReturnType<RequestContextService['create']>>,
        output: ImageGenerationOutput,
        outcome: string,
        startedAt: number,
        telemetry?: ProviderTelemetry,
        error?: unknown,
    ): Promise<void> {
        const details = providerErrorDetails(error);
        await this.connection
            .getRepository(ctx, ImageGenerationCostEvent)
            .insert(
                new ImageGenerationCostEvent({
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
                    httpStatus: telemetry?.httpStatus ?? details.httpStatus ?? null,
                    providerRequestId:
                        (telemetry?.providerRequestId ?? details.providerRequestId)?.slice(0, 200) ?? null,
                    latencyMs: Math.min(2_147_483_647, Math.max(0, Date.now() - startedAt)),
                    actualCostMicrounits:
                        telemetry?.actualCostMicrounits ?? details.actualCostMicrounits ?? null,
                    costCurrency:
                        (telemetry?.costCurrency ?? details.costCurrency)?.slice(0, 3).toUpperCase() ?? null,
                    usage: telemetry?.usage ?? details.usage ?? null,
                    errorMessage: error ? safeError(error) : null,
                }),
            )
            .catch(costError => {
                Logger.warn(
                    `cost ${String(output.id)}#${output.attemptCount}: ${safeError(costError)}`,
                    IMAGE_GENERATION_LOGGER_CTX,
                );
            });
    }
}

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function providerErrorDetails(error: unknown): ProviderTelemetry {
    if (!error || typeof error !== 'object' || !('details' in error)) return {};
    const details = (error as { details?: unknown }).details;
    return details && typeof details === 'object' ? details : {};
}

function dispatchBackoffMs(attemptCount: number): number {
    return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(6, Math.max(0, attemptCount - 1)));
}
