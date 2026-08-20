import { Injectable } from '@nestjs/common';
import { Order, RequestContext, TransactionalConnection } from '@vendure/core';

export const PHYSICAL_FULFILLMENT_TODO_STATES = [
    'PaymentAuthorized',
    'PaymentSettled',
    'PartiallyShipped',
    'PartiallyDelivered',
] as const;

@Injectable()
export class OrderOperationsService {
    constructor(private readonly connection: TransactionalConnection) {}

    /**
     * Counts only placed Orders in the active channel which still contain a
     * physical line. Pure-digital Orders can remain PaymentAuthorized while
     * their content is already delivered, so state alone is not sufficient.
     */
    countPhysicalFulfillmentTodos(ctx: RequestContext): Promise<number> {
        return this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .innerJoin('order.lines', 'line')
            .where('order.active = :active', { active: false })
            .andWhere('order.state IN (:...states)', {
                states: PHYSICAL_FULFILLMENT_TODO_STATES,
            })
            .andWhere('line.customFields.fulfillmentTypeSnapshot = :fulfillmentType', {
                fulfillmentType: 'physical',
            })
            .distinct(true)
            .getCount();
    }
}
