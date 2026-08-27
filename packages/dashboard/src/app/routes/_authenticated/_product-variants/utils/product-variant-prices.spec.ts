import { describe, expect, it } from 'vitest';

import { getEditableDefaultCurrencyPrices } from './product-variant-prices.js';

describe('getEditableDefaultCurrencyPrices', () => {
    it('only exposes the Channel default-currency source price', () => {
        const cny = { currencyCode: 'CNY', price: 10_000 };
        const staleMyr = { currencyCode: 'MYR', price: 1 };

        expect(getEditableDefaultCurrencyPrices([cny, staleMyr], 'CNY', cny)).toEqual([cny]);
    });

    it('creates an editable default price when legacy data has no source row', () => {
        const fallback = { currencyCode: 'MYR', price: 5_991 };

        expect(
            getEditableDefaultCurrencyPrices([{ currencyCode: 'CNY', price: 10_000 }], 'MYR', fallback),
        ).toEqual([fallback]);
    });
});
