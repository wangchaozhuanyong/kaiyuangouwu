import {
    Injector,
    Order,
    OrderLine,
    RequestContext,
    ShippingLine,
    ShippingLineAssignmentStrategy,
} from '@vendure/core';

import { CatalogSyncShippingService } from './catalog-sync-shipping.service';
import { getOrderLineFulfillmentType } from './fulfillment-classification';

export class CommerceShippingLineAssignmentStrategy implements ShippingLineAssignmentStrategy {
    private shipping?: CatalogSyncShippingService;
    init(injector: Injector) {
        this.shipping = injector.get(CatalogSyncShippingService);
    }
    assignShippingLineToOrderLines(
        ctx: RequestContext,
        shippingLine: ShippingLine,
        order: Order,
    ): OrderLine[] | Promise<OrderLine[]> {
        if (this.shipping && shippingLine.shippingMethod)
            return this.shipping.assignment(ctx, shippingLine.shippingMethod, order);
        return order.lines.filter(line => getOrderLineFulfillmentType(line) === 'physical');
    }
}
