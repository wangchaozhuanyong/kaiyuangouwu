import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

import { storeProfilePermission } from './constants';
import { StoreCommerceSettingsService } from './store-commerce-settings.service';
import { UpdateMyStoreCommerceConfigurationInput } from './types';

@Resolver()
export class StoreCommerceSettingsResolver {
    constructor(private readonly storeCommerceSettingsService: StoreCommerceSettingsService) {}

    @Query()
    @Allow(storeProfilePermission.Read)
    myStoreCommerceConfiguration(@Ctx() ctx: RequestContext) {
        return this.storeCommerceSettingsService.get(ctx);
    }

    @Query()
    @Allow(storeProfilePermission.Read)
    myStorePaymentOptions(@Ctx() ctx: RequestContext) {
        return this.storeCommerceSettingsService.paymentOptions(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    updateMyStoreCommerceConfiguration(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateMyStoreCommerceConfigurationInput,
    ) {
        return this.storeCommerceSettingsService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    setMyStorePaymentOptionEnabled(
        @Ctx() ctx: RequestContext,
        @Args('id') id: string,
        @Args('enabled') enabled: boolean,
    ) {
        return this.storeCommerceSettingsService.setPaymentOptionEnabled(ctx, id, enabled);
    }
}
