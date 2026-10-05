import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { VendureEvent } from '../vendure-event';

/** Lifecycle around the external gateway call, without gateway response payloads. */
export class PaymentAttemptEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public order: Order,
        public phase: 'STARTED' | 'RETURNED' | 'FAILED',
        public resultState?: string,
    ) {
        super();
    }
}
