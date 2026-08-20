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

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    updateMyStoreCommerceConfiguration(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateMyStoreCommerceConfigurationInput,
    ) {
        return this.storeCommerceSettingsService.update(ctx, input);
    }
}
