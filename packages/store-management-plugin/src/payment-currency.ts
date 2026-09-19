import { CurrencyCode, Order } from '@vendure/core';

import { USDT_TRC20_PAYMENT_METHOD_CODE } from './usdt/usdt-payment.constants';

export const STOREFRONT_USDT_CURRENCY_CODE = 'USDT' as const;
export const STOREFRONT_PAYMENT_CURRENCY_CODES = [
    CurrencyCode.CNY,
    CurrencyCode.MYR,
    STOREFRONT_USDT_CURRENCY_CODE,
] as const;

export type StorefrontPaymentCurrencyCode = (typeof STOREFRONT_PAYMENT_CURRENCY_CODES)[number];

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        paymentCurrencyCode?: StorefrontPaymentCurrencyCode | null;
    }
}

export function isStorefrontPaymentCurrencyCode(value: unknown): value is StorefrontPaymentCurrencyCode {
    return STOREFRONT_PAYMENT_CURRENCY_CODES.includes(value as StorefrontPaymentCurrencyCode);
}

export function orderPaymentCurrencyCode(order: Pick<Order, 'currencyCode' | 'customFields'>): string {
    const selected = order.customFields?.paymentCurrencyCode;
    return isStorefrontPaymentCurrencyCode(selected) ? selected : String(order.currencyCode);
}

export function paymentMethodMatchesCurrency(paymentCurrencyCode: string, methodCode: string): boolean {
    return paymentCurrencyCode === STOREFRONT_USDT_CURRENCY_CODE
        ? methodCode === USDT_TRC20_PAYMENT_METHOD_CODE
        : methodCode !== USDT_TRC20_PAYMENT_METHOD_CODE;
}
