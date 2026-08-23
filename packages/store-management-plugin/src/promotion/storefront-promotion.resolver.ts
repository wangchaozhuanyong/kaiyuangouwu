import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';

import { UpdateStorefrontPromotionDraftInput } from '../types';

import { StorefrontPromotionService } from './storefront-promotion.service';

@Resolver()
export class StorefrontPromotionAdminResolver {
    constructor(private readonly promotionService: StorefrontPromotionService) {}

    @Query()
    @Allow(storefrontContentPermission.Read)
    storefrontPromotionPage(@Ctx() ctx: RequestContext) {
        return this.promotionService.getForAdmin(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Update)
    saveStorefrontPromotionDraft(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateStorefrontPromotionDraftInput,
    ) {
        return this.promotionService.saveDraft(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Update)
    publishStorefrontPromotionPage(@Ctx() ctx: RequestContext) {
        return this.promotionService.publish(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Update)
    resetStorefrontPromotionPage(@Ctx() ctx: RequestContext) {
        return this.promotionService.resetToDefault(ctx);
    }

    @Mutation()
    @Allow(storefrontContentPermission.Update)
    previewStorefrontPromotionPage(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateStorefrontPromotionDraftInput,
    ) {
        return this.promotionService.preview(ctx, input);
    }
}
