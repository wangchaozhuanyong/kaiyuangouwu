import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHash, randomUUID } from 'node:crypto';

import { IMAGE_HEALTH_MAX_AGE_MS, launchModelDefinitions, retiredLaunchModelCodes } from './constants';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePromptSkillRelease } from './entities/image-prompt-skill-release.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';
import { PromptRulesService } from './prompt/prompt-rules.service';
import { ImageProviderClient } from './provider/image-provider.client';
import { ImageProviderCipherService } from './security/image-provider-cipher.service';
import { SafeProviderUrlService } from './security/safe-provider-url.service';
import {
    ImageProviderProtocol,
    ImageProviderScope,
    SaveImageGenerationConfigInput,
    SaveImageModelInput,
    SaveImageProviderCredentialInput,
} from './types';

const DEFAULT_TERMS_ZH =
    '我确认拥有提示词和参考图的使用权；内容会发送至第三方中转站及模型提供方；生成结果可能存在错误；禁止违法、侵权、冒充、欺诈及未成年人敏感内容。参考图在任务结束后保留24小时，提示词优化记录保留30天，生成图和任务提示词默认保留90天。';
const DEFAULT_TERMS_EN = [
    'I have rights to the prompt and reference image. Content is sent to the relay and model provider. ',
    'AI output may be inaccurate. Illegal, infringing, deceptive, impersonation, fraud, and sensitive ',
    'minor content are prohibited. References are kept 24 hours after completion, prompt optimizations ',
    'for 30 days, and generated outputs and job prompts for 90 days.',
].join('');
const PROVIDER_SCOPES = ['OPENAI', 'GEMINI'] as const satisfies readonly ImageProviderScope[];

@Injectable()
export class ImageGenerationConfigService implements OnApplicationBootstrap {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cipher: ImageProviderCipherService,
        private readonly safeUrls: SafeProviderUrlService,
        private readonly providerClient: ImageProviderClient,
        private readonly rules: PromptRulesService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(ImagePromptSkillRelease);
        let release = await repository.findOne({ where: { sourceHash: this.rules.sourceHash } });
        const active = await repository.findOne({
            where: { status: 'ACTIVE' },
            order: { activatedAt: 'DESC' },
        });
        if (!release) {
            release = await repository.save(
                new ImagePromptSkillRelease({
                    bundleVersion: Number(this.rules.serializableBundle.bundleVersion ?? 1),
                    sourceHash: this.rules.sourceHash,
                    status: active ? 'INACTIVE' : 'ACTIVE',
                    bundle: this.rules.serializableBundle,
                    activatedAt: active ? null : new Date(),
                }),
            );
        }
        const selected = active ?? release;
        this.rules.activateBundle(selected.bundle);
    }

    async adminConfig(ctx: RequestContext) {
        await this.synchronizeActiveSkillRelease();
        const config = await this.getOrCreateConfig(ctx);
        const models = await this.getOrCreateModels(ctx);
        const credentials = await Promise.all(
            PROVIDER_SCOPES.map(scope => this.credential(undefined, scope)),
        );
        return {
            ...config,
            models,
            credentialEnabled: credentials.some(credential => credential?.enabled),
            activeSkillHash: this.rules.sourceHash,
        };
    }

    async providerAdminConfigs(ctx?: RequestContext) {
        return Promise.all(PROVIDER_SCOPES.map(scope => this.providerAdminConfig(ctx, scope)));
    }

    async providerAdminConfig(ctx: RequestContext | undefined, scope: ImageProviderScope) {
        const credential = await this.credential(ctx, scope);
        return {
            scope,
            credentialConfigured: Boolean(credential?.encryptedApiKey),
            credentialEnabled: credential?.enabled ?? false,
            baseUrl: credential?.baseUrl ?? '',
            apiKeyLast4: credential?.apiKeyLast4 ?? '',
            textModelId: credential?.textModelId ?? '',
            providerHealthStatus: credential?.healthStatus ?? 'UNCONFIGURED',
            providerHealthMessage: credential?.healthMessage ?? null,
        };
    }

    async shopConfig(ctx: RequestContext) {
        await this.synchronizeActiveSkillRelease();
        const config = await this.getConfig(ctx);
        const [openAiCredential, geminiCredential, models] = await Promise.all([
            this.credential(undefined, 'OPENAI'),
            this.credential(undefined, 'GEMINI'),
            this.getOrCreateModels(ctx),
        ]);
        const credentials = new Map<ImageProviderScope, ImageProviderCredential | null>([
            ['OPENAI', openAiCredential],
            ['GEMINI', geminiCredential],
        ]);
        const availableModels = models.filter(model => {
            if (!model.enabled) return false;
            const credential = credentials.get(providerScopeForModel(model.protocol, model.providerModelId));
            return modelReady(model) && credentialReady(credential);
        });
        const optimizerAvailable =
            credentialReady(openAiCredential) && Boolean(openAiCredential?.textModelId.trim());
        return {
            enabled: config.enabled && availableModels.length > 0,
            promptOptimizationEnabled: config.promptOptimizationEnabled && optimizerAvailable,
            defaultModelCode: config.defaultModelCode,
            termsVersion: config.termsVersion,
            termsZh: config.termsZh,
            termsEn: config.termsEn,
            outputRetentionDays: 90,
            referenceRetentionHours: 24,
            maxReferenceBytes: 10 * 1024 * 1024,
            maxReferencePixels: 40_000_000,
            maxQuantity: 4,
            resolution: '1K',
            models: availableModels,
        };
    }

    async saveConfig(ctx: RequestContext, input: SaveImageGenerationConfigInput) {
        await this.connection.withTransaction(ctx, async txCtx => {
            const config = await this.getOrCreateConfig(txCtx);
            const models = await this.getOrCreateModels(txCtx);
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
            config.defaultModelCode = input.defaultModelCode;
            config.termsVersion = requiredText(input.termsVersion, 32, '条款版本');
            config.termsZh = requiredText(input.termsZh, 8_000, '中文条款');
            config.termsEn = requiredText(input.termsEn, 8_000, '英文条款');
            await this.connection.getRepository(txCtx, ImageGenerationConfig).save(config, { reload: false });
            await this.connection
                .getRepository(txCtx, ImageModelConfig)
                .createQueryBuilder()
                .update(ImageModelConfig)
                .set({ isDefault: false })
                .where('channelId = :channelId', { channelId: txCtx.channelId })
                .execute();
            await this.connection
                .getRepository(txCtx, ImageModelConfig)
                .update({ channelId: txCtx.channelId, code: input.defaultModelCode }, { isDefault: true });
        });
        return this.adminConfig(ctx);
    }

    async saveCredential(ctx: RequestContext, input: SaveImageProviderCredentialInput) {
        const baseUrl = await this.safeUrls.validate(input.baseUrl.trim());
        const repository = this.connection.getRepository(ctx, ImageProviderCredential);
        const scope = providerScope(input.scope);
        let credential = await this.credential(ctx, scope);
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
            enabled: input.enabled,
            baseUrl: normalizedBaseUrl,
            textModelId,
            encryptedApiKey,
            apiKeyLast4: apiKey ? apiKey.slice(-4) : (credential?.apiKeyLast4 ?? ''),
            healthStatus: connectionChanged ? 'UNTESTED' : (credential?.healthStatus ?? 'UNTESTED'),
            healthMessage: connectionChanged ? null : (credential?.healthMessage ?? null),
            lastTestedAt: connectionChanged ? null : (credential?.lastTestedAt ?? null),
        };
        credential = await repository.save(
            credential ? Object.assign(credential, values) : new ImageProviderCredential(values),
        );
        return this.providerAdminConfig(ctx, scope);
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
        const credential = await this.requireConfiguredCredential(
            ctx,
            providerScopeForModel(model.protocol, model.providerModelId),
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
        const credential = await this.requireConfiguredCredential(ctx, scope);
        if (!credential.enabled || !healthIsFresh(credential.lastTestedAt)) {
            throw new UserInputError('请先完成中转站连接测试');
        }
        const startedAt = Date.now();
        try {
            const result = await this.providerClient.generate(credential, model.protocol, {
                providerModelId: model.providerModelId,
                prompt: 'A simple blue circle centered on a clean white background, no text.',
                aspectRatio: '1:1',
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

    async saveModel(ctx: RequestContext, input: SaveImageModelInput) {
        const definition = launchModelDefinitions.find(model => model.code === input.code);
        if (!definition) throw new UserInputError('只支持当前已审核的生图模型');
        if (!Number.isSafeInteger(input.unitPrice) || input.unitPrice < 0)
            throw new UserInputError('单价必须是非负整数');
        if (input.enabled && input.unitPrice <= 0)
            throw new UserInputError('启用模型前必须设置大于 0 的单张价格');
        if (!Number.isInteger(input.position) || input.position < 0 || input.position > 1_000)
            throw new UserInputError('排序无效');
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
            let model = existingModels.find(item => item.code === input.code) ?? null;
            const mappingChanged =
                !model ||
                model.providerModelId !== input.providerModelId.trim() ||
                model.protocol !== input.protocol;
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
                currencyCode: input.currencyCode,
                position: input.position,
                isDefault: input.isDefault,
                supportsIdempotency: input.supportsIdempotency,
                healthStatus: mappingChanged ? 'UNTESTED' : (model?.healthStatus ?? 'UNTESTED'),
                healthMessage: mappingChanged ? null : (model?.healthMessage ?? null),
                lastTestedAt: mappingChanged ? null : (model?.lastTestedAt ?? null),
                consecutiveFailures: mappingChanged ? 0 : (model?.consecutiveFailures ?? 0),
            };
            model = await repository.save(
                model ? Object.assign(model, values) : new ImageModelConfig(values),
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
        ctx?: RequestContext,
        scope: ImageProviderScope = 'OPENAI',
    ): Promise<ImageProviderCredential> {
        return this.requireConfiguredCredential(ctx, scope).then(value => {
            if (!credentialReady(value))
                throw new UserInputError(`${scope} 生图中转站尚未启用或未通过连接测试`);
            return value;
        });
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
        if (result.authFailure && result.credentialScope) {
            await this.connection.getRepository(ctx, ImageProviderCredential).update(
                { scope: result.credentialScope },
                {
                    healthStatus: 'UNHEALTHY',
                    healthMessage: '运行时鉴权失败，请检查 API Key',
                    lastTestedAt: new Date(),
                },
            );
        }
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
        const credential = await repository.findOne({ where: { scope } });
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
                defaultModelCode: 'OPENAI_HIGH_QUALITY',
                termsVersion: '2026-08-27',
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
                        currencyCode,
                        position,
                        isDefault: definition.code === 'OPENAI_HIGH_QUALITY',
                        supportsIdempotency: false,
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

function requiredText(value: string, maxLength: number, label: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength)
        throw new UserInputError(`${label}不能为空且不能超过 ${maxLength} 个字符`);
    return normalized;
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

function credentialReady(credential: ImageProviderCredential | null | undefined): boolean {
    return Boolean(
        credential?.enabled &&
        credential.healthStatus === 'HEALTHY' &&
        healthIsFresh(credential.lastTestedAt),
    );
}

export function modelReady(model: ImageModelConfig): boolean {
    return model.healthStatus === 'HEALTHY' && healthIsFresh(model.lastTestedAt);
}

function healthIsFresh(lastTestedAt: Date | null | undefined): boolean {
    return Boolean(lastTestedAt && lastTestedAt.getTime() >= Date.now() - IMAGE_HEALTH_MAX_AGE_MS);
}

function safeMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function errorTelemetry(error: unknown): { actualCostMicrounits?: number; costCurrency?: string } {
    if (!error || typeof error !== 'object' || !('details' in error)) return {};
    const details = (error as { details?: unknown }).details;
    return details && typeof details === 'object'
        ? (details as { actualCostMicrounits?: number; costCurrency?: string })
        : {};
}
