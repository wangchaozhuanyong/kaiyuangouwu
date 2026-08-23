import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions';
import { STOREFRONT_PROMOTION_OPTIONS, storeProfilePermission } from './constants';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { StorefrontPromotionPage } from './entities/storefront-promotion-page.entity';
import { MerchantCatalogAccessInterceptor } from './merchant-catalog-access.interceptor';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';
import { MerchantInitialPasswordInterceptor } from './merchant-initial-password.interceptor';
import { MerchantInitialPasswordResolver } from './merchant-initial-password.resolver';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { StorefrontEntryMiddleware } from './promotion/storefront-entry.middleware';
import { StorefrontPromotionAccessService } from './promotion/storefront-promotion-access.service';
import { StorefrontPromotionHtmlService } from './promotion/storefront-promotion-html.service';
import { StorefrontPromotionController } from './promotion/storefront-promotion.controller';
import { StorefrontPromotionAdminResolver } from './promotion/storefront-promotion.resolver';
import { StorefrontPromotionService } from './promotion/storefront-promotion.service';
import { StoreActivationReadinessService } from './store-activation-readiness.service';
import { StoreCommerceSettingsResolver } from './store-commerce-settings.resolver';
import { StoreCommerceSettingsService } from './store-commerce-settings.service';
import { StoreProfileAdminResolver } from './store-profile.resolver';
import { StoreProfileService } from './store-profile.service';
import { StoreProvisioningResolver } from './store-provisioning.resolver';
import { StoreProvisioningService } from './store-provisioning.service';
import { StorefrontActivationInterceptor } from './storefront-activation.interceptor';
import { StorefrontActivationService } from './storefront-activation.service';
import { StorefrontPromotionPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StoreAdministratorAccess, StoreProfile, StorefrontPromotionPage],
    controllers: [StorefrontPromotionController],
    providers: [
        MerchantCatalogAccessService,
        MerchantInitialPasswordService,
        StoreActivationReadinessService,
        StoreProfileService,
        StorefrontActivationService,
        StoreCommerceSettingsService,
        StoreProvisioningService,
        StorefrontEntryMiddleware,
        StorefrontPromotionAccessService,
        StorefrontPromotionHtmlService,
        StorefrontPromotionService,
        {
            provide: STOREFRONT_PROMOTION_OPTIONS,
            useFactory: () => StoreManagementPlugin.promotionOptions,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: MerchantInitialPasswordInterceptor,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: MerchantCatalogAccessInterceptor,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: StorefrontActivationInterceptor,
        },
    ],
    configuration: config => {
        config.authOptions.customPermissions.push(storeProfilePermission);
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            MerchantInitialPasswordResolver,
            StoreProvisioningResolver,
            StoreProfileAdminResolver,
            StoreCommerceSettingsResolver,
            StorefrontPromotionAdminResolver,
        ],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class StoreManagementPlugin implements NestModule {
    static promotionOptions: Required<StorefrontPromotionPluginOptions> = {
        enabled: false,
        signingSecret: 'development-storefront-entry-secret',
        secureCookie: false,
        trustProxyHeaders: false,
        bypassHosts: ['localhost', '127.0.0.1'],
    };

    constructor(private readonly configService: ConfigService) {}

    static init(options: StorefrontPromotionPluginOptions = {}): typeof StoreManagementPlugin {
        const production = process.env.NODE_ENV === 'production';
        const enabled = options.enabled ?? production;
        const signingSecret = options.signingSecret?.trim() || '';
        if (production && enabled && signingSecret.length < 32) {
            throw new Error(
                'StoreManagementPlugin promotion gate requires a signing secret of at least 32 characters',
            );
        }
        this.promotionOptions = {
            enabled,
            signingSecret: signingSecret || 'development-storefront-entry-secret',
            secureCookie: options.secureCookie ?? production,
            trustProxyHeaders: options.trustProxyHeaders ?? false,
            bypassHosts: (options.bypassHosts ?? (production ? [] : ['localhost', '127.0.0.1'])).map(host =>
                host.trim().toLowerCase(),
            ),
        };
        return StoreManagementPlugin;
    }

    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(StorefrontEntryMiddleware).forRoutes(this.configService.apiOptions.shopApiPath);
    }
}
