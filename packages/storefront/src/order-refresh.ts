export const ORDER_STATUS_REFRESH_INTERVAL = 10_000;

const TERMINAL_ORDER_STATES = new Set(['Cancelled', 'Delivered', 'TestPaymentSettled']);

export function orderNeedsStatusRefresh(state: string | null | undefined): boolean {
    return Boolean(state && !TERMINAL_ORDER_STATES.has(state));
}

export function orderStatusRefreshInterval(state: string | null | undefined): number | false {
    return orderNeedsStatusRefresh(state) ? ORDER_STATUS_REFRESH_INTERVAL : false;
}
