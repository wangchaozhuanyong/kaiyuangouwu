import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Order, Permission, RequestContext, Transaction } from '@vendure/core';

import { MerchantInitialPasswordService } from '../merchant-initial-password.service';
import {
    CreateStoreCouponCampaignInput,
    CreateStoreFlashSaleInput,
    StoreCouponLedgerEntryListOptions,
} from '../types';

import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';
import { StorePromotionCampaignService } from './store-promotion-campaign.service';

@Resolver()
export class StorePromotionCampaignAdminResolver {
    constructor(
        private readonly campaignService: StorePromotionCampaignService,
        private readonly lifecycleService: StoreCouponLifecycleService,
        private readonly passwordService: MerchantInitialPasswordService,
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
    storeCouponLedger(
        @Ctx() ctx: RequestContext,
        @Args('options') options?: StoreCouponLedgerEntryListOptions,
    ) {
        return this.lifecycleService.findLedger(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    storeCouponDailyReport(
        @Ctx() ctx: RequestContext,
        @Args('from') from: Date,
        @Args('to') to: Date,
        @Args('campaignId') campaignId?: ID,
    ) {
        return this.campaignService.dailyCouponReport(ctx, from, to, campaignId);
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
        @Args('password') password: string,
    ) {
        return this.passwordService
            .assertCurrentPassword(ctx, password)
            .then(() => this.campaignService.setEnabled(ctx, id, enabled));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    updateStorePromotionName(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('name') name: string) {
        return this.campaignService.updateName(ctx, id, name);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    stopStoreCouponIssuance(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('password') password: string,
    ) {
        return this.passwordService
            .assertCurrentPassword(ctx, password)
            .then(() => this.campaignService.stopCouponIssuance(ctx, id));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeletePromotion)
    archiveStoreCouponCampaign(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('password') password: string,
    ) {
        return this.passwordService
            .assertCurrentPassword(ctx, password)
            .then(() => this.campaignService.archiveCouponCampaign(ctx, id));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdatePromotion)
    revokeStoreCouponCampaignOutstanding(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('password') password: string,
        @Args('reason') reason?: string,
    ) {
        return this.passwordService
            .assertCurrentPassword(ctx, password)
            .then(() => this.lifecycleService.revokeCampaignOutstanding(ctx, id, reason));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeletePromotion)
    deleteStorePromotion(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('password') password: string) {
        return this.passwordService
            .assertCurrentPassword(ctx, password)
            .then(() => this.campaignService.delete(ctx, id));
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

    @Query()
    @Allow(Permission.Authenticated)
    myStorefrontCouponUsageRecords(@Ctx() ctx: RequestContext) {
        return this.lifecycleService.findMyUsageRecords(ctx);
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
    applyBestStorefrontCoupon(@Ctx() ctx: RequestContext) {
        return this.lifecycleService.applyBest(ctx);
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
