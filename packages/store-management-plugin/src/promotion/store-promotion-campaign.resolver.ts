import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { CreateStoreCouponCampaignInput, CreateStoreFlashSaleInput } from '../types';
import { StorePromotionCampaignService } from './store-promotion-campaign.service';

@Resolver()
export class StorePromotionCampaignAdminResolver {
    constructor(private readonly campaignService: StorePromotionCampaignService) {}

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
}

@Resolver()
export class StorePromotionCampaignShopResolver {
    constructor(private readonly campaignService: StorePromotionCampaignService) {}

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
}
