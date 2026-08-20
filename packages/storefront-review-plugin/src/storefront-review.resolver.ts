import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { StorefrontReviewService } from './storefront-review.service';
import {
    ModerateStorefrontReviewInput,
    StorefrontReviewListOptions,
    SubmitStorefrontReviewInput,
} from './types';

@Resolver()
export class StorefrontReviewShopResolver {
    constructor(private readonly reviewService: StorefrontReviewService) {}

    @Query()
    storefrontProductReviews(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args('options') options?: StorefrontReviewListOptions,
    ) {
        return this.reviewService.findApprovedForProduct(ctx, productId, options);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myStorefrontReviews(@Ctx() ctx: RequestContext) {
        return this.reviewService.findMine(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myStorefrontReviewCandidates(@Ctx() ctx: RequestContext) {
        return this.reviewService.findCandidates(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    submitStorefrontReview(@Ctx() ctx: RequestContext, @Args('input') input: SubmitStorefrontReviewInput) {
        return this.reviewService.submit(ctx, input);
    }
}

@Resolver()
export class StorefrontReviewAdminResolver {
    constructor(private readonly reviewService: StorefrontReviewService) {}

    @Query()
    @Allow(Permission.ReadCatalog)
    storefrontReviews(@Ctx() ctx: RequestContext, @Args('options') options?: StorefrontReviewListOptions) {
        return this.reviewService.findForAdmin(ctx, options);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog)
    moderateStorefrontReview(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ModerateStorefrontReviewInput,
    ) {
        return this.reviewService.moderate(ctx, input);
    }
}
