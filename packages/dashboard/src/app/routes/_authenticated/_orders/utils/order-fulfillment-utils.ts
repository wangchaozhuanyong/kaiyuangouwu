export const orderStatesReadyForFulfillment = ['PaymentAuthorized', 'PaymentSettled'] as const;

export interface FulfillmentQueueOrder {
    id: string;
    code: string;
    state: string;
}

export function isOrderReadyForFulfillment(order: Pick<FulfillmentQueueOrder, 'state'>): boolean {
    return orderStatesReadyForFulfillment.includes(
        order.state as (typeof orderStatesReadyForFulfillment)[number],
    );
}

export function getOrdersReadyForFulfillment<T extends FulfillmentQueueOrder>(orders: T[]): T[] {
    return orders.filter(isOrderReadyForFulfillment);
}
