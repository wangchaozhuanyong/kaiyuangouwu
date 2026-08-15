import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { StoreProfileService } from './store-profile.service';
import { UpdateStoreProfileInput } from './types';

@Resolver()
export class StoreProfileAdminResolver {
    constructor(private readonly storeProfileService: StoreProfileService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    storeProfiles(@Ctx() ctx: RequestContext) {
        return this.storeProfileService.findAllForAdmin(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    updateStoreProfile(@Ctx() ctx: RequestContext, @Args('input') input: UpdateStoreProfileInput) {
        return this.storeProfileService.update(ctx, input);
    }
}

@Resolver()
export class StoreProfileShopResolver {
    constructor(private readonly storeProfileService: StoreProfileService) {}

    @Query()
    @Allow(Permission.Public)
    availableStores(@Ctx() ctx: RequestContext) {
        return this.storeProfileService.findPublished(ctx);
    }
}
