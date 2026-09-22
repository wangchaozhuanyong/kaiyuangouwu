import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

import { reviewStoreGovernancePermission, storeProfilePermission } from './constants';
import { StoreGovernanceChangeRequest } from './entities/store-governance-change-request.entity';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import {
    ReviewStoreGovernanceChangeInput,
    StoreGovernanceService,
    SubmitStoreGovernanceChangeInput,
} from './store-governance.service';

@Resolver('StoreGovernanceChangeRequest')
export class StoreGovernanceResolver {
    constructor(
        private readonly service: StoreGovernanceService,
        private readonly passwords: MerchantInitialPasswordService,
    ) {}

    @ResolveField()
    @Allow(reviewStoreGovernancePermission.Permission, Permission.SuperAdmin)
    reviewPayload(@Ctx() ctx: RequestContext, @Parent() request: StoreGovernanceChangeRequest) {
        return this.service.reviewPayload(ctx, request);
    }

    @Query()
    @Allow(storeProfilePermission.Read)
    myStoreGovernanceChanges(@Ctx() ctx: RequestContext) {
        return this.service.myRequests(ctx);
    }

    @Query()
    @Allow(reviewStoreGovernancePermission.Permission, Permission.SuperAdmin)
    storeGovernanceChanges(@Ctx() ctx: RequestContext, @Args('channelId') channelId?: string | null) {
        return this.service.reviewQueue(ctx, channelId);
    }

    @Transaction()
    @Mutation()
    @Allow(storeProfilePermission.Update)
    submitStoreGovernanceChange(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SubmitStoreGovernanceChangeInput,
    ) {
        return this.service.submit(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(reviewStoreGovernancePermission.Permission, Permission.SuperAdmin)
    async reviewStoreGovernanceChange(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ReviewStoreGovernanceChangeInput & { currentPassword: string },
    ) {
        await this.passwords.assertCurrentPassword(ctx, input.currentPassword);
        return this.service.review(ctx, input);
    }
}
