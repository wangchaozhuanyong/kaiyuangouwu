export const ORDER_STATUS_REFRESH_INTERVAL = 10_000;

export const PENDING_PAYMENT_ORDER_STATES = [
    'ArrangingPayment',
    'AwaitingManualPayment',
    'ArrangingAdditionalPayment',
] as const;

export function isPendingPaymentOrderState(state: string): boolean {
    return PENDING_PAYMENT_ORDER_STATES.some(candidate => candidate === state);
}

const TERMINAL_ORDER_STATES = new Set(['Cancelled', 'Delivered', 'TestPaymentSettled']);

export function orderNeedsStatusRefresh(state: string | null | undefined): boolean {
    return Boolean(state && !TERMINAL_ORDER_STATES.has(state));
}

export function orderStatusRefreshInterval(state: string | null | undefined): number | false {
    return orderNeedsStatusRefresh(state) ? ORDER_STATUS_REFRESH_INTERVAL : false;
}
