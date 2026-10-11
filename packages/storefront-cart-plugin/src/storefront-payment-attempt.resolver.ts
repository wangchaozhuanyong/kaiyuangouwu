import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import {
    StorefrontPaymentAttemptInput,
    StorefrontPaymentAttemptService,
} from './storefront-payment-attempt.service';

@Resolver()
export class StorefrontPaymentAttemptResolver {
    constructor(private readonly attempts: StorefrontPaymentAttemptService) {}

    @Query()
    @Allow(Permission.Owner)
    storefrontPaymentAttempt(
        @Ctx() ctx: RequestContext,
        @Args('input') input: StorefrontPaymentAttemptInput,
    ) {
        return this.attempts.read(ctx, input);
    }

    @Mutation()
    @Allow(Permission.Owner)
    fenceUnstartedStorefrontPaymentAttempt(
        @Ctx() ctx: RequestContext,
        @Args('input') input: StorefrontPaymentAttemptInput,
    ) {
        return this.attempts.fenceUnstarted(ctx, input);
    }
}
