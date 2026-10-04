import { CurrencyCode } from '@vendure/core';
import { convertDefaultCurrencyPriceForRequest } from '@vendure/store-management-plugin/currency-conversion';
import { describe, expect, it } from 'vitest';

import { catalogPriceBounds } from './catalog-price-bounds';

describe('catalog currency boundaries match the existing price strategy', () => {
    it.each(['CENT', 'TENTH', 'WHOLE'])(
        'retains inclusive rounded boundaries for %s in both directions',
        rounding => {
            for (const source of [CurrencyCode.CNY, CurrencyCode.MYR]) {
                const ctx = {
                    currencyCode: source === CurrencyCode.CNY ? CurrencyCode.MYR : CurrencyCode.CNY,
                    channel: {
                        defaultCurrencyCode: source,
                        customFields: {
                            cnyToMyrRate: 0.53,
                            currencyRateMarkupBps: 125,
                            currencyRoundingMode: rounding,
                        },
                    },
                } as any;
                for (const min of [0, 51, 100, 150]) {
                    const max = min + 85;
                    const bounds = catalogPriceBounds(ctx, min, max);
                    if (bounds.min == null || bounds.max == null) throw new Error('Missing price bounds');
                    for (let base = 0; base < 1000; base++) {
                        const display = convertDefaultCurrencyPriceForRequest(ctx, base);
                        if (display == null) throw new Error('Missing converted price');
                        expect(base >= bounds.min && base <= bounds.max).toBe(
                            display >= min && display <= max,
                        );
                    }
                }
            }
        },
    );
    it('rejects an unavailable exchange rate rather than using a wrong currency', () => {
        expect(() =>
            catalogPriceBounds(
                {
                    currencyCode: CurrencyCode.MYR,
                    channel: {
                        defaultCurrencyCode: CurrencyCode.CNY,
                        customFields: {},
                    },
                } as any,
                0,
                100,
            ),
        ).toThrow(/汇率/);
    });
});
