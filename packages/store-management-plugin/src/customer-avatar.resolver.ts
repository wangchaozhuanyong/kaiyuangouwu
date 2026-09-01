import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { CustomerAvatarService, CustomerAvatarUpload } from './customer-avatar.service';

@Resolver()
export class CustomerAvatarShopResolver {
    constructor(private readonly customerAvatarService: CustomerAvatarService) {}

    @Query()
    @Allow(Permission.Public)
    myCustomerAvatar(@Ctx() ctx: RequestContext) {
        return this.customerAvatarService.findMine(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    setCustomerAvatar(@Ctx() ctx: RequestContext, @Args('file') file: Promise<CustomerAvatarUpload>) {
        return this.customerAvatarService.uploadMine(ctx, file);
    }
}
