import 'reflect-metadata';

import { CurrencyCode } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import {
    calculateUsdtCheckoutAmount,
    convertMinorPrice,
    publicCurrencySelection,
} from './store-currency-settings.service';

describe('store currency price conversion', () => {
    it('converts CNY minor units to MYR minor units', () => {
        expect(convertMinorPrice(10_000, CurrencyCode.CNY, 0.5991, 0, 'CENT')).toBe(5_991);
        expect(convertMinorPrice(10_000, CurrencyCode.CNY, 0.5991, 0, 'TENTH')).toBe(5_990);
    });

    it('converts MYR back to CNY and applies the configured markup', () => {
        expect(convertMinorPrice(5_991, CurrencyCode.MYR, 0.5991, 0, 'CENT')).toBe(10_000);
        expect(convertMinorPrice(5_991, CurrencyCode.MYR, 0.5991, 2, 'WHOLE')).toBe(10_200);
    });

    it('never creates a negative price', () => {
        expect(convertMinorPrice(0, CurrencyCode.CNY, 0.5991, 10, 'CENT')).toBe(0);
    });
});

describe('USDT checkout quote amount', () => {
    it('applies markup and always rounds the payable amount up to four decimals', () => {
        expect(calculateUsdtCheckoutAmount(10_000, 7.2, 1)).toBe(14.0278);
    });

    it('rejects invalid rate inputs without producing an infinite amount', () => {
        expect(calculateUsdtCheckoutAmount(10_000, 0, 0)).toBe(0);
    });
});

describe('public storefront currency selection', () => {
    it('preserves a channel currency outside the managed CNY and MYR pair', () => {
        expect(
            publicCurrencySelection({
                defaultCurrencyCode: CurrencyCode.USD,
                availableCurrencyCodes: [CurrencyCode.USD],
            }),
        ).toEqual({
            defaultCurrencyCode: CurrencyCode.USD,
            availableCurrencyCodes: [CurrencyCode.USD],
        });
    });

    it('deduplicates currencies and always includes the channel default', () => {
        expect(
            publicCurrencySelection({
                defaultCurrencyCode: CurrencyCode.MYR,
                availableCurrencyCodes: [CurrencyCode.CNY, CurrencyCode.CNY],
            }),
        ).toEqual({
            defaultCurrencyCode: CurrencyCode.MYR,
            availableCurrencyCodes: [CurrencyCode.MYR, CurrencyCode.CNY],
        });
    });
});
