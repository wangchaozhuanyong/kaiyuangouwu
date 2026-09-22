import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import type { Response } from 'express';

import {
    MarketingAttributionReportInput,
    MarketingAttributionService,
    RecordMarketingCampaignCostInput,
} from '../marketing-attribution.service';
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
    constructor(
        private readonly traffic: StorefrontTrafficService,
        private readonly attribution: MarketingAttributionService,
    ) {}

    @Query()
    @Allow(referralPermission.Read)
    storefrontTraffic(@Ctx() ctx: RequestContext, @Args('days') days?: number) {
        return this.traffic.report(ctx, days ?? 7);
    }

    @Query()
    @Allow(Permission.ReadOrder, Permission.ReadPromotion)
    marketingAttributionReport(
        @Ctx() ctx: RequestContext,
        @Args('input') input: MarketingAttributionReportInput,
    ) {
        return this.attribution.report(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdatePromotion)
    recordMarketingCampaignCost(
        @Ctx() ctx: RequestContext,
        @Args('input') input: RecordMarketingCampaignCostInput,
    ) {
        return this.attribution.recordCost(ctx, input);
    }
}
