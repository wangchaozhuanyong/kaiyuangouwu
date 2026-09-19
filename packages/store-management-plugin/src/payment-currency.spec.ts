import { CurrencyCode } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import {
    isStorefrontPaymentCurrencyCode,
    orderPaymentCurrencyCode,
    paymentMethodMatchesCurrency,
} from './payment-currency';

describe('storefront payment currency', () => {
    it.each([CurrencyCode.CNY, CurrencyCode.MYR, 'USDT'])('accepts supported currency %s', currency => {
        expect(isStorefrontPaymentCurrencyCode(currency)).toBe(true);
    });

    it('rejects unsupported and malformed values', () => {
        expect(isStorefrontPaymentCurrencyCode('USD')).toBe(false);
        expect(isStorefrontPaymentCurrencyCode(null)).toBe(false);
    });

    it('uses the persisted payment currency and falls back to the order ledger currency', () => {
        expect(
            orderPaymentCurrencyCode({
                currencyCode: CurrencyCode.CNY,
                customFields: { paymentCurrencyCode: 'USDT' },
            } as never),
        ).toBe('USDT');
        expect(orderPaymentCurrencyCode({ currencyCode: CurrencyCode.MYR, customFields: {} })).toBe('MYR');
    });

    it('allows only USDT-TRC20 for USDT and excludes it for fiat', () => {
        expect(paymentMethodMatchesCurrency('USDT', 'usdt-trc20')).toBe(true);
        expect(paymentMethodMatchesCurrency('USDT', 'stripe')).toBe(false);
        expect(paymentMethodMatchesCurrency('CNY', 'usdt-trc20')).toBe(false);
        expect(paymentMethodMatchesCurrency('CNY', 'stripe')).toBe(true);
    });
});
