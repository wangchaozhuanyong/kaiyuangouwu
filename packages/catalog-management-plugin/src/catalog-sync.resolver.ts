import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    ConfigService,
    Ctx,
    ID,
    Permission,
    ProductVariant,
    ProductVariantPrice,
    RequestContext,
    Transaction,
    TransactionalConnection,
} from '@vendure/core';
import { managePlatformCatalogPermission } from '@vendure/store-management-plugin';

import { CatalogSyncInput, CatalogSyncService } from './catalog-sync.service';

@Resolver()
export class CatalogSyncResolver {
    constructor(private readonly sync: CatalogSyncService) {}
    @Query()
    @Allow(managePlatformCatalogPermission.Permission)
    catalogSyncRules(@Ctx() ctx: RequestContext) {
        return this.sync.list(ctx);
    }
    @Query()
    @Allow(managePlatformCatalogPermission.Permission)
    catalogSyncIssues(
        @Ctx() ctx: RequestContext,
        @Args('ruleId') ruleId: ID,
        @Args('skip') skip: number,
        @Args('take') take: number,
    ) {
        return this.sync.issues(ctx, ruleId, skip, take);
    }
    @Mutation()
    @Allow(managePlatformCatalogPermission.Permission)
    previewCatalogSyncRule(@Ctx() ctx: RequestContext, @Args('input') input: CatalogSyncInput) {
        return this.sync.preview(ctx, input);
    }
    @Mutation()
    @Transaction()
    @Allow(managePlatformCatalogPermission.Permission)
    saveCatalogSyncRule(@Ctx() ctx: RequestContext, @Args('input') input: CatalogSyncInput) {
        return this.sync.save(ctx, input);
    }
    @Mutation()
    @Allow(managePlatformCatalogPermission.Permission)
    enableCatalogSyncRule(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('version') version: number,
        @Args('fingerprint') fingerprint: string,
        @Args('acceptTakeover') acceptTakeover: boolean,
    ) {
        return this.sync.enable(ctx, id, version, fingerprint, acceptTakeover);
    }
    @Mutation()
    @Allow(managePlatformCatalogPermission.Permission)
    pauseCatalogSyncRule(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('version') version: number) {
        return this.sync.pause(ctx, id, version);
    }
    @Mutation()
    @Allow(managePlatformCatalogPermission.Permission)
    reconcileCatalogSyncRule(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.sync.request(ctx, id);
    }
}

/** Admin lists must distinguish an unconfigured price from a genuine zero-price offer. */
@Resolver('ProductVariant')
export class CatalogOperatingPriceResolver {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly config: ConfigService,
    ) {}
    @ResolveField()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    async catalogOperatingPrice(@Ctx() ctx: RequestContext, @Parent() variant: ProductVariant) {
        const prices = await this.connection
            .getRepository(ctx, ProductVariantPrice)
            .find({ where: { variant: { id: variant.id }, channelId: ctx.channelId } });
        return (
            (await this.config.catalogOptions.productVariantPriceSelectionStrategy.selectPrice(ctx, prices))
                ?.price ?? null
        );
    }
    @ResolveField()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    catalogOperatingCurrency(@Ctx() ctx: RequestContext) {
        return ctx.currencyCode;
    }
}
