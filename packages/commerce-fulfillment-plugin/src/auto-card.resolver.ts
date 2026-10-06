import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ID,
    Order,
    Permission,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    Transaction,
} from '@vendure/core';
import { managePlatformCatalogPermission } from '@vendure/store-management-plugin';

import { AutoCardSupplyService } from './auto-card-supply.service';
import { manageAutoCardSecretsPermission, readSoldAutoCardsPermission } from './auto-card.constants';
import { AutoCardService } from './auto-card.service';
import { DigitalProductService } from './digital-product.service';
import { StoreCatalogStatusService } from './store-catalog-status.service';
import {
    AutoCardDeliveryListOptions,
    AutoCardImportInput,
    AutoCardPoolItemListOptions,
    UpdateAutoCardConfigInput,
} from './types';

@Resolver()
export class AutoCardAdminResolver {
    constructor(
        private readonly autoCardService: AutoCardService,
        private readonly supply: AutoCardSupplyService,
        private readonly status: StoreCatalogStatusService,
    ) {}

    @Query()
    @Allow(Permission.ReadProduct)
    myAutoCardSupplySummary(@Ctx() ctx: RequestContext, @Args('productVariantId') id: ID) {
        return this.supply.supplierSummary(ctx, id);
    }

    @Query()
    @Allow(Permission.ReadProduct)
    myStoreCatalogStatus(@Ctx() ctx: RequestContext) {
        return this.status.summary(ctx);
    }

    @Query()
    @Allow(managePlatformCatalogPermission.Permission)
    platformAutoCardSupplyCatalog(@Ctx() ctx: RequestContext, @Args('productId') id: ID) {
        return this.supply.catalog(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(managePlatformCatalogPermission.Permission)
    setPlatformAutoCardSupply(
        @Ctx() ctx: RequestContext,
        @Args('input') input: Parameters<AutoCardSupplyService['setGrant']>[1],
    ) {
        return this.supply.setGrant(ctx, input);
    }

    @Mutation()
    @Allow(readSoldAutoCardsPermission.Permission)
    revealMyOrderAutoCards(@Ctx() ctx: RequestContext, @Args('deliveryId') id: ID) {
        return this.autoCardService.revealSoldCards(ctx, id);
    }

    @Query()
    @Allow(Permission.ReadProduct)
    autoCardConfig(@Ctx() ctx: RequestContext, @Args('productVariantId') productVariantId: ID) {
        return this.autoCardService.configForVariant(ctx, productVariantId);
    }

    @Query()
    @Allow(Permission.ReadProduct)
    autoCardPoolItems(
        @Ctx() ctx: RequestContext,
        @Args('productVariantId') productVariantId: ID,
        @Args('options') options?: AutoCardPoolItemListOptions,
    ) {
        return this.autoCardService.poolItems(ctx, productVariantId, options);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    autoCardDeliveries(@Ctx() ctx: RequestContext, @Args('options') options?: AutoCardDeliveryListOptions) {
        return this.autoCardService.deliveries(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadProduct)
    autoCardTodoSummary(@Ctx() ctx: RequestContext) {
        return this.autoCardService.todoSummary(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
    updateAutoCardConfig(@Ctx() ctx: RequestContext, @Args('input') input: UpdateAutoCardConfigInput) {
        return this.autoCardService.updateConfig(ctx, input);
    }

    @Mutation()
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
    previewAutoCardPoolImport(@Ctx() ctx: RequestContext, @Args('input') input: AutoCardImportInput) {
        return this.autoCardService.previewImport(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
    importAutoCardPoolItems(@Ctx() ctx: RequestContext, @Args('input') input: AutoCardImportInput) {
        return this.autoCardService.importPoolItems(ctx, input);
    }

    @Mutation()
    @Allow(manageAutoCardSecretsPermission.Permission)
    revealAutoCardPoolItem(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.autoCardService.revealPoolItem(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
    setAutoCardPoolItemEnabled(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('enabled') enabled: boolean,
        @Args('reason') reason?: string,
    ) {
        return this.autoCardService.setPoolItemEnabled(ctx, id, enabled, reason);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder)
    retryAutoCardDelivery(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.autoCardService.retryDelivery(ctx, id);
    }
}

@Resolver('Order')
export class AutoCardOrderResolver {
    constructor(private readonly autoCardService: AutoCardService) {}

    @ResolveField()
    autoCardDeliveries(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        return this.autoCardService.publicDeliveriesForOrder(ctx, order.id);
    }
}

@Resolver('ProductVariant')
export class AutoCardProductVariantResolver {
    constructor(private readonly autoCardService: AutoCardService) {}

    @ResolveField()
    @Allow(Permission.Public)
    autoCardAvailableStock(@Ctx() ctx: RequestContext, @Parent() variant: ProductVariant) {
        return this.autoCardService.availableStockForDisplay(ctx, variant);
    }
}

@Resolver('ProductVariant')
export class AutoCardShopProductVariantResolver {
    constructor(
        private readonly autoCardService: AutoCardService,
        private readonly productVariantService: ProductVariantService,
        private readonly digitalProducts: DigitalProductService,
    ) {}

    @ResolveField()
    @Allow(Permission.Public)
    async saleableStockLevel(@Ctx() ctx: RequestContext, @Parent() variant: ProductVariant) {
        const digital = await this.digitalProducts.availableForDisplay(ctx, variant);
        if (digital !== undefined) return digital;
        const isAutoCard =
            variant.customFields.fulfillmentType === 'digital' &&
            variant.customFields.digitalDeliveryMode === 'auto_card';
        if (isAutoCard) {
            const autoCardStockLevel = await this.autoCardService.availableStockForDisplay(ctx, variant);
            return normalizePublicSaleableStockLevel(autoCardStockLevel ?? 0);
        }
        const stockLevel = await this.productVariantService.getSaleableStockLevelForDisplay(ctx, variant);
        return normalizePublicSaleableStockLevel(stockLevel);
    }
}

@Resolver('ProductVariant')
export class DigitalProductVariantMetadataResolver {
    constructor(private readonly digitalProducts: DigitalProductService) {}

    @ResolveField()
    async customFields(@Ctx() ctx: RequestContext, @Parent() variant: ProductVariant) {
        const config =
            variant.customFields.fulfillmentType === 'digital'
                ? await this.digitalProducts.configForDisplay(ctx, variant.id)
                : null;
        return config
            ? {
                  ...variant.customFields,
                  digitalDeliveryMode: config.deliveryMode,
                  digitalStockPolicy: config.stockPolicy,
              }
            : variant.customFields;
    }
}

export function normalizePublicSaleableStockLevel(stockLevel: number): number | null {
    if (stockLevel === Number.MAX_SAFE_INTEGER) return null;
    if (!Number.isFinite(stockLevel)) return null;
    return Math.max(0, Math.floor(stockLevel));
}

export const autoCardAdminResolvers = [
    AutoCardAdminResolver,
    AutoCardProductVariantResolver,
    DigitalProductVariantMetadataResolver,
];
export const autoCardShopResolvers = [
    AutoCardOrderResolver,
    AutoCardProductVariantResolver,
    AutoCardShopProductVariantResolver,
    DigitalProductVariantMetadataResolver,
];
