import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Customer,
    CustomerService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import {
    ReferralWallet,
    ReferralWalletSpendService,
    ReferralWalletUsage,
} from '@vendure/store-management-plugin';
import {
    Brackets,
    In,
    IsNull,
    MoreThan,
    MoreThanOrEqual,
    Not,
    ObjectLiteral,
    SelectQueryBuilder,
} from 'typeorm';

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
import { ImageComplianceAuditEvent } from './entities/image-compliance-audit-event.entity';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageGenerationCostEvent } from './entities/image-generation-cost-event.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { ImagePromptOptimization } from './entities/image-prompt-optimization.entity';
import { ImageUsageQuotaBucket } from './entities/image-usage-quota-bucket.entity';
import { ImageUsageQuotaEvent } from './entities/image-usage-quota-event.entity';
import { imagePricingSnapshot, quoteImageMoney } from './image-billing-quote';
import {
    ImageGenerationConfigService,
    modelReady,
    providerScopeForModel,
} from './image-generation-config.service';
import { deriveImageJobSettlement } from './image-generation-state';
import { isImageResolution, resolutionPrice, supportsNativeResolution } from './image-resolution';
import { ImageUsageQuotaService } from './image-usage-quota.service';
import { ImagePromptEngineService, startOfBeijingDay } from './prompt/image-prompt-engine.service';
import { PromptRulesService } from './prompt/prompt-rules.service';
import { ImagePrivateStorageService, UploadedImageFile } from './storage/image-private-storage.service';
import {
    CreateImageGenerationInput,
    ImageAiUsageRecordListInput,
    ImageProviderScope,
    ImageReferenceMode,
} from './types';

@Injectable()
export class ImageGenerationService {
    private enqueueOutput?: (outputId: ID) => Promise<void>;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly walletSpend: ReferralWalletSpendService,
        private readonly configService: ImageGenerationConfigService,
        private readonly quota: ImageUsageQuotaService,
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
                const credentialRoute = await this.configService.routeCredential(
                    txCtx,
                    providerScope,
                    model.id,
                    'IMAGE',
                );
                const credential = credentialRoute.credential;
                const credentialFingerprint = this.configService.credentialFingerprint(credential);
                if (!supportsNativeResolution(model, normalized.resolution, normalized.aspectRatio)) {
                    throw new UserInputError('所选模型不支持该画幅的原生清晰度');
                }
                const baseUnitPrice = resolutionPrice(model, normalized.resolution);
                if (baseUnitPrice <= 0) throw new UserInputError('所选清晰度尚未配置价格');
                const priceQuote = quoteImageMoney(txCtx, baseUnitPrice, model.currencyCode);
                const unitPrice = priceQuote.amount;
                if (
                    unitPrice !== normalized.expectedUnitPrice ||
                    priceQuote.currencyCode !== normalized.currencyCode
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
                const safetyEvent = await this.quota.reserve(txCtx, {
                    customerId: customer.id,
                    quotaType: 'IMAGE_DAILY_SAFETY',
                    modelCode: model.code,
                    limit: model.dailyGenerationSafetyLimit,
                    requestedAmount: normalized.quantity,
                    idempotencyKey: `IMAGE_SAFETY:${String(txCtx.channelId)}:${String(customer.id)}:${normalized.idempotencyKey}`,
                    resourceType: 'IMAGE_GENERATION_JOB',
                    resourceId: normalized.idempotencyKey,
                });
                if (!safetyEvent) throw new UserInputError('今天的生图安全额度已用完');
                await this.quota.capture(txCtx, safetyEvent.id, normalized.quantity);
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
                        providerCredentialCodeSnapshot: credential.code,
                        providerCredentialNameSnapshot: credential.name,
                        providerCredentialLast4Snapshot: credential.apiKeyLast4,
                        providerSelectionReason: credentialRoute.selectionReason,
                        providerIdempotencySupportedSnapshot: model.supportsIdempotency,
                        originalPrompt: normalized.prompt,
                        finalPrompt,
                        promptSpec: promptSpec as unknown as Record<string, any>,
                        promptSkillHash: this.rules.sourceHash,
                        referenceMode: normalized.referenceMode,
                        aspectRatio: normalized.aspectRatio,
                        resolution: normalized.resolution,
                        quantity: normalized.quantity,
                        unitPriceSnapshot: unitPrice,
                        pricingSnapshot: imagePricingSnapshot(priceQuote),
                        reservedAmount: 0,
                        expectedChargeAmount: 0,
                        freeQuantityReserved: 0,
                        freeQuantityCaptured: 0,
                        paidQuantityReserved: 0,
                        quotaEventId: null,
                        capturedAmount: 0,
                        releasedAmount: 0,
                        currencyCode: priceQuote.currencyCode,
                        walletUsageId: null,
                        state: 'QUEUED',
                        termsVersion: config.termsVersion,
                        termsAcceptedAt: new Date(),
                        errorMessage: null,
                        completedAt: null,
                        customerDeletedAt: null,
                    }),
                );
                const freeEvent = model.freeImageEnabled
                    ? await this.quota.reserve(txCtx, {
                          customerId: customer.id,
                          quotaType: 'IMAGE_DAILY_FREE',
                          modelCode: model.code,
                          limit: model.dailyFreeImageLimit,
                          unlimited: model.dailyFreeImageUnlimited,
                          requestedAmount: normalized.quantity,
                          allowPartial: true,
                          idempotencyKey: `IMAGE_FREE:${String(txCtx.channelId)}:${String(customer.id)}:${normalized.idempotencyKey}`,
                          resourceType: 'IMAGE_GENERATION_JOB',
                          resourceId: String(job.id),
                      })
                    : null;
                const freeQuantity = freeEvent?.amount ?? 0;
                const paidQuantity = normalized.quantity - freeQuantity;
                if (paidQuantity > 0 && !model.paidAfterFreeEnabled) {
                    throw new UserInputError('今日免费生图额度不足，该模型未开启超额付费');
                }
                const expectedChargeAmount = unitPrice * paidQuantity;
                if (expectedChargeAmount !== normalized.expectedChargeAmount) {
                    throw new UserInputError('PRICE_CHANGED：免费额度或价格已变化，请刷新报价后重新提交');
                }
                if (expectedChargeAmount > 0) {
                    const usage = await this.walletSpend.reserve(txCtx, {
                        customerId: customer.id,
                        currencyCode: priceQuote.currencyCode,
                        amount: expectedChargeAmount,
                        resourceType: 'IMAGE_GENERATION_JOB',
                        resourceId: String(job.id),
                        idempotencyKey: `IMAGE_JOB:${String(txCtx.channelId)}:${String(customer.id)}:${normalized.idempotencyKey}`,
                        actorId: txCtx.activeUserId,
                        actorType: 'CUSTOMER',
                        metadata: {
                            modelCode: model.code,
                            resolution: normalized.resolution,
                            quantity: normalized.quantity,
                            freeQuantity,
                            paidQuantity,
                            unitPrice,
                            pricingSnapshot: imagePricingSnapshot(priceQuote),
                        },
                    });
                    job.walletUsageId = usage.id;
                }
                job.reservedAmount = expectedChargeAmount;
                job.expectedChargeAmount = expectedChargeAmount;
                job.freeQuantityReserved = freeQuantity;
                job.paidQuantityReserved = paidQuantity;
                job.quotaEventId = freeEvent?.id ?? null;
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
                            billingMode: 'PENDING',
                            chargeAmount: 0,
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
            where: { id, channelId: ctx.channelId, customerId: customer.id, customerDeletedAt: IsNull() },
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
                where: { channelId: ctx.channelId, customerId: customer.id, customerDeletedAt: IsNull() },
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
        const deleted = await this.storage.deleteOwned(ctx, output.assetId, customer.id);
        if (deleted) {
            output.assetId = null;
            output.asset = null;
            await this.connection.getRepository(ctx, ImageGenerationOutput).save(output, { reload: false });
        }
        return deleted;
    }

    async wallet(ctx: RequestContext): Promise<{ availableBalance: number; currencyCode: string }> {
        const customer = await this.activeCustomer(ctx);
        const currencyCode = ctx.currencyCode;
        const wallet = await this.connection.getRepository(ctx, ReferralWallet).findOne({
            where: { channelId: ctx.channelId, customerId: customer.id, currencyCode },
        });
        return { availableBalance: wallet?.availableBalance ?? 0, currencyCode };
    }

    async walletBalance(ctx: RequestContext): Promise<number> {
        return (await this.wallet(ctx)).availableBalance;
    }

    async modelQuotaStatus(ctx: RequestContext) {
        const customer = await this.activeCustomer(ctx);
        const models = await this.connection.getRepository(ctx, ImageModelConfig).find({
            where: { channelId: ctx.channelId, enabled: true },
            order: { position: 'ASC' },
        });
        return Promise.all(
            models.map(async model => {
                const unitPrice = quoteImageMoney(ctx, model.unitPrice, model.currencyCode);
                const [free, safety] = await Promise.all([
                    this.quota.status(
                        ctx,
                        customer.id,
                        'IMAGE_DAILY_FREE',
                        model.freeImageEnabled ? model.dailyFreeImageLimit : 0,
                        model.freeImageEnabled && model.dailyFreeImageUnlimited,
                        model.code,
                    ),
                    this.quota.status(
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

    async adminUsageRecords(ctx: RequestContext, input: ImageAiUsageRecordListInput = {}) {
        const options = normalizeUsageRecordInput(input);
        const prefetch = options.skip + options.take;
        let imageItems: ImageGenerationJob[] = [];
        let promptItems: ImagePromptOptimization[] = [];
        let imageTotal = 0;
        let promptTotal = 0;

        if (options.recordType !== 'PROMPT_OPTIMIZATION') {
            const query = this.connection
                .getRepository(ctx, ImageGenerationJob)
                .createQueryBuilder('job')
                .leftJoinAndSelect('job.customer', 'customer')
                .where('job.channelId = :channelId', { channelId: ctx.channelId });
            applyUsageDateAndCustomerFilters(query, 'job', options);
            if (options.modelCode) query.andWhere('job.modelCodeSnapshot = :modelCode', options);
            if (options.credentialCode) {
                query.andWhere('job.providerCredentialCodeSnapshot = :credentialCode', options);
            }
            if (options.state) query.andWhere('job.state = :state', options);
            if (options.billingMode === 'FREE') query.andWhere('job.freeQuantityReserved > 0');
            if (options.billingMode === 'PAID') query.andWhere('job.paidQuantityReserved > 0');
            if (options.billingMode === 'MIXED') {
                query.andWhere('job.freeQuantityReserved > 0').andWhere('job.paidQuantityReserved > 0');
            }
            if (options.billingMode === 'REFUNDED') {
                query.innerJoin('job.outputs', 'refundedOutput', 'refundedOutput.refundedAt IS NOT NULL');
                query.distinct(true);
            }
            if (options.failuresOnly)
                query.andWhere('job.state IN (:...failureStates)', {
                    failureStates: ['FAILED', 'UNKNOWN', 'CANCELLED', 'PARTIAL_SUCCESS'],
                });
            if (options.missingCostOnly) {
                const rawMissing = await this.connection
                    .getRepository(ctx, ImageGenerationCostEvent)
                    .createQueryBuilder('cost')
                    .select('DISTINCT cost.jobIdSnapshot', 'jobId')
                    .where('cost.channelId = :channelId', { channelId: ctx.channelId })
                    .andWhere('cost.actualCostMicrounits IS NULL')
                    .limit(50_000)
                    .getRawMany();
                const missingIds = rawMissing.map(row => String(row.jobId));
                if (missingIds.length) query.andWhere('job.id IN (:...missingIds)', { missingIds });
                else query.andWhere('1 = 0');
            }
            [imageItems, imageTotal] = await query
                .orderBy('job.createdAt', 'DESC')
                .addOrderBy('job.id', 'DESC')
                .take(prefetch)
                .getManyAndCount();
        }

        if (options.recordType !== 'IMAGE_GENERATION') {
            const query = this.connection
                .getRepository(ctx, ImagePromptOptimization)
                .createQueryBuilder('prompt')
                .leftJoinAndSelect('prompt.customer', 'customer')
                .where('prompt.channelId = :channelId', { channelId: ctx.channelId });
            applyUsageDateAndCustomerFilters(query, 'prompt', options);
            if (options.modelCode) query.andWhere('prompt.recommendedModelCode = :modelCode', options);
            if (options.credentialCode) {
                query.andWhere('prompt.credentialCodeSnapshot = :credentialCode', options);
            }
            if (options.billingMode) query.andWhere('prompt.billingMode = :billingMode', options);
            if (options.state === 'PENDING') query.andWhere("prompt.source = 'PENDING'");
            else if (options.state === 'FAILED') query.andWhere('prompt.errorMessage IS NOT NULL');
            else if (options.state === 'SUCCEEDED') {
                query.andWhere("prompt.source <> 'PENDING'").andWhere('prompt.errorMessage IS NULL');
            } else if (options.state) query.andWhere('1 = 0');
            if (options.failuresOnly) query.andWhere('prompt.errorMessage IS NOT NULL');
            if (options.missingCostOnly) {
                query
                    .andWhere('prompt.upstreamCallCount > 0')
                    .andWhere('prompt.actualCostMicrounits IS NULL');
            }
            [promptItems, promptTotal] = await query
                .orderBy('prompt.createdAt', 'DESC')
                .addOrderBy('prompt.id', 'DESC')
                .take(prefetch)
                .getManyAndCount();
        }

        const jobIds = imageItems.map(item => String(item.id));
        const costEvents = jobIds.length
            ? await this.connection.getRepository(ctx, ImageGenerationCostEvent).find({
                  where: { channelId: ctx.channelId, jobIdSnapshot: In(jobIds) },
              })
            : [];
        const refundedOutputs = jobIds.length
            ? await this.connection.getRepository(ctx, ImageGenerationOutput).find({
                  where: { jobId: In(jobIds), refundedAt: Not(IsNull()) },
              })
            : [];
        const costsByJob = groupBy(costEvents, event => event.jobIdSnapshot);
        const refundsByJob = new Map<string, { amount: number; count: number }>();
        for (const output of refundedOutputs) {
            const key = String(output.jobId);
            const current = refundsByJob.get(key) ?? { amount: 0, count: 0 };
            current.amount += output.chargeAmount || 0;
            current.count += 1;
            refundsByJob.set(key, current);
        }
        const items = [
            ...imageItems.map(job =>
                this.imageUsageRecord(
                    job,
                    costsByJob.get(String(job.id)) ?? [],
                    refundsByJob.get(String(job.id)),
                ),
            ),
            ...promptItems.map(prompt => this.promptUsageRecord(prompt)),
        ]
            .sort((left, right) => {
                const created = right.createdAt.getTime() - left.createdAt.getTime();
                return created || String(right.id).localeCompare(String(left.id));
            })
            .slice(options.skip, prefetch);
        return { items, totalItems: imageTotal + promptTotal };
    }

    async adminUsageRecordDetail(ctx: RequestContext, recordType: string, id: ID) {
        if (recordType === 'IMAGE_GENERATION') return this.imageUsageRecordDetail(ctx, id);
        if (recordType === 'PROMPT_OPTIMIZATION') return this.promptUsageRecordDetail(ctx, id);
        throw new UserInputError('使用记录类型无效');
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
        job.customerDeletedAt = new Date();
        await this.connection
            .getRepository(ctx, ImageGenerationJob)
            .update({ id: job.id }, { customerDeletedAt: job.customerDeletedAt });
        if (job.referenceAssetId) await this.storage.deleteOwned(ctx, job.referenceAssetId, customer.id);
        return true;
    }

    async purgeSensitiveRecords(): Promise<number> {
        // 提示词和计费调用记录按审计策略长期保留；合规删除必须走单独授权流程。
        return 0;
    }

    async complianceAnonymizeCustomer(ctx: RequestContext, customerId: ID, reason: string) {
        const note = reason.trim();
        if (!note || note.length > 500) throw new UserInputError('合规处理原因不能为空且不能超过 500 个字符');
        const jobs = await this.connection.getRepository(ctx, ImageGenerationJob).find({
            where: { channelId: ctx.channelId, customerId },
            relations: { outputs: { asset: true }, referenceAsset: true },
        });
        if (jobs.some(job => ['QUEUED', 'RUNNING', 'UNKNOWN'].includes(job.state))) {
            throw new UserInputError('该客户仍有进行中或待确认任务，不能执行合规匿名化');
        }
        for (const job of jobs) {
            for (const output of job.outputs) {
                if (output.assetId) await this.storage.deleteOwned(ctx, output.assetId, customerId);
            }
            if (job.referenceAssetId) await this.storage.deleteOwned(ctx, job.referenceAssetId, customerId);
        }
        return this.connection.withTransaction(ctx, async txCtx => {
            const promptResult = await this.connection
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
            const jobResult = await this.connection
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
                await this.connection
                    .getRepository(txCtx, ImageGenerationOutput)
                    .update(
                        { jobId: job.id },
                        { providerRequestId: null, errorMessage: null, assetId: null },
                    );
            }
            const event = await this.connection.getRepository(txCtx, ImageComplianceAuditEvent).save(
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
        const credential = output.job.providerCredentialCodeSnapshot
            ? await this.configService.credentialByCode(ctx, output.job.providerCredentialCodeSnapshot)
            : await this.configService.requireCredential(
                  ctx,
                  output.job.providerScopeSnapshot as ImageProviderScope,
                  output.job.modelConfigId,
                  'IMAGE',
              );
        if (!credential) throw new UserInputError('原任务使用的 Key 已归档，不能安全重试');
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
        const note = reason.trim();
        if (!note || note.length > 300) throw new UserInputError('退款原因不能为空且不能超过 300 个字符');
        await this.connection.withTransaction(ctx, async txCtx => {
            if (output.billingMode === 'FREE') {
                if (!output.job.quotaEventId) throw new UserInputError('该图片缺少免费额度记录');
                await this.quota.refundConsumed(txCtx, output.job.quotaEventId, 1);
                output.job.freeQuantityCaptured = Math.max(0, output.job.freeQuantityCaptured - 1);
                await this.connection
                    .getRepository(txCtx, ImageGenerationJob)
                    .save(output.job, { reload: false });
            } else {
                const walletUsageId = output.job.walletUsageId;
                if (!walletUsageId) throw new UserInputError('该图片缺少返利余额结算记录');
                await this.walletSpend.refundCaptured(txCtx, {
                    usageId: walletUsageId,
                    amount: output.chargeAmount || output.job.unitPriceSnapshot,
                    operationKey: `ADMIN_REFUND:${String(output.id)}`,
                    actorId: txCtx.activeUserId,
                    actorType: 'ADMIN',
                    metadata: { jobId: String(output.job.id), outputId: String(output.id), reason: note },
                });
            }
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

    async settleSuccessfulOutput(
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
            if (job.freeQuantityCaptured < job.freeQuantityReserved && job.quotaEventId) {
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
        const resolution = String(input.resolution).toUpperCase();
        if (!isImageResolution(resolution)) throw new UserInputError('图片清晰度无效');
        if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_GENERATION_COUNT)
            throw new UserInputError('每次只能生成 1 至 4 张图片');
        if (!Number.isSafeInteger(input.expectedUnitPrice) || input.expectedUnitPrice < 0)
            throw new UserInputError('预期价格无效');
        if (!Number.isSafeInteger(input.expectedChargeAmount) || input.expectedChargeAmount < 0)
            throw new UserInputError('预期结算金额无效');
        if (!input.termsAccepted) throw new UserInputError('请先同意 AI 图片服务条款');
        const idempotencyKey = input.idempotencyKey.trim();
        if (!/^[a-zA-Z0-9._:-]{8,64}$/u.test(idempotencyKey)) throw new UserInputError('请求幂等键无效');
        const referenceMode = normalizeReferenceMode(input.referenceMode);
        return { ...input, prompt, optimizedPrompt, idempotencyKey, referenceMode, resolution };
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
            job.resolution !== input.resolution ||
            job.quantity !== input.quantity ||
            job.unitPriceSnapshot !== input.expectedUnitPrice ||
            job.expectedChargeAmount !== input.expectedChargeAmount ||
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
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, ImageGenerationOutput);
            const completedAt = new Date();
            const transition = await repository.update(
                { id: output.id, state: In(fromStates), walletSettled: false },
                {
                    state: targetState,
                    errorMessage: message.slice(0, 500),
                    completedAt,
                    walletSettled: true,
                    billingMode: 'RELEASED',
                    chargeAmount: 0,
                },
            );
            if (transition.affected !== 1) return false;
            output.state = targetState;
            output.errorMessage = message.slice(0, 500);
            output.completedAt = completedAt;
            output.walletSettled = true;
            output.billingMode = 'RELEASED';
            output.chargeAmount = 0;
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
                    ? Math.max(
                          0,
                          walletUsage.amount - walletUsage.capturedAmount - walletUsage.releasedAmount,
                      )
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

    private imageUsageRecord(
        job: ImageGenerationJob,
        costs: ImageGenerationCostEvent[],
        refundInfo?: { amount: number; count: number },
    ) {
        const knownCost = costs.reduce((sum, event) => sum + (event.actualCostMicrounits ?? 0), 0);
        const costCurrencies = [...new Set(costs.map(event => event.costCurrency).filter(Boolean))];
        const billingMode = refundInfo
            ? 'REFUNDED'
            : job.freeQuantityReserved > 0 && job.paidQuantityReserved > 0
              ? 'MIXED'
              : job.paidQuantityReserved > 0
                ? 'PAID'
                : 'FREE';
        return {
            id: job.id,
            recordType: 'IMAGE_GENERATION',
            createdAt: job.createdAt,
            customer: job.customer,
            channelId: job.channelId,
            modelCode: job.modelCodeSnapshot,
            credentialCode: job.providerCredentialCodeSnapshot,
            credentialName: job.providerCredentialNameSnapshot,
            credentialLast4: job.providerCredentialLast4Snapshot,
            state: job.state,
            billingMode,
            freeQuantity: job.freeQuantityReserved,
            paidQuantity: job.paidQuantityReserved,
            chargedAmount: job.capturedAmount,
            refundedAmount: refundInfo?.amount ?? 0,
            currencyCode: job.currencyCode,
            actualCostMicrounits: costs.some(event => event.actualCostMicrounits != null) ? knownCost : null,
            costCurrency: costCurrencies.length === 1 ? costCurrencies[0] : null,
            missingCost: costs.some(event => event.actualCostMicrounits == null),
            errorMessage: job.errorMessage ?? costs.find(event => event.errorMessage)?.errorMessage ?? null,
        };
    }

    private promptUsageRecord(prompt: ImagePromptOptimization) {
        const state = prompt.source === 'PENDING' ? 'PENDING' : prompt.errorMessage ? 'FAILED' : 'SUCCEEDED';
        return {
            id: prompt.id,
            recordType: 'PROMPT_OPTIMIZATION',
            createdAt: prompt.createdAt,
            customer: prompt.customer,
            channelId: prompt.channelId,
            modelCode: prompt.recommendedModelCode,
            credentialCode: prompt.credentialCodeSnapshot,
            credentialName: prompt.credentialNameSnapshot,
            credentialLast4: prompt.credentialLast4Snapshot,
            state,
            billingMode: prompt.billingMode,
            freeQuantity: prompt.quotaEventId ? 1 : 0,
            paidQuantity: prompt.walletUsageId ? 1 : 0,
            chargedAmount: prompt.chargedAmount,
            refundedAmount: prompt.billingMode === 'REFUNDED' ? prompt.chargedAmount : 0,
            currencyCode: prompt.currencyCode,
            actualCostMicrounits: prompt.actualCostMicrounits,
            costCurrency: prompt.costCurrency,
            missingCost: prompt.upstreamCallCount > 0 && prompt.actualCostMicrounits == null,
            errorMessage: prompt.errorMessage,
        };
    }

    private async imageUsageRecordDetail(ctx: RequestContext, id: ID) {
        const job = await this.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: { id, channelId: ctx.channelId },
            relations: { customer: true, outputs: true },
        });
        if (!job) throw new UserInputError('找不到该生图使用记录');
        const costs = await this.connection.getRepository(ctx, ImageGenerationCostEvent).find({
            where: { channelId: ctx.channelId, jobIdSnapshot: String(job.id) },
            order: { createdAt: 'ASC', attemptNumber: 'ASC' },
        });
        const wallet = job.walletUsageId
            ? await this.connection.getRepository(ctx, ReferralWalletUsage).findOne({
                  where: { id: job.walletUsageId, channelId: ctx.channelId },
              })
            : null;
        const timeline = await this.quotaTimeline(ctx, [String(job.id), job.idempotencyKey]);
        timeline.push({
            at: job.createdAt,
            stage: '提交任务',
            status: '已提交',
            amount: job.expectedChargeAmount,
            currencyCode: job.currencyCode,
            costMicrounits: null,
            message: `请求 ${job.quantity} 张，预计免费 ${job.freeQuantityReserved} 张、付费 ${job.paidQuantityReserved} 张`,
            keyName: null,
            keyLast4: null,
        });
        if (job.providerCredentialCodeSnapshot) {
            timeline.push({
                at: job.createdAt,
                stage: '选择 Key',
                status: '已选择',
                amount: null,
                currencyCode: null,
                costMicrounits: null,
                message: job.providerSelectionReason ?? '按优先级和权重选择',
                keyName: job.providerCredentialNameSnapshot,
                keyLast4: job.providerCredentialLast4Snapshot,
            });
        }
        if (wallet) appendWalletTimeline(timeline, wallet);
        for (const cost of costs) {
            timeline.push({
                at: cost.createdAt,
                stage: '上游调用',
                status: usageOutcomeZh(cost.outcome),
                amount: null,
                currencyCode: null,
                costMicrounits: cost.actualCostMicrounits,
                message: [
                    `第 ${cost.attemptNumber} 次尝试`,
                    cost.httpStatus ? `HTTP ${cost.httpStatus}` : '',
                    `${cost.latencyMs}ms`,
                    cost.providerRequestId ? `上游请求 ${cost.providerRequestId}` : '',
                    cost.errorMessage ?? '',
                ]
                    .filter(Boolean)
                    .join(' · '),
                keyName: cost.credentialNameSnapshot,
                keyLast4: cost.credentialLast4Snapshot,
            });
        }
        for (const output of job.outputs) {
            const refundMessage = output.refundedAt ? '，已人工退款' : '';
            const outputErrorMessage = output.errorMessage ? `：${output.errorMessage}` : '';
            timeline.push({
                at: output.completedAt ?? output.updatedAt,
                stage: '结果保存',
                status: usageOutcomeZh(output.state),
                amount: output.chargeAmount,
                currencyCode: job.currencyCode,
                costMicrounits: null,
                message:
                    `第 ${output.outputIndex + 1} 张，${billingModeZhForAudit(output.billingMode)}` +
                    `${refundMessage}${outputErrorMessage}`,
                keyName: null,
                keyLast4: null,
            });
        }
        if (job.completedAt) {
            timeline.push({
                at: job.completedAt,
                stage: '任务结算',
                status: usageOutcomeZh(job.state),
                amount: job.capturedAmount,
                currencyCode: job.currencyCode,
                costMicrounits: null,
                message: `实扣 ${job.capturedAmount}，释放或退回 ${job.releasedAmount}`,
                keyName: null,
                keyLast4: null,
            });
        }
        return {
            record: this.imageUsageRecord(job, costs),
            inputPrompt: job.originalPrompt,
            outputPrompt: job.finalPrompt,
            totalTokens: null,
            providerRequestIds: [...new Set(costs.map(cost => cost.providerRequestId).filter(Boolean))],
            outputs: job.outputs.map(output => ({
                id: output.id,
                state: output.state,
                billingMode: output.billingMode,
                chargeAmount: output.chargeAmount,
                providerRequestId: output.providerRequestId,
                errorMessage: output.errorMessage,
                refundedAt: output.refundedAt,
            })),
            timeline: sortUsageTimeline(timeline),
        };
    }

    private async promptUsageRecordDetail(ctx: RequestContext, id: ID) {
        const prompt = await this.connection.getRepository(ctx, ImagePromptOptimization).findOne({
            where: { id, channelId: ctx.channelId },
            relations: { customer: true },
        });
        if (!prompt) throw new UserInputError('找不到该提示词使用记录');
        const wallet = prompt.walletUsageId
            ? await this.connection.getRepository(ctx, ReferralWalletUsage).findOne({
                  where: { id: prompt.walletUsageId, channelId: ctx.channelId },
              })
            : null;
        const timeline = await this.quotaTimeline(ctx, [String(prompt.id), prompt.idempotencyKey ?? '']);
        timeline.push({
            at: prompt.createdAt,
            stage: '提交优化',
            status: '已提交',
            amount: prompt.billingMode === 'PAID' ? prompt.chargedAmount : 0,
            currencyCode: prompt.currencyCode,
            costMicrounits: null,
            message: billingModeZhForAudit(prompt.billingMode),
            keyName: null,
            keyLast4: null,
        });
        if (prompt.credentialCodeSnapshot) {
            timeline.push({
                at: prompt.createdAt,
                stage: '选择 Key',
                status: '已选择',
                amount: null,
                currencyCode: null,
                costMicrounits: null,
                message: prompt.credentialSelectionReason ?? '按优先级和权重选择',
                keyName: prompt.credentialNameSnapshot,
                keyLast4: prompt.credentialLast4Snapshot,
            });
        }
        if (wallet) appendWalletTimeline(timeline, wallet);
        timeline.push({
            at: prompt.updatedAt,
            stage: '上游优化',
            status: prompt.errorMessage ? '已回退本地规则' : '成功',
            amount: prompt.chargedAmount,
            currencyCode: prompt.currencyCode,
            costMicrounits: prompt.actualCostMicrounits,
            message: [
                `调用 ${prompt.upstreamCallCount} 次`,
                `${prompt.latencyMs}ms`,
                prompt.providerRequestId ? `上游请求 ${prompt.providerRequestId}` : '',
                prompt.errorMessage ?? '',
            ]
                .filter(Boolean)
                .join(' · '),
            keyName: prompt.credentialNameSnapshot || null,
            keyLast4: prompt.credentialLast4Snapshot || null,
        });
        return {
            record: this.promptUsageRecord(prompt),
            inputPrompt: prompt.inputPrompt,
            outputPrompt: prompt.optimizedPrompt,
            totalTokens: prompt.totalTokens,
            providerRequestIds: prompt.providerRequestId ? [prompt.providerRequestId] : [],
            outputs: [],
            timeline: sortUsageTimeline(timeline),
        };
    }

    private async quotaTimeline(ctx: RequestContext, resourceIds: string[]) {
        const ids = [...new Set(resourceIds.filter(Boolean))];
        if (!ids.length) return [];
        const events = await this.connection.getRepository(ctx, ImageUsageQuotaEvent).find({
            where: { resourceId: In(ids) },
            order: { createdAt: 'ASC' },
        });
        const bucketIds = [...new Set(events.map(event => event.bucketId))];
        const buckets = bucketIds.length
            ? await this.connection.getRepository(ctx, ImageUsageQuotaBucket).find({
                  where: { id: In(bucketIds), channelId: ctx.channelId },
              })
            : [];
        const bucketById = new Map(buckets.map(bucket => [String(bucket.id), bucket]));
        const timeline: UsageTimelineItem[] = [];
        for (const event of events) {
            const bucket = bucketById.get(String(event.bucketId));
            if (!bucket) continue;
            timeline.push({
                at: event.createdAt,
                stage: '额度预占',
                status: '已预占',
                amount: event.amount,
                currencyCode: null,
                costMicrounits: null,
                message: `${quotaTypeZh(bucket.quotaType)} · 窗口 ${bucket.windowKey}`,
                keyName: null,
                keyLast4: null,
            });
            if (event.consumedAt && event.consumedAmount > 0) {
                timeline.push({
                    at: event.consumedAt,
                    stage: '额度消耗',
                    status: '已消耗',
                    amount: event.consumedAmount,
                    currencyCode: null,
                    costMicrounits: null,
                    message: quotaTypeZh(bucket.quotaType),
                    keyName: null,
                    keyLast4: null,
                });
            }
            if (event.releasedAt && event.releasedAmount > 0) {
                timeline.push({
                    at: event.releasedAt,
                    stage: '额度释放',
                    status: '已退回',
                    amount: event.releasedAmount,
                    currencyCode: null,
                    costMicrounits: null,
                    message: quotaTypeZh(bucket.quotaType),
                    keyName: null,
                    keyLast4: null,
                });
            }
        }
        return timeline;
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('找不到当前客户');
        return customer;
    }
}

export interface UsageTimelineItem {
    at: Date;
    stage: string;
    status: string;
    amount: number | null;
    currencyCode: string | null;
    costMicrounits: number | null;
    message: string;
    keyName: string | null;
    keyLast4: string | null;
}

type NormalizedUsageRecordInput = {
    skip: number;
    take: number;
    recordType: 'PROMPT_OPTIMIZATION' | 'IMAGE_GENERATION' | null;
    from: Date | null;
    to: Date | null;
    customer: string;
    modelCode: string;
    credentialCode: string;
    state: string;
    billingMode: string;
    failuresOnly: boolean;
    missingCostOnly: boolean;
};

function normalizeUsageRecordInput(input: ImageAiUsageRecordListInput): NormalizedUsageRecordInput {
    const recordType = input.recordType ?? null;
    if (recordType && !['PROMPT_OPTIMIZATION', 'IMAGE_GENERATION'].includes(recordType)) {
        throw new UserInputError('使用记录类型无效');
    }
    const from = optionalAuditDate(input.from, '开始时间');
    const to = optionalAuditDate(input.to, '结束时间');
    if (from && to && from > to) throw new UserInputError('开始时间不能晚于结束时间');
    return {
        skip: Math.min(10_000, Math.max(0, Math.floor(input.skip ?? 0))),
        take: Math.min(100, Math.max(1, Math.floor(input.take ?? 30))),
        recordType,
        from,
        to,
        customer: input.customer?.trim().slice(0, 160) ?? '',
        modelCode: input.modelCode?.trim().slice(0, 48) ?? '',
        credentialCode: input.credentialCode?.trim().slice(0, 64) ?? '',
        state: input.state?.trim().slice(0, 32) ?? '',
        billingMode: input.billingMode?.trim().slice(0, 16) ?? '',
        failuresOnly: input.failuresOnly === true,
        missingCostOnly: input.missingCostOnly === true,
    };
}

function optionalAuditDate(value: Date | string | null | undefined, label: string): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new UserInputError(`${label}无效`);
    return date;
}

function applyUsageDateAndCustomerFilters<T extends ObjectLiteral>(
    query: SelectQueryBuilder<T>,
    alias: 'job' | 'prompt',
    options: NormalizedUsageRecordInput,
): void {
    if (options.from) query.andWhere(`${alias}.createdAt >= :from`, { from: options.from });
    if (options.to) query.andWhere(`${alias}.createdAt <= :to`, { to: options.to });
    if (!options.customer) return;
    const customerTerm = `%${options.customer.toLowerCase()}%`;
    query.andWhere(
        new Brackets(where => {
            where
                .where('LOWER(customer.emailAddress) LIKE :customerTerm', { customerTerm })
                .orWhere('LOWER(customer.firstName) LIKE :customerTerm', { customerTerm })
                .orWhere('LOWER(customer.lastName) LIKE :customerTerm', { customerTerm });
            if (/^\d+$/u.test(options.customer)) {
                where.orWhere('customer.id = :customerId', { customerId: options.customer });
            }
        }),
    );
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
        const key = keyFor(item);
        grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return grouped;
}

function appendWalletTimeline(timeline: UsageTimelineItem[], wallet: ReferralWalletUsage): void {
    timeline.push({
        at: wallet.reservedAt,
        stage: '余额预冻结',
        status: '已冻结',
        amount: wallet.amount,
        currencyCode: wallet.currencyCode,
        costMicrounits: null,
        message: `余额使用记录 ${String(wallet.id)}`,
        keyName: null,
        keyLast4: null,
    });
    if (!wallet.settledAt) return;
    timeline.push({
        at: wallet.settledAt,
        stage: '余额结算',
        status: wallet.releasedAmount > 0 && wallet.capturedAmount === 0 ? '已退回' : '已结算',
        amount: wallet.capturedAmount,
        currencyCode: wallet.currencyCode,
        costMicrounits: null,
        message: `实扣 ${wallet.capturedAmount} · 退回 ${wallet.releasedAmount}`,
        keyName: null,
        keyLast4: null,
    });
}

function sortUsageTimeline(items: UsageTimelineItem[]): UsageTimelineItem[] {
    return items.sort((left, right) => left.at.getTime() - right.at.getTime());
}

function usageOutcomeZh(value: string): string {
    return (
        (
            {
                QUEUED: '排队中',
                RUNNING: '进行中',
                PARTIAL_SUCCESS: '部分成功',
                SUCCEEDED: '成功',
                FAILED: '失败',
                UNKNOWN: '结果待确认',
                CANCELLED: '已取消',
                RETRY: '已重试',
            } as Record<string, string>
        )[value] ?? value
    );
}

function billingModeZhForAudit(value: string): string {
    return (
        (
            {
                FREE: '免费额度',
                PAID: '付费',
                MIXED: '免费+付费',
                PENDING: '待结算',
                RELEASED: '已释放',
                REFUNDED: '已退款',
            } as Record<string, string>
        )[value] ?? value
    );
}

function quotaTypeZh(value: string): string {
    return (
        (
            {
                PROMPT_MINUTE: '提示词每分钟额度',
                PROMPT_DAILY_FREE: '提示词每日免费额度',
                IMAGE_DAILY_FREE: '每日免费生图额度',
                IMAGE_DAILY_SAFETY: '每日生图安全上限',
            } as Record<string, string>
        )[value] ?? value
    );
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
