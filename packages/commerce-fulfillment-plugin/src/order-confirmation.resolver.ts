import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Order, Permission, RelationPaths, Relations, RequestContext } from '@vendure/core';

import { OrderConfirmationTokenService } from './order-confirmation-token.service';

@Resolver()
export class OrderConfirmationResolver {
    constructor(private readonly tokenService: OrderConfirmationTokenService) {}

    @Mutation()
    @Allow(Permission.Owner)
    createStorefrontOrderConfirmationToken(@Ctx() ctx: RequestContext) {
        return this.tokenService.createForActiveOrder(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    storefrontOrderByConfirmationToken(
        @Ctx() ctx: RequestContext,
        @Args('token') token: string,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
    ) {
        return this.tokenService.orderForToken(ctx, token, relations);
    }
}
