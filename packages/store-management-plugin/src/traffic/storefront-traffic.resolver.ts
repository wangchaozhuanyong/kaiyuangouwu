import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import type { Response } from 'express';

import { referralPermission } from '../referral/referral.constants';

import { StorefrontPageViewInput, StorefrontTrafficService } from './storefront-traffic.service';

@Resolver()
export class StorefrontTrafficShopResolver {
    constructor(private readonly traffic: StorefrontTrafficService) {}

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    async recordStorefrontPageView(
        @Ctx() ctx: RequestContext,
        @Args('input') input: StorefrontPageViewInput,
        @Context('res') res: Response,
    ) {
        const result = await this.traffic.record(ctx, input);
        if (result.setCookie) res.append('Set-Cookie', result.setCookie);
        return { recorded: result.recorded };
    }
}

@Resolver()
export class StorefrontTrafficAdminResolver {
    constructor(private readonly traffic: StorefrontTrafficService) {}

    @Query()
    @Allow(referralPermission.Read)
    storefrontTraffic(@Ctx() ctx: RequestContext, @Args('days') days?: number) {
        return this.traffic.report(ctx, days ?? 7);
    }
}
