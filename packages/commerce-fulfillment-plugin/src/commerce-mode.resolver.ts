import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { CommerceModeService } from './commerce-mode.service';
import { StoreCommerceMode } from './types';

@Resolver()
export class CommerceModeAdminResolver {
    constructor(private readonly commerceModeService: CommerceModeService) {}

    @Query()
    @Allow(Permission.ReadCatalog)
    async myStoreCommerceMode(@Ctx() ctx: RequestContext) {
        return { mode: await this.commerceModeService.activeMode(ctx), conflicts: [] };
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog)
    updateMyStoreCommerceMode(@Ctx() ctx: RequestContext, @Args('mode') mode: StoreCommerceMode) {
        return this.commerceModeService.updateActiveMode(ctx, mode);
    }
}

@Resolver()
export class CommerceModeShopResolver {
    constructor(private readonly commerceModeService: CommerceModeService) {}

    @Query()
    @Allow(Permission.Public)
    activeStoreCommerceMode(@Ctx() ctx: RequestContext) {
        return this.commerceModeService.activeMode(ctx);
    }
}
