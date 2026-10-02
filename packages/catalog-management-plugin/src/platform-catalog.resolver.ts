import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import { managePlatformCatalogPermission } from '@vendure/store-management-plugin';

import { CatalogTemplateLibraryService } from './catalog-template-library.service';
import { DistributionInput, PlatformCatalogService } from './platform-catalog.service';

@Resolver()
export class PlatformCatalogResolver {
    constructor(
        private readonly service: PlatformCatalogService,
        private readonly library: CatalogTemplateLibraryService,
    ) {}
    @Query()
    @Allow(managePlatformCatalogPermission.Permission)
    platformCatalogResources(
        @Ctx() ctx: RequestContext,
        @Args('resourceType') type: Parameters<CatalogTemplateLibraryService['resources']>[1],
    ) {
        return this.library.resources(ctx, type);
    }
    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadFacet, Permission.ReadProduct)
    catalogTemplateLibrary(@Ctx() ctx: RequestContext) {
        return this.library.library(ctx);
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.CreateCatalog, Permission.CreateFacet, Permission.CreateProduct)
    claimCatalogTemplate(
        @Ctx() ctx: RequestContext,
        @Args('resourceType') type: 'Facet' | 'ProductOptionGroup',
        @Args('resourceId') id: string,
    ) {
        return this.library.claim(ctx, type, id);
    }
    @Mutation()
    @Transaction()
    @Allow(managePlatformCatalogPermission.Permission)
    publishPlatformCatalogTemplate(
        @Ctx() ctx: RequestContext,
        @Args('resourceType') type: 'Facet' | 'ProductOptionGroup',
        @Args('resourceId') id: string,
    ) {
        return this.library.publish(ctx, type, id);
    }
    @Query()
    @Allow(managePlatformCatalogPermission.Permission, Permission.SuperAdmin)
    platformCatalogProducts(
        @Ctx() ctx: RequestContext,
        @Args() args: { skip?: number; take?: number; term?: string },
    ) {
        return this.service.catalog(ctx, args.skip, args.take, args.term);
    }
    @Mutation()
    @Allow(managePlatformCatalogPermission.Permission, Permission.SuperAdmin)
    previewPlatformCatalogDistribution(@Ctx() ctx: RequestContext, @Args('input') input: DistributionInput) {
        return this.service.preview(ctx, input);
    }
    @Mutation()
    @Allow(managePlatformCatalogPermission.Permission, Permission.SuperAdmin)
    executePlatformCatalogDistribution(@Ctx() ctx: RequestContext, @Args('batchId') batchId: string) {
        return this.service.execute(ctx, batchId);
    }
    @Query()
    @Allow(Permission.ReadProduct)
    myProductSalesOffer(@Ctx() ctx: RequestContext, @Args('productId') productId: string) {
        return this.service.myOffer(ctx, productId);
    }
    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateProduct)
    updateMyProductSalesOffer(
        @Ctx() ctx: RequestContext,
        @Args('input') input: Parameters<PlatformCatalogService['updateMyOffer']>[1],
    ) {
        return this.service.updateMyOffer(ctx, input);
    }
}
