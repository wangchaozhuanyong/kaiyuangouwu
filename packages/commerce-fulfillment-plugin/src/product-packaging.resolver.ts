import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, Product, RequestContext, Transaction } from '@vendure/core';

import { ProductPackagingService } from './product-packaging.service';
import { UpdateProductPackagingInput } from './types';

@Resolver()
export class ProductPackagingAdminResolver {
    constructor(private readonly productPackagingService: ProductPackagingService) {}

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    productPackaging(@Ctx() ctx: RequestContext, @Args('productId') productId: ID) {
        return this.productPackagingService.configForProduct(ctx, productId);
    }

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    productPackagingStock(@Ctx() ctx: RequestContext, @Args('productId') productId: ID) {
        return this.productPackagingService.stockSummary(ctx, productId);
    }

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    productPackagingUnpackEvents(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args('take') take?: number,
    ) {
        return this.productPackagingService.unpackEvents(ctx, productId, take);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
    updateProductPackaging(@Ctx() ctx: RequestContext, @Args('input') input: UpdateProductPackagingInput) {
        return this.productPackagingService.updateConfig(ctx, input);
    }
}

@Resolver('Product')
export class ProductPackagingProductResolver {
    constructor(private readonly productPackagingService: ProductPackagingService) {}

    @ResolveField()
    @Allow(Permission.Public)
    packaging(@Ctx() ctx: RequestContext, @Parent() product: Product) {
        return this.productPackagingService.configForProduct(ctx, product.id);
    }
}
