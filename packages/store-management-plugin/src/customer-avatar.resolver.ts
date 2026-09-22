import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import { CustomerAvatarService, CustomerAvatarUpload } from './customer-avatar.service';

@Resolver()
export class CustomerAvatarShopResolver {
    constructor(private readonly customerAvatarService: CustomerAvatarService) {}

    @Query()
    @Allow(Permission.Public)
    myCustomerAvatar(@Ctx() ctx: RequestContext) {
        return this.customerAvatarService.findMine(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myCustomerAvatarHistory(@Ctx() ctx: RequestContext) {
        return this.customerAvatarService.historyMine(ctx);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    setCustomerAvatar(@Ctx() ctx: RequestContext, @Args('file') file: Promise<CustomerAvatarUpload>) {
        return this.customerAvatarService.uploadMine(ctx, file);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    restoreCustomerAvatar(@Ctx() ctx: RequestContext, @Args('retentionId') retentionId: ID) {
        return this.customerAvatarService.restoreMine(ctx, String(retentionId));
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    removeCustomerAvatar(@Ctx() ctx: RequestContext) {
        return this.customerAvatarService.removeMine(ctx);
    }
}
