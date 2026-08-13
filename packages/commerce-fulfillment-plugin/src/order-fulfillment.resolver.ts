import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Ctx, Order, RequestContext, TransactionalConnection } from '@vendure/core';

import { summarizeOrderFulfillment } from './fulfillment-classification';

@Resolver('Order')
export class OrderFulfillmentResolver {
    constructor(private readonly connection: TransactionalConnection) {}

    @ResolveField()
    async checkoutFulfillment(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const orderWithLines = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['lines', 'lines.productVariant'],
        });
        return summarizeOrderFulfillment(orderWithLines);
    }
}
