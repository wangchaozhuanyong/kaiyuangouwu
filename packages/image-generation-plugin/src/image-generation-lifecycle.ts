import { ID } from '@vendure/common/lib/shared-types';
import { Customer, RequestContext, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';

import { IMAGE_UNKNOWN_MAX_AGE_MS } from './constants';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { storedReferenceAssetIds, supportsGenerationLock } from './image-generation-helpers';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';

interface Dependencies {
    connection: TransactionalConnection;
    storage: ImagePrivateStorageService;
    lockAdministrator: (ctx: RequestContext, id: ID) => Promise<void>;
    refreshJob: (ctx: RequestContext, id: ID) => Promise<void>;
    refreshJobSettlement: (ctx: RequestContext, id: ID) => Promise<ImageGenerationJob | undefined>;
    releaseUnknownOlderThan: (ctx: RequestContext, cutoff: Date) => Promise<number>;
    transitionAndRelease: (
        ctx: RequestContext,
        job: ImageGenerationJob,
        output: ImageGenerationOutput,
        fromStates: string[],
        targetState: 'FAILED' | 'CANCELLED',
        message: string,
        failureCode?: string,
    ) => Promise<boolean>;
}

/** Owns terminal transitions, stale recovery and post-commit reference expiration. */
export class ImageGenerationLifecycle {
    constructor(private readonly dependencies: Dependencies) {}

    async failQueuedOutput(
        ctx: RequestContext,
        outputId: ID,
        message: string,
        failureCode?: string,
    ): Promise<void> {
        const output = await this.dependencies.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output) return;
        await this.dependencies.transitionAndRelease(
            ctx,
            output.job,
            output,
            ['QUEUED'],
            'FAILED',
            message,
            failureCode,
        );
        await this.dependencies.refreshJob(ctx, output.jobId);
    }

    async failRunningOutput(
        ctx: RequestContext,
        outputId: ID,
        message: string,
        failureCode?: string,
    ): Promise<boolean> {
        const output = await this.dependencies.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output) return false;
        const failed = await this.dependencies.transitionAndRelease(
            ctx,
            output.job,
            output,
            ['RUNNING'],
            'FAILED',
            message,
            failureCode,
        );
        await this.dependencies.refreshJob(ctx, output.jobId);
        return failed;
    }

    async settleUnreleasedTerminalOutput(ctx: RequestContext, outputId: ID): Promise<boolean> {
        const output = await this.dependencies.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output || !['FAILED', 'CANCELLED'].includes(output.state)) return false;
        const state = output.state as 'FAILED' | 'CANCELLED';
        const settled = await this.dependencies.transitionAndRelease(
            ctx,
            output.job,
            output,
            [state],
            state,
            output.errorMessage ?? '生图任务未成功',
        );
        if (settled) await this.dependencies.refreshJob(ctx, output.jobId);
        return settled;
    }

    async releaseUnknownOlderThan(ctx: RequestContext, cutoff: Date): Promise<number> {
        const outputs = await this.dependencies.connection
            .getRepository(ctx, ImageGenerationOutput)
            .createQueryBuilder('output')
            .innerJoinAndSelect('output.job', 'job')
            .where('job.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('output.state = :state', { state: 'UNKNOWN' })
            .andWhere('COALESCE(output.unknownAt, output.updatedAt) <= :cutoff', { cutoff })
            .take(100)
            .getMany();
        for (const output of outputs) {
            const released = await this.dependencies.transitionAndRelease(
                ctx,
                output.job,
                output,
                ['UNKNOWN'],
                'FAILED',
                '中转站结果在 15 分钟内无法确认，已自动退回本张费用',
                'UNKNOWN_RESULT',
            );
            if (released) await this.dependencies.refreshJob(ctx, output.jobId);
        }
        return outputs.filter(output => output.walletSettled).length;
    }

    async reconcileStaleOutputs(ctx: RequestContext, cutoff = this.staleOutputCutoff()): Promise<number> {
        const repository = this.dependencies.connection.getRepository(ctx, ImageGenerationOutput);
        const staleRunning = await repository
            .createQueryBuilder('output')
            .innerJoin('output.job', 'job')
            .where('job.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('output.state = :state', { state: 'RUNNING' })
            .andWhere('output.updatedAt <= :cutoff', { cutoff })
            .take(100)
            .getMany();
        for (const output of staleRunning) {
            await repository.update(
                { id: output.id, state: 'RUNNING', walletSettled: false },
                {
                    state: 'UNKNOWN',
                    unknownAt: output.updatedAt,
                    failureCode: 'UNKNOWN_RESULT',
                    errorMessage: '生图任务超过 15 分钟仍未返回结果，系统正在核对并释放费用',
                },
            );
        }
        return this.dependencies.releaseUnknownOlderThan(ctx, cutoff);
    }

    staleOutputCutoff(): Date {
        return new Date(Date.now() - IMAGE_UNKNOWN_MAX_AGE_MS);
    }

    async refreshJob(ctx: RequestContext, jobId: ID): Promise<void> {
        const job = await this.dependencies.connection.withTransaction(ctx, txCtx =>
            this.dependencies.refreshJobSettlement(txCtx, jobId),
        );
        if (!job?.completedAt) return;
        const terminalReferenceAssetIds = storedReferenceAssetIds(job);
        const terminalCustomerId = job.customerId;
        const terminalAdministratorUserId = job.administratorUserId;
        if (!terminalReferenceAssetIds.length) return;
        await this.dependencies.connection.withTransaction(ctx, async txCtx => {
            if (job.origin === 'ADMIN_PRODUCT_IMAGE' && terminalAdministratorUserId) {
                await this.dependencies.lockAdministrator(txCtx, terminalAdministratorUserId);
            } else if (terminalCustomerId) {
                const customerQuery = this.dependencies.connection
                    .getRepository(txCtx, Customer)
                    .createQueryBuilder('customer')
                    .where('customer.id = :id', { id: terminalCustomerId });
                if (supportsGenerationLock(this.dependencies.connection.rawConnection.options.type))
                    customerQuery.setLock('pessimistic_write');
                await customerQuery.getOne();
            }
            if (job.origin === 'ADMIN_PRODUCT_IMAGE' && !terminalAdministratorUserId) return;
            if (job.origin !== 'ADMIN_PRODUCT_IMAGE' && !terminalCustomerId) return;
            const ownerWhere =
                job.origin === 'ADMIN_PRODUCT_IMAGE'
                    ? {
                          administratorUserId: terminalAdministratorUserId as ID,
                          origin: 'ADMIN_PRODUCT_IMAGE' as const,
                      }
                    : { customerId: terminalCustomerId as ID, origin: 'CUSTOMER_STUDIO' as const };
            const activeJobs = await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationJob)
                .find({
                    where: {
                        channelId: txCtx.channelId,
                        ...ownerWhere,
                        state: In(['QUEUED', 'RUNNING', 'UNKNOWN']),
                    },
                    select: { id: true, referenceAssetId: true, promptSpec: true },
                });
            const activeReferenceIds = new Set(activeJobs.flatMap(storedReferenceAssetIds));
            for (const referenceAssetId of terminalReferenceAssetIds) {
                if (activeReferenceIds.has(String(referenceAssetId))) continue;
                await this.dependencies.storage.expireReferenceAfterTerminal(txCtx, referenceAssetId);
            }
        });
    }
}
