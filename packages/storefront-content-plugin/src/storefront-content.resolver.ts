import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ForbiddenError, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { storefrontContentPermission } from './constants';
import {
    StorefrontAuthSettingsService,
    UpdateStorefrontAuthSettingsInput,
    UpdateStorefrontGooglePlatformSettingsInput,
} from './storefront-auth-settings';
import { StorefrontContentService } from './storefront-content.service';
import {
    ApplyStorefrontContentChangesInput,
    CreateStorefrontContentBlockInput,
    UpdateStorefrontContentBlockInput,
    UpdateStorefrontContentSettingsInput,
} from './types';

@Resolver()
export class StorefrontContentShopResolver {
    constructor(
        private readonly storefrontContentService: StorefrontContentService,
        private readonly storefrontAuthSettingsService: StorefrontAuthSettingsService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    storefrontContent(@Ctx() ctx: RequestContext) {
        return this.storefrontContentService.findPublished(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    async storefrontContentSettings(@Ctx() ctx: RequestContext) {
        const settings = await this.storefrontContentService.getSettings(ctx);
        const auth = await this.storefrontAuthSettingsService.get(ctx);
        return { ...settings, auth };
    }
}

@Resolver()
export class StorefrontContentAdminResolver {
    constructor(
        private readonly storefrontContentService: StorefrontContentService,
        private readonly storefrontAuthSettingsService: StorefrontAuthSettingsService,
    ) {}

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

    @Query()
    @Allow(storefrontContentPermission.Read)
    async storefrontContentSettings(@Ctx() ctx: RequestContext) {
        const settings = await this.storefrontContentService.getSettings(ctx);
        const auth = await this.storefrontAuthSettingsService.get(ctx);
        return { ...settings, auth };
    }

    @Query()
    @Allow(storefrontContentPermission.Read)
    storefrontAuthConfiguration(@Ctx() ctx: RequestContext) {
        return this.storefrontAuthSettingsService.getConfiguration(ctx);
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
    @Allow(storefrontContentPermission.Create, storefrontContentPermission.Update)
    applyStorefrontContentChanges(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ApplyStorefrontContentChangesInput,
    ) {
        const canUpdate = ctx.userHasPermissions([storefrontContentPermission.Update]);
        const canCreate = ctx.userHasPermissions([storefrontContentPermission.Create]);
        if (!canUpdate || (input.creates.length > 0 && !canCreate)) {
            throw new ForbiddenError();
        }
        return this.storefrontContentService.applyChanges(ctx, input);
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

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Update)
    updateStorefrontContentSettings(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateStorefrontContentSettingsInput,
    ) {
        return this.storefrontContentService.updateSettings(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(storefrontContentPermission.Update)
    updateStorefrontAuthSettings(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateStorefrontAuthSettingsInput,
    ) {
        return this.storefrontAuthSettingsService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin)
    updateStorefrontGooglePlatformSettings(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateStorefrontGooglePlatformSettingsInput,
    ) {
        return this.storefrontAuthSettingsService.updatePlatformGoogle(ctx, input);
    }
}
