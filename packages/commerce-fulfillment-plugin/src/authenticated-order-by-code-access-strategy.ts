import { Order, OrderByCodeAccessStrategy, RequestContext } from '@vendure/core';

export class AuthenticatedOrderByCodeAccessStrategy implements OrderByCodeAccessStrategy {
    canAccessOrder(ctx: RequestContext, order: Order): boolean {
        return Boolean(
            ctx.activeUserId &&
            order.customer?.user?.id &&
            String(order.customer.user.id) === String(ctx.activeUserId),
        );
    }
}
