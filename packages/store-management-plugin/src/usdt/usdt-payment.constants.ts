export const USDT_TRC20_NETWORK = 'TRC20';
export const USDT_TRC20_CONTRACT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const USDT_TRC20_DECIMALS = 6;
export const USDT_TRC20_PAYMENT_HANDLER_CODE = 'usdt-trc20-chain-handler';
export const USDT_TRC20_PAYMENT_METHOD_CODE = 'usdt-trc20';

export const USDT_PAYMENT_INTENT_STATUS = {
    pending: 'PENDING',
    settled: 'SETTLED',
    manualReview: 'MANUAL_REVIEW',
    expired: 'EXPIRED',
} as const;

export type UsdtPaymentIntentStatus =
    (typeof USDT_PAYMENT_INTENT_STATUS)[keyof typeof USDT_PAYMENT_INTENT_STATUS];
