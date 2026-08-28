import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Job,
    JobQueue,
    JobQueueService,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { ReferralWalletSpendService } from '@vendure/store-management-plugin';
import { In } from 'typeorm';

import { IMAGE_GENERATION_LOGGER_CTX, IMAGE_GENERATION_QUEUE } from './constants';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
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
import { ImageProviderProtocol } from './types';

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
        private readonly walletSpend: ReferralWalletSpendService,
        private readonly generations: ImageGenerationService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.queue = await this.jobQueueService.createQueue({
            name: IMAGE_GENERATION_QUEUE,
            process: job => this.process(job),
        });
        this.generations.registerEnqueuer(async outputId => {
            await this.queue.add({ outputId: String(outputId) }, { retries: 2 });
        });
    }

    async reconcileUnknown(): Promise<number> {
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
        return released;
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
        try {
            const credential = await this.configService.requireCredential(
                ctx,
                providerScopeForModel(
                    output.job.protocolSnapshot as ImageProviderProtocol,
                    output.job.providerModelIdSnapshot,
                ),
            );
            const reference = output.job.referenceAsset
                ? {
                      bytes: await this.storage.read(output.job.referenceAsset),
                      mimeType: output.job.referenceAsset.mimeType,
                  }
                : undefined;
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
            storedAsset = await this.storage.storeGenerated(
                ctx,
                output.job.customerId,
                result,
                `ai-${String(output.job.id)}-${output.outputIndex + 1}.png`,
            );
            const generatedAsset = storedAsset;
            const walletUsageId = output.job.walletUsageId;
            if (!walletUsageId) throw new Error('生图任务缺少返利余额预占记录');
            await this.connection.withTransaction(ctx, async txCtx => {
                const completedAt = new Date();
                const completion = await this.connection.getRepository(txCtx, ImageGenerationOutput).update(
                    { id: output.id, state: 'RUNNING', walletSettled: false },
                    {
                        state: 'SUCCEEDED',
                        assetId: generatedAsset.id,
                        providerRequestId: result.providerRequestId?.slice(0, 200) ?? null,
                        completedAt,
                        walletSettled: true,
                    },
                );
                if (completion.affected !== 1) {
                    throw new Error('生图输出状态已变更，无法重复结算');
                }
                await this.walletSpend.capture(txCtx, {
                    usageId: walletUsageId,
                    amount: output.job.unitPriceSnapshot,
                    operationKey: `OUTPUT:${String(output.id)}`,
                    metadata: { jobId: String(output.job.id), outputId: String(output.id) },
                });
                output.state = 'SUCCEEDED';
                output.assetId = generatedAsset.id;
                output.asset = generatedAsset;
                output.providerRequestId = result.providerRequestId?.slice(0, 200) ?? null;
                output.completedAt = completedAt;
                output.walletSettled = true;
            });
        } catch (error) {
            if (storedAsset) {
                await this.storage.deleteOwned(ctx, storedAsset.id, output.job.customerId).catch(() => false);
                storedAsset = undefined;
            }
            const failureDecision = decideImageOutputFailure({
                retryable: error instanceof RetryableImageProviderError,
                ambiguous: error instanceof AmbiguousImageProviderError,
                attempts: jobQueueItem.attempts,
                retries: jobQueueItem.retries,
            });
            const failureMessage = safeError(error);
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
            Logger.warn(`${String(output.id)}: ${safeError(error)}`, IMAGE_GENERATION_LOGGER_CTX);
        }
        await this.generations.refreshJob(ctx, output.jobId);
        return { outputId: String(output.id), state: output.state };
    }
}

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
