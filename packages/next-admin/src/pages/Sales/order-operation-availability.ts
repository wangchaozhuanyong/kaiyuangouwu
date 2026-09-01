const MANUAL_PAYMENT_ORDER_STATES = new Set(['ArrangingPayment', 'ArrangingAdditionalPayment']);

export function canAddManualPayment(state: string, outstanding: number): boolean {
    return outstanding > 0 && MANUAL_PAYMENT_ORDER_STATES.has(state);
}
