import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { storeProfilePermission } from './constants';
import { StoreCurrencySettingsService } from './store-currency-settings.service';
import { UpdateStoreCurrencyConfigurationInput } from './types';
import { UsdtPaymentService } from './usdt/usdt-payment.service';

@Resolver()
export class StoreCurrencySettingsAdminResolver {
    constructor(
        private readonly currencySettings: StoreCurrencySettingsService,
        private readonly usdtPayments: UsdtPaymentService,
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
