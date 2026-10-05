import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { CheckoutResourcesService } from './checkout-resources.service';
import { DigitalFileService, PrivateDigitalUpload } from './digital-file.service';
import { DigitalProductService, UpdateDigitalVariantInput } from './digital-product.service';
import { FulfillmentModelService } from './fulfillment-model.service';
import { ProductDomainCopyService } from './product-domain-copy.service';

@Resolver()
export class DigitalProductAdminResolver {
    constructor(
        private readonly products: DigitalProductService,
        private readonly files: DigitalFileService,
        private readonly checkout: CheckoutResourcesService,
        private readonly copies: ProductDomainCopyService,
        private readonly model: FulfillmentModelService,
    ) {}
    @Query()
    @Allow(Permission.ReadProduct)
    productTypeChangeAllowed(@Ctx() ctx: RequestContext, @Args('productId') id: ID) {
        return this.model.canChangeProductType(ctx, id);
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.CreateProduct, Permission.CreateCatalog)
    copyProductBasicsAsType(
        @Ctx() ctx: RequestContext,
        @Args('productId') productId: ID,
        @Args('fulfillmentType') type: string,
    ) {
        return this.copies.copy(ctx, productId, type);
    }
    @Query()
    @Allow(Permission.ReadOrder)
    digitalDeliveryExceptions(@Ctx() ctx: RequestContext) {
        return this.checkout.exceptions(ctx);
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder)
    retryCheckoutDelivery(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.checkout.retryDelivery(ctx, orderId);
    }
    @Query()
    @Allow(Permission.ReadProduct)
    digitalProductWorkspace(@Ctx() ctx: RequestContext, @Args('productId') productId: ID) {
        return this.products.workspace(ctx, productId);
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateProduct)
    updateDigitalVariantConfig(@Ctx() ctx: RequestContext, @Args('input') input: UpdateDigitalVariantInput) {
        return this.products.update(ctx, input);
    }
    @Mutation()
    @Allow(Permission.UpdateProduct)
    uploadDigitalDeliveryFile(@Ctx() ctx: RequestContext, @Args('file') file: Promise<PrivateDigitalUpload>) {
        return this.files.upload(ctx, file);
    }
    @Query()
    @Allow(Permission.ReadProduct)
    digitalInventoryMigrationPreview(@Ctx() ctx: RequestContext, @Args('productVariantId') id: ID) {
        return this.products.migrationPreview(ctx, id);
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateProduct)
    migrateDigitalInventory(
        @Ctx() ctx: RequestContext,
        @Args('productVariantId') id: ID,
        @Args('expectedAvailable') available: number,
        @Args('expectedReserved') reserved: number,
    ) {
        return this.products.migrate(ctx, id, available, reserved);
    }
}
