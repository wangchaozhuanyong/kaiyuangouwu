import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Order, Permission, RequestContext, Transaction } from '@vendure/core';

import { OrderProcessingListOptions, OrderProcessingService } from './order-processing.service';

@Resolver()
export class OrderOperationsAdminResolver {
    constructor(private readonly processing: OrderProcessingService) {}

    @Query()
    @Allow(Permission.ReadOrder)
    physicalFulfillmentTodoCount(@Ctx() ctx: RequestContext) {
        return this.processing.counts(ctx).then(counts => counts.physical);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    processingOrders(@Ctx() ctx: RequestContext, @Args('options') options?: OrderProcessingListOptions) {
        return this.processing.list(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    orderProcessingCounts(@Ctx() ctx: RequestContext) {
        return this.processing.counts(ctx);
    }

    @Mutation()
    @Transaction('manual')
    @Allow(Permission.UpdateOrder)
    finishOrderModification(@Ctx() ctx: RequestContext, @Args('orderId') orderId: string) {
        return this.processing.finishModification(ctx, orderId);
    }

    @Mutation()
    @Transaction('manual')
    @Allow(Permission.UpdateOrder)
    prepareFulfillmentShipment(
        @Ctx() ctx: RequestContext,
        @Args('input') input: { fulfillmentId: string; carrier: string; trackingCode: string },
    ) {
        return this.processing.prepareShipment(ctx, input);
    }
}

@Resolver('Order')
export class OrderProcessingFieldResolver {
    constructor(private readonly processing: OrderProcessingService) {}

    @ResolveField()
    @Allow(Permission.ReadOrder)
    processingSummary(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        return this.processing.forOrder(ctx, order);
    }
}
