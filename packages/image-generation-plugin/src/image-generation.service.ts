import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Customer,
    CustomerService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { ReferralWallet, ReferralWalletSpendService } from '@vendure/store-management-plugin';
import { In, IsNull, LessThan, MoreThan, MoreThanOrEqual, Not } from 'typeorm';

import {
    MAX_ACTIVE_GENERATION_JOBS,
    MAX_ACTIVE_REFERENCE_ASSETS,
    MAX_ACTIVE_REFERENCE_BYTES,
    MAX_GENERATION_COUNT,
    MAX_PROMPT_LENGTH,
    MAX_REFERENCE_BYTES,
    MAX_REFERENCE_UPLOADS_PER_DAY,
    MAX_REFERENCE_UPLOADS_PER_MINUTE,
    supportedAspectRatios,
} from './constants';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageGenerationCostEvent } from './entities/image-generation-cost-event.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { ImagePromptOptimization } from './entities/image-prompt-optimization.entity';
import {
    ImageGenerationConfigService,
    modelReady,
    providerScopeForModel,
} from './image-generation-config.service';
import { deriveImageJobSettlement } from './image-generation-state';
import { ImagePromptEngineService, startOfBeijingDay } from './prompt/image-prompt-engine.service';
import { PromptRulesService } from './prompt/prompt-rules.service';
import { ImagePrivateStorageService, UploadedImageFile } from './storage/image-private-storage.service';
import { CreateImageGenerationInput, ImageProviderScope, ImageReferenceMode } from './types';

@Injectable()
export class ImageGenerationService {
    private enqueueOutput?: (outputId: ID) => Promise<void>;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly walletSpend: ReferralWalletSpendService,
        private readonly configService: ImageGenerationConfigService,
        private readonly promptEngine: ImagePromptEngineService,
        private readonly rules: PromptRulesService,
        private readonly storage: ImagePrivateStorageService,
    ) {}

    registerEnqueuer(enqueue: (outputId: ID) => Promise<void>): void {
        this.enqueueOutput = enqueue;
    }

    async create(ctx: RequestContext, input: CreateImageGenerationInput) {
        const customer = await this.activeCustomer(ctx);
        const normalized = this.validateCreateInput(input);
        const existing = await this.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: {
                channelId: ctx.channelId,
                customerId: customer.id,
                idempotencyKey: normalized.idempotencyKey,
            },
            relations: { outputs: { asset: true }, referenceAsset: true },
        });
        if (existing) {
            this.assertSameCreateRequest(existing, normalized);
            return this.jobView(existing, customer.id);
        }
        if (!(await this.configService.shopConfig(ctx)).enabled) {
            throw new UserInputError('当前店铺的 AI 图片工坊不可用');
        }
        let created: ImageGenerationJob;
        try {
            created = await this.connection.withTransaction(ctx, async txCtx => {
                if (supportsGenerationLock(this.connection.rawConnection.options.type)) {
                    await this.connection
                        .getRepository(txCtx, Customer)
                        .createQueryBuilder('customer')
                        .setLock('pessimistic_write')
                        .where('customer.id = :id', { id: customer.id })
                        .getOne();
                }
                const activeJobCount = await this.connection.getRepository(txCtx, ImageGenerationJob).count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        state: In(['QUEUED', 'RUNNING', 'UNKNOWN']),
                    },
                });
                if (activeJobCount >= MAX_ACTIVE_GENERATION_JOBS) {
                    throw new UserInputError(`同时进行的生图任务不能超过 ${MAX_ACTIVE_GENERATION_JOBS} 个`);
                }
                const config = await this.connection.getRepository(txCtx, ImageGenerationConfig).findOne({
                    where: { channelId: txCtx.channelId },
                });
                if (!config?.enabled) throw new UserInputError('当前店铺尚未开启 AI 图片工坊');
                const model = await this.connection.getRepository(txCtx, ImageModelConfig).findOne({
                    where: { channelId: txCtx.channelId, code: normalized.modelCode, enabled: true },
                });
                if (!model || !modelReady(model)) throw new UserInputError('所选模型当前不可用');
                const providerScope = providerScopeForModel(model.protocol, model.providerModelId);
                const credential = await this.configService.requireCredential(txCtx, providerScope);
                const credentialFingerprint = this.configService.credentialFingerprint(credential);
                if (
                    model.unitPrice !== normalized.expectedUnitPrice ||
                    model.currencyCode !== normalized.currencyCode
                ) {
                    throw new UserInputError('PRICE_CHANGED：模型价格已更新，请确认新价格后重新提交');
                }
                let reference: ImagePrivateAsset | null = null;
                if (normalized.referenceAssetId) {
                    reference = await this.connection.getRepository(txCtx, ImagePrivateAsset).findOne({
                        where: {
                            id: normalized.referenceAssetId,
                            channelId: txCtx.channelId,
                            customerId: customer.id,
                            kind: 'REFERENCE',
                        },
                    });
                    if (!reference || reference.deletedAt || reference.expiresAt.getTime() <= Date.now()) {
                        throw new UserInputError('参考图不存在或已过期');
                    }
                }
                if ((normalized.referenceMode === 'NONE') !== !reference) {
                    throw new UserInputError('参考图和参考模式必须同时设置');
                }
                if (reference) await this.storage.retainReferenceWhileActive(txCtx, reference.id);
                const promptSpec = this.rules.fallbackSpec(normalized.prompt, normalized.referenceMode);
                const finalPrompt = this.compileFinalPrompt(normalized, promptSpec);
                this.promptEngine.assertSafe(finalPrompt);
                const amount = model.unitPrice * normalized.quantity;
                const job = await this.connection.getRepository(txCtx, ImageGenerationJob).save(
                    new ImageGenerationJob({
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        modelConfigId: model.id,
                        referenceAssetId: reference?.id ?? null,
                        idempotencyKey: normalized.idempotencyKey,
                        modelCodeSnapshot: model.code,
                        modelNameSnapshot: model.displayNameZh,
                        officialModelIdSnapshot: model.officialModelId,
                        providerModelIdSnapshot: model.providerModelId,
                        protocolSnapshot: model.protocol,
                        providerScopeSnapshot: providerScope,
                        providerCredentialFingerprint: credentialFingerprint,
                        providerIdempotencySupportedSnapshot: model.supportsIdempotency,
                        originalPrompt: normalized.prompt,
                        finalPrompt,
                        promptSpec: promptSpec as unknown as Record<string, any>,
                        promptSkillHash: this.rules.sourceHash,
                        referenceMode: normalized.referenceMode,
                        aspectRatio: normalized.aspectRatio,
                        quantity: normalized.quantity,
                        unitPriceSnapshot: model.unitPrice,
                        reservedAmount: amount,
                        capturedAmount: 0,
                        releasedAmount: 0,
                        currencyCode: model.currencyCode,
                        walletUsageId: null,
                        state: 'QUEUED',
                        termsVersion: config.termsVersion,
                        termsAcceptedAt: new Date(),
                        errorMessage: null,
                        completedAt: null,
                    }),
                );
                const usage = await this.walletSpend.reserve(txCtx, {
                    customerId: customer.id,
                    currencyCode: model.currencyCode,
                    amount,
                    resourceType: 'IMAGE_GENERATION_JOB',
                    resourceId: String(job.id),
                    idempotencyKey: `IMAGE_JOB:${String(txCtx.channelId)}:${String(customer.id)}:${normalized.idempotencyKey}`,
                    actorId: txCtx.activeUserId,
                    actorType: 'CUSTOMER',
                    metadata: {
                        modelCode: model.code,
                        quantity: normalized.quantity,
                        unitPrice: model.unitPrice,
                    },
                });
                job.walletUsageId = usage.id;
                await this.connection.getRepository(txCtx, ImageGenerationJob).save(job, { reload: false });
                const outputs: ImageGenerationOutput[] = [];
                for (let outputIndex = 0; outputIndex < normalized.quantity; outputIndex++) {
                    const output = await this.connection.getRepository(txCtx, ImageGenerationOutput).save(
                        new ImageGenerationOutput({
                            jobId: job.id,
                            outputIndex,
                            state: 'QUEUED',
                            attemptCount: 0,
                            providerIdempotencyKey: `image-${String(job.id)}-${outputIndex}`,
                            providerRequestId: null,
                            assetId: null,
                            errorMessage: null,
                            unknownAt: null,
                            completedAt: null,
                            walletSettled: false,
                            refundedAt: null,
                        }),
                    );
                    outputs.push(output);
                    await this.connection.getRepository(txCtx, ImageGenerationDispatch).save(
                        new ImageGenerationDispatch({
                            outputId: output.id,
                            state: 'PENDING',
                            attemptCount: 0,
                            nextAttemptAt: new Date(),
                            dispatchedAt: null,
                            lastError: null,
                        }),
                    );
                }
                job.outputs = outputs;
                job.referenceAsset = reference;
                return job;
            });
        } catch (error) {
            const raced = await this.connection.getRepository(ctx, ImageGenerationJob).findOne({
                where: {
                    channelId: ctx.channelId,
                    customerId: customer.id,
                    idempotencyKey: normalized.idempotencyKey,
                },
                relations: { outputs: { asset: true }, referenceAsset: true },
            });
            if (!raced) throw error;
            this.assertSameCreateRequest(raced, normalized);
            return this.jobView(raced, customer.id);
        }

        if (this.enqueueOutput) {
            for (const output of created.outputs) {
                await this.enqueueOutput(output.id).catch(() => undefined);
            }
        }
        return this.findMine(ctx, created.id);
    }

    async uploadReference(ctx: RequestContext, upload: Promise<UploadedImageFile>, termsAccepted: boolean) {
        if (!termsAccepted) throw new UserInputError('上传参考图前需确认拥有图片使用权并同意服务条款');
        const customer = await this.activeCustomer(ctx);
        if (!(await this.configService.shopConfig(ctx)).enabled)
            throw new UserInputError('当前店铺的 AI 图片工坊不可用');
        const file = await upload;
        const asset = await this.connection.withTransaction(ctx, async txCtx => {
            if (supportsGenerationLock(this.connection.rawConnection.options.type)) {
                await this.connection
                    .getRepository(txCtx, Customer)
                    .createQueryBuilder('customer')
                    .setLock('pessimistic_write')
                    .where('customer.id = :id', { id: customer.id })
                    .getOne();
            }
            const repository = this.connection.getRepository(txCtx, ImagePrivateAsset);
            const now = Date.now();
            const [minuteCount, dayCount, activeCount, activeSize] = await Promise.all([
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        kind: 'REFERENCE',
                        createdAt: MoreThanOrEqual(new Date(now - 60_000)),
                    },
                }),
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        kind: 'REFERENCE',
                        createdAt: MoreThanOrEqual(startOfBeijingDay(now)),
                    },
                }),
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        kind: 'REFERENCE',
                        deletedAt: IsNull(),
                        expiresAt: MoreThan(new Date()),
                    },
                }),
                repository
                    .createQueryBuilder('asset')
                    .select('COALESCE(SUM(asset.byteSize), 0)', 'total')
                    .where('asset.channelId = :channelId', { channelId: txCtx.channelId })
                    .andWhere('asset.customerId = :customerId', { customerId: customer.id })
                    .andWhere('asset.kind = :kind', { kind: 'REFERENCE' })
                    .andWhere('asset.deletedAt IS NULL')
                    .andWhere('asset.expiresAt > :now', { now: new Date() })
                    .getRawOne<{ total: string | number }>(),
            ]);
            if (minuteCount >= MAX_REFERENCE_UPLOADS_PER_MINUTE)
                throw new UserInputError('参考图每分钟最多上传 5 张，请稍后再试');
            if (dayCount >= MAX_REFERENCE_UPLOADS_PER_DAY)
                throw new UserInputError('今天的参考图上传额度已用完');
            if (activeCount >= MAX_ACTIVE_REFERENCE_ASSETS)
                throw new UserInputError('最多保留 10 张有效参考图，请等待过期后再上传');
            const remainingBytes = MAX_ACTIVE_REFERENCE_BYTES - Number(activeSize?.total ?? 0);
            if (remainingBytes <= 0) throw new UserInputError('参考图总容量已达到 100MB');
            return this.storage.storeReference(
                txCtx,
                customer.id,
                file,
                Math.min(MAX_REFERENCE_BYTES, remainingBytes),
            );
        });
        return this.assetView(asset, customer.id);
    }

    async findMine(ctx: RequestContext, id: ID) {
        const customer = await this.activeCustomer(ctx);
        const job = await this.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
            relations: { outputs: { asset: true }, referenceAsset: true },
            order: { outputs: { outputIndex: 'ASC' } },
        });
        if (!job) throw new UserInputError('找不到生图任务');
        return this.jobView(job, customer.id);
    }

    async findMineList(ctx: RequestContext, skip = 0, take = 20) {
        const customer = await this.activeCustomer(ctx);
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ImageGenerationJob)
            .findAndCount({
                where: { channelId: ctx.channelId, customerId: customer.id },
                relations: { outputs: { asset: true }, referenceAsset: true },
                order: { createdAt: 'DESC', outputs: { outputIndex: 'ASC' } },
                skip: Math.max(0, Math.floor(skip || 0)),
                take: Math.min(50, Math.max(1, Math.floor(take || 20))),
            });
        return { items: items.map(job => this.jobView(job, customer.id)), totalItems };
    }

    async cancelQueued(ctx: RequestContext, id: ID) {
        const customer = await this.activeCustomer(ctx);
        const job = await this.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
            relations: { outputs: true },
        });
        if (!job) throw new UserInputError('找不到生图任务');
        for (const output of job.outputs.filter(item => item.state === 'QUEUED')) {
            await this.transitionAndRelease(
                ctx,
                job,
                output,
                ['QUEUED'],
                'CANCELLED',
                '客户在开始生成前取消',
            );
        }
        await this.refreshJob(ctx, job.id);
        return this.findMine(ctx, job.id);
    }

    async deleteOutput(ctx: RequestContext, outputId: ID): Promise<boolean> {
        const customer = await this.activeCustomer(ctx);
        const output = await this.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true, asset: true },
        });
        if (
            !output ||
            output.job.channelId.toString() !== ctx.channelId.toString() ||
            output.job.customerId.toString() !== customer.id.toString()
        )
            return false;
        if (!output.assetId) return false;
        return this.storage.deleteOwned(ctx, output.assetId, customer.id);
    }

    async walletBalance(ctx: RequestContext): Promise<number> {
        const customer = await this.activeCustomer(ctx);
        const model = await this.connection.getRepository(ctx, ImageModelConfig).findOne({
            where: { channelId: ctx.channelId, enabled: true },
            order: { isDefault: 'DESC', position: 'ASC' },
        });
        const currencyCode = model?.currencyCode ?? ctx.channel.defaultCurrencyCode;
        const wallet = await this.connection.getRepository(ctx, ReferralWallet).findOne({
            where: { channelId: ctx.channelId, customerId: customer.id, currencyCode },
        });
        return wallet?.availableBalance ?? 0;
    }

    async adminJobs(ctx: RequestContext, skip = 0, take = 50, state?: string | null) {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ImageGenerationJob)
            .findAndCount({
                where: { channelId: ctx.channelId, ...(state ? { state } : {}) },
                relations: { outputs: { asset: true }, referenceAsset: true, customer: true },
                order: { createdAt: 'DESC', outputs: { outputIndex: 'ASC' } },
                skip: Math.max(0, Math.floor(skip || 0)),
                take: Math.min(100, Math.max(1, Math.floor(take || 50))),
            });
        return { items: items.map(job => this.jobView(job, job.customerId)), totalItems };
    }

    async adminCostSummary(ctx: RequestContext, days = 30) {
        const normalizedDays = Math.min(365, Math.max(1, Math.floor(days || 30)));
        const from = new Date(Date.now() - normalizedDays * 24 * 60 * 60_000);
        const events = await this.connection.getRepository(ctx, ImageGenerationCostEvent).find({
            where: { channelId: ctx.channelId, createdAt: MoreThanOrEqual(from) },
            select: {
                modelCodeSnapshot: true,
                providerScopeSnapshot: true,
                saleUnitPriceSnapshot: true,
                saleCurrencyCode: true,
                outcome: true,
                latencyMs: true,
                actualCostMicrounits: true,
                costCurrency: true,
            },
            order: { createdAt: 'DESC' },
            take: 20_000,
        });
        const grouped = new Map<
            string,
            {
                modelCode: string;
                providerScope: string;
                saleCurrencyCode: string;
                costCurrency: string;
                attempts: number;
                successes: number;
                retries: number;
                failures: number;
                unknowns: number;
                missingCostCount: number;
                grossRevenue: number;
                actualCostMicrounits: number;
                latencyTotal: number;
            }
        >();
        for (const event of events) {
            const costCurrency = event.costCurrency ?? 'UNKNOWN';
            const key = [
                event.modelCodeSnapshot,
                event.providerScopeSnapshot,
                event.saleCurrencyCode,
                costCurrency,
            ].join(':');
            const item = grouped.get(key) ?? {
                modelCode: event.modelCodeSnapshot,
                providerScope: event.providerScopeSnapshot,
                saleCurrencyCode: event.saleCurrencyCode,
                costCurrency,
                attempts: 0,
                successes: 0,
                retries: 0,
                failures: 0,
                unknowns: 0,
                missingCostCount: 0,
                grossRevenue: 0,
                actualCostMicrounits: 0,
                latencyTotal: 0,
            };
            item.attempts += 1;
            item.latencyTotal += event.latencyMs;
            if (event.outcome === 'SUCCEEDED') {
                item.successes += 1;
                item.grossRevenue += event.saleUnitPriceSnapshot;
            } else if (event.outcome === 'RETRY') item.retries += 1;
            else if (event.outcome === 'UNKNOWN') item.unknowns += 1;
            else item.failures += 1;
            if (event.actualCostMicrounits == null) item.missingCostCount += 1;
            else item.actualCostMicrounits += event.actualCostMicrounits;
            grouped.set(key, item);
        }
        return {
            from,
            to: new Date(),
            truncated: events.length >= 20_000,
            items: [...grouped.values()].map(item => ({
                ...item,
                actualCost: item.actualCostMicrounits / 1_000_000,
                averageLatencyMs: item.attempts ? Math.round(item.latencyTotal / item.attempts) : 0,
            })),
        };
    }

    async deleteJob(ctx: RequestContext, id: ID): Promise<boolean> {
        const customer = await this.activeCustomer(ctx);
        const job = await this.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
            relations: { outputs: { asset: true }, referenceAsset: true },
        });
        if (!job) return false;
        if (!['PARTIAL_SUCCESS', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.state)) {
            throw new UserInputError('只能删除已结束的生图任务');
        }
        for (const output of job.outputs) {
            if (output.assetId) await this.storage.deleteOwned(ctx, output.assetId, customer.id);
        }
        const referenceAssetId = job.referenceAssetId;
        await this.connection.getRepository(ctx, ImageGenerationJob).delete({ id: job.id });
        if (referenceAssetId) {
            const remainingReferences = await this.connection.getRepository(ctx, ImageGenerationJob).count({
                where: { channelId: ctx.channelId, customerId: customer.id, referenceAssetId },
            });
            if (remainingReferences === 0) {
                await this.storage.deleteOwned(ctx, referenceAssetId, customer.id);
            }
        }
        return true;
    }

    async purgeSensitiveRecords(): Promise<number> {
        const rawConnection = this.connection.rawConnection;
        const expiredOptimizations = await rawConnection.getRepository(ImagePromptOptimization).find({
            where: { createdAt: LessThan(new Date(Date.now() - 30 * 24 * 60 * 60_000)) },
            select: { id: true },
            take: 10_000,
        });
        const promptDelete = expiredOptimizations.length
            ? await rawConnection
                  .getRepository(ImagePromptOptimization)
                  .delete({ id: In(expiredOptimizations.map(item => item.id)) })
            : { affected: 0 };
        const jobs = await rawConnection.getRepository(ImageGenerationJob).find({
            where: {
                completedAt: LessThan(new Date(Date.now() - 90 * 24 * 60 * 60_000)),
                originalPrompt: Not('[已按保留策略删除]'),
            },
            take: 200,
        });
        let redacted = 0;
        for (const job of jobs) {
            await rawConnection.getRepository(ImageGenerationJob).update(
                { id: job.id },
                {
                    originalPrompt: '[已按保留策略删除]',
                    finalPrompt: '[已按保留策略删除]',
                    promptSpec: null,
                    errorMessage: null,
                },
            );
            await rawConnection
                .getRepository(ImageGenerationOutput)
                .update({ jobId: job.id }, { providerRequestId: null, errorMessage: null });
            redacted += 1;
        }
        return (promptDelete.affected ?? 0) + redacted;
    }

    async adminRetryUnknown(ctx: RequestContext, outputId: ID) {
        const output = await this.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output || output.job.channelId.toString() !== ctx.channelId.toString())
            throw new UserInputError('找不到该生图输出');
        if (output.state !== 'UNKNOWN' || output.walletSettled)
            throw new UserInputError('只有尚未退款的 UNKNOWN 输出可人工重试');
        if (!output.job.providerIdempotencySupportedSnapshot)
            throw new UserInputError('该模型未确认支持中转站幂等，不能安全人工重试');
        if (!this.enqueueOutput) throw new UserInputError('生图任务队列尚未就绪');
        const credential = await this.configService.requireCredential(
            ctx,
            output.job.providerScopeSnapshot as ImageProviderScope,
        );
        const currentFingerprint = this.configService.credentialFingerprint(credential);
        if (
            output.job.providerCredentialFingerprint &&
            output.job.providerCredentialFingerprint !== currentFingerprint
        ) {
            throw new UserInputError('中转站账号或地址已更换，不能使用旧幂等键重试');
        }
        const transition = await this.connection
            .getRepository(ctx, ImageGenerationOutput)
            .update(
                { id: output.id, state: 'UNKNOWN', walletSettled: false },
                { state: 'QUEUED', unknownAt: null, errorMessage: '管理员确认后使用相同幂等键重试' },
            );
        if (transition.affected !== 1) throw new UserInputError('该输出状态已变更，请刷新后重试');
        output.state = 'QUEUED';
        output.unknownAt = null;
        output.errorMessage = '管理员确认后使用相同幂等键重试';
        await this.connection.getRepository(ctx, ImageGenerationDispatch).upsert(
            {
                outputId: output.id,
                state: 'PENDING',
                attemptCount: 0,
                nextAttemptAt: new Date(),
                dispatchedAt: null,
                lastError: null,
            },
            ['outputId'],
        );
        try {
            await this.enqueueOutput(output.id);
        } catch {
            output.errorMessage = '即时入队失败，系统将在后台自动补发';
            await this.connection
                .getRepository(ctx, ImageGenerationOutput)
                .update({ id: output.id, state: 'QUEUED' }, { errorMessage: output.errorMessage });
        }
        await this.refreshJob(ctx, output.jobId);
        return this.connection.getRepository(ctx, ImageGenerationOutput).findOneByOrFail({ id: output.id });
    }

    async adminRefundOutput(ctx: RequestContext, outputId: ID, reason: string) {
        const output = await this.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output || output.job.channelId.toString() !== ctx.channelId.toString())
            throw new UserInputError('找不到该生图输出');
        if (output.state !== 'SUCCEEDED' || !output.walletSettled || output.refundedAt)
            throw new UserInputError('该图片不能重复退款');
        const walletUsageId = output.job.walletUsageId;
        if (!walletUsageId) throw new UserInputError('该图片缺少返利余额结算记录');
        const note = reason.trim();
        if (!note || note.length > 300) throw new UserInputError('退款原因不能为空且不能超过 300 个字符');
        await this.connection.withTransaction(ctx, async txCtx => {
            await this.walletSpend.refundCaptured(txCtx, {
                usageId: walletUsageId,
                amount: output.job.unitPriceSnapshot,
                operationKey: `ADMIN_REFUND:${String(output.id)}`,
                actorId: txCtx.activeUserId,
                actorType: 'ADMIN',
                metadata: { jobId: String(output.job.id), outputId: String(output.id), reason: note },
            });
            output.refundedAt = new Date();
            await this.connection.getRepository(txCtx, ImageGenerationOutput).save(output, { reload: false });
        });
        await this.refreshJob(ctx, output.jobId);
        return output;
    }

    async failQueuedOutput(ctx: RequestContext, outputId: ID, message: string): Promise<void> {
        const output = await this.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output) return;
        await this.transitionAndRelease(ctx, output.job, output, ['QUEUED'], 'FAILED', message);
        await this.refreshJob(ctx, output.jobId);
    }

    async failRunningOutput(ctx: RequestContext, outputId: ID, message: string): Promise<boolean> {
        const output = await this.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output) return false;
        const failed = await this.transitionAndRelease(
            ctx,
            output.job,
            output,
            ['RUNNING'],
            'FAILED',
            message,
        );
        await this.refreshJob(ctx, output.jobId);
        return failed;
    }

    async settleUnreleasedTerminalOutput(ctx: RequestContext, outputId: ID): Promise<boolean> {
        const output = await this.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output || !['FAILED', 'CANCELLED'].includes(output.state)) return false;
        const state = output.state as 'FAILED' | 'CANCELLED';
        const settled = await this.transitionAndRelease(
            ctx,
            output.job,
            output,
            [state],
            state,
            output.errorMessage ?? '生图任务未成功',
        );
        if (settled) await this.refreshJob(ctx, output.jobId);
        return settled;
    }

    async releaseUnknownOlderThan(ctx: RequestContext, cutoff: Date): Promise<number> {
        const outputs = await this.connection
            .getRepository(ctx, ImageGenerationOutput)
            .createQueryBuilder('output')
            .innerJoinAndSelect('output.job', 'job')
            .where('job.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('output.state = :state', { state: 'UNKNOWN' })
            .andWhere('output.unknownAt <= :cutoff', { cutoff })
            .take(100)
            .getMany();
        for (const output of outputs) {
            const released = await this.transitionAndRelease(
                ctx,
                output.job,
                output,
                ['UNKNOWN'],
                'FAILED',
                '中转站结果在 15 分钟内无法确认，已自动退回本张费用',
            );
            if (released) await this.refreshJob(ctx, output.jobId);
        }
        return outputs.filter(output => output.walletSettled).length;
    }

    private validateCreateInput(input: CreateImageGenerationInput) {
        const prompt = input.prompt.trim();
        if (!prompt || prompt.length > MAX_PROMPT_LENGTH)
            throw new UserInputError(`原始描述必须为 1 至 ${MAX_PROMPT_LENGTH} 个字符`);
        const optimizedPrompt = input.optimizedPrompt?.trim() ?? '';
        if (optimizedPrompt.length > 8_000) throw new UserInputError('优化后的提示词不能超过 8000 个字符');
        if (!supportedAspectRatios.includes(input.aspectRatio as (typeof supportedAspectRatios)[number]))
            throw new UserInputError('图片比例无效');
        if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_GENERATION_COUNT)
            throw new UserInputError('每次只能生成 1 至 4 张图片');
        if (!Number.isSafeInteger(input.expectedUnitPrice) || input.expectedUnitPrice <= 0)
            throw new UserInputError('预期价格无效');
        if (!input.termsAccepted) throw new UserInputError('请先同意 AI 图片服务条款');
        const idempotencyKey = input.idempotencyKey.trim();
        if (!/^[a-zA-Z0-9._:-]{8,64}$/u.test(idempotencyKey)) throw new UserInputError('请求幂等键无效');
        const referenceMode = normalizeReferenceMode(input.referenceMode);
        return { ...input, prompt, optimizedPrompt, idempotencyKey, referenceMode };
    }

    private assertSameCreateRequest(
        job: ImageGenerationJob,
        input: ReturnType<ImageGenerationService['validateCreateInput']>,
    ): void {
        const sameReference = String(job.referenceAssetId ?? '') === String(input.referenceAssetId ?? '');
        const expectedPrompt = this.compileFinalPrompt(
            input,
            this.rules.fallbackSpec(input.prompt, input.referenceMode),
        );
        const sameExplicitOptimizedPrompt = !input.optimizedPrompt || job.finalPrompt === expectedPrompt;
        if (
            job.modelCodeSnapshot !== input.modelCode ||
            job.originalPrompt !== input.prompt ||
            !sameExplicitOptimizedPrompt ||
            job.referenceMode !== input.referenceMode ||
            !sameReference ||
            job.aspectRatio !== input.aspectRatio ||
            job.quantity !== input.quantity ||
            job.unitPriceSnapshot !== input.expectedUnitPrice ||
            job.currencyCode !== input.currencyCode
        ) {
            throw new UserInputError('请求幂等键已被其他生图参数使用');
        }
    }

    private compileFinalPrompt(
        input: ReturnType<ImageGenerationService['validateCreateInput']>,
        promptSpec: ReturnType<PromptRulesService['fallbackSpec']>,
    ): string {
        const base = input.optimizedPrompt || this.rules.render(promptSpec);
        const referenceInstruction = referenceModeInstruction(input.referenceMode);
        const finalPrompt = referenceInstruction
            ? `${base}\nReference instruction: ${referenceInstruction}`
            : base;
        if (finalPrompt.length > 8_000) throw new UserInputError('最终提示词超过 8000 个字符');
        return finalPrompt;
    }

    private async transitionAndRelease(
        ctx: RequestContext,
        job: ImageGenerationJob,
        output: ImageGenerationOutput,
        fromStates: string[],
        targetState: 'FAILED' | 'CANCELLED',
        message: string,
    ): Promise<boolean> {
        const walletUsageId = job.walletUsageId;
        if (!walletUsageId) throw new Error('生图任务缺少返利余额预占记录');
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, ImageGenerationOutput);
            const completedAt = new Date();
            const transition = await repository.update(
                { id: output.id, state: In(fromStates), walletSettled: false },
                { state: targetState, errorMessage: message.slice(0, 500), completedAt },
            );
            if (transition.affected !== 1) return false;
            await this.walletSpend.release(txCtx, {
                usageId: walletUsageId,
                amount: job.unitPriceSnapshot,
                operationKey: `OUTPUT:${String(output.id)}`,
                metadata: { jobId: String(job.id), outputId: String(output.id) },
            });
            await repository.update({ id: output.id }, { walletSettled: true });
            output.state = targetState;
            output.errorMessage = message.slice(0, 500);
            output.completedAt = completedAt;
            output.walletSettled = true;
            return true;
        });
    }

    async refreshJob(ctx: RequestContext, jobId: ID): Promise<void> {
        let terminalReferenceAssetId: ID | null = null;
        await this.connection.withTransaction(ctx, async txCtx => {
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
            const settlement = deriveImageJobSettlement(job.quantity, job.unitPriceSnapshot, job.outputs);
            job.capturedAmount = settlement.capturedAmount;
            job.releasedAmount = settlement.releasedAmount;
            job.state = settlement.state;
            job.completedAt = settlement.terminal ? (job.completedAt ?? new Date()) : null;
            await repository.save(job, { reload: false });
            terminalReferenceAssetId = settlement.terminal ? job.referenceAssetId : null;
        });
        const referenceAssetId = terminalReferenceAssetId;
        if (referenceAssetId) {
            await this.connection.withTransaction(ctx, async txCtx => {
                if (supportsGenerationLock(this.connection.rawConnection.options.type)) {
                    await this.connection
                        .getRepository(txCtx, ImagePrivateAsset)
                        .createQueryBuilder('asset')
                        .setLock('pessimistic_write')
                        .where('asset.id = :id', { id: referenceAssetId })
                        .getOne();
                }
                const activeJobs = await this.connection.getRepository(txCtx, ImageGenerationJob).count({
                    where: {
                        channelId: txCtx.channelId,
                        referenceAssetId,
                        state: In(['QUEUED', 'RUNNING', 'UNKNOWN']),
                    },
                });
                if (activeJobs === 0) {
                    await this.storage.expireReferenceAfterTerminal(txCtx, referenceAssetId);
                }
            });
        }
    }

    jobView(job: ImageGenerationJob, customerId: ID) {
        return {
            ...job,
            referenceAsset: job.referenceAsset ? this.assetView(job.referenceAsset, customerId) : null,
            outputs: (job.outputs ?? []).map(output => ({
                ...output,
                imageUrl: output.asset ? this.storage.signedUrl(output.asset, customerId) : null,
                downloadUrl: output.asset ? this.storage.signedUrl(output.asset, customerId, true) : null,
            })),
        };
    }

    private assetView(asset: ImagePrivateAsset, customerId: ID) {
        return { ...asset, previewUrl: this.storage.signedUrl(asset, customerId) };
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('找不到当前客户');
        return customer;
    }
}

function normalizeReferenceMode(value?: ImageReferenceMode | null): ImageReferenceMode {
    return value && ['STYLE', 'COMPOSITION', 'IDENTITY', 'PRODUCT', 'EDIT'].includes(value) ? value : 'NONE';
}

function referenceModeInstruction(mode: ImageReferenceMode): string {
    const instructions: Record<ImageReferenceMode, string> = {
        NONE: '',
        STYLE: 'Use the reference only for visual style; do not copy its identity, text, logo, or unrelated objects.',
        COMPOSITION:
            'Preserve the reference composition and spatial layout while following the requested subject and content.',
        IDENTITY:
            'Preserve the consenting adult subject identity and facial features; change only what the user requested.',
        PRODUCT:
            'Preserve the product shape, proportions, materials, colors, labels, and brand details unless explicitly changed.',
        EDIT: 'Edit only the requested regions and preserve all unrequested details from the reference.',
    };
    return instructions[mode];
}

function supportsGenerationLock(driverType: unknown): boolean {
    return new Set([
        'aurora-mysql',
        'aurora-postgres',
        'cockroachdb',
        'mariadb',
        'mssql',
        'mysql',
        'oracle',
        'postgres',
    ]).has(String(driverType));
}
