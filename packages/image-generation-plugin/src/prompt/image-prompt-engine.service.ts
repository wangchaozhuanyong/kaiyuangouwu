import { Injectable } from '@nestjs/common';
import {
    Customer,
    CustomerService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { ReferralWalletSpendService } from '@vendure/store-management-plugin';
import { randomUUID } from 'node:crypto';

import { MAX_PROMPT_LENGTH } from '../constants';
import { ImageGenerationConfig } from '../entities/image-generation-config.entity';
import { ImagePromptOptimization } from '../entities/image-prompt-optimization.entity';
import { imagePricingSnapshot, quoteImageMoney } from '../image-billing-quote';
import { ImageGenerationConfigService } from '../image-generation-config.service';
import { ImageUsageQuotaService } from '../image-usage-quota.service';
import { ImageProviderClient } from '../provider/image-provider.client';
import {
    type ImagePromptSpec,
    type ImageProviderScope,
    type ImageReferenceMode,
    type OptimizeImagePromptInput,
} from '../types';

import {
    detectPromptLanguage,
    promptLanguageFromLanguageCode,
    PromptRulesService,
    type PromptOutputLanguage,
} from './prompt-rules.service';

const OPTIMIZER_SYSTEM_PROMPT_BASE = [
    'You are the server-side prompt compiler for an ecommerce image studio.',
    'Return exactly one JSON object with these keys: useCase, subject, scene, composition, lighting, ',
    'camera, style, colors, materials, exactText, preserve, avoid, referenceMode.',
    'useCase must be one of product-photo, ecommerce-poster, portrait, interior-design, illustration, ',
    'reference-edit.',
    'referenceMode must be one of NONE, STYLE, COMPOSITION, IDENTITY, PRODUCT, EDIT.',
    'String arrays must contain strings only. Preserve any exact requested text verbatim. Never invent ',
    'a brand, logo, price, promotion, certification, medical claim, product claim, or identity.',
].join('\n');
const PROMPT_PROVIDER_SCOPES = ['OPENAI', 'GEMINI'] as const satisfies readonly ImageProviderScope[];

@Injectable()
export class ImagePromptEngineService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly configService: ImageGenerationConfigService,
        private readonly quota: ImageUsageQuotaService,
        private readonly walletSpend: ReferralWalletSpendService,
        private readonly providerClient: ImageProviderClient,
        private readonly rules: PromptRulesService,
    ) {}

    async optimize(ctx: RequestContext, input: OptimizeImagePromptInput) {
        const prompt = normalizePrompt(input.prompt);
        this.assertSafe(prompt);
        const customer = await this.activeCustomer(ctx);
        const shopConfig = await this.configService.shopConfig(ctx);
        if (!shopConfig.enabled || !shopConfig.promptOptimizationEnabled) {
            throw new UserInputError('当前店铺尚未开启提示词优化');
        }
        const referenceMode = normalizeReferenceMode(input.referenceMode);
        const outputLanguage = detectPromptLanguage(prompt, promptLanguageFromLanguageCode(ctx.languageCode));
        const fallback = this.rules.fallbackSpec(prompt, referenceMode, outputLanguage);
        const requestKey = normalizeIdempotencyKey(input.idempotencyKey);
        const existing = await this.connection.getRepository(ctx, ImagePromptOptimization).findOne({
            where: { channelId: ctx.channelId, customerId: customer.id, idempotencyKey: requestKey },
        });
        if (existing) {
            if (existing.source === 'PENDING') throw new UserInputError('该提示词优化请求正在处理中');
            if (existing.currencyCode !== ctx.currencyCode) {
                throw new UserInputError('请求幂等键已被其他币种的提示词优化请求使用');
            }
            return this.optimizationResult(ctx, customer, existing);
        }
        await this.consumeMinuteLimit(ctx, customer, requestKey);
        const reserved = await this.reserveOptimization(
            ctx,
            customer,
            prompt,
            fallback,
            input,
            requestKey,
            outputLanguage,
        );

        let spec = fallback;
        let source = 'FALLBACK';
        let optimizerModelId: string | null = null;
        let providerSucceeded = false;
        let telemetry: Record<string, any> | undefined;
        let credentialCode = '';
        let credentialName = '';
        let credentialLast4 = '';
        let credentialSelectionReason: string | null = null;
        let upstreamCallCount = 0;
        let providerError: string | null = null;
        const providerStartedAt = Date.now();
        try {
            const selected = await firstSuccessfulPromptProvider(async scope => {
                let lastScopeError: unknown;
                for (let routeAttempt = 0; routeAttempt < 2; routeAttempt += 1) {
                    const route = await this.configService.routeCredential(ctx, scope, undefined, 'PROMPT');
                    const routedCredential = route.credential;
                    optimizerModelId = routedCredential.textModelId;
                    credentialCode = routedCredential.code;
                    credentialName = routedCredential.name;
                    credentialLast4 = routedCredential.apiKeyLast4;
                    credentialSelectionReason = `${providerScopeName(scope)}；${route.selectionReason}`;
                    upstreamCallCount += 1;
                    try {
                        const promptResult = await this.providerClient.optimizePrompt(
                            routedCredential,
                            optimizerSystemPrompt(outputLanguage),
                            JSON.stringify({
                                prompt,
                                referenceMode,
                                targetLanguage: outputLanguage === 'zh' ? 'Simplified Chinese' : 'English',
                            }),
                        );
                        await this.configService
                            .recordCredentialRuntimeSuccess(ctx, routedCredential)
                            .catch(() => undefined);
                        return { credential: routedCredential, result: promptResult };
                    } catch (error) {
                        lastScopeError = error;
                        const details = providerFailureDetails(error);
                        await this.configService
                            .recordCredentialRuntimeFailure(ctx, routedCredential, {
                                httpStatus: details.httpStatus,
                                retryAfterSeconds: details.retryAfterSeconds,
                                message: error instanceof Error ? error.message : String(error),
                            })
                            .catch(() => undefined);
                        const safelyRejected = [401, 403, 429].includes(details.httpStatus ?? 0);
                        if (!safelyRejected || routeAttempt === 1) break;
                    }
                }
                throw errorFromUnknown(lastScopeError, `${providerScopeName(scope)} 没有可用的提示词 Key`);
            });
            const { credential: selectedCredential, result: selectedResult } = selected;
            telemetry = selectedResult.telemetry as Record<string, any> | undefined;
            const parsed = this.parseSpec(selectedResult.text);
            if (!parsed) upstreamCallCount += 1;
            spec =
                parsed ??
                (await this.repairSpec(
                    selectedCredential,
                    selectedResult.text,
                    prompt,
                    referenceMode,
                    outputLanguage,
                )) ??
                fallback;
            source = spec === fallback ? 'FALLBACK' : 'MODEL';
            providerSucceeded = source === 'MODEL';
        } catch (error) {
            spec = fallback;
            source = 'FALLBACK';
            providerError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
        }
        if (!providerSucceeded && !providerError) providerError = '上游结果无法解析，已使用本地规则结果';
        const recommendation = await this.recommendEnabledModel(ctx, spec, outputLanguage);
        const optimizedPrompt = this.rules.render(spec, outputLanguage);
        Object.assign(reserved, {
            optimizedPrompt,
            promptSpec: spec,
            source,
            optimizerModelId,
            credentialCodeSnapshot: credentialCode,
            credentialNameSnapshot: credentialName,
            credentialLast4Snapshot: credentialLast4,
            credentialSelectionReason,
            upstreamCallCount,
            latencyMs: Math.min(2_147_483_647, Date.now() - providerStartedAt),
            errorMessage: providerError,
            ...promptTelemetryValues(telemetry),
            recommendedModelCode: recommendation.model.code,
            recommendationReason: recommendation.reason,
        });
        await this.connection.withTransaction(ctx, async txCtx => {
            if (providerSucceeded) {
                if (reserved.billingMode === 'FREE' && reserved.quotaEventId) {
                    await this.quota.capture(txCtx, reserved.quotaEventId, 1);
                } else if (reserved.billingMode === 'PAID' && reserved.walletUsageId) {
                    await this.walletSpend.capture(txCtx, {
                        usageId: reserved.walletUsageId,
                        amount: reserved.chargedAmount,
                        operationKey: `PROMPT_CAPTURE:${String(reserved.id)}`,
                        actorId: txCtx.activeUserId,
                        actorType: 'CUSTOMER',
                        metadata: { promptOptimizationId: String(reserved.id) },
                    });
                }
            } else {
                if (reserved.billingMode === 'FREE' && reserved.quotaEventId) {
                    await this.quota.release(txCtx, reserved.quotaEventId, 1);
                    reserved.billingMode = 'RELEASED';
                } else if (reserved.billingMode === 'PAID' && reserved.walletUsageId) {
                    await this.walletSpend.release(txCtx, {
                        usageId: reserved.walletUsageId,
                        amount: reserved.chargedAmount,
                        operationKey: `PROMPT_RELEASE:${String(reserved.id)}`,
                        actorId: txCtx.activeUserId,
                        actorType: 'CUSTOMER',
                        metadata: { reason: '提示词优化上游失败或结果无效' },
                    });
                    reserved.chargedAmount = 0;
                    reserved.billingMode = 'REFUNDED';
                }
            }
            await this.connection.getRepository(txCtx, ImagePromptOptimization).save(reserved, {
                reload: false,
            });
        });
        return this.optimizationResult(ctx, customer, reserved);
    }

    async quotaStatus(ctx: RequestContext, currentCustomer?: Customer) {
        const customer = currentCustomer ?? (await this.activeCustomer(ctx));
        const config = await this.connection.getRepository(ctx, ImageGenerationConfig).findOne({
            where: { channelId: ctx.channelId },
        });
        const minuteLimit = config?.promptRateLimitPerMinute ?? 3;
        const dailyLimit = config?.promptDailyFreeLimit ?? 20;
        const dailyUnlimited = config?.promptDailyFreeUnlimited ?? false;
        const paidPrice = quoteImageMoney(
            ctx,
            config?.paidPromptOptimizationPrice ?? 0,
            config?.paidPromptOptimizationCurrencyCode ?? ctx.channel.defaultCurrencyCode,
        );
        const [minute, daily] = await Promise.all([
            this.quota.status(ctx, customer.id, 'PROMPT_MINUTE', minuteLimit),
            this.quota.status(ctx, customer.id, 'PROMPT_DAILY_FREE', dailyLimit, dailyUnlimited),
        ]);
        return {
            minute,
            daily,
            paidEnabled: config?.paidPromptOptimizationEnabled ?? false,
            paidPrice: paidPrice.amount,
            currencyCode: paidPrice.currencyCode,
        };
    }

    private async optimizationResult(
        ctx: RequestContext,
        customer: Customer,
        record: ImagePromptOptimization,
    ) {
        return {
            originalPrompt: record.inputPrompt,
            optimizedPrompt: record.optimizedPrompt,
            promptSpec: record.promptSpec,
            source: record.source,
            optimizerModelId: record.optimizerModelId,
            recommendedModelCode: record.recommendedModelCode,
            recommendationReason: record.recommendationReason,
            promptSkillHash: record.promptSkillHash,
            billingMode: record.billingMode,
            chargedAmount: record.chargedAmount,
            currencyCode: record.currencyCode,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            totalTokens: record.totalTokens,
            actualCostMicrounits: record.actualCostMicrounits,
            costCurrency: record.costCurrency,
            promptQuota: await this.quotaStatus(ctx, customer),
        };
    }

    async recommend(ctx: RequestContext, prompt: string, referenceMode?: ImageReferenceMode | null) {
        const normalized = normalizePrompt(prompt);
        this.assertSafe(normalized);
        if (!(await this.configService.shopConfig(ctx)).enabled) {
            throw new UserInputError('当前店铺的 AI 图片工坊不可用');
        }
        const outputLanguage = detectPromptLanguage(
            normalized,
            promptLanguageFromLanguageCode(ctx.languageCode),
        );
        const spec = this.rules.fallbackSpec(
            normalized,
            normalizeReferenceMode(referenceMode),
            outputLanguage,
        );
        const recommendation = await this.recommendEnabledModel(ctx, spec, outputLanguage);
        return {
            modelCode: recommendation.model.code,
            modelName:
                outputLanguage === 'zh'
                    ? recommendation.model.displayNameZh
                    : recommendation.model.displayNameEn,
            officialModelId: recommendation.model.officialModelId,
            unitPrice: recommendation.model.unitPrice,
            currencyCode: recommendation.model.currencyCode,
            reason: recommendation.reason,
            promptSkillHash: this.rules.sourceHash,
        };
    }

    async adminAudit(ctx: RequestContext, skip = 0, take = 50) {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ImagePromptOptimization)
            .findAndCount({
                where: { channelId: ctx.channelId },
                relations: { customer: true },
                order: { createdAt: 'DESC' },
                skip: Math.max(0, Math.floor(skip || 0)),
                take: Math.min(100, Math.max(1, Math.floor(take || 50))),
            });
        return { items, totalItems };
    }

    assertSafe(prompt: string): void {
        const blocked = [
            /(?:未成年|儿童|小学生|幼女|幼男|child|minor).{0,24}(?:色情|裸体|裸露|性|sexy|nude|sexual)/iu,
            /(?:(?:换脸|face\s*swap).{0,40}(?:总统|总理|主席|明星|名人|public\s*figure)|(?:总统|总理|主席|明星|名人|public\s*figure).{0,40}(?:换脸|face\s*swap))/iu,
            /(?:deepfake|深度伪造).{0,40}(?:诈骗|欺诈|冒充|勒索|fraud|scam)/iu,
            /(?:去除|移除|erase|remove).{0,20}(?:水印|watermark|provenance|来源标记)/iu,
            /(?:非自愿|偷拍|报复性).{0,24}(?:裸照|色情|intimate|nude)/iu,
        ];
        if (blocked.some(pattern => pattern.test(prompt))) {
            throw new UserInputError(
                '该请求涉及禁止的未成年人、非自愿私密内容、冒充欺诈或来源伪造，无法处理',
            );
        }
    }

    private async reserveOptimization(
        ctx: RequestContext,
        customer: Customer,
        prompt: string,
        fallback: ImagePromptSpec,
        input: OptimizeImagePromptInput,
        requestKey: string,
        outputLanguage: PromptOutputLanguage,
    ): Promise<ImagePromptOptimization> {
        return this.connection.withTransaction(ctx, async txCtx => {
            if (supportsRateLimitLock(this.connection.rawConnection.options.type)) {
                await this.connection
                    .getRepository(txCtx, Customer)
                    .createQueryBuilder('customer')
                    .setLock('pessimistic_write')
                    .where('customer.id = :id', { id: customer.id })
                    .getOne();
            }
            const repository = this.connection.getRepository(txCtx, ImagePromptOptimization);
            const config = await this.connection.getRepository(txCtx, ImageGenerationConfig).findOne({
                where: { channelId: txCtx.channelId },
            });
            if (!config) throw new UserInputError('找不到图片工坊配置');
            const existing = await repository.findOne({
                where: { channelId: txCtx.channelId, customerId: customer.id, idempotencyKey: requestKey },
            });
            if (existing) {
                if (existing.currencyCode !== txCtx.currencyCode) {
                    throw new UserInputError('请求幂等键已被其他币种的提示词优化请求使用');
                }
                return existing;
            }
            const priceQuote = quoteImageMoney(
                txCtx,
                config.paidPromptOptimizationPrice,
                config.paidPromptOptimizationCurrencyCode,
            );
            const record = await repository.save(
                new ImagePromptOptimization({
                    channelId: txCtx.channelId,
                    customerId: customer.id,
                    inputPrompt: prompt,
                    optimizedPrompt: this.rules.render(fallback, outputLanguage),
                    promptSpec: fallback as unknown as Record<string, any>,
                    source: 'PENDING',
                    optimizerModelId: null,
                    promptSkillHash: this.rules.sourceHash,
                    recommendedModelCode: 'GEMINI_FLASH',
                    recommendationReason: '正在生成推荐',
                    idempotencyKey: requestKey,
                    billingMode: 'PENDING',
                    chargedAmount: 0,
                    pricingSnapshot: imagePricingSnapshot(priceQuote),
                    currencyCode: priceQuote.currencyCode,
                    walletUsageId: null,
                    quotaEventId: null,
                    inputTokens: null,
                    outputTokens: null,
                    totalTokens: null,
                    actualCostMicrounits: null,
                    costCurrency: null,
                    providerRequestId: null,
                    credentialCodeSnapshot: '',
                    credentialNameSnapshot: '',
                    credentialLast4Snapshot: '',
                    credentialSelectionReason: null,
                    upstreamCallCount: 0,
                    latencyMs: 0,
                    errorMessage: null,
                }),
            );
            const free = await this.quota.reserve(txCtx, {
                customerId: customer.id,
                quotaType: 'PROMPT_DAILY_FREE',
                limit: config.promptDailyFreeLimit,
                unlimited: config.promptDailyFreeUnlimited,
                requestedAmount: 1,
                allowPartial: true,
                idempotencyKey: `PROMPT_DAILY:${String(txCtx.channelId)}:${String(customer.id)}:${requestKey}`,
                resourceType: 'PROMPT_OPTIMIZATION',
                resourceId: String(record.id),
            });
            if (free) {
                record.billingMode = 'FREE';
                record.quotaEventId = free.id;
            } else {
                if (!config.paidPromptOptimizationEnabled || config.paidPromptOptimizationPrice <= 0) {
                    throw new UserInputError('今天的免费提示词优化额度已用完，管理员尚未开启付费优化');
                }
                if (
                    input.expectedPrice !== priceQuote.amount ||
                    input.currencyCode !== priceQuote.currencyCode
                ) {
                    throw new UserInputError('PRICE_CHANGED：提示词优化价格已更新，请刷新后重试');
                }
                const usage = await this.walletSpend.reserve(txCtx, {
                    customerId: customer.id,
                    currencyCode: priceQuote.currencyCode,
                    amount: priceQuote.amount,
                    resourceType: 'IMAGE_PROMPT_OPTIMIZATION',
                    resourceId: String(record.id),
                    idempotencyKey: `PROMPT_PAID:${String(txCtx.channelId)}:${String(customer.id)}:${requestKey}`,
                    actorId: txCtx.activeUserId,
                    actorType: 'CUSTOMER',
                    metadata: { pricingSnapshot: imagePricingSnapshot(priceQuote) },
                });
                record.billingMode = 'PAID';
                record.chargedAmount = priceQuote.amount;
                record.walletUsageId = usage.id;
            }
            return repository.save(record);
        });
    }

    private async consumeMinuteLimit(ctx: RequestContext, customer: Customer, requestKey: string) {
        await this.connection.withTransaction(ctx, async txCtx => {
            if (supportsRateLimitLock(this.connection.rawConnection.options.type)) {
                await this.connection
                    .getRepository(txCtx, Customer)
                    .createQueryBuilder('customer')
                    .setLock('pessimistic_write')
                    .where('customer.id = :id', { id: customer.id })
                    .getOne();
            }
            const config = await this.connection.getRepository(txCtx, ImageGenerationConfig).findOne({
                where: { channelId: txCtx.channelId },
            });
            if (!config) throw new UserInputError('找不到图片工坊配置');
            await this.quota.consumeAttempt(txCtx, {
                customerId: customer.id,
                quotaType: 'PROMPT_MINUTE',
                limit: config.promptRateLimitPerMinute,
                idempotencyKey: `PROMPT_MINUTE:${String(txCtx.channelId)}:${String(customer.id)}:${requestKey}`,
                resourceType: 'PROMPT_OPTIMIZATION_ATTEMPT',
                resourceId: requestKey,
            });
        });
    }

    private async repairSpec(
        credential: Awaited<ReturnType<ImageGenerationConfigService['requireCredential']>>,
        invalidJson: string,
        prompt: string,
        referenceMode: ImageReferenceMode,
        outputLanguage: PromptOutputLanguage,
    ): Promise<ImagePromptSpec | undefined> {
        try {
            const repaired = await this.providerClient.optimizePrompt(
                credential,
                `${optimizerSystemPrompt(outputLanguage)}\nThe previous output was invalid. Repair it and output valid JSON only.`,
                JSON.stringify({
                    prompt,
                    referenceMode,
                    targetLanguage: outputLanguage === 'zh' ? 'Simplified Chinese' : 'English',
                    invalidOutput: invalidJson.slice(0, 4_000),
                }),
            );
            return this.parseSpec(repaired.text);
        } catch {
            return;
        }
    }

    private parseSpec(raw: string): ImagePromptSpec | undefined {
        try {
            const cleaned = raw
                .trim()
                .replace(/^```(?:json)?\s*/iu, '')
                .replace(/\s*```$/u, '');
            return this.rules.validateSpec(JSON.parse(cleaned));
        } catch {
            return;
        }
    }

    private async recommendEnabledModel(
        ctx: RequestContext,
        spec: ImagePromptSpec,
        outputLanguage: PromptOutputLanguage,
    ) {
        const preferred = this.rules.recommendation(spec);
        const { models } = await this.configService.shopConfig(ctx);
        const healthy = models;
        const selected =
            healthy.find(model => model.code === preferred.modelCode) ??
            healthy.find(model => model.isDefault) ??
            healthy[0];
        if (!selected) throw new UserInputError('当前没有可用的生图模型');
        return {
            model: selected,
            reason:
                selected.code === preferred.modelCode
                    ? outputLanguage === 'zh'
                        ? preferred.reasonZh
                        : preferred.reasonEn
                    : outputLanguage === 'zh'
                      ? `推荐模型当前不可用，已选择可用的 ${selected.displayNameZh}`
                      : `The recommended model is unavailable. Using ${selected.displayNameEn} instead.`,
        };
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('找不到当前客户');
        return customer;
    }
}

export function optimizerSystemPrompt(language: PromptOutputLanguage): string {
    const languageInstruction =
        language === 'zh'
            ? [
                  'Write subject, scene, composition, lighting, camera, style, colors, materials, preserve,',
                  'and avoid entirely in Simplified Chinese. Do not mix in English except for exact user',
                  'text, brand names, product names, and model names.',
              ].join(' ')
            : [
                  'Write subject, scene, composition, lighting, camera, style, colors, materials, preserve,',
                  'and avoid entirely in English. Do not mix in another language except for exact user text,',
                  'brand names, product names, and model names.',
              ].join(' ');
    return `${OPTIMIZER_SYSTEM_PROMPT_BASE}\n${languageInstruction}`;
}

export async function firstSuccessfulPromptProvider<T>(
    attempt: (scope: ImageProviderScope) => Promise<T>,
): Promise<T> {
    let lastError: unknown;
    for (const scope of PROMPT_PROVIDER_SCOPES) {
        try {
            return await attempt(scope);
        } catch (error) {
            lastError = error;
        }
    }
    throw errorFromUnknown(lastError, '没有可用的提示词优化 Key');
}

function providerScopeName(scope: ImageProviderScope): string {
    return scope === 'OPENAI' ? 'GPT/OpenAI' : 'Gemini';
}

function errorFromUnknown(error: unknown, fallbackMessage: string): Error {
    if (error instanceof Error) return error;
    return new UserInputError(typeof error === 'string' && error.trim() ? error : fallbackMessage);
}

function normalizePrompt(value: string): string {
    const normalized = value.trim();
    if (!normalized) throw new UserInputError('请输入图片描述');
    if (normalized.length > MAX_PROMPT_LENGTH)
        throw new UserInputError(`图片描述不能超过 ${MAX_PROMPT_LENGTH} 个字符`);
    return normalized;
}

function normalizeReferenceMode(value?: ImageReferenceMode | null): ImageReferenceMode {
    return value && ['STYLE', 'COMPOSITION', 'IDENTITY', 'PRODUCT', 'EDIT'].includes(value) ? value : 'NONE';
}

function normalizeIdempotencyKey(value?: string | null): string {
    const normalized = value?.trim() || randomUUID();
    if (!/^[a-zA-Z0-9:_-]{8,64}$/u.test(normalized)) {
        throw new UserInputError('请求幂等键格式无效');
    }
    return normalized;
}

function promptTelemetryValues(telemetry?: Record<string, any>) {
    const usage = telemetry?.usage && typeof telemetry.usage === 'object' ? telemetry.usage : {};
    const inputTokens = integerOrNull(usage.input_tokens ?? usage.prompt_tokens);
    const outputTokens = integerOrNull(usage.output_tokens ?? usage.completion_tokens);
    return {
        inputTokens,
        outputTokens,
        totalTokens:
            integerOrNull(usage.total_tokens) ??
            (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null),
        actualCostMicrounits: integerOrNull(telemetry?.actualCostMicrounits),
        costCurrency: typeof telemetry?.costCurrency === 'string' ? telemetry.costCurrency.slice(0, 3) : null,
        providerRequestId:
            typeof telemetry?.providerRequestId === 'string'
                ? telemetry.providerRequestId.slice(0, 200)
                : null,
    };
}

function integerOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function providerFailureDetails(error: unknown): { httpStatus?: number; retryAfterSeconds?: number } {
    if (!error || typeof error !== 'object' || !('details' in error)) return {};
    const details = (error as { details?: unknown }).details;
    return details && typeof details === 'object' ? details : {};
}

export function startOfBeijingDay(now: number): Date {
    const offsetMs = 8 * 60 * 60_000;
    const shifted = new Date(now + offsetMs);
    return new Date(
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - offsetMs,
    );
}

function supportsRateLimitLock(driverType: unknown): boolean {
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
