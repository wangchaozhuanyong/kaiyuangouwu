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
import { In, IsNull, MoreThan, MoreThanOrEqual } from 'typeorm';

import {
    IMAGE_UNKNOWN_MAX_AGE_MS,
    MAX_ACTIVE_GENERATION_JOBS,
    MAX_ACTIVE_REFERENCE_ASSETS,
    MAX_ACTIVE_REFERENCE_BYTES,
    MAX_GENERATION_COUNT,
    MAX_PROMPT_LENGTH,
    MAX_REFERENCE_BYTES,
    MAX_REFERENCE_IMAGES_PER_JOB,
    MAX_REFERENCE_INSTRUCTION_LENGTH,
    MAX_REFERENCE_UPLOADS_PER_DAY,
    MAX_REFERENCE_UPLOADS_PER_MINUTE,
    supportedAspectRatios,
} from './constants';
import { ImageComplianceAuditEvent } from './entities/image-compliance-audit-event.entity';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { ImagePromptOptimization } from './entities/image-prompt-optimization.entity';
import { imagePricingSnapshot, quoteImageMoney } from './image-billing-quote';
import {
    ImageGenerationConfigService,
    modelReady,
    providerScopeForModel,
} from './image-generation-config.service';
import {
    normalizeReferenceMode,
    publicOutputError,
    referenceModeInstruction,
    storedReferenceAssetIds,
    storedReferenceInstruction,
    supportsGenerationLock,
    uniqueReferenceAssetIds,
} from './image-generation-helpers';
import { deriveImageJobSettlement, hasStaleImageOutput } from './image-generation-state';
import { ImageGenerationUsageQuery } from './image-generation-usage-query';
import { isImageResolution, resolutionPrice, supportsNativeResolution } from './image-resolution';
import { ImageUsageQuotaService } from './image-usage-quota.service';
import { ImagePromptEngineService, startOfBeijingDay } from './prompt/image-prompt-engine.service';
import {
    detectPromptLanguage,
    promptLanguageFromLanguageCode,
    PromptRulesService,
    type PromptOutputLanguage,
} from './prompt/prompt-rules.service';
import { ImagePrivateStorageService, UploadedImageFile } from './storage/image-private-storage.service';
import { CreateImageGenerationInput, ImageAiUsageRecordListInput, ImageProviderScope } from './types';

@Injectable()
export class ImageGenerationService {
    private enqueueOutput?: (outputId: ID) => Promise<void>;
    private readonly usageQuery: ImageGenerationUsageQuery;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly walletSpend: ReferralWalletSpendService,
        private readonly configService: ImageGenerationConfigService,
        private readonly quota: ImageUsageQuotaService,
        private readonly promptEngine: ImagePromptEngineService,
        private readonly rules: PromptRulesService,
        private readonly storage: ImagePrivateStorageService,
    ) {
        this.usageQuery = new ImageGenerationUsageQuery(connection);
    }

    registerEnqueuer(enqueue: (outputId: ID) => Promise<void>): void {
        this.enqueueOutput = enqueue;
    }

    async create(ctx: RequestContext, input: CreateImageGenerationInput) {
        const customer = await this.activeCustomer(ctx);
        const normalized = this.validateCreateInput(input, promptLanguageFromLanguageCode(ctx.languageCode));
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
                const loadedReferences = normalized.referenceAssetIds.length
                    ? await this.connection.getRepository(txCtx, ImagePrivateAsset).find({
                          where: {
                              id: In(normalized.referenceAssetIds),
                              channelId: txCtx.channelId,
                              customerId: customer.id,
                              kind: 'REFERENCE',
                          },
                      })
                    : [];
                const referencesById = new Map(loadedReferences.map(asset => [String(asset.id), asset]));
                const references = normalized.referenceAssetIds.map(id => referencesById.get(String(id)));
                if (
                    references.some(
                        asset => !asset || asset.deletedAt || asset.expiresAt.getTime() <= Date.now(),
                    )
                ) {
                    throw new UserInputError('参考图不存在或已过期');
                }
                const validReferences = references as ImagePrivateAsset[];
                const reference = validReferences[0] ?? null;
                if ((normalized.referenceMode === 'NONE') !== !validReferences.length) {
                    throw new UserInputError('参考图和参考模式必须同时设置');
                }
                for (const asset of validReferences) {
                    await this.storage.retainReferenceWhileActive(txCtx, asset.id);
                }
                const promptSpec = this.rules.fallbackSpec(
                    normalized.prompt,
                    normalized.referenceMode,
                    normalized.promptLanguage,
                );
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
                        promptSpec: {
                            ...promptSpec,
                            referenceAssetIds: normalized.referenceAssetIds.map(String),
                            referenceInstruction: normalized.referenceInstruction || null,
                        } as unknown as Record<string, any>,
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
        const repository = this.connection.getRepository(ctx, ImageGenerationJob);
        let job = await repository.findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id, customerDeletedAt: IsNull() },
            relations: { outputs: { asset: true }, referenceAsset: true },
            order: { outputs: { outputIndex: 'ASC' } },
        });
        if (!job) throw new UserInputError('找不到生图任务');
        const cutoff = this.staleOutputCutoff();
        if (hasStaleImageOutput(job.outputs, cutoff)) {
            await this.reconcileStaleOutputs(ctx, cutoff);
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
        return this.jobView(job, customer.id);
    }

    async findMineList(ctx: RequestContext, skip = 0, take = 20) {
        const customer = await this.activeCustomer(ctx);
        const repository = this.connection.getRepository(ctx, ImageGenerationJob);
        const options = {
            where: { channelId: ctx.channelId, customerId: customer.id, customerDeletedAt: IsNull() },
            relations: { outputs: { asset: true }, referenceAsset: true },
            order: { createdAt: 'DESC', id: 'DESC', outputs: { outputIndex: 'ASC' } },
            skip: Math.max(0, Math.floor(skip || 0)),
            take: Math.min(50, Math.max(1, Math.floor(take || 20))),
        } as const;
        let [items, totalItems] = await repository.findAndCount(options);
        const cutoff = this.staleOutputCutoff();
        if (items.some(job => hasStaleImageOutput(job.outputs, cutoff))) {
            await this.reconcileStaleOutputs(ctx, cutoff);
            [items, totalItems] = await repository.findAndCount(options);
        }
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
        await this.reconcileStaleOutputs(ctx);
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ImageGenerationJob)
            .findAndCount({
                where: { channelId: ctx.channelId, ...(state ? { state } : {}) },
                relations: { outputs: { asset: true }, referenceAsset: true, customer: true },
                order: { createdAt: 'DESC', id: 'DESC', outputs: { outputIndex: 'ASC' } },
                skip: Math.max(0, Math.floor(skip || 0)),
                take: Math.min(100, Math.max(1, Math.floor(take || 50))),
            });
        return { items: items.map(job => this.jobView(job, job.customerId)), totalItems };
    }

    async adminUsageRecords(ctx: RequestContext, input: ImageAiUsageRecordListInput = {}) {
        await this.reconcileStaleOutputs(ctx);
        return this.usageQuery.adminUsageRecords(ctx, input);
    }

    async adminUsageRecordDetail(ctx: RequestContext, recordType: string, id: ID) {
        return this.usageQuery.adminUsageRecordDetail(ctx, recordType, id);
    }

    async adminCostSummary(ctx: RequestContext, days = 30) {
        return this.usageQuery.adminCostSummary(ctx, days);
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
        for (const referenceAssetId of storedReferenceAssetIds(job)) {
            await this.storage.deleteOwned(ctx, referenceAssetId, customer.id);
        }
        return true;
    }

    purgeSensitiveRecords(): number {
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
            for (const referenceAssetId of storedReferenceAssetIds(job)) {
                await this.storage.deleteOwned(ctx, referenceAssetId, customerId);
            }
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
                        { providerRequestId: null, errorMessage: null, failureCode: null, assetId: null },
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
        const transition = await this.connection.getRepository(ctx, ImageGenerationOutput).update(
            { id: output.id, state: 'UNKNOWN', walletSettled: false },
            {
                state: 'QUEUED',
                unknownAt: null,
                errorMessage: '管理员确认后使用相同幂等键重试',
                failureCode: null,
            },
        );
        if (transition.affected !== 1) throw new UserInputError('该输出状态已变更，请刷新后重试');
        output.state = 'QUEUED';
        output.unknownAt = null;
        output.errorMessage = '管理员确认后使用相同幂等键重试';
        output.failureCode = null;
        await this.connection.getRepository(ctx, ImageGenerationDispatch).upsert(
            {
                outputId: output.id,
                state: 'PENDING',
                attemptCount: 0,
                nextAttemptAt: new Date(),
                dispatchedAt: null,
                queueTaskId: null,
                processingStage: null,
                heartbeatAt: null,
                stagedAssetId: null,
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

    async failQueuedOutput(
        ctx: RequestContext,
        outputId: ID,
        message: string,
        failureCode?: string,
    ): Promise<void> {
        const output = await this.connection.getRepository(ctx, ImageGenerationOutput).findOne({
            where: { id: outputId },
            relations: { job: true },
        });
        if (!output) return;
        await this.transitionAndRelease(ctx, output.job, output, ['QUEUED'], 'FAILED', message, failureCode);
        await this.refreshJob(ctx, output.jobId);
    }

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

    async failRunningOutput(
        ctx: RequestContext,
        outputId: ID,
        message: string,
        failureCode?: string,
    ): Promise<boolean> {
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
            failureCode,
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
            .andWhere('COALESCE(output.unknownAt, output.updatedAt) <= :cutoff', { cutoff })
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
                'UNKNOWN_RESULT',
            );
            if (released) await this.refreshJob(ctx, output.jobId);
        }
        return outputs.filter(output => output.walletSettled).length;
    }

    async reconcileStaleOutputs(ctx: RequestContext, cutoff = this.staleOutputCutoff()): Promise<number> {
        const repository = this.connection.getRepository(ctx, ImageGenerationOutput);
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
        return this.releaseUnknownOlderThan(ctx, cutoff);
    }

    private staleOutputCutoff(): Date {
        return new Date(Date.now() - IMAGE_UNKNOWN_MAX_AGE_MS);
    }

    private validateCreateInput(
        input: CreateImageGenerationInput,
        fallbackLanguage: PromptOutputLanguage = 'en',
    ) {
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
        const referenceAssetIds = uniqueReferenceAssetIds(input);
        if (referenceAssetIds.length > MAX_REFERENCE_IMAGES_PER_JOB) {
            throw new UserInputError(`每次最多可以使用 ${MAX_REFERENCE_IMAGES_PER_JOB} 张参考图`);
        }
        const referenceInstruction = input.referenceInstruction?.trim() ?? '';
        if (referenceInstruction.length > MAX_REFERENCE_INSTRUCTION_LENGTH) {
            throw new UserInputError(`参考要求不能超过 ${MAX_REFERENCE_INSTRUCTION_LENGTH} 个字符`);
        }
        const referenceMode = normalizeReferenceMode(input.referenceMode);
        if (!referenceAssetIds.length && referenceInstruction) {
            throw new UserInputError('添加参考要求前请先上传参考图');
        }
        const promptLanguage = detectPromptLanguage(prompt, fallbackLanguage);
        return {
            ...input,
            prompt,
            optimizedPrompt,
            idempotencyKey,
            referenceAssetId: referenceAssetIds[0] ?? null,
            referenceAssetIds,
            referenceInstruction,
            referenceMode,
            resolution,
            promptLanguage,
        };
    }

    private assertSameCreateRequest(
        job: ImageGenerationJob,
        input: ReturnType<ImageGenerationService['validateCreateInput']>,
    ): void {
        const sameReference =
            storedReferenceAssetIds(job).join('|') === input.referenceAssetIds.map(String).join('|');
        const sameReferenceInstruction = storedReferenceInstruction(job) === input.referenceInstruction;
        const expectedPrompt = this.compileFinalPrompt(
            input,
            this.rules.fallbackSpec(input.prompt, input.referenceMode, input.promptLanguage),
        );
        const sameExplicitOptimizedPrompt = !input.optimizedPrompt || job.finalPrompt === expectedPrompt;
        if (
            job.modelCodeSnapshot !== input.modelCode ||
            job.originalPrompt !== input.prompt ||
            !sameExplicitOptimizedPrompt ||
            job.referenceMode !== input.referenceMode ||
            !sameReference ||
            !sameReferenceInstruction ||
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
        const base = input.optimizedPrompt || this.rules.render(promptSpec, input.promptLanguage);
        const referenceInstruction = referenceModeInstruction(input.referenceMode, input.promptLanguage);
        const isZh = input.promptLanguage === 'zh';
        const referenceLines = [
            input.referenceAssetIds.length > 1
                ? isZh
                    ? `参考图已按第 1 张至第 ${input.referenceAssetIds.length} 张的顺序附加。`
                    : `Reference images are attached in order from 1 to ${input.referenceAssetIds.length}.`
                : '',
            referenceInstruction
                ? `${isZh ? '参考图要求：' : 'Reference instruction: '}${referenceInstruction}`
                : '',
            input.referenceInstruction
                ? `${isZh ? '具体参考要求：' : 'Specific reference requirement: '}${input.referenceInstruction}`
                : '',
        ].filter(Boolean);
        const finalPrompt = referenceLines.length ? `${base}\n${referenceLines.join('\n')}` : base;
        if (finalPrompt.length > 8_000) throw new UserInputError('最终提示词超过 8000 个字符');
        return finalPrompt;
    }

    private transitionAndRelease(
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
                    billingMode: 'RELEASED',
                    chargeAmount: 0,
                },
            );
            if (transition.affected !== 1) return false;
            output.state = targetState;
            output.errorMessage = message.slice(0, 500);
            output.failureCode = failureCode?.slice(0, 48) ?? output.failureCode;
            output.completedAt = completedAt;
            output.walletSettled = true;
            output.billingMode = 'RELEASED';
            output.chargeAmount = 0;
            return true;
        });
    }

    async refreshJob(ctx: RequestContext, jobId: ID): Promise<void> {
        let terminalReferenceAssetIds: string[] = [];
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
            terminalReferenceAssetIds = settlement.terminal ? storedReferenceAssetIds(job) : [];
        });
        if (!terminalReferenceAssetIds.length) return;
        await this.connection.withTransaction(ctx, async txCtx => {
            const activeJobs = await this.connection.getRepository(txCtx, ImageGenerationJob).find({
                where: {
                    channelId: txCtx.channelId,
                    state: In(['QUEUED', 'RUNNING', 'UNKNOWN']),
                },
                select: { id: true, referenceAssetId: true, promptSpec: true },
            });
            const activeReferenceIds = new Set(activeJobs.flatMap(storedReferenceAssetIds));
            for (const referenceAssetId of terminalReferenceAssetIds) {
                if (activeReferenceIds.has(String(referenceAssetId))) continue;
                await this.storage.expireReferenceAfterTerminal(txCtx, referenceAssetId);
            }
        });
    }

    jobView(job: ImageGenerationJob, customerId: ID) {
        const outputs = job.outputs ?? [];
        return {
            ...job,
            errorMessage:
                outputs.map(publicOutputError).find((message): message is string => Boolean(message)) ?? null,
            referenceAsset: job.referenceAsset ? this.assetView(job.referenceAsset, customerId) : null,
            outputs: outputs.map(output => ({
                ...output,
                providerRequestId: null,
                errorMessage: publicOutputError(output),
                width: output.asset?.width ?? null,
                height: output.asset?.height ?? null,
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

export { referenceModeInstruction } from './image-generation-helpers';
