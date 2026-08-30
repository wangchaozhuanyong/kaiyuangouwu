import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { storeProfilePermission } from './constants';
import { StoreCurrencySettingsService } from './store-currency-settings.service';
import { StorePaymentReportingService } from './store-payment-reporting.service';
import { UpdateStoreCurrencyConfigurationInput } from './types';
import { ReviewStoreUsdtWalletInput, StoreUsdtWalletService } from './usdt/store-usdt-wallet.service';
import { StoreUsdtManualRefundInput, UsdtManualRefundService } from './usdt/usdt-manual-refund.service';
import { UsdtPaymentService } from './usdt/usdt-payment.service';

@Resolver()
export class StoreCurrencySettingsAdminResolver {
    constructor(
        private readonly currencySettings: StoreCurrencySettingsService,
        private readonly usdtPayments: UsdtPaymentService,
        private readonly usdtWallets: StoreUsdtWalletService,
        private readonly paymentReporting: StorePaymentReportingService,
        private readonly usdtManualRefunds: UsdtManualRefundService,
    ) {}

    @Query()
    @Allow(storeProfilePermission.Read)
    myStoreCurrencyConfiguration(@Ctx() ctx: RequestContext) {
        return this.currencySettings.get(ctx);
    }

    @Query()
    @Allow(storeProfilePermission.Read)
    myStoreUsdtPaymentIntents(@Ctx() ctx: RequestContext) {
        return this.usdtPayments.listForChannel(ctx);
    }

    @Query()
    @Allow(storeProfilePermission.Read)
    myStoreUsdtWallet(@Ctx() ctx: RequestContext) {
        return this.usdtWallets.status(ctx);
    }

    @Query()
    @Allow(storeProfilePermission.Read)
    myStoreUsdtPaymentStats(@Ctx() ctx: RequestContext) {
        return this.usdtPayments.statsForChannel(ctx);
    }

    @Query()
    @Allow(storeProfilePermission.Read)
    myStorePaymentStats(@Ctx() ctx: RequestContext) {
        return this.paymentReporting.statsForChannel(ctx);
    }

    @Query()
    @Allow(storeProfilePermission.Read)
    myStorePaymentDetails(@Ctx() ctx: RequestContext) {
        return this.paymentReporting.detailsForChannel(ctx);
    }

    @Query()
    @Allow(storeProfilePermission.Read)
    myStoreUsdtManualRefunds(@Ctx() ctx: RequestContext) {
        return this.usdtManualRefunds.listForChannel(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    storeUsdtWallets(@Ctx() ctx: RequestContext) {
        return this.usdtWallets.list(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    storeUsdtPaymentIntents(@Ctx() ctx: RequestContext, @Args('channelId') channelId?: ID) {
        return this.usdtPayments.listForPlatform(ctx, channelId == null ? null : String(channelId));
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    storeUsdtPaymentStats(@Ctx() ctx: RequestContext, @Args('channelId') channelId?: ID) {
        return this.usdtPayments.stats(ctx, channelId == null ? null : String(channelId));
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    storePaymentStats(@Ctx() ctx: RequestContext, @Args('channelId') channelId?: ID) {
        return this.paymentReporting.stats(ctx, channelId ?? null);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    storePaymentDetails(@Ctx() ctx: RequestContext, @Args('channelId') channelId?: ID) {
        return this.paymentReporting.details(ctx, channelId ?? null);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    storeUsdtManualRefunds(@Ctx() ctx: RequestContext, @Args('channelId') channelId?: ID) {
        return this.usdtManualRefunds.listForPlatform(ctx, channelId ?? null);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    updateMyStoreCurrencyConfiguration(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateStoreCurrencyConfigurationInput,
    ) {
        return this.currencySettings.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    refreshMyStoreExchangeRate(@Ctx() ctx: RequestContext) {
        return this.currencySettings.refreshRate(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    syncMyStoreCurrencyPrices(@Ctx() ctx: RequestContext) {
        return this.currencySettings.syncPrices(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    refreshMyStoreUsdtRate(@Ctx() ctx: RequestContext) {
        return this.currencySettings.refreshUsdtRate(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    submitMyStoreUsdtWallet(@Ctx() ctx: RequestContext, @Args('receivingAddress') receivingAddress: string) {
        return this.usdtWallets.submit(ctx, receivingAddress);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    reviewStoreUsdtWallet(@Ctx() ctx: RequestContext, @Args('input') input: ReviewStoreUsdtWalletInput) {
        return this.usdtWallets.review(ctx, input);
    }

    @Mutation()
    @Allow(storeProfilePermission.Update, Permission.SuperAdmin)
    recordStoreUsdtManualRefund(
        @Ctx() ctx: RequestContext,
        @Args('input') input: StoreUsdtManualRefundInput,
    ) {
        return this.usdtManualRefunds.record(ctx, input);
    }
}

@Resolver()
export class StoreCurrencySettingsShopResolver {
    constructor(private readonly currencySettings: StoreCurrencySettingsService) {}

    @Query()
    @Allow(Permission.Public)
    storefrontCurrencyConfiguration(@Ctx() ctx: RequestContext) {
        return this.currencySettings.getPublic(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    createStorefrontUsdtCheckoutQuote(@Ctx() ctx: RequestContext) {
        return this.currencySettings.createCheckoutUsdtQuote(ctx);
    }
}
