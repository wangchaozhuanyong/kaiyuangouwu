import { ID } from '@vendure/common/lib/shared-types';
import { Customer, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { ReferralWalletSpendService } from '@vendure/store-management-plugin';
import { In } from 'typeorm';

import { MAX_ACTIVE_GENERATION_JOBS } from './constants';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { imagePricingSnapshot, quoteImageMoney } from './image-billing-quote';
import {
    ImageGenerationConfigService,
    modelReady,
    providerScopeForModel,
} from './image-generation-config.service';
import { supportsGenerationLock } from './image-generation-helpers';
import { ImageGenerationJobViews } from './image-generation-job-views';
import { ImageGenerationRequestPolicy } from './image-generation-request-policy';
import { imageDispatchReadyAt } from './image-generation-state';
import { resolutionPrice, supportsNativeResolution } from './image-resolution';
import { ImageUsageQuotaService } from './image-usage-quota.service';
import { ImagePromptEngineService } from './prompt/image-prompt-engine.service';
import { promptLanguageFromLanguageCode, PromptRulesService } from './prompt/prompt-rules.service';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';
import { CreateImageGenerationInput } from './types';
interface ImageCreationDependencies {
    connection: TransactionalConnection;
    configService: ImageGenerationConfigService;
    rules: PromptRulesService;
    promptEngine: ImagePromptEngineService;
    storage: ImagePrivateStorageService;
    quota: ImageUsageQuotaService;
    walletSpend: ReferralWalletSpendService;
    activeCustomer: (ctx: RequestContext) => Promise<Customer>;
    findMine: (ctx: RequestContext, id: ID) => ReturnType<ImageGenerationJobViews['jobView']>;
    enqueueOutput?: (outputId: ID) => Promise<void>;
}
/** Creates customer jobs atomically and dispatches only after commit. */
export class ImageGenerationCreation {
    constructor(
        private readonly dependencies: ImageCreationDependencies,
        private readonly requests: ImageGenerationRequestPolicy,
        private readonly views: ImageGenerationJobViews,
    ) {}
    async create(ctx: RequestContext, input: CreateImageGenerationInput) {
        const customer = await this.dependencies.activeCustomer(ctx);
        const normalized = this.requests.validateCreateInput(
            input,
            promptLanguageFromLanguageCode(ctx.languageCode),
        );
        const existing = await this.dependencies.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: {
                channelId: ctx.channelId,
                customerId: customer.id,
                idempotencyKey: normalized.idempotencyKey,
            },
            relations: { outputs: { asset: true }, referenceAsset: true },
        });
        if (existing) {
            this.requests.assertSameCreateRequest(existing, normalized);
            return this.views.jobView(ctx, existing, customer.id);
        }
        if (!(await this.dependencies.configService.shopConfig(ctx)).enabled) {
            throw new UserInputError('当前店铺的 AI 图片工坊不可用');
        }
        let created: ImageGenerationJob;
        try {
            created = await this.dependencies.connection.withTransaction(ctx, async txCtx => {
                if (supportsGenerationLock(this.dependencies.connection.rawConnection.options.type)) {
                    await this.dependencies.connection
                        .getRepository(txCtx, Customer)
                        .createQueryBuilder('customer')
                        .setLock('pessimistic_write')
                        .where('customer.id = :id', { id: customer.id })
                        .getOne();
                }
                const activeJobCount = await this.dependencies.connection
                    .getRepository(txCtx, ImageGenerationJob)
                    .count({
                        where: {
                            channelId: txCtx.channelId,
                            customerId: customer.id,
                            state: In(['QUEUED', 'RUNNING', 'UNKNOWN']),
                        },
                    });
                if (activeJobCount >= MAX_ACTIVE_GENERATION_JOBS) {
                    throw new UserInputError(`同时进行的生图任务不能超过 ${MAX_ACTIVE_GENERATION_JOBS} 个`);
                }
                const config = await this.dependencies.connection
                    .getRepository(txCtx, ImageGenerationConfig)
                    .findOne({
                        where: { channelId: txCtx.channelId },
                    });
                if (!config?.enabled) throw new UserInputError('当前店铺尚未开启 AI 图片工坊');
                await this.dependencies.configService.assertStorefrontEntryEnabled(txCtx);
                const model = await this.dependencies.connection
                    .getRepository(txCtx, ImageModelConfig)
                    .findOne({
                        where: { channelId: txCtx.channelId, code: normalized.modelCode, enabled: true },
                    });
                if (!model || !modelReady(model)) throw new UserInputError('所选模型当前不可用');
                const providerScope = providerScopeForModel(model.protocol, model.providerModelId);
                const credentialRoute = await this.dependencies.configService.routeCredential(
                    txCtx,
                    providerScope,
                    model.id,
                    'IMAGE',
                );
                const credential = credentialRoute.credential;
                const credentialFingerprint =
                    this.dependencies.configService.credentialFingerprint(credential);
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
                    ? await this.dependencies.connection.getRepository(txCtx, ImagePrivateAsset).find({
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
                    await this.dependencies.storage.retainReferenceWhileActive(txCtx, asset.id);
                }
                const promptSpec = this.dependencies.rules.fallbackSpec(
                    normalized.prompt,
                    normalized.referenceMode,
                    normalized.promptLanguage,
                );
                const finalPrompt = this.requests.compileFinalPrompt(normalized, promptSpec);
                this.dependencies.promptEngine.assertSafe(finalPrompt);
                const safetyEvent = await this.dependencies.quota.reserve(txCtx, {
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
                await this.dependencies.quota.capture(txCtx, safetyEvent.id, normalized.quantity);
                const job = await this.dependencies.connection.getRepository(txCtx, ImageGenerationJob).save(
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
                            inputSnapshot: {
                                version: 1,
                                optimizedPrompt: normalized.optimizedPrompt || null,
                            },
                        } as unknown as Record<string, any>,
                        promptSkillHash: this.dependencies.rules.sourceHash,
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
                    ? await this.dependencies.quota.reserve(txCtx, {
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
                    const usage = await this.dependencies.walletSpend.reserve(txCtx, {
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
                await this.dependencies.connection
                    .getRepository(txCtx, ImageGenerationJob)
                    .save(job, { reload: false });
                const outputs: ImageGenerationOutput[] = [];
                for (let outputIndex = 0; outputIndex < normalized.quantity; outputIndex++) {
                    const output = await this.dependencies.connection
                        .getRepository(txCtx, ImageGenerationOutput)
                        .save(
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
                    await this.dependencies.connection.getRepository(txCtx, ImageGenerationDispatch).save(
                        new ImageGenerationDispatch({
                            outputId: output.id,
                            state: 'PENDING',
                            attemptCount: 0,
                            nextAttemptAt: imageDispatchReadyAt(),
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
            const raced = await this.dependencies.connection.getRepository(ctx, ImageGenerationJob).findOne({
                where: {
                    channelId: ctx.channelId,
                    customerId: customer.id,
                    idempotencyKey: normalized.idempotencyKey,
                },
                relations: { outputs: { asset: true }, referenceAsset: true },
            });
            if (!raced) throw error;
            this.requests.assertSameCreateRequest(raced, normalized);
            return this.views.jobView(ctx, raced, customer.id);
        }

        if (this.dependencies.enqueueOutput) {
            for (const output of created.outputs) {
                await this.dependencies.enqueueOutput(output.id).catch(() => undefined);
            }
        }
        return this.dependencies.findMine(ctx, created.id);
    }
}
