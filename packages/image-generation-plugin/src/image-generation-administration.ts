import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { ReferralWalletSpendService } from '@vendure/store-management-plugin';

import { ImageComplianceAuditEvent } from './entities/image-compliance-audit-event.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImagePromptOptimization } from './entities/image-prompt-optimization.entity';
import { ImageGenerationConfigService } from './image-generation-config.service';
import { storedReferenceAssetIds, supportsGenerationLock } from './image-generation-helpers';
import { ImageGenerationJobViews } from './image-generation-job-views';
import { imageDispatchReadyAt } from './image-generation-state';
import { ImageGenerationUsageQuery } from './image-generation-usage-query';
import { ImageUsageQuotaService } from './image-usage-quota.service';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';
import { ImageAiUsageRecordListInput } from './types';

interface Dependencies {
    connection: TransactionalConnection;
    configService: ImageGenerationConfigService;
    storage: ImagePrivateStorageService;
    quota: ImageUsageQuotaService;
    walletSpend: ReferralWalletSpendService;
    reconcileStaleOutputs: (ctx: RequestContext, cutoff?: Date) => Promise<number>;
    refreshJobSettlement: (ctx: RequestContext, id: ID) => Promise<ImageGenerationJob | undefined>;
    enqueueOutput: ((outputId: ID) => Promise<void>) | undefined;
}

/** Owns administration queries, guarded retries, refunds and compliance anonymization. */
export class ImageGenerationAdministration {
    constructor(
        private readonly dependencies: Dependencies,
        private readonly views: ImageGenerationJobViews,
        private readonly usageQuery: ImageGenerationUsageQuery,
    ) {}

    async adminJobs(ctx: RequestContext, skip = 0, take = 50, state?: string | null) {
        await this.dependencies.reconcileStaleOutputs(ctx);
        const [items, totalItems] = await this.dependencies.connection
            .getRepository(ctx, ImageGenerationJob)
            .findAndCount({
                where: {
                    channelId: ctx.channelId,
                    origin: 'CUSTOMER_STUDIO',
                    ...(state ? { state } : {}),
                },
                relations: { outputs: { asset: true }, referenceAsset: true, customer: true },
                order: { createdAt: 'DESC', id: 'DESC', outputs: { outputIndex: 'ASC' } },
                skip: Math.max(0, Math.floor(skip || 0)),
                take: Math.min(100, Math.max(1, Math.floor(take || 50))),
            });
        return {
            items: await Promise.all(
                items.map(job => {
                    if (!job.customerId) throw new UserInputError('客户生图任务缺少客户归属');
                    return this.views.jobView(ctx, job, job.customerId);
                }),
            ),
            totalItems,
        };
    }

    async adminUsageRecords(ctx: RequestContext, input: ImageAiUsageRecordListInput = {}) {
        await this.dependencies.reconcileStaleOutputs(ctx);
        return this.usageQuery.adminUsageRecords(ctx, input);
    }

    async adminUsageRecordDetail(ctx: RequestContext, recordType: string, id: ID) {
        return this.usageQuery.adminUsageRecordDetail(ctx, recordType, id);
    }

    async adminCostSummary(ctx: RequestContext, days = 30) {
        return this.usageQuery.adminCostSummary(ctx, days);
    }

    purgeSensitiveRecords(): number {
        // 提示词和计费调用记录按审计策略长期保留；合规删除必须走单独授权流程。
        return 0;
    }

    async complianceAnonymizeCustomer(ctx: RequestContext, customerId: ID, reason: string) {
        const note = reason.trim();
        if (!note || note.length > 500) throw new UserInputError('合规处理原因不能为空且不能超过 500 个字符');
        const jobs = await this.dependencies.connection.getRepository(ctx, ImageGenerationJob).find({
            where: { channelId: ctx.channelId, customerId },
            relations: { outputs: { asset: true }, referenceAsset: true },
        });
        if (jobs.some(job => ['QUEUED', 'RUNNING', 'UNKNOWN'].includes(job.state))) {
            throw new UserInputError('该客户仍有进行中或待确认任务，不能执行合规匿名化');
        }
        for (const job of jobs) {
            for (const output of job.outputs) {
                if (output.assetId)
                    await this.dependencies.storage.deleteOwned(ctx, output.assetId, customerId);
            }
            for (const referenceAssetId of storedReferenceAssetIds(job)) {
                await this.dependencies.storage.deleteOwned(ctx, referenceAssetId, customerId);
            }
        }
        return this.dependencies.connection.withTransaction(ctx, async txCtx => {
            const promptResult = await this.dependencies.connection
                .getRepository(txCtx, ImagePromptOptimization)
                .createQueryBuilder()
                .update(ImagePromptOptimization)
                .set({
                    inputPrompt: '[已按合规请求匿名化]',
                    optimizedPrompt: '[已按合规请求匿名化]',
                    promptSpec: {},
                    errorMessage: null,
                })
                .where('channelId = :channelId AND customerId = :customerId', {
                    channelId: txCtx.channelId,
                    customerId,
                })
                .execute();
            const jobResult = await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationJob)
                .createQueryBuilder()
                .update(ImageGenerationJob)
                .set({
                    originalPrompt: '[已按合规请求匿名化]',
                    finalPrompt: '[已按合规请求匿名化]',
                    promptSpec: null,
                    errorMessage: null,
                    customerDeletedAt: new Date(),
                })
                .where('channelId = :channelId AND customerId = :customerId', {
                    channelId: txCtx.channelId,
                    customerId,
                })
                .execute();
            for (const job of jobs) {
                await this.dependencies.connection
                    .getRepository(txCtx, ImageGenerationOutput)
                    .update(
                        { jobId: job.id },
                        { providerRequestId: null, errorMessage: null, failureCode: null, assetId: null },
                    );
            }
            const event = await this.dependencies.connection
                .getRepository(txCtx, ImageComplianceAuditEvent)
                .save(
                    new ImageComplianceAuditEvent({
                        channelId: txCtx.channelId,
                        actorId: txCtx.activeUserId ?? null,
                        customerIdSnapshot: String(customerId),
                        action: 'ANONYMIZE',
                        reason: note,
                        affectedPromptRecords: promptResult.affected ?? 0,
                        affectedJobs: jobResult.affected ?? 0,
                        metadata: { assetJobsProcessed: jobs.length } as Record<string, any>,
                    }),
                );
            return {
                auditEventId: event.id,
                affectedPromptRecords: event.affectedPromptRecords,
                affectedJobs: event.affectedJobs,
            };
        });
    }

    async adminRetryUnknown(ctx: RequestContext, outputId: ID) {
        const output = await this.dependencies.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output || output.job.channelId.toString() !== ctx.channelId.toString())
            throw new UserInputError('找不到该生图输出');
        if (output.state !== 'UNKNOWN' || output.walletSettled)
            throw new UserInputError('只有尚未退款的 UNKNOWN 输出可人工重试');
        if (!output.job.providerIdempotencySupportedSnapshot)
            throw new UserInputError('该模型未确认支持中转站幂等，不能安全人工重试');
        if (!this.dependencies.enqueueOutput) throw new UserInputError('生图任务队列尚未就绪');
        if (!output.job.providerCredentialCodeSnapshot || !output.job.providerCredentialFingerprint)
            throw new UserInputError('原任务账号快照不完整，不能安全重试');
        const credential = await this.dependencies.configService.credentialByCode(
            ctx,
            output.job.providerCredentialCodeSnapshot,
        );
        if (!credential) throw new UserInputError('原任务使用的 Key 已归档，不能安全重试');
        if (
            !credential.enabled ||
            credential.healthStatus !== 'HEALTHY' ||
            (credential.cooldownUntil?.getTime() ?? 0) > Date.now()
        )
            throw new UserInputError('原任务账号暂不可用，请等待恢复后再试');
        const currentFingerprint = this.dependencies.configService.credentialFingerprint(credential);
        if (
            output.job.providerCredentialFingerprint &&
            output.job.providerCredentialFingerprint !== currentFingerprint
        ) {
            throw new UserInputError('中转站账号或地址已更换，不能使用旧幂等键重试');
        }
        await this.dependencies.connection.withTransaction(ctx, async txCtx => {
            const transition = await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationOutput)
                .update(
                    { id: output.id, state: 'UNKNOWN', walletSettled: false },
                    {
                        state: 'QUEUED',
                        unknownAt: null,
                        errorMessage: '管理员确认后使用相同幂等键重试',
                        failureCode: 'UNKNOWN_RETRY',
                    },
                );
            if (transition.affected !== 1) throw new UserInputError('该输出状态已变更，请刷新后重试');
            await this.dependencies.connection.getRepository(txCtx, ImageGenerationDispatch).upsert(
                {
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
                },
                ['outputId'],
            );
            await this.dependencies.refreshJobSettlement(txCtx, output.jobId);
        });
        try {
            await this.dependencies.enqueueOutput(output.id);
        } catch {
            output.errorMessage = '即时入队失败，系统将在后台自动补发';
            await this.dependencies.connection
                .getRepository(ctx, ImageGenerationOutput)
                .update({ id: output.id, state: 'QUEUED' }, { errorMessage: output.errorMessage });
        }
        return this.dependencies.connection
            .getRepository(ctx, ImageGenerationOutput)
            .findOneByOrFail({ id: output.id });
    }

    async adminRefundOutput(ctx: RequestContext, outputId: ID, reason: string) {
        const note = reason.trim();
        if (!note || note.length > 300) throw new UserInputError('退款原因不能为空且不能超过 300 个字符');
        const refundedOutput = await this.dependencies.connection.withTransaction(ctx, async txCtx => {
            const outputQuery = this.dependencies.connection
                .getRepository(txCtx, ImageGenerationOutput)
                .createQueryBuilder('output')
                .where('output.id = :id', { id: outputId });
            if (supportsGenerationLock(this.dependencies.connection.rawConnection.options.type))
                outputQuery.setLock('pessimistic_write');
            const output = await outputQuery.getOne();
            if (!output) throw new UserInputError('找不到该生图输出');
            const jobQuery = this.dependencies.connection
                .getRepository(txCtx, ImageGenerationJob)
                .createQueryBuilder('job')
                .where('job.id = :id', { id: output.jobId })
                .andWhere('job.channelId = :channelId', { channelId: txCtx.channelId });
            if (supportsGenerationLock(this.dependencies.connection.rawConnection.options.type))
                jobQuery.setLock('pessimistic_write');
            const job = await jobQuery.getOne();
            if (!job) throw new UserInputError('找不到该生图输出');
            output.job = job;
            if (output.state !== 'SUCCEEDED' || !output.walletSettled || output.refundedAt)
                throw new UserInputError('该图片不能重复退款');
            if (output.billingMode === 'FREE') {
                if (!output.job.quotaEventId) throw new UserInputError('该图片缺少免费额度记录');
                await this.dependencies.quota.refundConsumed(txCtx, output.job.quotaEventId, 1);
                output.job.freeQuantityCaptured = Math.max(0, output.job.freeQuantityCaptured - 1);
                await this.dependencies.connection
                    .getRepository(txCtx, ImageGenerationJob)
                    .save(output.job, { reload: false });
            } else {
                const walletUsageId = output.job.walletUsageId;
                if (!walletUsageId) throw new UserInputError('该图片缺少返利余额结算记录');
                await this.dependencies.walletSpend.refundCaptured(txCtx, {
                    usageId: walletUsageId,
                    amount: output.chargeAmount || output.job.unitPriceSnapshot,
                    operationKey: `ADMIN_REFUND:${String(output.id)}`,
                    actorId: txCtx.activeUserId,
                    actorType: 'ADMIN',
                    metadata: { jobId: String(output.job.id), outputId: String(output.id), reason: note },
                });
            }
            output.refundedAt = new Date();
            await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationOutput)
                .save(output, { reload: false });
            await this.dependencies.refreshJobSettlement(txCtx, output.jobId);
            return output;
        });
        return refundedOutput;
    }
}
