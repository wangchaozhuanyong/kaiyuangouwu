import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ID } from '@vendure/common/lib/shared-types';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { CustomerProductActivityService } from './customer-product-activity.service';

@Resolver()
export class CustomerProductActivityShopResolver {
    constructor(private readonly activity: CustomerProductActivityService) {}

    @Query()
    @Allow(Permission.Authenticated)
    myCustomerProductActivity(@Ctx() ctx: RequestContext) {
        return this.activity.list(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    setMyFavoriteProduct(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args('favorite') favorite: boolean,
    ) {
        return this.activity.setFavorite(ctx, productId, favorite);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    removeMyFavoriteProducts(@Ctx() ctx: RequestContext, @Args('productIds') productIds: ID[]) {
        return this.activity.removeFavorites(ctx, productIds);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    clearMyFavoriteProducts(@Ctx() ctx: RequestContext) {
        return this.activity.clear(ctx, 'FAVORITE');
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    recordMyProductVisit(@Ctx() ctx: RequestContext, @Args('productId') productId: ID) {
        return this.activity.recordVisit(ctx, productId);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    clearMyProductVisits(@Ctx() ctx: RequestContext) {
        return this.activity.clear(ctx, 'HISTORY');
    }
}
