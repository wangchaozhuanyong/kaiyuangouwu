import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Order, Permission, RequestContext, Transaction } from '@vendure/core';

import { DigitalReceiptService } from './digital-receipt.service';

@Resolver()
export class DigitalReceiptShopResolver {
    constructor(private readonly receipts: DigitalReceiptService) {}

    @Query()
    @Allow(Permission.Public)
    myDigitalDeliveryContents(
        @Ctx() ctx: RequestContext,
        @Args('orderId') id: ID,
        @Args('confirmationToken') token?: string,
    ) {
        return this.receipts.myDigitalDeliveryContents(ctx, id, token);
    }

    @Mutation()
    @Transaction('manual')
    @Allow(Permission.Public)
    claimDigitalDelivery(
        @Ctx() ctx: RequestContext,
        @Args('orderId') id: ID,
        @Args('orderLineId') lineId: ID,
        @Args('confirmationToken') token?: string,
    ) {
        return this.receipts.claimDigitalDelivery(ctx, id, lineId, token);
    }

    /** Internal compatibility proxy; the metadata source lives only in DigitalReceiptService. */
    statuses(ctx: RequestContext, order: Order) {
        return this.receipts.statuses(ctx, order);
    }
}
