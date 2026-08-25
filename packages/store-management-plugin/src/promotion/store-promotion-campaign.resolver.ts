import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Order, Permission, RequestContext, Transaction } from '@vendure/core';

import {
    CreateStoreCouponCampaignInput,
    CreateStoreFlashSaleInput,
    StoreCouponLedgerListOptions,
} from '../types';

import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';
import { StorePromotionCampaignService } from './store-promotion-campaign.service';

@Resolver()
export class StorePromotionCampaignAdminResolver {
    constructor(
        private readonly campaignService: StorePromotionCampaignService,
        private readonly lifecycleService: StoreCouponLifecycleService,
    ) {}

    @Query()
    @Allow(Permission.ReadPromotion)
    storeCouponCampaigns(@Ctx() ctx: RequestContext) {
        return this.campaignService.findCoupons(ctx);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    storeFlashSales(@Ctx() ctx: RequestContext) {
        return this.campaignService.findFlashSales(ctx);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    storeCouponLedger(@Ctx() ctx: RequestContext, @Args('options') options?: StoreCouponLedgerListOptions) {
        return this.lifecycleService.findLedger(ctx, options);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreatePromotion)
    createStoreCouponCampaign(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateStoreCouponCampaignInput,
    ) {
        return this.campaignService.createCoupon(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreatePromotion)
    createStoreFlashSale(@Ctx() ctx: RequestContext, @Args('input') input: CreateStoreFlashSaleInput) {
        return this.campaignService.createFlashSale(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    setStorePromotionEnabled(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('enabled') enabled: boolean,
    ) {
        return this.campaignService.setEnabled(ctx, id, enabled);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeletePromotion)
    deleteStorePromotion(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.campaignService.delete(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    grantStoreCoupon(
        @Ctx() ctx: RequestContext,
        @Args('campaignId') campaignId: ID,
        @Args('customerId') customerId: ID,
    ) {
        return this.lifecycleService.grant(ctx, campaignId, customerId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    revokeStoreCustomerCoupon(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('reason') reason?: string,
    ) {
        return this.lifecycleService.revoke(ctx, id, reason);
    }
}

@Resolver()
export class StorePromotionCampaignShopResolver {
    constructor(
        private readonly campaignService: StorePromotionCampaignService,
        private readonly lifecycleService: StoreCouponLifecycleService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    activeStorefrontCoupons(@Ctx() ctx: RequestContext) {
        return this.campaignService.findActiveCoupons(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    activeStorefrontFlashSales(@Ctx() ctx: RequestContext) {
        return this.campaignService.findFlashSales(ctx, true);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myStorefrontCoupons(@Ctx() ctx: RequestContext) {
        return this.lifecycleService.findMine(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    claimStorefrontCoupon(@Ctx() ctx: RequestContext, @Args('campaignId') campaignId: ID) {
        return this.lifecycleService.claim(ctx, campaignId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    applyStorefrontCoupon(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.lifecycleService.apply(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    removeStorefrontCoupon(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.lifecycleService.remove(ctx, id);
    }
}

@Resolver('Order')
export class StoreCouponOrderResolver {
    constructor(private readonly lifecycleService: StoreCouponLifecycleService) {}

    @ResolveField()
    @Allow(Permission.ReadOrder)
    storeCouponAllocations(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        return this.lifecycleService.findOrderAllocations(ctx, order.id);
    }
}
