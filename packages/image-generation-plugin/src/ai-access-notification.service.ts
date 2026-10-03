import { Injectable } from '@nestjs/common';
import {
    Channel,
    LanguageCode,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { AdminNotificationService } from '@vendure/operations-dashboard-plugin';
import { IsNull } from 'typeorm';

import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePromptModelConfig } from './entities/image-prompt-model-config.entity';
import { ImageProviderCredentialModel } from './entities/image-provider-credential-model.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';
import { aiAccessReason } from './provider/ai-access-failure';
import { ImageProviderRouterService } from './provider/image-provider-router.service';
import { ImageProviderScope, ProviderTelemetry } from './types';

@Injectable()
export class AiAccessNotificationService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly notifications: AdminNotificationService,
        private readonly contexts: RequestContextService,
        private readonly router: ImageProviderRouterService,
    ) {}
    async result(
        ctx: RequestContext,
        id: string,
        purpose: 'IMAGE' | 'PROMPT',
        telemetry: ProviderTelemetry,
        ok: boolean,
    ) {
        const fingerprint = `ai.access:${purpose}:${id}`;
        if (ok) {
            await this.notifications.resolveIncident(ctx, fingerprint, {
                reason: '真实上游调用或已有连接检测成功，凭证已恢复',
            });
            return;
        }
        if (!telemetry.accessFailure) return;
        await this.connection
            .getRepository(ctx, purpose === 'PROMPT' ? ImagePromptModelConfig : ImageProviderCredential)
            .update(
                { id },
                { healthStatus: 'UNHEALTHY', healthMessage: aiAccessReason[telemetry.accessFailure] },
            );
        const configs = await this.connection.rawConnection
            .getRepository(ImageGenerationConfig)
            .find({ where: { enabled: true }, relations: ['channel'] });
        let affected = configs;
        if (purpose === 'IMAGE') {
            const bindings = await this.connection
                .getRepository(ctx, ImageProviderCredentialModel)
                .find({ where: { credentialId: id }, relations: ['modelConfig'] });
            const ids = new Set(bindings.map(binding => String(binding.modelConfig.channelId)));
            if (ids.size) affected = configs.filter(config => ids.has(String(config.channelId)));
        } else affected = configs.filter(config => config.promptOptimizationEnabled);
        const fallback =
            purpose === 'PROMPT'
                ? (
                      await this.connection
                          .getRepository(ctx, ImagePromptModelConfig)
                          .find({ where: { enabled: true, archivedAt: IsNull(), healthStatus: 'HEALTHY' } })
                  ).some(
                      model =>
                          String(model.id) !== id &&
                          (!model.cooldownUntil || model.cooldownUntil <= new Date()),
                  )
                : (
                      await this.connection
                          .getRepository(ctx, ImageProviderCredential)
                          .find({ where: { enabled: true, archivedAt: IsNull(), healthStatus: 'HEALTHY' } })
                  ).some(
                      key =>
                          String(key.id) !== id &&
                          ['IMAGE', 'BOTH'].includes(key.purpose) &&
                          (!key.cooldownUntil || key.cooldownUntil <= new Date()),
                  );
        await this.notifications.upsertIncident(null, {
            eventType: 'ai.access.unavailable',
            category: 'AI_ACCESS',
            severity: 'P1',
            sourceType: purpose === 'PROMPT' ? 'ImagePromptModelConfig' : 'ImageProviderCredential',
            sourceId: id,
            fingerprint,
            title: '人工智能调用凭证异常',
            payload: {
                accessId: id,
                purpose: purpose === 'PROMPT' ? '提示词优化' : '图片生成',
                reason: aiAccessReason[telemetry.accessFailure],
                affectedStores: affected.map(config => name(config.channel)),
                fallback: fallback
                    ? '存在其他健康通道，模型绑定与实际可用性以店铺服务监测为准'
                    : '未发现备用通道',
                adminPath: '/settings/image-generation',
            },
        });
    }
    /** Read-only availability checks; never send a paid generation probe. */
    async reconcile() {
        const configs = await this.connection.rawConnection
            .getRepository(ImageGenerationConfig)
            .find({ where: { enabled: true }, relations: ['channel'] });
        for (const config of configs) {
            const ctx = await this.contexts.create({
                apiType: 'admin',
                channelOrToken: config.channel,
                languageCode: LanguageCode.zh_Hans,
            });
            const models = await this.connection
                .getRepository(ctx, ImageModelConfig)
                .find({ where: { channelId: config.channelId, enabled: true } });
            let imageAvailable = false;
            for (const model of models)
                if (
                    await this.router.hasAvailable(ctx, {
                        scope: scopeForModel(model.protocol, model.providerModelId),
                        purpose: 'IMAGE',
                        modelConfigId: model.id,
                    })
                ) {
                    imageAvailable = true;
                    break;
                }
            await this.serviceState(
                ctx,
                'IMAGE',
                imageAvailable,
                models.length
                    ? '已启用模型没有健康且符合绑定规则的调用通道；暂未确认是凭证失效还是通道配置问题'
                    : '店铺已启用图片服务，但尚未启用图片模型',
            );
            if (config.promptOptimizationEnabled) {
                const pool = await this.connection
                    .getRepository(ctx, ImagePromptModelConfig)
                    .find({ where: { enabled: true, archivedAt: IsNull(), healthStatus: 'HEALTHY' } });
                await this.serviceState(
                    ctx,
                    'PROMPT',
                    pool.some(model => !model.cooldownUntil || model.cooldownUntil <= new Date()),
                    '已启用提示词服务没有健康且未处于冷却期的调用通道；暂未确认凭证失效',
                );
            } else
                await this.notifications.resolveIncident(ctx, `ai.service:${ctx.channelId}:PROMPT`, {
                    reason: '店铺已关闭提示词服务',
                });
        }
    }
    private async serviceState(
        ctx: RequestContext,
        purpose: 'IMAGE' | 'PROMPT',
        available: boolean,
        reason: string,
    ) {
        const fingerprint = `ai.service:${ctx.channelId}:${purpose}`;
        if (available)
            return this.notifications.resolveIncident(ctx, fingerprint, {
                reason: '只读配置检查发现可用通道；上游凭证恢复仍以真实调用或连接检测为准',
            });
        return this.notifications.upsertIncident(ctx, {
            eventType: 'ai.service.unavailable',
            category: 'AI_ACCESS',
            severity: 'P0',
            fingerprint,
            title: '人工智能服务暂无可用通道',
            payload: {
                channelId: String(ctx.channelId),
                purpose: purpose === 'PROMPT' ? '提示词优化' : '图片生成',
                reason,
                adminPath: '/settings/image-generation',
            },
        });
    }
}
function name(channel: Channel) {
    return (
        (channel.customFields as { storefrontNameZh?: string }).storefrontNameZh ||
        (/\p{Script=Han}/u.test(channel.code) ? channel.code : `店铺 ${channel.id}`)
    );
}

function scopeForModel(protocol: string, model: string): ImageProviderScope {
    return protocol.startsWith('GEMINI_') || /^(?:models\/)?(?:gemini|imagen)-/iu.test(model.trim())
        ? 'GEMINI'
        : 'OPENAI';
}
