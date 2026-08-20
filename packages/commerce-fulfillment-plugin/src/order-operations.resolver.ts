import { Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { OrderOperationsService } from './order-operations.service';

@Resolver()
export class OrderOperationsAdminResolver {
    constructor(private readonly orderOperationsService: OrderOperationsService) {}

    @Query()
    @Allow(Permission.ReadOrder)
    physicalFulfillmentTodoCount(@Ctx() ctx: RequestContext) {
        return this.orderOperationsService.countPhysicalFulfillmentTodos(ctx);
    }
}
