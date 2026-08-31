import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction, UserInputError } from '@vendure/core';

import { storeProfilePermission } from './constants';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { StoreDeprovisionService } from './store-deprovision.service';
import { StoreProfileService } from './store-profile.service';
import { DeprovisionStoreInput, UpdateMyStoreProfileInput, UpdateStoreProfileInput } from './types';

@Resolver('StoreProfile')
export class StoreProfileAdminResolver {
    constructor(
        private readonly storeProfileService: StoreProfileService,
        private readonly storeDeprovisionService: StoreDeprovisionService,
        private readonly passwordService: MerchantInitialPasswordService,
    ) {}

    @ResolveField()
    internalNote(@Ctx() ctx: RequestContext, @Parent() profile: { internalNote?: string | null }) {
        return ctx.userHasPermissions([Permission.SuperAdmin]) ? (profile.internalNote ?? null) : null;
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    storeProfiles(@Ctx() ctx: RequestContext) {
        return this.storeProfileService.findAllForAdmin(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    storeDeprovisionImpact(@Ctx() ctx: RequestContext, @Args('profileId') profileId: string) {
        return this.storeDeprovisionService.impact(ctx, profileId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    async updateStoreProfile(@Ctx() ctx: RequestContext, @Args('input') input: UpdateStoreProfileInput) {
        if (input.status != null) {
            if (input.status === 'SUSPENDED') {
                throw new UserInputError('暂停营业必须使用安全清退入口');
            }
            await this.passwordService.assertCurrentPassword(ctx, input.currentPassword ?? '');
        }
        return this.storeProfileService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    suspendStore(
        @Ctx() ctx: RequestContext,
        @Args('profileId') profileId: string,
        @Args('expectedUpdatedAt') expectedUpdatedAt: Date,
        @Args('currentPassword') currentPassword: string,
    ) {
        return this.storeDeprovisionService.suspend(ctx, profileId, expectedUpdatedAt, currentPassword);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    deprovisionStore(@Ctx() ctx: RequestContext, @Args('input') input: DeprovisionStoreInput) {
        return this.storeDeprovisionService.deprovision(ctx, input);
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
