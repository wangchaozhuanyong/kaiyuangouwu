import { Injectable } from '@nestjs/common';
import {
    Customer,
    CustomerService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { MoreThanOrEqual } from 'typeorm';
import type { ImagePromptSpec, ImageReferenceMode, OptimizeImagePromptInput } from '../types';

import { MAX_PROMPT_LENGTH } from '../constants';
import { ImageModelConfig } from '../entities/image-model-config.entity';
import { ImagePromptOptimization } from '../entities/image-prompt-optimization.entity';
import { ImageGenerationConfigService } from '../image-generation-config.service';
import { ImageProviderClient } from '../provider/image-provider.client';

import { PromptRulesService } from './prompt-rules.service';

const OPTIMIZER_SYSTEM_PROMPT = [
    'You are the server-side prompt compiler for an ecommerce image studio.',
    'Return exactly one JSON object with these keys: useCase, subject, scene, composition, lighting, ',
    'camera, style, colors, materials, exactText, preserve, avoid, referenceMode.',
    'useCase must be one of product-photo, ecommerce-poster, portrait, interior-design, illustration, ',
    'reference-edit.',
    'referenceMode must be one of NONE, STYLE, COMPOSITION, IDENTITY, PRODUCT, EDIT.',
    'String arrays must contain strings only. Preserve any exact requested text verbatim. Never invent ',
    'a brand, logo, price, promotion, certification, medical claim, product claim, or identity.',
].join('\n');

@Injectable()
export class ImagePromptEngineService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly configService: ImageGenerationConfigService,
        private readonly providerClient: ImageProviderClient,
        private readonly rules: PromptRulesService,
    ) {}

    async optimize(ctx: RequestContext, input: OptimizeImagePromptInput) {
        const prompt = normalizePrompt(input.prompt);
        this.assertSafe(prompt);
        const customer = await this.activeCustomer(ctx);
        const shopConfig = await this.configService.shopConfig(ctx);
        if (!shopConfig.enabled || !shopConfig.promptOptimizationEnabled) {
            throw new UserInputError('当前店铺尚未开启免费提示词优化');
        }
        const referenceMode = normalizeReferenceMode(input.referenceMode);
        const fallback = this.rules.fallbackSpec(prompt, referenceMode);
        const reserved = await this.reserveRateLimitSlot(ctx, customer, prompt, fallback);

        let spec = fallback;
        let source = 'FALLBACK';
        let optimizerModelId: string | null = null;
        try {
            const credential = await this.configService.requireCredential(ctx);
            optimizerModelId = credential.textModelId;
            const raw = await this.providerClient.optimizePrompt(
                credential,
                OPTIMIZER_SYSTEM_PROMPT,
                JSON.stringify({ prompt, referenceMode }),
            );
            spec =
                this.parseSpec(raw) ??
                (await this.repairSpec(credential, raw, prompt, referenceMode)) ??
                fallback;
            source = spec === fallback ? 'FALLBACK' : 'MODEL';
        } catch {
            spec = fallback;
            source = 'FALLBACK';
        }
        const recommendation = await this.recommendEnabledModel(ctx, spec);
        const optimizedPrompt = this.rules.render(spec);
        Object.assign(reserved, {
            optimizedPrompt,
            promptSpec: spec,
            source,
            optimizerModelId,
            recommendedModelCode: recommendation.model.code,
            recommendationReason: recommendation.reason,
        });
        await this.connection.getRepository(ctx, ImagePromptOptimization).save(reserved, { reload: false });
        return {
            originalPrompt: prompt,
            optimizedPrompt,
            promptSpec: spec,
            source,
            recommendedModelCode: recommendation.model.code,
            recommendationReason: recommendation.reason,
            promptSkillHash: this.rules.sourceHash,
        };
    }

    async recommend(ctx: RequestContext, prompt: string, referenceMode?: ImageReferenceMode | null) {
        const normalized = normalizePrompt(prompt);
        this.assertSafe(normalized);
        if (!(await this.configService.shopConfig(ctx)).enabled) {
            throw new UserInputError('当前店铺的 AI 图片工坊不可用');
        }
        const spec = this.rules.fallbackSpec(normalized, normalizeReferenceMode(referenceMode));
        const recommendation = await this.recommendEnabledModel(ctx, spec);
        return {
            modelCode: recommendation.model.code,
            modelName: recommendation.model.displayNameZh,
            officialModelId: recommendation.model.officialModelId,
            unitPrice: recommendation.model.unitPrice,
            currencyCode: recommendation.model.currencyCode,
            reason: recommendation.reason,
            promptSkillHash: this.rules.sourceHash,
        };
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

    private async reserveRateLimitSlot(
        ctx: RequestContext,
        customer: Customer,
        prompt: string,
        fallback: ImagePromptSpec,
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
            const now = Date.now();
            const [minuteCount, dayCount] = await Promise.all([
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        createdAt: MoreThanOrEqual(new Date(now - 60_000)),
                    },
                }),
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        createdAt: MoreThanOrEqual(startOfBeijingDay(now)),
                    },
                }),
            ]);
            if (minuteCount >= 3) throw new UserInputError('提示词优化每分钟最多使用 3 次，请稍后再试');
            if (dayCount >= 20) throw new UserInputError('今天的 20 次免费提示词优化额度已用完');
            return repository.save(
                new ImagePromptOptimization({
                    channelId: txCtx.channelId,
                    customerId: customer.id,
                    inputPrompt: prompt,
                    optimizedPrompt: this.rules.render(fallback),
                    promptSpec: fallback as unknown as Record<string, any>,
                    source: 'PENDING',
                    optimizerModelId: null,
                    promptSkillHash: this.rules.sourceHash,
                    recommendedModelCode: 'GEMINI_FLASH',
                    recommendationReason: '正在生成推荐',
                }),
            );
        });
    }

    private async repairSpec(
        credential: Awaited<ReturnType<ImageGenerationConfigService['requireCredential']>>,
        invalidJson: string,
        prompt: string,
        referenceMode: ImageReferenceMode,
    ): Promise<ImagePromptSpec | undefined> {
        try {
            const repaired = await this.providerClient.optimizePrompt(
                credential,
                `${OPTIMIZER_SYSTEM_PROMPT}\nThe previous output was invalid. Repair it and output valid JSON only.`,
                JSON.stringify({ prompt, referenceMode, invalidOutput: invalidJson.slice(0, 4_000) }),
            );
            return this.parseSpec(repaired);
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
    ): Promise<{ model: ImageModelConfig; reason: string }> {
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
                    ? preferred.reasonZh
                    : `推荐模型当前不可用，已选择可用的 ${selected.displayNameZh}`,
        };
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('找不到当前客户');
        return customer;
    }
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
