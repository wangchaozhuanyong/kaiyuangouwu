export const orderStatesReadyForFulfillment = ['PaymentAuthorized', 'PaymentSettled'] as const;

export interface FulfillmentQueueOrder {
    id: string;
    code: string;
    state: string;
    type?: string;
}

export function isOrderReadyForFulfillment(order: Pick<FulfillmentQueueOrder, 'state' | 'type'>): boolean {
    if (order.type === 'Aggregate') {
        return false;
    }
    return orderStatesReadyForFulfillment.includes(
        order.state as (typeof orderStatesReadyForFulfillment)[number],
    );
}

export function getOrdersReadyForFulfillment<T extends FulfillmentQueueOrder>(orders: T[]): T[] {
    return orders.filter(isOrderReadyForFulfillment);
}
