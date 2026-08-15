import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { storeProfilePermission } from './constants';
import { StoreProfileService } from './store-profile.service';
import { UpdateMyStoreProfileInput, UpdateStoreProfileInput } from './types';

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

    @Query()
    @Allow(storeProfilePermission.Read)
    myStoreProfile(@Ctx() ctx: RequestContext) {
        return this.storeProfileService.findForMerchant(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    updateMyStoreProfile(@Ctx() ctx: RequestContext, @Args('input') input: UpdateMyStoreProfileInput) {
        return this.storeProfileService.updateForMerchant(ctx, input);
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
