import {
    Order,
    OrderLine,
    RequestContext,
    ShippingLine,
    ShippingLineAssignmentStrategy,
} from '@vendure/core';

import { getOrderLineFulfillmentType } from './fulfillment-classification';

export class CommerceShippingLineAssignmentStrategy implements ShippingLineAssignmentStrategy {
    assignShippingLineToOrderLines(
        ctx: RequestContext,
        shippingLine: ShippingLine,
        order: Order,
    ): OrderLine[] {
        return order.lines.filter(line => getOrderLineFulfillmentType(line) === 'physical');
    }
}
