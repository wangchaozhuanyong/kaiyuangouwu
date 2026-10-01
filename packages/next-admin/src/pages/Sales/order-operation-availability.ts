const MANUAL_PAYMENT_ORDER_STATES = new Set(['ArrangingPayment', 'ArrangingAdditionalPayment']);
export const PHYSICAL_FULFILLMENT_ORDER_STATES = [
    'PaymentAuthorized',
    'PaymentSettled',
    'PartiallyShipped',
    'PartiallyDelivered',
] as const;
const PHYSICAL_FULFILLMENT_ORDER_STATE_SET = new Set<string>(PHYSICAL_FULFILLMENT_ORDER_STATES);

export function canAddManualPayment(state: string, outstanding: number): boolean {
    return outstanding > 0 && MANUAL_PAYMENT_ORDER_STATES.has(state);
}

export function canCreatePhysicalFulfillment(state: string): boolean {
    return PHYSICAL_FULFILLMENT_ORDER_STATE_SET.has(state);
}
