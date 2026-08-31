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

import { AutoCardService } from './auto-card.service';
import {
    AutoCardDeliveryListOptions,
    AutoCardImportInput,
    AutoCardPoolItemListOptions,
    UpdateAutoCardConfigInput,
} from './types';

@Resolver()
export class AutoCardAdminResolver {
    constructor(private readonly autoCardService: AutoCardService) {}

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
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
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
        return this.autoCardService.availableStockForVariant(ctx, variant.id);
    }
}

@Resolver('ProductVariant')
export class AutoCardShopProductVariantResolver {
    constructor(
        private readonly autoCardService: AutoCardService,
        private readonly productVariantService: ProductVariantService,
    ) {}

    @ResolveField()
    @Allow(Permission.Public)
    async saleableStockLevel(@Ctx() ctx: RequestContext, @Parent() variant: ProductVariant) {
        const isAutoCard =
            variant.customFields.fulfillmentType === 'digital' &&
            variant.customFields.digitalDeliveryMode === 'auto_card';
        if (isAutoCard) {
            const autoCardStockLevel = await this.autoCardService.availableStockForVariant(ctx, variant.id);
            return normalizePublicSaleableStockLevel(autoCardStockLevel ?? 0);
        }
        const stockLevel = await this.productVariantService.getSaleableStockLevel(ctx, variant);
        return normalizePublicSaleableStockLevel(stockLevel);
    }
}

export function normalizePublicSaleableStockLevel(stockLevel: number): number | null {
    if (stockLevel === Number.MAX_SAFE_INTEGER) return null;
    if (!Number.isFinite(stockLevel)) return null;
    return Math.max(0, Math.floor(stockLevel));
}
