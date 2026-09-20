import { MiddlewareConsumer, NestModule, OnApplicationBootstrap } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CreatePaymentMethodInput } from '@vendure/common/lib/generated-types';
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
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { Like } from 'typeorm';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { STOREFRONT_PROMOTION_OPTIONS, storeProfilePermission } from './constants';
import { CustomerAvatarShopResolver } from './customer-avatar.resolver';
import { CustomerAvatarService } from './customer-avatar.service';
import {
    CustomerFollowUpResolver,
    CustomerOperationsAdminResolver,
    CustomerOperationsProfileResolver,
} from './customer-operations.resolver';
import { CustomerOperationsService } from './customer-operations.service';
import { reconcileCustomerOperationsTask } from './customer-operations.tasks';
import { DataConsentAdminResolver, DataConsentShopResolver } from './data-consent.resolver';
import { DATA_CONSENT_SERVICE_TOKEN, DataConsentService } from './data-consent.service';
import { DataRetentionAdminResolver } from './data-retention.resolver';
import { DataRetentionService } from './data-retention.service';
import { purgeDueDataRetentionTask } from './data-retention.tasks';
import { DataSubjectAdminResolver, DataSubjectShopResolver } from './data-subject.resolver';
import { DataSubjectService } from './data-subject.service';
import { processDueAccountClosuresTask } from './data-subject.tasks';
import { CouponLedgerEntry } from './entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from './entities/coupon-order-allocation.entity';
import { CustomerCoupon } from './entities/customer-coupon.entity';
import { CustomerFollowUpEvent } from './entities/customer-follow-up-event.entity';
import { CustomerFollowUp } from './entities/customer-follow-up.entity';
import { CustomerOperationsProfile } from './entities/customer-operations-profile.entity';
import { DataConsentRecord } from './entities/data-consent-record.entity';
import { DataRetentionRecord } from './entities/data-retention-record.entity';
import { DataSubjectRequest } from './entities/data-subject-request.entity';
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
import { StoreUsdtReconciliationAction } from './entities/store-usdt-reconciliation-action.entity';
import { StoreUsdtWalletAudit } from './entities/store-usdt-wallet-audit.entity';
import { StoreUsdtWallet } from './entities/store-usdt-wallet.entity';
import { StorefrontDailyVisitor } from './entities/storefront-daily-visitor.entity';
import { StorefrontPageView } from './entities/storefront-page-view.entity';
import { StorefrontPromotionPage } from './entities/storefront-promotion-page.entity';
import { StorefrontUsdtCheckoutQuote } from './entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from './entities/storefront-usdt-payment-intent.entity';
import { SystemAnnouncement } from './entities/system-announcement.entity';
import { MerchantCatalogAccessInterceptor } from './merchant-catalog-access.interceptor';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';
import { MerchantInitialPasswordInterceptor } from './merchant-initial-password.interceptor';
import { MerchantInitialPasswordResolver } from './merchant-initial-password.resolver';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { isStorefrontPaymentCurrencyCode, STOREFRONT_PAYMENT_CURRENCY_CODES } from './payment-currency';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { CartCouponCommandAdapter } from './promotion/cart-coupon-command.adapter';
import {
    collectionPercentageDiscount,
    currencyMinimumOrderAmount,
    currencyOrderFixedDiscount,
    customerCouponEntitlement,
    flashSalePriceAction,
} from './promotion/store-commerce-promotion-actions';
import { StoreCouponClosureRepairService } from './promotion/store-coupon-closure-repair.service';
import { StoreCouponLifecycleService } from './promotion/store-coupon-lifecycle.service';
import { StoreCouponRepairService } from './promotion/store-coupon-repair.service';
import { reconcileStoreCouponsTask } from './promotion/store-coupon-tasks';
import {
    StoreCouponOrderResolver,
    StoreCouponVariantResolver,
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
    reconcileStorePaymentsDailyTask,
    reconcileStoreUsdtPaymentsTask,
    refreshStoreUsdtRatesTask,
    syncAutomaticStoreCurrencyPricesTask,
} from './store-currency-tasks';
import { StoreDeprovisionService } from './store-deprovision.service';
import { StorePaymentReportingService } from './store-payment-reporting.service';
import { StoreProfileAdminResolver } from './store-profile.resolver';
import { StoreProfileService } from './store-profile.service';
import { StoreProvisioningResolver } from './store-provisioning.resolver';
import { StoreProvisioningService } from './store-provisioning.service';
import { StorefrontActivationInterceptor } from './storefront-activation.interceptor';
import { StorefrontActivationService } from './storefront-activation.service';
import {
    StorefrontBrandingAdminResolver,
    StorefrontBrandingShopResolver,
} from './storefront-branding.resolver';
import { StorefrontCatalogAccessInterceptor } from './storefront-catalog-access.interceptor';
import { StorefrontPaymentCurrencyInterceptor } from './storefront-payment-currency.interceptor';
import { StorefrontRegionShopResolver } from './storefront-region.resolver';
import {
    SystemAnnouncementAdminResolver,
    SystemAnnouncementShopResolver,
} from './system-announcement.resolver';
import { SystemAnnouncementService } from './system-announcement.service';
import { SystemWorkerHealthService } from './system-worker-health.service';
import {
    StorefrontTrafficAdminResolver,
    StorefrontTrafficShopResolver,
} from './traffic/storefront-traffic.resolver';
import { StorefrontTrafficService } from './traffic/storefront-traffic.service';
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
    imports: [PluginCommonModule, ContentTranslationPlugin, StorefrontCartPlugin],
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
        StorefrontPageView,
        StorefrontUsdtCheckoutQuote,
        StorefrontUsdtPaymentIntent,
        StoreUsdtManualRefund,
        StoreUsdtReconciliationAction,
        StoreUsdtWallet,
        StoreUsdtWalletAudit,
        DataSubjectRequest,
        DataRetentionRecord,
        DataConsentRecord,
        CustomerOperationsProfile,
        CustomerFollowUp,
        CustomerFollowUpEvent,
    ],
    controllers: [StorefrontPromotionController, StorefrontRealtimeController],
    providers: [
        SystemWorkerHealthService,
        CartCouponCommandAdapter,
        MerchantCatalogAccessService,
        MerchantInitialPasswordService,
        StoreActivationReadinessService,
        StoreDeprovisionService,
        StoreProfileService,
        StorefrontActivationService,
        StoreCommerceSettingsService,
        StoreCurrencySettingsService,
        StorePaymentReportingService,
        PaymentReconciliationService,
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
        StoreCouponRepairService,
        StoreCouponClosureRepairService,
        ReferralService,
        StorefrontTrafficService,
        ReferralWalletSpendService,
        SystemAnnouncementService,
        StorefrontRealtimeService,
        CustomerAvatarService,
        DataConsentService,
        { provide: DATA_CONSENT_SERVICE_TOKEN, useExisting: DataConsentService },
        DataSubjectService,
        DataRetentionService,
        CustomerOperationsService,
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
        {
            provide: APP_INTERCEPTOR,
            useClass: StorefrontCatalogAccessInterceptor,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: StorefrontPaymentCurrencyInterceptor,
        },
    ],
    exports: [ReferralWalletSpendService],
    configuration: config => {
        config.customFields.Order ??= [];
        if (!config.customFields.Order.some(field => field.name === 'paymentCurrencyCode')) {
            config.customFields.Order.push({
                name: 'paymentCurrencyCode',
                type: 'string',
                length: 8,
                nullable: true,
                public: true,
                ui: { dashboard: false },
                validate: (value: string | null | undefined) =>
                    value == null || isStorefrontPaymentCurrencyCode(value)
                        ? undefined
                        : `Payment currency must be one of ${STOREFRONT_PAYMENT_CURRENCY_CODES.join(', ')}`,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '客户付款币种' },
                    { languageCode: LanguageCode.en, value: 'Customer payment currency' },
                ],
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '客户选定的实际付款币种；USDT 订单仍保留法币账务金额',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'The currency selected for payment; USDT orders retain their fiat ledger amount',
                    },
                ],
            });
        }
        config.settingsStoreFields ??= {};
        config.settingsStoreFields.systemOperations = [
            ...(config.settingsStoreFields.systemOperations ?? []).filter(
                field => field.name !== 'workerHeartbeat',
            ),
            { name: 'workerHeartbeat', readonly: true, requiresPermission: Permission.ReadSystem },
        ];
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
        config.schedulerOptions.tasks.push(reconcileStorePaymentsDailyTask);
        config.schedulerOptions.tasks.push(purgeDueDataRetentionTask);
        config.schedulerOptions.tasks.push(processDueAccountClosuresTask);
        config.schedulerOptions.tasks.push(reconcileCustomerOperationsTask);
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            StorefrontBrandingAdminResolver,
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
            StorefrontTrafficAdminResolver,
            DataRetentionAdminResolver,
            DataSubjectAdminResolver,
            DataConsentAdminResolver,
            CustomerOperationsAdminResolver,
            CustomerOperationsProfileResolver,
            CustomerFollowUpResolver,
        ],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            StorefrontBrandingShopResolver,
            StorefrontRegionShopResolver,
            CustomerAvatarShopResolver,
            DataConsentShopResolver,
            DataSubjectShopResolver,
            StoreCurrencySettingsShopResolver,
            StorePromotionCampaignShopResolver,
            StoreCouponVariantResolver,
            SystemAnnouncementShopResolver,
            ReferralShopResolver,
            StorefrontTrafficShopResolver,
        ],
    },
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
        for (const channel of channels) {
            await this.ensureIsolatedPaymentMethod(ctx, channel, true, {
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
    }

    private async ensureUsdtPaymentMethod(): Promise<void> {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const channels = await this.connection.getRepository(ctx, Channel).find();
        await this.storeUsdtWallets.rotateEncryptionKey(ctx);
        await this.storeUsdtWallets.seedLegacyWallet(ctx, channels, this.usdtWalletConfiguration.get());
        const configuredChannelIds = new Set(
            (await this.storeUsdtWallets.list(ctx))
                .filter(wallet => wallet.configured)
                .map(wallet => String(wallet.channelId)),
        );
        for (const channel of channels) {
            await this.ensureIsolatedPaymentMethod(
                ctx,
                channel,
                configuredChannelIds.has(String(channel.id)),
                {
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
                },
            );
        }
    }

    private async ensureIsolatedPaymentMethod(
        ctx: Awaited<ReturnType<RequestContextService['create']>>,
        channel: Channel,
        shouldAssign: boolean,
        defaults: CreatePaymentMethodInput,
    ): Promise<PaymentMethod | undefined> {
        const repository = this.connection.rawConnection.getRepository(PaymentMethod);
        const candidates = await repository.find({
            where: { code: defaults.code },
            relations: { channels: true },
        });
        const assigned = candidates.filter(method =>
            method.channels.some(item => String(item.id) === String(channel.id)),
        );
        if (!shouldAssign) {
            for (const method of assigned) {
                await this.channelService.removeFromChannels(ctx, PaymentMethod, method.id, [channel.id]);
            }
            return;
        }

        const exclusive = assigned.find(method => method.channels.length === 1);
        if (exclusive) {
            if (!exclusive.enabled) {
                exclusive.enabled = true;
                await repository.save(exclusive, { reload: false });
            }
            for (const duplicate of assigned.filter(method => method.id !== exclusive.id)) {
                await this.channelService.removeFromChannels(ctx, PaymentMethod, duplicate.id, [channel.id]);
            }
            return exclusive;
        }

        const source = assigned[0] ?? candidates[0];
        const channelCtx = await this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: channel,
        });
        const created = await this.paymentMethodService.create(
            channelCtx,
            source
                ? {
                      code: source.code,
                      enabled: true,
                      ...(source.checker ? { checker: paymentOperationInput(source.checker) } : {}),
                      handler: paymentOperationInput(source.handler),
                      translations: source.translations.map(translation => ({
                          languageCode: translation.languageCode,
                          name: translation.name,
                          description: translation.description,
                          customFields: translation.customFields,
                      })),
                      customFields: source.customFields,
                  }
                : defaults,
        );
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (String(defaultChannel.id) !== String(channel.id)) {
            await this.channelService.removeFromChannels(channelCtx, PaymentMethod, created.id, [
                defaultChannel.id,
            ]);
        }
        for (const previous of assigned) {
            await this.channelService.removeFromChannels(ctx, PaymentMethod, previous.id, [channel.id]);
        }
        return created;
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

function paymentOperationInput(operation: { code: string; args: Array<{ name: string; value: string }> }) {
    return { code: operation.code, arguments: operation.args.map(argument => ({ ...argument })) };
}
