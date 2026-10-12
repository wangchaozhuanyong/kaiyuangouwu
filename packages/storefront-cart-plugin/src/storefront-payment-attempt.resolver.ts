import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Order, Permission, RelationPaths, Relations, RequestContext } from '@vendure/core';

import {
    StorefrontPaymentAttemptInput,
    StorefrontPaymentAttemptService,
} from './storefront-payment-attempt.service';

@Resolver('StorefrontPaymentAttemptReceipt')
export class StorefrontPaymentAttemptResolver {
    constructor(private readonly attempts: StorefrontPaymentAttemptService) {}

    @ResolveField()
    order(
        @Ctx() ctx: RequestContext,
        @Parent() receipt: { input: StorefrontPaymentAttemptInput },
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
    ) {
        return this.attempts.readOrder(ctx, receipt.input, relations);
    }

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
