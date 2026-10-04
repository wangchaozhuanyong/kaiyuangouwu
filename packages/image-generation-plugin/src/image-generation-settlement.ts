import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { ReferralWalletSpendService, ReferralWalletUsage } from '@vendure/store-management-plugin';
import { In } from 'typeorm';

import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { supportsGenerationLock } from './image-generation-helpers';
import { deriveImageJobSettlement } from './image-generation-state';
import { ImageUsageQuotaService } from './image-usage-quota.service';
/** Owns transactional output settlement and database-only parent totals. */
export class ImageGenerationSettlement {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly walletSpend: ReferralWalletSpendService,
        private readonly quota: ImageUsageQuotaService,
    ) {}

    settleSuccessfulOutput(
        ctx: RequestContext,
        outputId: ID,
        assetId: ID,
        providerRequestId?: string,
    ): Promise<ImageGenerationOutput> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const outputRepository = this.connection.getRepository(txCtx, ImageGenerationOutput);
            const outputQuery = outputRepository
                .createQueryBuilder('output')
                .innerJoinAndSelect('output.job', 'job')
                .where('output.id = :outputId', { outputId });
            if (supportsGenerationLock(this.connection.rawConnection.options.type)) {
                outputQuery.setLock('pessimistic_write');
            }
            const output = await outputQuery.getOne();
            if (!output || output.state !== 'RUNNING' || output.walletSettled) {
                throw new UserInputError('生图输出状态已变更，无法重复结算');
            }
            const jobRepository = this.connection.getRepository(txCtx, ImageGenerationJob);
            const job = output.job;
            let billingMode = 'PAID';
            let chargeAmount = job.unitPriceSnapshot;
            if (job.origin === 'ADMIN_PRODUCT_IMAGE') {
                billingMode = 'INTERNAL';
                chargeAmount = 0;
            } else if (job.freeQuantityCaptured < job.freeQuantityReserved && job.quotaEventId) {
                await this.quota.capture(txCtx, job.quotaEventId, 1);
                job.freeQuantityCaptured += 1;
                billingMode = 'FREE';
                chargeAmount = 0;
            } else {
                if (!job.walletUsageId) throw new UserInputError('生图任务缺少付费余额预占记录');
                await this.walletSpend.capture(txCtx, {
                    usageId: job.walletUsageId,
                    amount: job.unitPriceSnapshot,
                    operationKey: `OUTPUT:${String(output.id)}`,
                    metadata: { jobId: String(job.id), outputId: String(output.id) },
                });
            }
            const completedAt = new Date();
            Object.assign(output, {
                state: 'SUCCEEDED',
                assetId,
                providerRequestId: providerRequestId?.slice(0, 200) ?? null,
                completedAt,
                walletSettled: true,
                billingMode,
                chargeAmount,
            });
            await jobRepository.save(job, { reload: false });
            await outputRepository.save(output, { reload: false });
            return output;
        });
    }

    transitionAndRelease(
        ctx: RequestContext,
        job: ImageGenerationJob,
        output: ImageGenerationOutput,
        fromStates: string[],
        targetState: 'FAILED' | 'CANCELLED',
        message: string,
        failureCode?: string,
    ): Promise<boolean> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, ImageGenerationOutput);
            const completedAt = new Date();
            const transition = await repository.update(
                { id: output.id, state: In(fromStates), walletSettled: false },
                {
                    state: targetState,
                    errorMessage: message.slice(0, 500),
                    failureCode: failureCode?.slice(0, 48) ?? output.failureCode,
                    completedAt,
                    walletSettled: true,
                    billingMode: job.origin === 'ADMIN_PRODUCT_IMAGE' ? 'INTERNAL' : 'RELEASED',
                    chargeAmount: 0,
                },
            );
            if (transition.affected !== 1) return false;
            // The terminal flag cannot commit before its wallet/quota and parent totals.
            await this.refreshJobSettlement(txCtx, job.id);
            output.state = targetState;
            output.errorMessage = message.slice(0, 500);
            output.failureCode = failureCode?.slice(0, 48) ?? output.failureCode;
            output.completedAt = completedAt;
            output.walletSettled = true;
            output.billingMode = job.origin === 'ADMIN_PRODUCT_IMAGE' ? 'INTERNAL' : 'RELEASED';
            output.chargeAmount = 0;
            return true;
        });
    }

    async refreshJobSettlement(txCtx: RequestContext, jobId: ID) {
        const repository = this.connection.getRepository(txCtx, ImageGenerationJob);
        if (supportsGenerationLock(this.connection.rawConnection.options.type)) {
            await repository
                .createQueryBuilder('job')
                .setLock('pessimistic_write')
                .where('job.id = :id', { id: jobId })
                .getOne();
        }
        const job = await repository.findOne({ where: { id: jobId }, relations: { outputs: true } });
        if (!job) return;
        const settlement = deriveImageJobSettlement(
            job.quantity,
            job.unitPriceSnapshot,
            job.outputs,
            job.expectedChargeAmount,
        );
        if (settlement.terminal) {
            const walletUsage = job.walletUsageId
                ? await this.connection.getRepository(txCtx, ReferralWalletUsage).findOne({
                      where: { id: job.walletUsageId },
                  })
                : null;
            const walletRelease = walletUsage
                ? Math.max(0, walletUsage.amount - walletUsage.capturedAmount - walletUsage.releasedAmount)
                : 0;
            if (job.walletUsageId && walletRelease > 0) {
                await this.walletSpend.release(txCtx, {
                    usageId: job.walletUsageId,
                    amount: walletRelease,
                    operationKey: `JOB_TERMINAL:${String(job.id)}`,
                    actorType: 'SYSTEM',
                    metadata: { jobId: String(job.id), reason: '任务终态释放未使用预冻结金额' },
                });
            }
            if (job.quotaEventId) await this.quota.release(txCtx, job.quotaEventId);
        }
        job.capturedAmount = settlement.capturedAmount;
        job.releasedAmount = settlement.releasedAmount;
        job.state = settlement.state;
        job.completedAt = settlement.terminal ? (job.completedAt ?? new Date()) : null;
        await repository.save(job, { reload: false });
        return job;
    }
}
