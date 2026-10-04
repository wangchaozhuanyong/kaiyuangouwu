import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    AssetService,
    isGraphQlErrorResult,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { Readable } from 'node:stream';
import { In, IsNull, MoreThan, MoreThanOrEqual } from 'typeorm';

import {
    MAX_ACTIVE_GENERATION_JOBS,
    MAX_ACTIVE_REFERENCE_ASSETS,
    MAX_ACTIVE_REFERENCE_BYTES,
    MAX_REFERENCE_BYTES,
    MAX_REFERENCE_UPLOADS_PER_DAY,
    MAX_REFERENCE_UPLOADS_PER_MINUTE,
} from './constants';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import {
    ImageGenerationConfigService,
    modelReady,
    providerScopeForModel,
} from './image-generation-config.service';
import { supportsGenerationLock } from './image-generation-helpers';
import { ImageGenerationJobViews } from './image-generation-job-views';
import { ImageGenerationRequestPolicy } from './image-generation-request-policy';
import { hasStaleImageOutput, imageDispatchReadyAt } from './image-generation-state';
import { supportsNativeResolution } from './image-resolution';
import { ImagePromptEngineService, startOfBeijingDay } from './prompt/image-prompt-engine.service';
import { PromptRulesService } from './prompt/prompt-rules.service';
import { ImagePrivateStorageService, UploadedImageFile } from './storage/image-private-storage.service';
import { CreateCatalogImageGenerationInput } from './types';

interface Dependencies {
    connection: TransactionalConnection;
    configService: ImageGenerationConfigService;
    rules: PromptRulesService;
    promptEngine: ImagePromptEngineService;
    storage: ImagePrivateStorageService;
    assetService: AssetService;
    assertCatalogImagePermissions: (ctx: RequestContext) => void;
    activeAdministratorId: (ctx: RequestContext) => ID;
    lockAdministrator: (ctx: RequestContext, id: ID) => Promise<void>;
    staleOutputCutoff: () => Date;
    reconcileStaleOutputs: (ctx: RequestContext, cutoff?: Date) => Promise<number>;
    catalogConfig: (ctx: RequestContext) => ReturnType<ImageGenerationCatalog['catalogConfig']>;
    catalogGeneration: (
        ctx: RequestContext,
        id: ID,
    ) => ReturnType<ImageGenerationCatalog['catalogGeneration']>;
    enqueueOutput: ((outputId: ID) => Promise<void>) | undefined;
}

/** Owns administrator product-image requests, owned references and Channel asset publication. */
export class ImageGenerationCatalog {
    constructor(
        private readonly dependencies: Dependencies,
        private readonly requests: ImageGenerationRequestPolicy,
        private readonly views: ImageGenerationJobViews,
    ) {}

    async catalogConfig(ctx: RequestContext) {
        this.dependencies.assertCatalogImagePermissions(ctx);
        const config = await this.dependencies.configService.shopConfig(ctx);
        const defaultModel = config.models.find(model => model.code === config.defaultModelCode) ?? null;
        const unavailableReason = !config.enabled
            ? '当前店铺尚未开启 AI 图片工坊，或中转站暂不可用'
            : !defaultModel
              ? '当前默认生图模型不可用，请超级管理员检查配置'
              : null;
        return {
            enabled: !unavailableReason,
            unavailableReason,
            defaultModelCode: defaultModel?.code ?? config.defaultModelCode,
            defaultModelName: defaultModel?.displayNameZh ?? config.defaultModelCode,
            termsVersion: config.termsVersion,
            termsZh: config.termsZh,
            maxReferenceBytes: MAX_REFERENCE_BYTES,
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
            aspectRatio: '1:1',
            resolution: '1K',
            quantity: 1,
        };
    }

    async uploadCatalogReference(
        ctx: RequestContext,
        upload: Promise<UploadedImageFile>,
        termsAccepted: boolean,
    ) {
        this.dependencies.assertCatalogImagePermissions(ctx);
        if (!termsAccepted) throw new UserInputError('上传商品照片前需确认拥有图片使用权并同意服务条款');
        const administratorUserId = this.dependencies.activeAdministratorId(ctx);
        const availability = await this.dependencies.catalogConfig(ctx);
        if (!availability.enabled)
            throw new UserInputError(availability.unavailableReason ?? '后台商品图生成暂不可用');
        const file = await upload;
        const asset = await this.dependencies.connection.withTransaction(ctx, async txCtx => {
            await this.dependencies.lockAdministrator(txCtx, administratorUserId);
            const repository = this.dependencies.connection.getRepository(txCtx, ImagePrivateAsset);
            const now = Date.now();
            const [minuteCount, dayCount, activeCount, activeSize] = await Promise.all([
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        administratorUserId,
                        kind: 'REFERENCE',
                        createdAt: MoreThanOrEqual(new Date(now - 60_000)),
                    },
                }),
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        administratorUserId,
                        kind: 'REFERENCE',
                        createdAt: MoreThanOrEqual(startOfBeijingDay(now)),
                    },
                }),
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        administratorUserId,
                        kind: 'REFERENCE',
                        deletedAt: IsNull(),
                        expiresAt: MoreThan(new Date()),
                    },
                }),
                repository
                    .createQueryBuilder('asset')
                    .select('COALESCE(SUM(asset.byteSize), 0)', 'total')
                    .where('asset.channelId = :channelId', { channelId: txCtx.channelId })
                    .andWhere('asset.administratorUserId = :administratorUserId', {
                        administratorUserId,
                    })
                    .andWhere('asset.kind = :kind', { kind: 'REFERENCE' })
                    .andWhere('asset.deletedAt IS NULL')
                    .andWhere('asset.expiresAt > :now', { now: new Date() })
                    .getRawOne<{ total: string | number }>(),
            ]);
            if (minuteCount >= MAX_REFERENCE_UPLOADS_PER_MINUTE)
                throw new UserInputError('商品照片每分钟最多上传 5 张，请稍后再试');
            if (dayCount >= MAX_REFERENCE_UPLOADS_PER_DAY)
                throw new UserInputError('今天的商品照片上传额度已用完');
            if (activeCount >= MAX_ACTIVE_REFERENCE_ASSETS)
                throw new UserInputError('最多保留 10 张有效商品照片');
            const remainingBytes = MAX_ACTIVE_REFERENCE_BYTES - Number(activeSize?.total ?? 0);
            if (remainingBytes <= 0) throw new UserInputError('商品照片总容量已达到 100MB');
            return this.dependencies.storage.storeAdminReference(
                txCtx,
                administratorUserId,
                file,
                Math.min(MAX_REFERENCE_BYTES, remainingBytes),
            );
        });
        return this.views.catalogAssetView(ctx, asset, administratorUserId);
    }

    async releaseCatalogReference(ctx: RequestContext, assetId: ID) {
        this.dependencies.assertCatalogImagePermissions(ctx);
        return this.dependencies.storage.releaseAdminReference(
            ctx,
            assetId,
            this.dependencies.activeAdministratorId(ctx),
        );
    }

    async createCatalogGeneration(ctx: RequestContext, input: CreateCatalogImageGenerationInput) {
        this.dependencies.assertCatalogImagePermissions(ctx);
        const administratorUserId = this.dependencies.activeAdministratorId(ctx);
        const normalized = this.requests.validateCatalogCreateInput(input);
        const repository = this.dependencies.connection.getRepository(ctx, ImageGenerationJob);
        const existing = await repository.findOne({
            where: {
                channelId: ctx.channelId,
                administratorUserId,
                origin: 'ADMIN_PRODUCT_IMAGE',
                idempotencyKey: normalized.idempotencyKey,
            },
            relations: { outputs: { asset: true, catalogAsset: true }, referenceAsset: true },
        });
        if (existing) {
            this.requests.assertSameCatalogRequest(existing, normalized);
            return this.views.catalogJobView(ctx, existing, administratorUserId);
        }
        const created = await this.dependencies.connection.withTransaction(ctx, async txCtx => {
            await this.dependencies.lockAdministrator(txCtx, administratorUserId);
            const raced = await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationJob)
                .findOne({
                    where: {
                        channelId: txCtx.channelId,
                        administratorUserId,
                        origin: 'ADMIN_PRODUCT_IMAGE',
                        idempotencyKey: normalized.idempotencyKey,
                    },
                    relations: { outputs: { asset: true, catalogAsset: true }, referenceAsset: true },
                });
            if (raced) {
                this.requests.assertSameCatalogRequest(raced, normalized);
                return raced;
            }
            const activeCount = await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationJob)
                .count({
                    where: {
                        channelId: txCtx.channelId,
                        administratorUserId,
                        origin: 'ADMIN_PRODUCT_IMAGE',
                        state: In(['QUEUED', 'RUNNING', 'UNKNOWN']),
                    },
                });
            if (activeCount >= MAX_ACTIVE_GENERATION_JOBS)
                throw new UserInputError(`同时进行的后台生图任务不能超过 ${MAX_ACTIVE_GENERATION_JOBS} 个`);
            const config = await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationConfig)
                .findOne({
                    where: { channelId: txCtx.channelId },
                });
            if (!config?.enabled) throw new UserInputError('当前店铺尚未开启 AI 图片工坊');
            const model = await this.dependencies.connection.getRepository(txCtx, ImageModelConfig).findOne({
                where: { channelId: txCtx.channelId, code: config.defaultModelCode, enabled: true },
            });
            if (!model || !modelReady(model)) throw new UserInputError('当前默认生图模型不可用');
            if (!supportsNativeResolution(model, '1K', '1:1'))
                throw new UserInputError('当前默认模型不支持 1:1 / 1K 商品主图');
            const providerScope = providerScopeForModel(model.protocol, model.providerModelId);
            const credentialRoute = await this.dependencies.configService.routeCredential(
                txCtx,
                providerScope,
                model.id,
                'IMAGE',
            );
            const credential = credentialRoute.credential;
            const reference = await this.dependencies.connection
                .getRepository(txCtx, ImagePrivateAsset)
                .findOne({
                    where: {
                        id: normalized.referenceAssetId,
                        channelId: txCtx.channelId,
                        administratorUserId,
                        kind: 'REFERENCE',
                        deletedAt: IsNull(),
                        expiresAt: MoreThan(new Date()),
                    },
                });
            if (!reference) throw new UserInputError('商品照片不存在或已过期');
            await this.dependencies.storage.retainReferenceWhileActive(txCtx, reference.id);
            const dailyCount = await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationJob)
                .count({
                    where: {
                        channelId: txCtx.channelId,
                        administratorUserId,
                        origin: 'ADMIN_PRODUCT_IMAGE',
                        modelConfigId: model.id,
                        createdAt: MoreThanOrEqual(startOfBeijingDay(Date.now())),
                    },
                });
            if (dailyCount >= model.dailyGenerationSafetyLimit)
                throw new UserInputError('今天的后台商品图安全额度已用完');
            const prompt = `商品名称：${normalized.productName}\n主图效果描述：${normalized.description}`;
            const promptInput = {
                prompt,
                optimizedPrompt: '',
                referenceAssetId: reference.id,
                referenceAssetIds: [reference.id],
                referenceInstruction:
                    '必须忠实保留商品主体、外形、Logo、包装文字和原有颜色；不得改变品牌信息，不得添加新文字。',
                referenceMode: 'PRODUCT' as const,
                promptLanguage: 'zh' as const,
            };
            const promptSpec = this.dependencies.rules.fallbackSpec(prompt, 'PRODUCT', 'zh');
            const finalPrompt = this.requests.compileFinalPrompt(promptInput, promptSpec);
            this.dependencies.promptEngine.assertSafe(finalPrompt);
            const job = await this.dependencies.connection.getRepository(txCtx, ImageGenerationJob).save(
                new ImageGenerationJob({
                    channelId: txCtx.channelId,
                    customerId: null,
                    administratorUserId,
                    origin: 'ADMIN_PRODUCT_IMAGE',
                    modelConfigId: model.id,
                    referenceAssetId: reference.id,
                    idempotencyKey: normalized.idempotencyKey,
                    modelCodeSnapshot: model.code,
                    modelNameSnapshot: model.displayNameZh,
                    officialModelIdSnapshot: model.officialModelId,
                    providerModelIdSnapshot: model.providerModelId,
                    protocolSnapshot: model.protocol,
                    providerScopeSnapshot: providerScope,
                    providerCredentialFingerprint:
                        this.dependencies.configService.credentialFingerprint(credential),
                    providerCredentialCodeSnapshot: credential.code,
                    providerCredentialNameSnapshot: credential.name,
                    providerCredentialLast4Snapshot: credential.apiKeyLast4,
                    providerSelectionReason: credentialRoute.selectionReason,
                    providerIdempotencySupportedSnapshot: model.supportsIdempotency,
                    originalPrompt: prompt,
                    finalPrompt,
                    promptSpec: {
                        ...promptSpec,
                        catalogProductName: normalized.productName,
                        catalogDescription: normalized.description,
                        referenceAssetIds: [String(reference.id)],
                        referenceInstruction: promptInput.referenceInstruction,
                        inputSnapshot: { version: 1, optimizedPrompt: null },
                    } as Record<string, any>,
                    promptSkillHash: this.dependencies.rules.sourceHash,
                    referenceMode: 'PRODUCT',
                    aspectRatio: '1:1',
                    resolution: '1K',
                    quantity: 1,
                    unitPriceSnapshot: 0,
                    pricingSnapshot: null,
                    reservedAmount: 0,
                    expectedChargeAmount: 0,
                    freeQuantityReserved: 0,
                    freeQuantityCaptured: 0,
                    paidQuantityReserved: 0,
                    quotaEventId: null,
                    capturedAmount: 0,
                    releasedAmount: 0,
                    currencyCode: model.currencyCode,
                    walletUsageId: null,
                    state: 'QUEUED',
                    termsVersion: config.termsVersion,
                    termsAcceptedAt: new Date(),
                    errorMessage: null,
                    completedAt: null,
                    customerDeletedAt: null,
                }),
            );
            const output = await this.dependencies.connection
                .getRepository(txCtx, ImageGenerationOutput)
                .save(
                    new ImageGenerationOutput({
                        jobId: job.id,
                        outputIndex: 0,
                        state: 'QUEUED',
                        attemptCount: 0,
                        providerIdempotencyKey: `catalog-image-${String(job.id)}-0`,
                        providerRequestId: null,
                        assetId: null,
                        catalogAssetId: null,
                        usedAt: null,
                        errorMessage: null,
                        failureCode: null,
                        unknownAt: null,
                        completedAt: null,
                        walletSettled: false,
                        billingMode: 'PENDING',
                        chargeAmount: 0,
                        refundedAt: null,
                    }),
                );
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
            job.outputs = [output];
            job.referenceAsset = reference;
            return job;
        });
        if (this.dependencies.enqueueOutput)
            await this.dependencies.enqueueOutput(created.outputs[0].id).catch(() => undefined);
        return this.dependencies.catalogGeneration(ctx, created.id);
    }

    async catalogGeneration(ctx: RequestContext, id: ID) {
        this.dependencies.assertCatalogImagePermissions(ctx);
        const administratorUserId = this.dependencies.activeAdministratorId(ctx);
        const repository = this.dependencies.connection.getRepository(ctx, ImageGenerationJob);
        let job = await repository.findOne({
            where: { id, channelId: ctx.channelId, administratorUserId, origin: 'ADMIN_PRODUCT_IMAGE' },
            relations: { outputs: { asset: true, catalogAsset: true }, referenceAsset: true },
            order: { outputs: { outputIndex: 'ASC' } },
        });
        if (!job) throw new UserInputError('找不到后台商品图任务');
        const cutoff = this.dependencies.staleOutputCutoff();
        if (hasStaleImageOutput(job.outputs, cutoff)) {
            await this.dependencies.reconcileStaleOutputs(ctx, cutoff);
            job = await repository.findOne({
                where: { id, channelId: ctx.channelId, administratorUserId, origin: 'ADMIN_PRODUCT_IMAGE' },
                relations: { outputs: { asset: true, catalogAsset: true }, referenceAsset: true },
                order: { outputs: { outputIndex: 'ASC' } },
            });
            if (!job) throw new UserInputError('找不到后台商品图任务');
        }
        return this.views.catalogJobView(ctx, job, administratorUserId);
    }

    async catalogGenerations(ctx: RequestContext, skip = 0, take = 10) {
        this.dependencies.assertCatalogImagePermissions(ctx);
        const administratorUserId = this.dependencies.activeAdministratorId(ctx);
        const options = {
            where: {
                channelId: ctx.channelId,
                administratorUserId,
                origin: 'ADMIN_PRODUCT_IMAGE' as const,
            },
            relations: { outputs: { asset: true, catalogAsset: true }, referenceAsset: true },
            order: { createdAt: 'DESC', id: 'DESC', outputs: { outputIndex: 'ASC' } },
            skip: Math.max(0, Math.floor(skip || 0)),
            take: Math.min(20, Math.max(1, Math.floor(take || 10))),
        } as const;
        let [items, totalItems] = await this.dependencies.connection
            .getRepository(ctx, ImageGenerationJob)
            .findAndCount(options);
        const cutoff = this.dependencies.staleOutputCutoff();
        if (items.some(job => hasStaleImageOutput(job.outputs, cutoff))) {
            await this.dependencies.reconcileStaleOutputs(ctx, cutoff);
            [items, totalItems] = await this.dependencies.connection
                .getRepository(ctx, ImageGenerationJob)
                .findAndCount(options);
        }
        return {
            items: items.map(job => this.views.catalogJobView(ctx, job, administratorUserId)),
            totalItems,
        };
    }

    async useCatalogOutput(ctx: RequestContext, outputId: ID): Promise<Asset> {
        this.dependencies.assertCatalogImagePermissions(ctx);
        const administratorUserId = this.dependencies.activeAdministratorId(ctx);
        return this.dependencies.connection.withTransaction(ctx, async txCtx => {
            const repository = this.dependencies.connection.getRepository(txCtx, ImageGenerationOutput);
            const query = repository
                .createQueryBuilder('output')
                .innerJoinAndSelect('output.job', 'job')
                .leftJoinAndSelect('output.asset', 'privateAsset')
                .leftJoinAndSelect('output.catalogAsset', 'catalogAsset')
                .where('output.id = :outputId', { outputId });
            if (supportsGenerationLock(this.dependencies.connection.rawConnection.options.type)) {
                query.setLock('pessimistic_write');
            }
            const output = await query.getOne();
            if (
                !output ||
                output.job.origin !== 'ADMIN_PRODUCT_IMAGE' ||
                String(output.job.channelId) !== String(txCtx.channelId) ||
                String(output.job.administratorUserId) !== String(administratorUserId)
            ) {
                throw new UserInputError('找不到可使用的商品图结果');
            }
            if (output.catalogAsset) return output.catalogAsset;
            if (output.state !== 'SUCCEEDED' || !output.asset) {
                throw new UserInputError('只有生成成功的图片才能作为商品主图');
            }
            const bytes = await this.dependencies.storage.read(output.asset);
            const extension =
                output.asset.mimeType === 'image/png'
                    ? 'png'
                    : output.asset.mimeType === 'image/webp'
                      ? 'webp'
                      : 'jpg';
            const created = await this.dependencies.assetService.create(txCtx, {
                file: Promise.resolve({
                    filename: `ai-product-${String(output.job.id)}-${output.outputIndex + 1}.${extension}`,
                    mimetype: output.asset.mimeType,
                    encoding: '7bit',
                    createReadStream: () => Readable.from(bytes),
                }),
                tags: ['AI商品图', '后台生成'],
            });
            if (isGraphQlErrorResult(created)) throw new UserInputError(created.message);
            output.catalogAssetId = created.id;
            output.catalogAsset = created;
            output.usedAt = new Date();
            await repository.save(output, { reload: false });
            return created;
        });
    }
}
