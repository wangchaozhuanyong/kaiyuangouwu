import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Fulfillment, Permission, RequestContext, Transaction } from '@vendure/core';

import { FulfillmentDeliveryService } from './fulfillment-delivery.service';
import {
    ConfirmFulfillmentDeliveryInput,
    FulfillmentDeliveryListOptions,
    UpdateFulfillmentDeliveryInput,
} from './types';

@Resolver('Fulfillment')
export class FulfillmentDeliveryFieldResolver {
    constructor(private readonly fulfillmentDeliveryService: FulfillmentDeliveryService) {}

    @ResolveField()
    deliveryEvidence(@Ctx() ctx: RequestContext, @Parent() fulfillment: Fulfillment) {
        return this.fulfillmentDeliveryService.findForFulfillment(ctx, fulfillment.id);
    }
}

@Resolver()
export class FulfillmentDeliveryShopResolver {
    constructor(private readonly fulfillmentDeliveryService: FulfillmentDeliveryService) {}

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    confirmMyFulfillmentDelivery(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ConfirmFulfillmentDeliveryInput,
    ) {
        return this.fulfillmentDeliveryService.confirmForCustomer(ctx, input);
    }
}

@Resolver()
export class FulfillmentDeliveryAdminResolver {
    constructor(private readonly fulfillmentDeliveryService: FulfillmentDeliveryService) {}

    @Query()
    @Allow(Permission.ReadOrder)
    fulfillmentDeliveryExceptions(
        @Ctx() ctx: RequestContext,
        @Args('options') options?: FulfillmentDeliveryListOptions,
    ) {
        return this.fulfillmentDeliveryService.findExceptions(ctx, options);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    updateFulfillmentDelivery(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateFulfillmentDeliveryInput,
    ) {
        return this.fulfillmentDeliveryService.updateForAdmin(ctx, input);
    }
}
