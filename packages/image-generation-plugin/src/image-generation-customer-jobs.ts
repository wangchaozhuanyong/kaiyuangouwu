import { ID } from '@vendure/common/lib/shared-types';
import { Customer, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { ReferralWallet } from '@vendure/store-management-plugin';
import { In, IsNull } from 'typeorm';

import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { quoteImageMoney } from './image-billing-quote';
import { storedReferenceAssetIds } from './image-generation-helpers';
import { ImageGenerationJobViews } from './image-generation-job-views';
import { hasStaleImageOutput } from './image-generation-state';
import { ImageUsageQuotaService } from './image-usage-quota.service';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';

interface Dependencies {
    connection: TransactionalConnection;
    storage: ImagePrivateStorageService;
    quota: ImageUsageQuotaService;
    activeCustomer: (ctx: RequestContext) => Promise<Customer>;
    staleOutputCutoff: () => Date;
    reconcileStaleOutputs: (ctx: RequestContext, cutoff?: Date) => Promise<number>;
    refreshJob: (ctx: RequestContext, id: ID) => Promise<void>;
    transitionAndRelease: (
        ctx: RequestContext,
        job: ImageGenerationJob,
        output: ImageGenerationOutput,
        fromStates: string[],
        targetState: 'FAILED' | 'CANCELLED',
        message: string,
        failureCode?: string,
    ) => Promise<boolean>;
    findMine: (ctx: RequestContext, id: ID) => ReturnType<ImageGenerationCustomerJobs['findMine']>;
    wallet: (ctx: RequestContext) => ReturnType<ImageGenerationCustomerJobs['wallet']>;
}

/** Owns customer-scoped job reads, cancellation, deletion, balance and quota views. */
export class ImageGenerationCustomerJobs {
    constructor(
        private readonly dependencies: Dependencies,
        private readonly views: ImageGenerationJobViews,
    ) {}

    async findMine(ctx: RequestContext, id: ID) {
        const customer = await this.dependencies.activeCustomer(ctx);
        const repository = this.dependencies.connection.getRepository(ctx, ImageGenerationJob);
        let job = await repository.findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id, customerDeletedAt: IsNull() },
            relations: { outputs: { asset: true }, referenceAsset: true },
            order: { outputs: { outputIndex: 'ASC' } },
        });
        if (!job) throw new UserInputError('找不到生图任务');
        const cutoff = this.dependencies.staleOutputCutoff();
        if (hasStaleImageOutput(job.outputs, cutoff)) {
            await this.dependencies.reconcileStaleOutputs(ctx, cutoff);
            job = await repository.findOne({
                where: {
                    id,
                    channelId: ctx.channelId,
                    customerId: customer.id,
                    customerDeletedAt: IsNull(),
                },
                relations: { outputs: { asset: true }, referenceAsset: true },
                order: { outputs: { outputIndex: 'ASC' } },
            });
            if (!job) throw new UserInputError('找不到生图任务');
        }
        return this.views.jobView(ctx, job, customer.id);
    }

    async findMineList(ctx: RequestContext, skip = 0, take = 20, states?: string[]) {
        const customer = await this.dependencies.activeCustomer(ctx);
        const repository = this.dependencies.connection.getRepository(ctx, ImageGenerationJob);
        const options = {
            where: {
                channelId: ctx.channelId,
                customerId: customer.id,
                customerDeletedAt: IsNull(),
                ...(states?.length ? { state: In(states) } : {}),
            },
            relations: { outputs: { asset: true }, referenceAsset: true },
            order: { createdAt: 'DESC', id: 'DESC', outputs: { outputIndex: 'ASC' } },
            skip: Math.max(0, Math.floor(skip || 0)),
            take: Math.min(50, Math.max(1, Math.floor(take || 20))),
        } as const;
        let [items, totalItems] = await repository.findAndCount(options);
        const cutoff = this.dependencies.staleOutputCutoff();
        if (items.some(job => hasStaleImageOutput(job.outputs, cutoff))) {
            await this.dependencies.reconcileStaleOutputs(ctx, cutoff);
            [items, totalItems] = await repository.findAndCount(options);
        }
        return {
            items: await Promise.all(items.map(job => this.views.jobView(ctx, job, customer.id))),
            totalItems,
        };
    }

    async cancelQueued(ctx: RequestContext, id: ID) {
        const customer = await this.dependencies.activeCustomer(ctx);
        const job = await this.dependencies.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
            relations: { outputs: true },
        });
        if (!job) throw new UserInputError('找不到生图任务');
        for (const output of job.outputs.filter(item => item.state === 'QUEUED')) {
            await this.dependencies.transitionAndRelease(
                ctx,
                job,
                output,
                ['QUEUED'],
                'CANCELLED',
                '客户在开始生成前取消',
            );
        }
        await this.dependencies.refreshJob(ctx, job.id);
        return this.dependencies.findMine(ctx, job.id);
    }

    async deleteOutput(ctx: RequestContext, outputId: ID): Promise<boolean> {
        const customer = await this.dependencies.activeCustomer(ctx);
        const output = await this.dependencies.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true, asset: true },
        });
        if (
            !output ||
            output.job.channelId.toString() !== ctx.channelId.toString() ||
            output.job.customerId == null ||
            output.job.customerId.toString() !== customer.id.toString()
        )
            return false;
        if (!output.assetId) return false;
        const deleted = await this.dependencies.storage.deleteOwned(ctx, output.assetId, customer.id);
        if (deleted) {
            output.assetId = null;
            output.asset = null;
            await this.dependencies.connection
                .getRepository(ctx, ImageGenerationOutput)
                .save(output, { reload: false });
        }
        return deleted;
    }

    async wallet(ctx: RequestContext): Promise<{ availableBalance: number; currencyCode: string }> {
        const customer = await this.dependencies.activeCustomer(ctx);
        const currencyCode = ctx.currencyCode;
        const wallet = await this.dependencies.connection.getRepository(ctx, ReferralWallet).findOne({
            where: { channelId: ctx.channelId, customerId: customer.id, currencyCode },
        });
        return { availableBalance: wallet?.availableBalance ?? 0, currencyCode };
    }

    async walletBalance(ctx: RequestContext): Promise<number> {
        return (await this.dependencies.wallet(ctx)).availableBalance;
    }

    async modelQuotaStatus(ctx: RequestContext) {
        const customer = await this.dependencies.activeCustomer(ctx);
        const models = await this.dependencies.connection.getRepository(ctx, ImageModelConfig).find({
            where: { channelId: ctx.channelId, enabled: true },
            order: { position: 'ASC' },
        });
        return Promise.all(
            models.map(async model => {
                const unitPrice = quoteImageMoney(ctx, model.unitPrice, model.currencyCode);
                const [free, safety] = await Promise.all([
                    this.dependencies.quota.status(
                        ctx,
                        customer.id,
                        'IMAGE_DAILY_FREE',
                        model.freeImageEnabled ? model.dailyFreeImageLimit : 0,
                        model.freeImageEnabled && model.dailyFreeImageUnlimited,
                        model.code,
                    ),
                    this.dependencies.quota.status(
                        ctx,
                        customer.id,
                        'IMAGE_DAILY_SAFETY',
                        model.dailyGenerationSafetyLimit,
                        false,
                        model.code,
                    ),
                ]);
                return {
                    modelCode: model.code,
                    freeImageEnabled: model.freeImageEnabled,
                    paidAfterFreeEnabled: model.paidAfterFreeEnabled,
                    unitPrice: unitPrice.amount,
                    currencyCode: unitPrice.currencyCode,
                    free,
                    safety,
                };
            }),
        );
    }

    async deleteJob(ctx: RequestContext, id: ID): Promise<boolean> {
        const customer = await this.dependencies.activeCustomer(ctx);
        const job = await this.dependencies.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
            relations: { outputs: { asset: true }, referenceAsset: true },
        });
        if (!job) return false;
        if (!['PARTIAL_SUCCESS', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.state)) {
            throw new UserInputError('只能删除已结束的生图任务');
        }
        for (const output of job.outputs) {
            if (output.assetId) await this.dependencies.storage.deleteOwned(ctx, output.assetId, customer.id);
        }
        job.customerDeletedAt = new Date();
        await this.dependencies.connection
            .getRepository(ctx, ImageGenerationJob)
            .update({ id: job.id }, { customerDeletedAt: job.customerDeletedAt });
        for (const referenceAssetId of storedReferenceAssetIds(job)) {
            await this.dependencies.storage.releaseReference(ctx, referenceAssetId, customer.id);
        }
        return true;
    }
}
