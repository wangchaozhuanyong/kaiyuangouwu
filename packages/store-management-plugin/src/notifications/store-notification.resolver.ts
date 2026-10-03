import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import type { Response } from 'express';

import { CustomerServiceReviewService, ServiceReviewInput } from './customer-service-review.service';
import { StorefrontPresenceService } from './storefront-presence.service';
@Resolver()
export class StoreNotificationShopResolver {
    constructor(
        private readonly presence: StorefrontPresenceService,
        private readonly reviews: CustomerServiceReviewService,
    ) {}
    @Query()
    @Allow(Permission.Public)
    currentCustomerServiceReview(
        @Ctx() ctx: RequestContext,
        @Args('visitorId') visitorId: string,
        @Args('orderCode') orderCode?: string,
    ) {
        return this.reviews.current(ctx, visitorId, orderCode);
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    async recordStorefrontHeartbeat(
        @Ctx() ctx: RequestContext,
        @Args('visitorId') visitorId: string,
        @Context('res') res: Response,
    ) {
        const result = await this.presence.heartbeat(ctx, visitorId);
        if (result.setCookie) res.append('Set-Cookie', result.setCookie);
        return { recorded: result.recorded };
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    async submitCustomerServiceReview(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ServiceReviewInput,
        @Context('res') res: Response,
    ) {
        const result = await this.reviews.submit(ctx, input);
        if (result.setCookie) res.append('Set-Cookie', result.setCookie);
        return result.review;
    }
}
@Resolver()
export class StoreNotificationAdminResolver {
    constructor(
        private readonly presence: StorefrontPresenceService,
        private readonly reviews: CustomerServiceReviewService,
    ) {}
    @Query()
    @Allow(Permission.ReadOrder)
    storefrontOnline(@Ctx() ctx: RequestContext) {
        return this.presence.snapshot(ctx);
    }
    @Query()
    @Allow(Permission.ReadCustomer)
    customerServiceReviews(
        @Ctx() ctx: RequestContext,
        @Args('skip') skip: number,
        @Args('take') take: number,
        @Args('allStores') allStores: boolean,
    ) {
        return this.reviews.list(ctx, skip, take, allStores);
    }
}
