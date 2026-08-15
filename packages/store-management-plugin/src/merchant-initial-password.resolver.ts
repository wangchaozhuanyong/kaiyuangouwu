import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { MerchantInitialPasswordService } from './merchant-initial-password.service';

@Resolver()
export class MerchantInitialPasswordResolver {
    constructor(private readonly merchantInitialPasswordService: MerchantInitialPasswordService) {}

    @Query()
    @Allow(Permission.Authenticated)
    merchantInitialPasswordStatus(@Ctx() ctx: RequestContext) {
        return this.merchantInitialPasswordService.status(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    completeInitialPasswordChange(@Ctx() ctx: RequestContext, @Args('password') password: string) {
        return this.merchantInitialPasswordService.complete(ctx, password);
    }
}
