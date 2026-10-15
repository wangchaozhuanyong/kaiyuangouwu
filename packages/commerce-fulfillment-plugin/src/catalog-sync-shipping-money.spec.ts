import { CurrencyCode, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { quoteShippingAmounts } from './catalog-sync-shipping-money';

const ctx = (currency: CurrencyCode, rate: number) =>
    ({
        channel: {
            defaultCurrencyCode: currency,
            customFields: {
                cnyToMyrRate: rate,
                currencyRateMode: 'MANUAL',
                currencyRateMarkupBps: 0,
                currencyRoundingMode: 'CENT',
            },
        },
        currencyCode: currency,
    }) as RequestContext;

describe('inherited shipping money readiness', () => {
    it('keeps a valid template available beside a historical unsupported currency', () => {
        const buyer = ctx(CurrencyCode.MYR, 0.6);
        const source = ctx(CurrencyCode.CNY, 0.5);
        const money = { baseRate: 1000, freeAbove: 2000, sourceCurrencyCode: 'CNY' };
        expect(quoteShippingAmounts(buyer, money, CurrencyCode.MYR, source)).toEqual({
            baseRate: 600,
            freeAbove: 1200,
        });
        expect(
            quoteShippingAmounts(buyer, { ...money, sourceCurrencyCode: 'USD' }, CurrencyCode.MYR, source),
        ).toBeNull();
    });
    it('normalizes source configured money before applying the target fixed conversion', () => {
        expect(
            quoteShippingAmounts(
                ctx(CurrencyCode.MYR, 0.6),
                {
                    baseRate: 1000,
                    freeAbove: 2000,
                    sourceCurrencyCode: 'MYR',
                },
                CurrencyCode.MYR,
                ctx(CurrencyCode.CNY, 0.5),
            ),
        ).toEqual({ baseRate: 1200, freeAbove: 2400 });
    });
    it('returns pending when the target conversion is missing', () => {
        expect(
            quoteShippingAmounts(
                ctx(CurrencyCode.MYR, 0),
                {
                    baseRate: 1000,
                    freeAbove: 2000,
                    sourceCurrencyCode: 'CNY',
                },
                CurrencyCode.MYR,
                ctx(CurrencyCode.CNY, 0.5),
            ),
        ).toBeNull();
    });
});
