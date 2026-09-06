import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { storefrontContentPermission } from './constants';
import {
    StorefrontVisualPresetService,
    UpdateStorefrontVisualPresetInput,
} from './storefront-visual-preset.service';

@Resolver()
export class StorefrontVisualPresetShopResolver {
    constructor(private readonly service: StorefrontVisualPresetService) {}

    @Query()
    @Allow(Permission.Public)
    storefrontVisualPreset(@Ctx() ctx: RequestContext) {
        return this.service.get(ctx);
    }
}

@Resolver()
export class StorefrontVisualPresetAdminResolver {
    constructor(private readonly service: StorefrontVisualPresetService) {}

    @Query()
    @Allow(storefrontContentPermission.Read)
    storefrontVisualPreset(@Ctx() ctx: RequestContext) {
        return this.service.get(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Update)
    updateStorefrontVisualPreset(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateStorefrontVisualPresetInput,
    ) {
        return this.service.update(ctx, input);
    }
}
