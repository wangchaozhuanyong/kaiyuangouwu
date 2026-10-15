import { describe, expect, it } from 'vitest';

import { type ShippingMethod } from '../types';

import { selectShippingMethods } from './cart-shipping-selection';

const method = (id: string, group: string, price: number): ShippingMethod => ({
    id,
    code: id,
    name: id,
    description: '',
    priceWithTax: price,
    metadata: { shippingGroupId: group },
});

describe('source-group shipping selection', () => {
    const methods = [
        method('a-fast', 'a', 900),
        method('a-standard', 'a', 500),
        method('b-standard', 'b', 200),
    ];
    it('keeps an explicit selection for every independent source group', () => {
        expect(
            selectShippingMethods(methods, { selectedShippingMethodIds: ['a-fast', 'b-standard'] }).map(
                item => item.id,
            ),
        ).toEqual(['a-fast', 'b-standard']);
    });
    it('replaces an unavailable selection within its own group while keeping another group', () => {
        expect(
            selectShippingMethods(methods, { selectedShippingMethodIds: ['a-removed', 'b-standard'] }).map(
                item => item.id,
            ),
        ).toEqual(['a-standard', 'b-standard']);
    });
});
