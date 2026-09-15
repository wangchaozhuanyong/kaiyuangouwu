import { ID } from '@vendure/common/lib/shared-types';
import { SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { EntityNotFoundError } from '../../common/error/errors';
import { idsAreEqual } from '../../common/utils';
import { Order } from '../../entity/order/order.entity';

import { isPlatformAdminContext } from './platform-admin-context';

/** Filter by the immutable sale owner; channel memberships are management/assignment metadata. */
export function scopeOrderQuery(
    ctx: RequestContext,
    query: SelectQueryBuilder<Order>,
    access: 'read' | 'business' = 'business',
): SelectQueryBuilder<Order> {
    return access === 'read' && isPlatformAdminContext(ctx)
        ? query
        : query.andWhere(query.alias + '.salesChannelId = :orderSalesChannelId', {
              orderSalesChannelId: ctx.channelId,
          });
}

export function orderBelongsToSalesChannel(
    ctx: RequestContext,
    order: Pick<Order, 'salesChannelId'>,
): boolean {
    return order.salesChannelId != null && idsAreEqual(order.salesChannelId, ctx.channelId);
}

export function assertOrderSalesChannel(
    ctx: RequestContext,
    order: Pick<Order, 'id' | 'salesChannelId'>,
): void {
    if (!orderBelongsToSalesChannel(ctx, order)) throw new EntityNotFoundError('Order', order.id);
}

/** Session references and custom active-order strategies must also respect the signed-in member. */
export function isActiveOrderForUser(ctx: RequestContext, order: Order, userId?: ID): boolean {
    return (
        orderBelongsToSalesChannel(ctx, order) &&
        order.active &&
        (!order.customer?.user || (userId != null && idsAreEqual(order.customer.user.id, userId)))
    );
}
