import { ID, Order, Promotion, RequestContext, TransactionalConnection } from '@vendure/core';
import { IsNull, LessThanOrEqual, Not } from 'typeorm';

import { stringArg } from './promotion-operation-args';

export type CouponAudience = 'ALL' | 'NEW' | 'RETURNING';

export function couponAudience(promotion: Promotion): CouponAudience {
    const rule = promotion.conditions?.find(condition => condition.code === 'store_customer_order_history');
    if (!rule) return 'ALL';
    // Unknown configured rules must never become unrestricted coupons.
    return stringArg(rule, 'audience') as CouponAudience;
}

export async function couponCustomerEligible(
    ctx: RequestContext,
    connection: TransactionalConnection,
    audience: CouponAudience,
    customerId?: ID | null,
    order?: Pick<Order, 'id' | 'orderPlacedAt'>,
): Promise<boolean> {
    if (audience === 'ALL') return true;
    if (!customerId || (audience !== 'NEW' && audience !== 'RETURNING')) return false;
    const previous = await connection.getRepository(ctx, Order).findOne({
        where: {
            customerId,
            salesChannelId: ctx.channelId,
            // A submitted order counts regardless of its later payment or fulfilment state.
            // Draft carts do not count because Vendure leaves orderPlacedAt null.
            orderPlacedAt: order?.orderPlacedAt ? LessThanOrEqual(order.orderPlacedAt) : Not(IsNull()),
            ...(order ? { id: Not(order.id) } : {}),
            // Recalculating a placed order must not make later purchases invalidate its original quote.
        },
        select: { id: true },
    });
    return audience === 'NEW' ? !previous : Boolean(previous);
}
