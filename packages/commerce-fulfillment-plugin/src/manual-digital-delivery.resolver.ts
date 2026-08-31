import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Order, Permission, RequestContext, Transaction } from '@vendure/core';

import { ManualDigitalDeliveryService, SaveManualDeliveryInput } from './manual-digital-delivery.service';

@Resolver()
export class ManualDigitalDeliveryAdminResolver {
    constructor(private readonly service: ManualDigitalDeliveryService) {}

    @Query()
    @Allow(Permission.ReadOrder)
    manualDigitalDeliveries(
        @Ctx() ctx: RequestContext,
        @Args('options') options: { skip?: number; take?: number; state?: string } = {},
    ) {
        return this.service.list(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    manualDigitalDelivery(@Ctx() ctx: RequestContext, @Args('id') id: string) {
        return this.service.one(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    saveManualDigitalDeliveryDraft(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SaveManualDeliveryInput,
    ) {
        return this.service.saveDraft(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    publishManualDigitalDelivery(@Ctx() ctx: RequestContext, @Args('input') input: SaveManualDeliveryInput) {
        return this.service.publish(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    retryManualDigitalDelivery(@Ctx() ctx: RequestContext, @Args('id') id: string) {
        return this.service.retry(ctx, id);
    }
}

@Resolver('Order')
export class ManualDigitalDeliveryOrderResolver {
    constructor(private readonly service: ManualDigitalDeliveryService) {}

    @ResolveField()
    manualDigitalDeliveries(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        return this.service.forOrder(ctx, order.id);
    }
}
