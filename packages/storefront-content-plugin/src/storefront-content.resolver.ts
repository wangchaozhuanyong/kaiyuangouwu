import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { storefrontContentPermission } from './constants';
import { StorefrontContentService } from './storefront-content.service';
import { CreateStorefrontContentBlockInput, UpdateStorefrontContentBlockInput } from './types';

@Resolver()
export class StorefrontContentShopResolver {
    constructor(private readonly storefrontContentService: StorefrontContentService) {}

    @Query()
    @Allow(Permission.Public)
    storefrontContent(@Ctx() ctx: RequestContext) {
        return this.storefrontContentService.findPublished(ctx);
    }
}

@Resolver()
export class StorefrontContentAdminResolver {
    constructor(private readonly storefrontContentService: StorefrontContentService) {}

    @Query()
    @Allow(storefrontContentPermission.Read)
    storefrontContentBlocks(@Ctx() ctx: RequestContext) {
        return this.storefrontContentService.findAllForAdmin(ctx);
    }

    @Query()
    @Allow(storefrontContentPermission.Read)
    storefrontContentBlock(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.storefrontContentService.findOneForAdmin(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Create)
    createStorefrontContentBlock(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateStorefrontContentBlockInput,
    ) {
        return this.storefrontContentService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Update)
    updateStorefrontContentBlock(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateStorefrontContentBlockInput,
    ) {
        return this.storefrontContentService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Update)
    reorderStorefrontContentBlocks(@Ctx() ctx: RequestContext, @Args('ids') ids: ID[]) {
        return this.storefrontContentService.reorder(ctx, ids);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Delete)
    deleteStorefrontContentBlock(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.storefrontContentService.delete(ctx, id);
    }
}
