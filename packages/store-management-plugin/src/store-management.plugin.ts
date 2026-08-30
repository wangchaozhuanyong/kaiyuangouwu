import { MiddlewareConsumer, NestModule, OnApplicationBootstrap } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Channel,
    ChannelService,
    ConfigService,
    LanguageCode,
    PaymentMethod,
    PaymentMethodService,
    Permission,
    PluginCommonModule,
    RequestContextService,
    Role,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { Like } from 'typeorm';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { STOREFRONT_PROMOTION_OPTIONS, storeProfilePermission } from './constants';
import { CouponLedgerEntry } from './entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from './entities/coupon-order-allocation.entity';
import { CustomerCoupon } from './entities/customer-coupon.entity';
import { ReferralAccount } from './entities/referral-account.entity';
import { ReferralBalanceUse } from './entities/referral-balance-use.entity';
import { ReferralLedgerEntry } from './entities/referral-ledger-entry.entity';
import { ReferralPosterTemplate } from './entities/referral-poster-template.entity';
import { ReferralProgramConfig } from './entities/referral-program-config.entity';
import { ReferralRelationship } from './entities/referral-relationship.entity';
import { ReferralReward } from './entities/referral-reward.entity';
import { ReferralWalletUsage } from './entities/referral-wallet-usage.entity';
import { ReferralWallet } from './entities/referral-wallet.entity';
import { ReferralWithdrawal } from './entities/referral-withdrawal.entity';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreCouponCampaignConfig } from './entities/store-coupon-campaign-config.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { StoreUsdtManualRefund } from './entities/store-usdt-manual-refund.entity';
import { StoreUsdtWalletAudit } from './entities/store-usdt-wallet-audit.entity';
import { StoreUsdtWallet } from './entities/store-usdt-wallet.entity';
import { StorefrontDailyVisitor } from './entities/storefront-daily-visitor.entity';
import { StorefrontPromotionPage } from './entities/storefront-promotion-page.entity';
import { StorefrontUsdtCheckoutQuote } from './entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from './entities/storefront-usdt-payment-intent.entity';
import { SystemAnnouncement } from './entities/system-announcement.entity';
import { MerchantCatalogAccessInterceptor } from './merchant-catalog-access.interceptor';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';
import { MerchantInitialPasswordInterceptor } from './merchant-initial-password.interceptor';
import { MerchantInitialPasswordResolver } from './merchant-initial-password.resolver';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import {
    collectionPercentageDiscount,
    currencyMinimumOrderAmount,
    currencyOrderFixedDiscount,
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
import { StorefrontRealtimeController } from './realtime/storefront-realtime.controller';
import { StorefrontRealtimeService } from './realtime/storefront-realtime.service';
import { referralBalancePaymentHandler } from './referral/referral-payment-handler';
import { configureReferralPaymentProofSecret } from './referral/referral-payment-proof';
import { auditReferralBalancesTask, reconcileReferralRewardsTask } from './referral/referral-tasks';
import { ReferralWalletSpendService } from './referral/referral-wallet-spend.service';
import {
    adjustReferralBalancePermission,
    manageReferralWithdrawalPermission,
    REFERRAL_BALANCE_PAYMENT_METHOD_CODE,
    referralPermission,
} from './referral/referral.constants';
import { ReferralAdminResolver, ReferralShopResolver } from './referral/referral.resolver';
import { ReferralService } from './referral/referral.service';
import { StoreActivationReadinessService } from './store-activation-readiness.service';
import { StoreCommerceSettingsResolver } from './store-commerce-settings.resolver';
import { StoreCommerceSettingsService } from './store-commerce-settings.service';
import {
    StoreCurrencySettingsAdminResolver,
    StoreCurrencySettingsShopResolver,
} from './store-currency-settings.resolver';
import { StoreCurrencySettingsService } from './store-currency-settings.service';
import {
    reconcileStoreUsdtPaymentsTask,
    refreshStoreUsdtRatesTask,
    syncAutomaticStoreCurrencyPricesTask,
} from './store-currency-tasks';
import { StorePaymentReportingService } from './store-payment-reporting.service';
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
// eslint-disable-next-line import/order -- organize-imports sorts this sibling file before the usdt directory.
import { UsdtOtcRateService } from './usdt-otc-rate.service';
import { StoreUsdtWalletService } from './usdt/store-usdt-wallet.service';
import { loadReviewedRefundSenders, UsdtManualRefundService } from './usdt/usdt-manual-refund.service';
import { usdtTrc20PaymentHandler } from './usdt/usdt-payment-handler';
import {
    configureUsdtPaymentProofSecret,
    isAcceptableUsdtPaymentProofSecret,
} from './usdt/usdt-payment-proof';
import { USDT_TRC20_PAYMENT_METHOD_CODE } from './usdt/usdt-payment.constants';
import { UsdtPaymentService } from './usdt/usdt-payment.service';
import { UsdtTrc20Client } from './usdt/usdt-trc20-client';
import {
    assertProductionUsdtSecretIsolation,
    loadUsdtWalletConfiguration,
    UsdtWalletConfigurationService,
} from './usdt/usdt-wallet-configuration.service';

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
        ReferralProgramConfig,
        ReferralPosterTemplate,
        ReferralAccount,
        ReferralWallet,
        ReferralRelationship,
        ReferralReward,
        ReferralLedgerEntry,
        ReferralBalanceUse,
        ReferralWalletUsage,
        ReferralWithdrawal,
        StorefrontDailyVisitor,
        StorefrontUsdtCheckoutQuote,
        StorefrontUsdtPaymentIntent,
        StoreUsdtManualRefund,
        StoreUsdtWallet,
        StoreUsdtWalletAudit,
    ],
    controllers: [StorefrontPromotionController, StorefrontRealtimeController],
    providers: [
        MerchantCatalogAccessService,
        MerchantInitialPasswordService,
        StoreActivationReadinessService,
        StoreProfileService,
        StorefrontActivationService,
        StoreCommerceSettingsService,
        StoreCurrencySettingsService,
        StorePaymentReportingService,
        UsdtOtcRateService,
        UsdtWalletConfigurationService,
        StoreUsdtWalletService,
        UsdtTrc20Client,
        UsdtPaymentService,
        UsdtManualRefundService,
        StoreProvisioningService,
        StorefrontEntryMiddleware,
        StorefrontPromotionAccessService,
        StorefrontPromotionHtmlService,
        StorefrontPromotionService,
        StorePromotionCampaignService,
        StoreCouponLifecycleService,
        ReferralService,
        ReferralWalletSpendService,
        SystemAnnouncementService,
        StorefrontRealtimeService,
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
    exports: [ReferralWalletSpendService],
    configuration: config => {
        config.authOptions.customPermissions.push(
            storeProfilePermission,
            referralPermission,
            manageReferralWithdrawalPermission,
            adjustReferralBalancePermission,
        );
        if (
            !config.paymentOptions.paymentMethodHandlers.some(
                handler => handler.code === referralBalancePaymentHandler.code,
            )
        ) {
            config.paymentOptions.paymentMethodHandlers.push(referralBalancePaymentHandler);
        }
        if (
            !config.paymentOptions.paymentMethodHandlers.some(
                handler => handler.code === usdtTrc20PaymentHandler.code,
            )
        ) {
            config.paymentOptions.paymentMethodHandlers.push(usdtTrc20PaymentHandler);
        }
        for (const condition of [customerCouponEntitlement, currencyMinimumOrderAmount]) {
            if (
                !config.promotionOptions.promotionConditions.some(
                    candidate => candidate.code === condition.code,
                )
            ) {
                config.promotionOptions.promotionConditions.push(condition);
            }
        }
        for (const action of [
            collectionPercentageDiscount,
            flashSalePriceAction,
            currencyOrderFixedDiscount,
        ]) {
            if (!config.promotionOptions.promotionActions.some(candidate => candidate.code === action.code)) {
                config.promotionOptions.promotionActions.push(action);
            }
        }
        config.schedulerOptions.tasks.push(reconcileStoreCouponsTask);
        config.schedulerOptions.tasks.push(reconcileReferralRewardsTask);
        config.schedulerOptions.tasks.push(auditReferralBalancesTask);
        config.schedulerOptions.tasks.push(syncAutomaticStoreCurrencyPricesTask);
        config.schedulerOptions.tasks.push(refreshStoreUsdtRatesTask);
        config.schedulerOptions.tasks.push(reconcileStoreUsdtPaymentsTask);
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            MerchantInitialPasswordResolver,
            StoreProvisioningResolver,
            StoreProfileAdminResolver,
            StoreCommerceSettingsResolver,
            StoreCurrencySettingsAdminResolver,
            StorefrontPromotionAdminResolver,
            StorePromotionCampaignAdminResolver,
            StoreCouponOrderResolver,
            SystemAnnouncementAdminResolver,
            ReferralAdminResolver,
        ],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            StorefrontBrandingShopResolver,
            StoreCurrencySettingsShopResolver,
            StorePromotionCampaignShopResolver,
            SystemAnnouncementShopResolver,
            ReferralShopResolver,
        ],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class StoreManagementPlugin implements NestModule, OnApplicationBootstrap {
    static promotionOptions: Required<StorefrontPromotionPluginOptions> = {
        enabled: false,
        signingSecret: 'development-storefront-entry-secret',
        secureCookie: false,
        trustProxyHeaders: false,
        bypassHosts: ['localhost', '127.0.0.1'],
    };

    constructor(
        private readonly configService: ConfigService,
        private readonly connection: TransactionalConnection,
        private readonly requestContextService: RequestContextService,
        private readonly paymentMethodService: PaymentMethodService,
        private readonly channelService: ChannelService,
        private readonly usdtWalletConfiguration: UsdtWalletConfigurationService,
        private readonly storeUsdtWallets: StoreUsdtWalletService,
    ) {}

    static init(options: StorefrontPromotionPluginOptions = {}): typeof StoreManagementPlugin {
        const production = process.env.NODE_ENV === 'production';
        const enabled = options.enabled ?? production;
        const signingSecret = options.signingSecret?.trim() || '';
        if (production && signingSecret.length < 32) {
            throw new Error(
                'StoreManagementPlugin promotion gate and referral balance payment require a signing secret of at least 32 characters',
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
        configureReferralPaymentProofSecret(signingSecret || 'development-referral-payment-proof-secret');
        loadUsdtWalletConfiguration(process.env, production);
        const usdtPaymentProofSecret = process.env.USDT_PAYMENT_PROOF_SECRET?.trim() || '';
        if (production && !isAcceptableUsdtPaymentProofSecret(usdtPaymentProofSecret)) {
            throw new Error(
                'USDT_PAYMENT_PROOF_SECRET must be a non-placeholder secret of at least 32 characters in production',
            );
        }
        if (production) {
            assertProductionUsdtSecretIsolation(process.env, usdtPaymentProofSecret);
        }
        // An empty allowlist keeps manual USDT refund registration disabled in
        // UsdtManualRefundService. Validate non-empty configuration at startup,
        // but do not block unrelated production capabilities while finance is
        // still reviewing the sender wallet.
        if (production) loadReviewedRefundSenders(process.env);
        configureUsdtPaymentProofSecret(usdtPaymentProofSecret || 'development-usdt-payment-proof-secret');
        return StoreManagementPlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        await this.ensureReferralPaymentMethod();
        await this.ensureUsdtPaymentMethod();
        await this.ensurePrimaryStoreAdminPermissions();
    }

    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(StorefrontEntryMiddleware).forRoutes(this.configService.apiOptions.shopApiPath);
    }

    private async ensureReferralPaymentMethod(): Promise<void> {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const channels = await this.connection.getRepository(ctx, Channel).find();
        let paymentMethod = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: { code: REFERRAL_BALANCE_PAYMENT_METHOD_CODE },
        });
        if (!paymentMethod) {
            paymentMethod = await this.paymentMethodService.create(ctx, {
                code: REFERRAL_BALANCE_PAYMENT_METHOD_CODE,
                enabled: true,
                handler: { code: referralBalancePaymentHandler.code, arguments: [] },
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: '邀请返利余额',
                        description: '使用邀请返利可用余额抵扣订单',
                    },
                    {
                        languageCode: LanguageCode.en,
                        name: 'Referral reward balance',
                        description: 'Pay using available referral reward balance',
                    },
                ],
            });
        }
        await this.channelService.assignToChannels(
            ctx,
            PaymentMethod,
            paymentMethod.id,
            channels.map(channel => channel.id),
        );
    }

    private async ensureUsdtPaymentMethod(): Promise<void> {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const repository = this.connection.rawConnection.getRepository(PaymentMethod);
        const channels = await this.connection.getRepository(ctx, Channel).find();
        await this.storeUsdtWallets.rotateEncryptionKey(ctx);
        await this.storeUsdtWallets.seedLegacyWallet(ctx, channels, this.usdtWalletConfiguration.get());
        const configuredChannelIds = new Set(
            (await this.storeUsdtWallets.list(ctx))
                .filter(wallet => wallet.configured)
                .map(wallet => String(wallet.channelId)),
        );
        let paymentMethod = await repository.findOne({
            where: { code: USDT_TRC20_PAYMENT_METHOD_CODE },
        });
        if (!paymentMethod) {
            paymentMethod = await this.paymentMethodService.create(ctx, {
                code: USDT_TRC20_PAYMENT_METHOD_CODE,
                enabled: true,
                handler: { code: usdtTrc20PaymentHandler.code, arguments: [] },
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: 'USDT-TRC20 链上支付',
                        description: '系统确认链上固化到账后自动更新订单为待发货',
                    },
                    {
                        languageCode: LanguageCode.en,
                        name: 'USDT-TRC20 on-chain payment',
                        description: 'The order is paid after the transfer is solidified on TRON',
                    },
                ],
            });
        } else if (!paymentMethod.enabled) {
            paymentMethod.enabled = true;
            await repository.save(paymentMethod, { reload: false });
        }
        const assignedChannelIds = channels
            .filter(channel => configuredChannelIds.has(String(channel.id)))
            .map(channel => channel.id);
        const unassignedChannelIds = channels
            .filter(channel => !configuredChannelIds.has(String(channel.id)))
            .map(channel => channel.id);
        if (assignedChannelIds.length) {
            await this.channelService.assignToChannels(
                ctx,
                PaymentMethod,
                paymentMethod.id,
                assignedChannelIds,
            );
        }
        if (unassignedChannelIds.length) {
            await this.channelService.removeFromChannels(
                ctx,
                PaymentMethod,
                paymentMethod.id,
                unassignedChannelIds,
            );
        }
    }

    private async ensurePrimaryStoreAdminPermissions(): Promise<void> {
        const permissions = [
            'CreateCatalogImport' as Permission,
            'ReadCatalogImport' as Permission,
            'UpdateCatalogImport' as Permission,
            'DeleteCatalogImport' as Permission,
            referralPermission.Create,
            referralPermission.Read,
            referralPermission.Update,
            referralPermission.Delete,
            manageReferralWithdrawalPermission.Permission,
            adjustReferralBalancePermission.Permission,
        ];
        const roles = await this.connection.rawConnection.getRepository(Role).find({
            where: { code: Like('%-store-admin') },
        });
        for (const role of roles) {
            const merged = Array.from(new Set([...role.permissions, ...permissions]));
            if (merged.length !== role.permissions.length) {
                role.permissions = merged;
                await this.connection.rawConnection.getRepository(Role).save(role, { reload: false });
            }
        }
    }
}
