import { Injectable, OnModuleInit } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { AdminCapabilitiesService, AdminImageCapabilityReadiness } from '@vendure/store-management-plugin';

import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { modelReady, providerScopeForModel } from './image-generation-config.service';
import { ImageProviderRouterService } from './provider/image-provider-router.service';

/** Reads existing configuration only; capability bootstrap must not provision AI settings. */
@Injectable()
export class ImageCapabilityReadinessService implements OnModuleInit {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly router: ImageProviderRouterService,
        private readonly capabilities: AdminCapabilitiesService,
    ) {}

    onModuleInit() {
        this.capabilities.registerImageReadiness(ctx => this.read(ctx));
    }

    async read(ctx: RequestContext): Promise<AdminImageCapabilityReadiness> {
        const config = await this.connection.getRepository(ctx, ImageGenerationConfig).findOne({
            where: { channelId: ctx.channelId },
        });
        if (!config) return { enabled: false, configured: false };
        const models = await this.connection.getRepository(ctx, ImageModelConfig).find({
            where: { channelId: ctx.channelId, enabled: true },
        });
        const available = await Promise.all(
            models.filter(modelReady).map(model =>
                this.router.hasAvailable(ctx, {
                    scope: providerScopeForModel(model.protocol, model.providerModelId),
                    purpose: 'IMAGE',
                    modelConfigId: model.id,
                }),
            ),
        );
        return { enabled: config.enabled, configured: available.some(Boolean) };
    }
}
