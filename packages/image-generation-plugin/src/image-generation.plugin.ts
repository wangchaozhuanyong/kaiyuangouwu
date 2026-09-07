import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { IMAGE_GENERATION_OPTIONS, manageImageGenerationPermission } from './constants';
import { ImageComplianceAuditEvent } from './entities/image-compliance-audit-event.entity';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageGenerationCostEvent } from './entities/image-generation-cost-event.entity';
import { ImageGenerationDispatch } from './entities/image-generation-dispatch.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageGenerationRuntimeStatus } from './entities/image-generation-runtime-status.entity';
import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { ImagePromptModelConfig } from './entities/image-prompt-model-config.entity';
import { ImagePromptOptimization } from './entities/image-prompt-optimization.entity';
import { ImagePromptRoutingConfig } from './entities/image-prompt-routing-config.entity';
import { ImagePromptSkillRelease } from './entities/image-prompt-skill-release.entity';
import { ImageProviderCredentialModel } from './entities/image-provider-credential-model.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';
import { ImageUsageQuotaBucket } from './entities/image-usage-quota-bucket.entity';
import { ImageUsageQuotaEvent } from './entities/image-usage-quota-event.entity';
import { ImageGenerationConfigService } from './image-generation-config.service';
import { ImageGenerationHealthController } from './image-generation-health.controller';
import { ImageGenerationQueueService } from './image-generation-queue.service';
import { ImageGenerationReliabilityService } from './image-generation-reliability.service';
import { ImageGenerationAdminResolver, ImageGenerationShopResolver } from './image-generation.resolver';
import { ImageGenerationService } from './image-generation.service';
import {
    purgeExpiredPrivateImagesTask,
    purgeImageGenerationSensitiveRecordsTask,
    reconcileImageGenerationsTask,
} from './image-generation.tasks';
import { ImageUsageQuotaService } from './image-usage-quota.service';
import { ImagePromptEngineService } from './prompt/image-prompt-engine.service';
import { PromptRulesService } from './prompt/prompt-rules.service';
import { ImageProviderRouterService } from './provider/image-provider-router.service';
import { ImageProviderClient } from './provider/image-provider.client';
import { ImageProviderCipherService } from './security/image-provider-cipher.service';
import { SafeProviderUrlService } from './security/safe-provider-url.service';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';
import { ImagePrivateController } from './storage/image-private.controller';
import { ImageGenerationPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule, StoreManagementPlugin, ContentTranslationPlugin],
    entities: [
        ImageGenerationConfig,
        ImageComplianceAuditEvent,
        ImageGenerationCostEvent,
        ImageGenerationDispatch,
        ImageProviderCredential,
        ImageProviderCredentialModel,
        ImageModelConfig,
        ImagePromptSkillRelease,
        ImagePromptOptimization,
        ImagePromptModelConfig,
        ImagePromptRoutingConfig,
        ImagePrivateAsset,
        ImageGenerationJob,
        ImageGenerationOutput,
        ImageGenerationRuntimeStatus,
        ImageUsageQuotaBucket,
        ImageUsageQuotaEvent,
    ],
    controllers: [ImagePrivateController, ImageGenerationHealthController],
    providers: [
        PromptRulesService,
        ImageProviderCipherService,
        SafeProviderUrlService,
        ImageProviderClient,
        ImageProviderRouterService,
        ImagePrivateStorageService,
        ImageGenerationConfigService,
        ImageGenerationReliabilityService,
        ImageUsageQuotaService,
        ImagePromptEngineService,
        ImageGenerationService,
        ImageGenerationQueueService,
        {
            provide: IMAGE_GENERATION_OPTIONS,
            useFactory: () => ImageGenerationPlugin.options,
        },
    ],
    configuration: config => {
        config.authOptions.customPermissions.push(manageImageGenerationPermission);
        config.schedulerOptions.tasks.push(
            reconcileImageGenerationsTask,
            purgeExpiredPrivateImagesTask,
            purgeImageGenerationSensitiveRecordsTask,
        );
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [ImageGenerationAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [ImageGenerationShopResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class ImageGenerationPlugin {
    static options: ImageGenerationPluginOptions = {};

    static init(options: ImageGenerationPluginOptions = {}): typeof ImageGenerationPlugin {
        this.options = options;
        return ImageGenerationPlugin;
    }
}
