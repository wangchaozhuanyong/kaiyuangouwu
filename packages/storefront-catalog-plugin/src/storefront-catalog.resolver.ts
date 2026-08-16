import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import { StorefrontCatalogService } from './storefront-catalog.service';
import { StorefrontProductSalesService } from './storefront-product-sales.service';
import { StorefrontCatalogInput } from './types';

@Resolver()
export class StorefrontCatalogShopResolver {
    constructor(
        private readonly catalogService: StorefrontCatalogService,
        private readonly productSalesService: StorefrontProductSalesService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    storefrontCatalog(@Ctx() ctx: RequestContext, @Args('input') input: StorefrontCatalogInput) {
        return this.catalogService.find(ctx, input);
    }

    @Query()
    @Allow(Permission.Public)
    storefrontProductSales(@Ctx() ctx: RequestContext, @Args('productIds') productIds: ID[]) {
        return this.productSalesService.findByProductIds(ctx, productIds);
    }
}
