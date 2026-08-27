import 'reflect-metadata';

import { CurrencyCode, ProductVariantPrice, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { StoreDefaultCurrencyPriceSelectionStrategy } from './store-currency-price-selection-strategy';

describe('StoreDefaultCurrencyPriceSelectionStrategy', () => {
    const strategy = new StoreDefaultCurrencyPriceSelectionStrategy();

    it('returns the Channel default-currency source price unchanged', () => {
        const cny = price(1, CurrencyCode.CNY, 10_000);

        expect(strategy.selectPrice(context(CurrencyCode.CNY, CurrencyCode.CNY), [cny])).toBe(cny);
    });

    it('calculates MYR from the CNY source price and ignores a stored derived price', () => {
        const selected = strategy.selectPrice(context(CurrencyCode.CNY, CurrencyCode.MYR), [
            price(1, CurrencyCode.CNY, 10_000),
            price(1, CurrencyCode.MYR, 1),
        ]);

        expect(selected).toMatchObject({ currencyCode: CurrencyCode.MYR, price: 5_991 });
    });

    it('calculates CNY from a MYR-default Channel and applies markup and rounding', () => {
        const selected = strategy.selectPrice(
            context(CurrencyCode.MYR, CurrencyCode.CNY, {
                currencyRateMarkupBps: 200,
                currencyRoundingMode: 'WHOLE',
            }),
            [price(1, CurrencyCode.MYR, 5_991)],
        );

        expect(selected).toMatchObject({ currencyCode: CurrencyCode.CNY, price: 10_200 });
    });

    it('does not borrow a source price from another Channel', () => {
        expect(
            strategy.selectPrice(context(CurrencyCode.CNY, CurrencyCode.MYR), [
                price(2, CurrencyCode.CNY, 10_000),
            ]),
        ).toBeUndefined();
    });

    it('does not synthesize a price when the configured rate is invalid', () => {
        expect(
            strategy.selectPrice(context(CurrencyCode.CNY, CurrencyCode.MYR, { cnyToMyrRate: 0 }), [
                price(1, CurrencyCode.CNY, 10_000),
            ]),
        ).toBeUndefined();
    });

    it('keeps Vendure default price selection for unmanaged currencies', () => {
        const usd = price(1, CurrencyCode.USD, 2_500);

        expect(strategy.selectPrice(context(CurrencyCode.USD, CurrencyCode.USD), [usd])).toBe(usd);
    });
});

function context(
    defaultCurrencyCode: CurrencyCode,
    currencyCode: CurrencyCode,
    customFields: Record<string, unknown> = {},
): RequestContext {
    return {
        channelId: 1,
        currencyCode,
        channel: {
            id: 1,
            defaultCurrencyCode,
            customFields: {
                cnyToMyrRate: 0.5991,
                currencyRateMarkupBps: 0,
                currencyRoundingMode: 'CENT',
                ...customFields,
            },
        },
    } as unknown as RequestContext;
}

function price(channelId: number, currencyCode: CurrencyCode, value: number): ProductVariantPrice {
    return new ProductVariantPrice({ channelId, currencyCode, price: value });
}
