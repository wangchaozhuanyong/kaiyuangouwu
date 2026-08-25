import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { ConfigService, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { STOREFRONT_PROMOTION_OPTIONS, storeProfilePermission } from './constants';
import { CouponLedgerEntry } from './entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from './entities/coupon-order-allocation.entity';
import { CustomerCoupon } from './entities/customer-coupon.entity';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreCouponCampaignConfig } from './entities/store-coupon-campaign-config.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { StorefrontPromotionPage } from './entities/storefront-promotion-page.entity';
import { SystemAnnouncement } from './entities/system-announcement.entity';
import { MerchantCatalogAccessInterceptor } from './merchant-catalog-access.interceptor';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';
import { MerchantInitialPasswordInterceptor } from './merchant-initial-password.interceptor';
import { MerchantInitialPasswordResolver } from './merchant-initial-password.resolver';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import {
    collectionPercentageDiscount,
    customerCouponEntitlement,
    flashSalePriceAction,
} from './promotion/store-commerce-promotion-actions';
import { StoreCouponLifecycleService } from './promotion/store-coupon-lifecycle.service';
import { reconcileStoreCouponsTask } from './promotion/store-coupon-tasks';
import {
    StoreCouponOrderResolver,
    StorePromotionCampaignAdminResolver,
    StorePromotionCampaignShopResolver,
} from './promotion/store-promotion-campaign.resolver';
import { StorePromotionCampaignService } from './promotion/store-promotion-campaign.service';
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
import { StorefrontBrandingShopResolver } from './storefront-branding.resolver';
import {
    SystemAnnouncementAdminResolver,
    SystemAnnouncementShopResolver,
} from './system-announcement.resolver';
import { SystemAnnouncementService } from './system-announcement.service';
import { StorefrontPromotionPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule, ContentTranslationPlugin],
    entities: [
        StoreAdministratorAccess,
        StoreProfile,
        StorefrontPromotionPage,
        SystemAnnouncement,
        StoreCouponCampaignConfig,
        CustomerCoupon,
        CouponLedgerEntry,
        CouponOrderAllocation,
    ],
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
        StorePromotionCampaignService,
        StoreCouponLifecycleService,
        SystemAnnouncementService,
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
        if (
            !config.promotionOptions.promotionConditions.some(
                candidate => candidate.code === customerCouponEntitlement.code,
            )
        ) {
            config.promotionOptions.promotionConditions.push(customerCouponEntitlement);
        }
        for (const action of [collectionPercentageDiscount, flashSalePriceAction]) {
            if (!config.promotionOptions.promotionActions.some(candidate => candidate.code === action.code)) {
                config.promotionOptions.promotionActions.push(action);
            }
        }
        config.schedulerOptions.tasks.push(reconcileStoreCouponsTask);
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
            StorePromotionCampaignAdminResolver,
            StoreCouponOrderResolver,
            SystemAnnouncementAdminResolver,
        ],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            StorefrontBrandingShopResolver,
            StorePromotionCampaignShopResolver,
            SystemAnnouncementShopResolver,
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
