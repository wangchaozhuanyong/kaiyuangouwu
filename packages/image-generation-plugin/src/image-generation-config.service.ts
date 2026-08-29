import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHash, randomUUID } from 'node:crypto';

import { IMAGE_GENERATION_OPTIONS, launchModelDefinitions, retiredLaunchModelCodes } from './constants';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePromptSkillRelease } from './entities/image-prompt-skill-release.entity';
import { ImageProviderCredentialModel } from './entities/image-provider-credential-model.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';
import { supportsNativeResolution } from './image-resolution';
import { PromptRulesService } from './prompt/prompt-rules.service';
import { ImageProviderRouterService } from './provider/image-provider-router.service';
import { ImageProviderClient } from './provider/image-provider.client';
import { ImageProviderCipherService } from './security/image-provider-cipher.service';
import { SafeProviderUrlService } from './security/safe-provider-url.service';
import {
    ImageGenerationPluginOptions,
    ImageProviderProtocol,
    ImageProviderScope,
    SaveImageGenerationConfigInput,
    SaveImageModelInput,
    SaveImageProviderCredentialInput,
} from './types';

const DEFAULT_TERMS_ZH =
    '我确认拥有提示词和参考图的使用权；内容会发送至第三方中转站及模型提供方；生成结果可能存在错误；禁止违法、侵权、冒充、欺诈及未成年人敏感内容。参考图在任务结束后保留24小时。客户删除生成记录时，图片会删除且前台记录会隐藏；提示词、计费和调用记录为安全审计长期保留，合规删除或匿名化需另行申请。';
const DEFAULT_TERMS_EN = [
    'I have rights to the prompt and reference image. Content is sent to the relay and model provider. ',
    'AI output may be inaccurate. Illegal, infringing, deceptive, impersonation, fraud, and sensitive ',
    'minor content are prohibited. References are kept 24 hours after completion. Customer deletion removes ',
    'images and hides storefront history; prompts, billing, and invocation records are retained for security audit ',
    'until a separately authorized compliance deletion or anonymization request is completed.',
].join('');
const DEFAULT_TERMS_VERSION = '2026-08-28-audit';
const PROVIDER_SCOPES = ['OPENAI', 'GEMINI'] as const satisfies readonly ImageProviderScope[];

@Injectable()
export class ImageGenerationConfigService implements OnApplicationBootstrap {
    constructor(
        @Inject(IMAGE_GENERATION_OPTIONS) private readonly options: ImageGenerationPluginOptions,
        private readonly connection: TransactionalConnection,
        private readonly cipher: ImageProviderCipherService,
        private readonly safeUrls: SafeProviderUrlService,
        private readonly providerClient: ImageProviderClient,
        private readonly providerRouter: ImageProviderRouterService,
        private readonly rules: PromptRulesService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(ImagePromptSkillRelease);
        let release = await repository.findOne({ where: { sourceHash: this.rules.sourceHash } });
        const discoveredDuringThisBoot = !release;
        const active = await repository.findOne({
            where: { status: 'ACTIVE' },
            order: { activatedAt: 'DESC' },
        });
        if (!release) {
            try {
                release = await repository.save(
                    new ImagePromptSkillRelease({
                        bundleVersion: Number(this.rules.serializableBundle.bundleVersion ?? 1),
                        sourceHash: this.rules.sourceHash,
                        status: 'INACTIVE',
                        bundle: this.rules.serializableBundle,
                        activatedAt: null,
                    }),
                );
            } catch (error) {
                // A second API instance may have registered the same unique source hash first.
                release = await repository.findOne({ where: { sourceHash: this.rules.sourceHash } });
                if (!release) throw error;
            }
        }
        const promoteRelease =
            !active || (discoveredDuringThisBoot && this.options.autoActivateSkillReleases === true);
        if (promoteRelease) {
            const activatedAt = new Date();
            await this.connection.rawConnection.transaction(async manager => {
                const transactionRepository = manager.getRepository(ImagePromptSkillRelease);
                await transactionRepository.update({ status: 'ACTIVE' }, { status: 'INACTIVE' });
                await transactionRepository.update({ id: release.id }, { status: 'ACTIVE', activatedAt });
            });
            release.status = 'ACTIVE';
            release.activatedAt = activatedAt;
        }
        const selected = promoteRelease ? release : (active ?? release);
        this.rules.activateBundle(selected.bundle);
    }

    async adminConfig(ctx: RequestContext) {
        await this.synchronizeActiveSkillRelease();
        const config = await this.getOrCreateConfig(ctx);
        const models = await this.getOrCreateModels(ctx);
        const credentials = await this.connection
            .getRepository(ctx, ImageProviderCredential)
            .createQueryBuilder('credential')
            .where('credential.archivedAt IS NULL')
            .getMany();
        return {
            ...config,
            models,
            credentialEnabled: credentials.some(credential => credential?.enabled),
            activeSkillHash: this.rules.sourceHash,
            skillAutoActivateEnabled: this.options.autoActivateSkillReleases === true,
        };
    }

    async providerAdminConfigs(ctx?: RequestContext) {
        const repository = ctx
            ? this.connection.getRepository(ctx, ImageProviderCredential)
            : this.connection.rawConnection.getRepository(ImageProviderCredential);
        const credentials = await repository
            .createQueryBuilder('credential')
            .where('credential.archivedAt IS NULL')
            .orderBy('credential.scope', 'ASC')
            .addOrderBy('credential.priority', 'ASC')
            .addOrderBy('credential.id', 'ASC')
            .getMany();
        return Promise.all(credentials.map(credential => this.providerAdminView(ctx, credential)));
    }

    async providerAdminConfig(ctx: RequestContext | undefined, scope: ImageProviderScope) {
        const credential = await this.credential(ctx, scope);
        if (!credential) {
            return {
                id: null,
                code: '',
                name: `${scope} 主 Key`,
                purpose: 'BOTH',
                scope,
                credentialConfigured: false,
                credentialEnabled: false,
                baseUrl: '',
                apiKeyLast4: '',
                textModelId: '',
                providerHealthStatus: 'UNCONFIGURED',
                providerHealthMessage: null,
                priority: 100,
                weight: 1,
                cooldownUntil: null,
                lastUsedAt: null,
                modelCodes: [],
            };
        }
        return this.providerAdminView(ctx, credential);
    }

    private async providerAdminView(ctx: RequestContext | undefined, credential: ImageProviderCredential) {
        const bindingRepository = ctx
            ? this.connection.getRepository(ctx, ImageProviderCredentialModel)
            : this.connection.rawConnection.getRepository(ImageProviderCredentialModel);
        const bindings = await bindingRepository.find({
            where: { credentialId: credential.id },
            relations: { modelConfig: true },
        });
        return {
            id: credential.id,
            code: credential.code,
            name: credential.name,
            purpose: credential.purpose,
            scope: credential.scope,
            credentialConfigured: Boolean(credential?.encryptedApiKey),
            credentialEnabled: credential?.enabled ?? false,
            baseUrl: credential?.baseUrl ?? '',
            apiKeyLast4: credential?.apiKeyLast4 ?? '',
            textModelId: credential?.textModelId ?? '',
            providerHealthStatus: credential?.healthStatus ?? 'UNCONFIGURED',
            providerHealthMessage: credential?.healthMessage ?? null,
            priority: credential.priority,
            weight: credential.weight,
            cooldownUntil: credential.cooldownUntil,
            lastUsedAt: credential.lastUsedAt,
            modelCodes: bindings.map(binding => binding.modelConfig.code),
        };
    }

    async shopConfig(ctx: RequestContext) {
        await this.synchronizeActiveSkillRelease();
        const config = await this.getConfig(ctx);
        const models = await this.getOrCreateModels(ctx);
        const readiness = await Promise.all(
            models.map(async model => ({
                model,
                available:
                    model.enabled &&
                    modelReady(model) &&
                    (await this.providerRouter.hasAvailable(ctx, {
                        scope: providerScopeForModel(model.protocol, model.providerModelId),
                        purpose: 'IMAGE',
                        modelConfigId: model.id,
                    })),
            })),
        );
        const availableModels = readiness.filter(item => item.available).map(item => item.model);
        const optimizerAvailable = (
            await Promise.all(
                PROVIDER_SCOPES.map(scope =>
                    this.providerRouter.hasAvailable(ctx, {
                        scope,
                        purpose: 'PROMPT',
                    }),
                ),
            )
        ).some(Boolean);
        return {
            enabled: config.enabled && availableModels.length > 0,
            promptOptimizationEnabled: config.promptOptimizationEnabled && optimizerAvailable,
            promptRateLimitPerMinute: config.promptRateLimitPerMinute,
            promptDailyFreeLimit: config.promptDailyFreeLimit,
            promptDailyFreeUnlimited: config.promptDailyFreeUnlimited,
            paidPromptOptimizationEnabled: config.paidPromptOptimizationEnabled,
            paidPromptOptimizationPrice: config.paidPromptOptimizationPrice,
            paidPromptOptimizationCurrencyCode: config.paidPromptOptimizationCurrencyCode,
            defaultModelCode: config.defaultModelCode,
            termsVersion: config.termsVersion,
            termsZh: config.termsZh,
            termsEn: config.termsEn,
            outputRetentionDays: 90,
            referenceRetentionHours: 24,
            maxReferenceBytes: 10 * 1024 * 1024,
            maxReferencePixels: 40_000_000,
            maxQuantity: 4,
            models: availableModels,
        };
    }

    async saveConfig(ctx: RequestContext, input: SaveImageGenerationConfigInput) {
        await this.connection.withTransaction(ctx, async txCtx => {
            const config = await this.getOrCreateConfig(txCtx);
            const modelRepository = this.connection.getRepository(txCtx, ImageModelConfig);
            let models = await this.getOrCreateModels(txCtx);
            if (input.models) {
                const submittedCodes = new Set<string>();
                for (const modelInput of input.models) {
                    if (submittedCodes.has(modelInput.code))
                        throw new UserInputError(`模型 ${modelInput.code} 不能重复提交`);
                    submittedCodes.add(modelInput.code);
                    const definition = validateModelInput(modelInput);
                    if (
                        modelInput.enabled &&
                        models.some(
                            model =>
                                model.code !== modelInput.code &&
                                model.enabled &&
                                model.currencyCode !== modelInput.currencyCode,
                        )
                    ) {
                        throw new UserInputError('同一店铺已启用的生图模型必须使用同一币种');
                    }
                    const savedModel = await this.saveModelRecord(
                        txCtx,
                        modelInput,
                        definition,
                        models.find(model => model.code === modelInput.code),
                    );
                    models = models.some(model => model.code === savedModel.code)
                        ? models.map(model => (model.code === savedModel.code ? savedModel : model))
                        : [...models, savedModel];
                }
            }
            if (input.enabled && !models.some(model => model.enabled))
                throw new UserInputError('请至少启用一个生图模型');
            if (
                !models.some(
                    model => model.code === input.defaultModelCode && (!input.enabled || model.enabled),
                )
            ) {
                throw new UserInputError(input.enabled ? '默认模型必须已启用' : '默认模型无效');
            }
            config.enabled = input.enabled;
            config.promptOptimizationEnabled = input.promptOptimizationEnabled;
            assertNonNegativeInteger(input.promptRateLimitPerMinute, '每分钟提示词优化次数');
            assertNonNegativeInteger(input.promptDailyFreeLimit, '每日免费提示词优化次数');
            if (input.promptRateLimitPerMinute === 0)
                throw new UserInputError('每分钟提示词优化次数必须大于 0');
            if (input.promptDailyFreeUnlimited && input.promptDailyFreeLimit !== 0)
                throw new UserInputError('提示词免费次数不限时，次数值必须为 0');
            if (input.paidPromptOptimizationEnabled && input.paidPromptOptimizationPrice <= 0)
                throw new UserInputError('启用付费提示词优化前必须设置大于 0 的价格');
            assertNonNegativeInteger(input.paidPromptOptimizationPrice, '提示词优化价格');
            config.promptRateLimitPerMinute = input.promptRateLimitPerMinute;
            config.promptDailyFreeLimit = input.promptDailyFreeLimit;
            config.promptDailyFreeUnlimited = input.promptDailyFreeUnlimited;
            config.paidPromptOptimizationEnabled = input.paidPromptOptimizationEnabled;
            config.paidPromptOptimizationPrice = input.paidPromptOptimizationPrice;
            config.paidPromptOptimizationCurrencyCode = input.paidPromptOptimizationCurrencyCode;
            config.defaultModelCode = input.defaultModelCode;
            config.termsVersion = requiredText(input.termsVersion, 32, '条款版本');
            config.termsZh = requiredText(input.termsZh, 8_000, '中文条款');
            config.termsEn = requiredText(input.termsEn, 8_000, '英文条款');
            await this.connection.getRepository(txCtx, ImageGenerationConfig).save(config, { reload: false });
            await modelRepository
                .createQueryBuilder()
                .update(ImageModelConfig)
                .set({ isDefault: false })
                .where('channelId = :channelId', { channelId: txCtx.channelId })
                .execute();
            await modelRepository.update(
                { channelId: txCtx.channelId, code: input.defaultModelCode },
                { isDefault: true },
            );
        });
        return this.adminConfig(ctx);
    }

    async saveCredential(ctx: RequestContext, input: SaveImageProviderCredentialInput) {
        const baseUrl = await this.safeUrls.validate(input.baseUrl.trim());
        const repository = this.connection.getRepository(ctx, ImageProviderCredential);
        const scope = providerScope(input.scope);
        const code = requiredCode(input.code);
        const purpose = providerPurpose(input.purpose);
        if (!Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 10_000)
            throw new UserInputError('Key 优先级必须是 0 到 10000 的整数');
        if (!Number.isSafeInteger(input.weight) || input.weight < 1 || input.weight > 1_000)
            throw new UserInputError('Key 轮询权重必须是 1 到 1000 的整数');
        let credential = input.id
            ? await repository.findOne({ where: { id: input.id } })
            : await repository.findOne({ where: { code } });
        if (credential?.archivedAt) throw new UserInputError('已归档的 Key 不能编辑');
        const apiKey = input.apiKey?.trim();
        if (!credential && !apiKey) throw new UserInputError('首次配置必须填写 API Key');
        const normalizedBaseUrl = baseUrl.toString().replace(/\/$/u, '');
        const textModelId = requiredText(input.textModelId, 160, '提示词优化模型 ID');
        const connectionChanged =
            !credential ||
            Boolean(apiKey) ||
            credential.baseUrl !== normalizedBaseUrl ||
            credential.textModelId !== textModelId;
        const encryptedApiKey = apiKey ? this.cipher.encrypt(apiKey) : credential?.encryptedApiKey;
        if (!encryptedApiKey) throw new UserInputError('首次配置必须填写 API Key');
        const values = {
            scope,
            code,
            name: requiredText(input.name, 120, 'Key 名称'),
            purpose,
            enabled: input.enabled,
            baseUrl: normalizedBaseUrl,
            textModelId,
            encryptedApiKey,
            apiKeyLast4: apiKey ? apiKey.slice(-4) : (credential?.apiKeyLast4 ?? ''),
            healthStatus: connectionChanged ? 'UNTESTED' : (credential?.healthStatus ?? 'UNTESTED'),
            healthMessage: connectionChanged ? null : (credential?.healthMessage ?? null),
            lastTestedAt: connectionChanged ? null : (credential?.lastTestedAt ?? null),
            priority: input.priority,
            weight: input.weight,
            currentWeight: connectionChanged ? 0 : (credential?.currentWeight ?? 0),
            consecutiveFailures: connectionChanged ? 0 : (credential?.consecutiveFailures ?? 0),
            cooldownUntil: connectionChanged ? null : (credential?.cooldownUntil ?? null),
            lastUsedAt: credential?.lastUsedAt ?? null,
            archivedAt: null,
        };
        credential = await this.connection.withTransaction(ctx, async txCtx => {
            const txRepository = this.connection.getRepository(txCtx, ImageProviderCredential);
            const saved = await txRepository.save(
                credential ? Object.assign(credential, values) : new ImageProviderCredential(values),
            );
            const modelRepository = this.connection.getRepository(txCtx, ImageModelConfig);
            const modelCodes = [...new Set(input.modelCodes.map(value => value.trim()).filter(Boolean))];
            const models = modelCodes.length
                ? await modelRepository
                      .createQueryBuilder('model')
                      .where('model.channelId = :channelId', { channelId: txCtx.channelId })
                      .andWhere('model.code IN (:...modelCodes)', { modelCodes })
                      .getMany()
                : [];
            if (models.length !== modelCodes.length) throw new UserInputError('Key 绑定的模型无效');
            if (
                models.some(model => providerScopeForModel(model.protocol, model.providerModelId) !== scope)
            ) {
                throw new UserInputError('Key 只能绑定同一供应商协议的模型');
            }
            const bindingRepository = this.connection.getRepository(txCtx, ImageProviderCredentialModel);
            await bindingRepository.delete({ credentialId: saved.id });
            if (models.length) {
                await bindingRepository.save(
                    models.map(
                        model =>
                            new ImageProviderCredentialModel({
                                credentialId: saved.id,
                                modelConfigId: model.id,
                            }),
                    ),
                );
            }
            return saved;
        });
        return this.providerAdminView(ctx, credential);
    }

    async testCredential(ctx: RequestContext, id: ID) {
        const credential = await this.connection.getRepository(ctx, ImageProviderCredential).findOne({
            where: { id },
        });
        if (!credential || credential.archivedAt) throw new UserInputError('找不到 Key');
        const result = await this.providerClient.testConnection(credential);
        credential.lastTestedAt = new Date();
        credential.healthStatus = result.ok ? 'HEALTHY' : 'UNHEALTHY';
        credential.healthMessage = result.message.slice(0, 500);
        credential.consecutiveFailures = result.ok ? 0 : credential.consecutiveFailures + 1;
        credential.cooldownUntil = null;
        await this.connection.getRepository(ctx, ImageProviderCredential).save(credential, { reload: false });
        return { ...result, testedAt: credential.lastTestedAt };
    }

    async archiveCredential(ctx: RequestContext, id: ID): Promise<boolean> {
        const result = await this.connection
            .getRepository(ctx, ImageProviderCredential)
            .update({ id }, { enabled: false, archivedAt: new Date(), healthMessage: '已归档' });
        return result.affected === 1;
    }

    async testConnection(ctx: RequestContext, rawScope: ImageProviderScope) {
        const scope = providerScope(rawScope);
        const credential = await this.requireConfiguredCredential(ctx, scope);
        const result = await this.providerClient.testConnection(credential);
        credential.lastTestedAt = new Date();
        credential.healthStatus = result.ok ? 'HEALTHY' : 'UNHEALTHY';
        credential.healthMessage = result.message.slice(0, 500);
        await this.connection.getRepository(ctx, ImageProviderCredential).save(credential, { reload: false });
        return { ...result, testedAt: credential.lastTestedAt };
    }

    async testModel(ctx: RequestContext, code: string) {
        const model = await this.getModel(ctx, code);
        if (!model) throw new UserInputError('找不到生图模型');
        const credential = await this.requireCredential(
            ctx,
            providerScopeForModel(model.protocol, model.providerModelId),
            model.id,
            'IMAGE',
        );
        const result = await this.providerClient.testModel(credential, model.providerModelId);
        model.lastTestedAt = new Date();
        model.healthStatus = result.ok ? 'HEALTHY' : 'UNHEALTHY';
        model.healthMessage = result.message.slice(0, 500);
        await this.connection.getRepository(ctx, ImageModelConfig).save(model, { reload: false });
        return { ...result, testedAt: model.lastTestedAt };
    }

    async smokeTestModel(ctx: RequestContext, code: string) {
        const model = await this.getModel(ctx, code);
        if (!model) throw new UserInputError('找不到生图模型');
        const scope = providerScopeForModel(model.protocol, model.providerModelId);
        const credential = await this.requireCredential(ctx, scope, model.id, 'IMAGE');
        const startedAt = Date.now();
        try {
            const result = await this.providerClient.generate(credential, model.protocol, {
                providerModelId: model.providerModelId,
                prompt: 'A simple blue circle centered on a clean white background, no text.',
                aspectRatio: '1:1',
                resolution: '1K',
                idempotencyKey: `image-smoke-${String(model.id)}-${randomUUID()}`,
            });
            model.healthStatus = 'HEALTHY';
            model.healthMessage = `付费真实生图测试成功，耗时 ${Date.now() - startedAt}ms`;
            model.lastTestedAt = new Date();
            model.consecutiveFailures = 0;
            await this.connection.getRepository(ctx, ImageModelConfig).save(model, { reload: false });
            return {
                ok: true,
                message: model.healthMessage,
                testedAt: model.lastTestedAt,
                actualCostMicrounits: result.telemetry?.actualCostMicrounits ?? null,
                costCurrency: result.telemetry?.costCurrency ?? null,
            };
        } catch (error) {
            const telemetry = errorTelemetry(error);
            model.healthStatus = 'UNHEALTHY';
            model.healthMessage = `付费真实生图测试失败：${safeMessage(error)}`.slice(0, 500);
            model.lastTestedAt = new Date();
            model.consecutiveFailures += 1;
            await this.connection.getRepository(ctx, ImageModelConfig).save(model, { reload: false });
            return {
                ok: false,
                message: model.healthMessage,
                testedAt: model.lastTestedAt,
                actualCostMicrounits: telemetry.actualCostMicrounits ?? null,
                costCurrency: telemetry.costCurrency ?? null,
            };
        }
    }

    saveModel(ctx: RequestContext, input: SaveImageModelInput) {
        const definition = validateModelInput(input);
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, ImageModelConfig);
            const [existingModels, config] = await Promise.all([
                repository.find({ where: { channelId: txCtx.channelId } }),
                this.getOrCreateConfig(txCtx),
            ]);
            if (
                input.enabled &&
                existingModels.some(
                    item =>
                        item.code !== input.code && item.enabled && item.currencyCode !== input.currencyCode,
                )
            ) {
                throw new UserInputError('同一店铺已启用的生图模型必须使用同一币种');
            }
            const currentDefault = config.defaultModelCode === input.code;
            if (currentDefault && !input.isDefault) {
                throw new UserInputError('请先将其他模型设为默认模型');
            }
            if (config.enabled && input.isDefault && !input.enabled) {
                throw new UserInputError('已开启图片工坊时，默认模型必须启用');
            }
            const model = await this.saveModelRecord(
                txCtx,
                input,
                definition,
                existingModels.find(item => item.code === input.code),
            );
            if (model.isDefault) {
                await repository
                    .createQueryBuilder()
                    .update(ImageModelConfig)
                    .set({ isDefault: false })
                    .where('channelId = :channelId AND id != :id', {
                        channelId: txCtx.channelId,
                        id: model.id,
                    })
                    .execute();
                config.defaultModelCode = model.code;
                await this.connection
                    .getRepository(txCtx, ImageGenerationConfig)
                    .save(config, { reload: false });
            }
            return model;
        });
    }

    private saveModelRecord(
        txCtx: RequestContext,
        input: SaveImageModelInput,
        definition: (typeof launchModelDefinitions)[number],
        existingModel: ImageModelConfig | undefined,
    ): Promise<ImageModelConfig> {
        const repository = this.connection.getRepository(txCtx, ImageModelConfig);
        const mappingChanged =
            !existingModel ||
            existingModel.providerModelId !== input.providerModelId.trim() ||
            existingModel.protocol !== input.protocol;
        const values = {
            channelId: txCtx.channelId,
            code: definition.code,
            enabled: input.enabled,
            displayNameZh: requiredText(input.displayNameZh, 120, '中文名称'),
            displayNameEn: requiredText(input.displayNameEn, 120, '英文名称'),
            descriptionZh: requiredText(input.descriptionZh, 500, '中文模型说明'),
            descriptionEn: requiredText(input.descriptionEn, 500, '英文模型说明'),
            officialModelId: definition.officialModelId,
            providerModelId: requiredText(input.providerModelId, 160, '中转站模型 ID'),
            protocol: input.protocol,
            unitPrice: input.unitPrice,
            unitPrice2K: input.unitPrice2K,
            unitPrice4K: input.unitPrice4K,
            currencyCode: input.currencyCode,
            position: input.position,
            isDefault: input.isDefault,
            supportsIdempotency: input.supportsIdempotency,
            freeImageEnabled: input.freeImageEnabled,
            dailyFreeImageLimit: input.dailyFreeImageLimit,
            dailyFreeImageUnlimited: input.dailyFreeImageUnlimited,
            paidAfterFreeEnabled: input.paidAfterFreeEnabled,
            dailyGenerationSafetyLimit: input.dailyGenerationSafetyLimit,
            healthStatus: mappingChanged ? 'UNTESTED' : (existingModel?.healthStatus ?? 'UNTESTED'),
            healthMessage: mappingChanged ? null : (existingModel?.healthMessage ?? null),
            lastTestedAt: mappingChanged ? null : (existingModel?.lastTestedAt ?? null),
            consecutiveFailures: mappingChanged ? 0 : (existingModel?.consecutiveFailures ?? 0),
        };
        return repository.save(
            existingModel ? Object.assign(existingModel, values) : new ImageModelConfig(values),
        );
    }

    skillReleases(ctx: RequestContext): Promise<ImagePromptSkillRelease[]> {
        return this.connection.getRepository(ctx, ImagePromptSkillRelease).find({
            order: { createdAt: 'DESC' },
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
                bundleVersion: true,
                sourceHash: true,
                status: true,
                activatedAt: true,
                bundle: true,
            },
        });
    }

    async activateSkillRelease(ctx: RequestContext, id: string | number): Promise<ImagePromptSkillRelease> {
        const release = await this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, ImagePromptSkillRelease);
            const selected = await repository.findOne({ where: { id } });
            if (!selected) throw new UserInputError('找不到提示词 Skill 版本');
            if ((selected.bundle as Record<string, unknown>).sourceHash !== selected.sourceHash)
                throw new UserInputError('提示词 Skill 版本校验失败');
            await repository
                .createQueryBuilder()
                .update(ImagePromptSkillRelease)
                .set({ status: 'INACTIVE' })
                .where('status = :status', { status: 'ACTIVE' })
                .execute();
            selected.status = 'ACTIVE';
            selected.activatedAt = new Date();
            await repository.save(selected, { reload: false });
            return selected;
        });
        this.rules.activateBundle(release.bundle);
        return release;
    }

    getModel(ctx: RequestContext, code: string): Promise<ImageModelConfig | null> {
        return this.connection
            .getRepository(ctx, ImageModelConfig)
            .findOne({ where: { channelId: ctx.channelId, code } });
    }

    requireCredential(
        ctx: RequestContext,
        scope: ImageProviderScope = 'OPENAI',
        modelConfigId?: ID,
        purpose: 'PROMPT' | 'IMAGE' = modelConfigId ? 'IMAGE' : 'PROMPT',
    ): Promise<ImageProviderCredential> {
        return this.routeCredential(ctx, scope, modelConfigId, purpose).then(route => route.credential);
    }

    routeCredential(
        ctx: RequestContext,
        scope: ImageProviderScope,
        modelConfigId?: ID,
        purpose: 'PROMPT' | 'IMAGE' = modelConfigId ? 'IMAGE' : 'PROMPT',
    ) {
        return this.providerRouter.select(ctx, { scope, purpose, modelConfigId });
    }

    credentialByCode(ctx: RequestContext, code: string) {
        return this.providerRouter.findByCode(ctx, code);
    }

    recordCredentialRuntimeFailure(
        ctx: RequestContext,
        credential: ImageProviderCredential,
        input: { httpStatus?: number; retryAfterSeconds?: number; message: string },
    ) {
        return this.providerRouter.recordFailure(ctx, credential, input);
    }

    recordCredentialRuntimeSuccess(ctx: RequestContext, credential: ImageProviderCredential) {
        return this.providerRouter.recordSuccess(ctx, credential);
    }

    credentialFingerprint(credential: ImageProviderCredential): string {
        return createHash('sha256')
            .update(
                JSON.stringify({
                    scope: credential.scope,
                    baseUrl: credential.baseUrl,
                    textModelId: credential.textModelId,
                    encryptedApiKey: credential.encryptedApiKey,
                }),
            )
            .digest('hex');
    }

    async recordRuntimeResult(
        ctx: RequestContext,
        modelConfigId: ID,
        result: {
            ok: boolean;
            message?: string;
            credentialScope?: ImageProviderScope;
            authFailure?: boolean;
        },
    ): Promise<void> {
        const repository = this.connection.getRepository(ctx, ImageModelConfig);
        const model = await repository.findOne({ where: { id: modelConfigId } });
        if (!model) return;
        if (result.ok) {
            await repository.update(
                { id: model.id },
                {
                    consecutiveFailures: 0,
                    healthStatus: 'HEALTHY',
                    healthMessage: '最近一次真实生图成功',
                    lastTestedAt: new Date(),
                },
            );
            return;
        }
        await repository.increment({ id: model.id }, 'consecutiveFailures', 1);
        const refreshed = await repository.findOne({ where: { id: model.id } });
        if (refreshed && refreshed.consecutiveFailures >= 3) {
            await repository.update(
                { id: model.id },
                {
                    healthStatus: 'UNHEALTHY',
                    healthMessage:
                        `连续 ${refreshed.consecutiveFailures} 次调用失败：${result.message ?? '未知错误'}`.slice(
                            0,
                            500,
                        ),
                    lastTestedAt: new Date(),
                },
            );
        }
        // 具体 Key 的鉴权与冷却状态由路由器按本次实际选中的凭证更新，不能批量停用同供应商 Key。
    }

    private requireConfiguredCredential(
        ctx: RequestContext | undefined,
        scope: ImageProviderScope,
    ): Promise<ImageProviderCredential> {
        return this.credential(ctx, scope).then(value => {
            if (!value?.encryptedApiKey) throw new UserInputError(`平台尚未配置 ${scope} 生图中转站`);
            return value;
        });
    }

    private async credential(
        ctx: RequestContext | undefined,
        scope: ImageProviderScope,
    ): Promise<ImageProviderCredential | null> {
        const repository = ctx
            ? this.connection.getRepository(ctx, ImageProviderCredential)
            : this.connection.rawConnection.getRepository(ImageProviderCredential);
        const credential = await repository.findOne({
            where: { scope },
            order: { priority: 'ASC', id: 'ASC' },
        });
        if (credential || scope !== 'OPENAI') return credential;
        return repository.findOne({ where: { scope: 'GLOBAL' } });
    }

    private async synchronizeActiveSkillRelease(): Promise<void> {
        const active = await this.connection.rawConnection
            .getRepository(ImagePromptSkillRelease)
            .findOne({ where: { status: 'ACTIVE' }, order: { activatedAt: 'DESC' } });
        if (active && active.sourceHash !== this.rules.sourceHash) {
            this.rules.activateBundle(active.bundle);
        }
    }

    private async getConfig(ctx: RequestContext): Promise<ImageGenerationConfig> {
        return (
            (await this.connection
                .getRepository(ctx, ImageGenerationConfig)
                .findOne({ where: { channelId: ctx.channelId } })) ??
            new ImageGenerationConfig({
                channelId: ctx.channelId,
                enabled: false,
                promptOptimizationEnabled: true,
                promptRateLimitPerMinute: 3,
                promptDailyFreeLimit: 20,
                promptDailyFreeUnlimited: false,
                paidPromptOptimizationEnabled: false,
                paidPromptOptimizationPrice: 0,
                paidPromptOptimizationCurrencyCode: ctx.channel.defaultCurrencyCode,
                defaultModelCode: 'OPENAI_HIGH_QUALITY',
                termsVersion: DEFAULT_TERMS_VERSION,
                termsZh: DEFAULT_TERMS_ZH,
                termsEn: DEFAULT_TERMS_EN,
            })
        );
    }

    private async getOrCreateConfig(ctx: RequestContext): Promise<ImageGenerationConfig> {
        const config = await this.getConfig(ctx);
        return config.id ? config : this.connection.getRepository(ctx, ImageGenerationConfig).save(config);
    }

    private async getOrCreateModels(ctx: RequestContext): Promise<ImageModelConfig[]> {
        const repository = this.connection.getRepository(ctx, ImageModelConfig);
        const existing = await repository.find({
            where: { channelId: ctx.channelId },
            order: { position: 'ASC' },
        });
        const retired = existing.filter(model => retiredLaunchModelCodes.has(model.code));
        if (retired.length) {
            await repository
                .createQueryBuilder()
                .update(ImageModelConfig)
                .set({ enabled: false, isDefault: false })
                .where('channelId = :channelId', { channelId: ctx.channelId })
                .andWhere('code IN (:...codes)', { codes: retired.map(model => model.code) })
                .execute();
            for (const model of retired) Object.assign(model, { enabled: false, isDefault: false });

            const config = await this.getOrCreateConfig(ctx);
            if (retiredLaunchModelCodes.has(config.defaultModelCode)) {
                const replacementCode =
                    existing.find(model => model.enabled && !retiredLaunchModelCodes.has(model.code))?.code ??
                    launchModelDefinitions[0].code;
                config.defaultModelCode = replacementCode;
                await this.connection
                    .getRepository(ctx, ImageGenerationConfig)
                    .save(config, { reload: false });
                await repository.update(
                    { channelId: ctx.channelId, code: replacementCode },
                    { isDefault: true },
                );
                const replacement = existing.find(model => model.code === replacementCode);
                if (replacement) replacement.isDefault = true;
            }
        }
        const existingCodes = new Set(existing.map(model => model.code));
        const currencyCode = ctx.channel.defaultCurrencyCode;
        for (const [position, definition] of launchModelDefinitions.entries()) {
            if (existingCodes.has(definition.code)) continue;
            existing.push(
                await repository.save(
                    new ImageModelConfig({
                        channelId: ctx.channelId,
                        code: definition.code,
                        enabled: false,
                        displayNameZh: definition.nameZh,
                        displayNameEn: definition.nameEn,
                        descriptionZh: definition.descriptionZh,
                        descriptionEn: definition.descriptionEn,
                        officialModelId: definition.officialModelId,
                        providerModelId: definition.officialModelId,
                        protocol: definition.protocol,
                        unitPrice: 0,
                        unitPrice2K: 0,
                        unitPrice4K: 0,
                        currencyCode,
                        position,
                        isDefault: definition.code === 'OPENAI_HIGH_QUALITY',
                        supportsIdempotency: false,
                        freeImageEnabled: false,
                        dailyFreeImageLimit: 0,
                        dailyFreeImageUnlimited: false,
                        paidAfterFreeEnabled: true,
                        dailyGenerationSafetyLimit: 20,
                        healthStatus: 'UNTESTED',
                        healthMessage: null,
                        lastTestedAt: null,
                        consecutiveFailures: 0,
                    }),
                ),
            );
        }
        return existing
            .filter(model => !retiredLaunchModelCodes.has(model.code))
            .sort((left, right) => left.position - right.position);
    }
}

function validateModelInput(input: SaveImageModelInput): (typeof launchModelDefinitions)[number] {
    const definition = launchModelDefinitions.find(model => model.code === input.code);
    if (!definition) throw new UserInputError('只支持当前已审核的生图模型');
    for (const [label, price] of [
        ['1K', input.unitPrice],
        ['2K', input.unitPrice2K],
        ['4K', input.unitPrice4K],
    ] as const) {
        if (!Number.isSafeInteger(price) || price < 0)
            throw new UserInputError(`${label} 单价必须是非负整数`);
    }
    if (input.enabled && input.paidAfterFreeEnabled && input.unitPrice <= 0)
        throw new UserInputError('启用超额付费生图前必须设置大于 0 的 1K 单张价格');
    if (!Number.isInteger(input.position) || input.position < 0 || input.position > 1_000)
        throw new UserInputError('排序无效');
    assertNonNegativeInteger(input.dailyFreeImageLimit, '每日免费生图张数');
    assertNonNegativeInteger(input.dailyGenerationSafetyLimit, '每日生图安全上限');
    if (input.dailyFreeImageUnlimited && input.dailyFreeImageLimit !== 0)
        throw new UserInputError('免费生图不限次数时，张数值必须为 0');
    if (input.dailyGenerationSafetyLimit <= 0) throw new UserInputError('每日生图安全上限必须大于 0');
    if (input.enabled && !input.freeImageEnabled && !input.paidAfterFreeEnabled)
        throw new UserInputError('启用模型时，免费生图和超额付费至少开启一项');
    if (
        ![
            'OPENAI_RESPONSES_IMAGE',
            'OPENAI_IMAGES',
            'OPENAI_COMPATIBLE_CHAT',
            'GEMINI_INTERACTIONS',
            'GEMINI_NATIVE',
            'GEMINI_NATIVE_STREAM',
        ].includes(input.protocol)
    )
        throw new UserInputError('协议类型无效');
    const resolutionModel = {
        officialModelId: definition.officialModelId,
        providerModelId: input.providerModelId,
        protocol: input.protocol,
        unitPrice: input.unitPrice,
        unitPrice2K: input.unitPrice2K,
        unitPrice4K: input.unitPrice4K,
    };
    if (input.unitPrice2K > 0 && !supportsNativeResolution(resolutionModel, '2K')) {
        throw new UserInputError('当前模型或协议不支持原生 2K，请将 2K 价格设为 0');
    }
    if (input.unitPrice4K > 0 && !supportsNativeResolution(resolutionModel, '4K')) {
        throw new UserInputError('当前模型或协议不支持原生 4K，请将 4K 价格设为 0');
    }
    return definition;
}

function requiredText(value: string, maxLength: number, label: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength)
        throw new UserInputError(`${label}不能为空且不能超过 ${maxLength} 个字符`);
    return normalized;
}

function requiredCode(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/u.test(normalized)) {
        throw new UserInputError('Key 稳定编码只能包含小写字母、数字、下划线和连字符，长度 3 到 64 位');
    }
    return normalized;
}

function providerPurpose(value: string): 'PROMPT' | 'IMAGE' | 'BOTH' {
    if (value === 'PROMPT' || value === 'IMAGE' || value === 'BOTH') return value;
    throw new UserInputError('Key 用途无效');
}

function assertNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new UserInputError(`${label}必须是非负整数`);
}

function providerScope(value: string): ImageProviderScope {
    if (PROVIDER_SCOPES.includes(value as ImageProviderScope)) return value as ImageProviderScope;
    throw new UserInputError('中转站类型无效');
}

export function providerScopeForModel(
    protocol: ImageProviderProtocol,
    providerModelId: string,
): ImageProviderScope {
    return protocol === 'GEMINI_INTERACTIONS' ||
        protocol === 'GEMINI_NATIVE' ||
        protocol === 'GEMINI_NATIVE_STREAM' ||
        /^(?:models\/)?(?:gemini|imagen)-/iu.test(providerModelId.trim())
        ? 'GEMINI'
        : 'OPENAI';
}

export function modelReady(model: ImageModelConfig): boolean {
    return model.healthStatus === 'HEALTHY';
}

function safeMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function errorTelemetry(error: unknown): { actualCostMicrounits?: number; costCurrency?: string } {
    if (!error || typeof error !== 'object' || !('details' in error)) return {};
    const details = (error as { details?: unknown }).details;
    return details && typeof details === 'object' ? details : {};
}
