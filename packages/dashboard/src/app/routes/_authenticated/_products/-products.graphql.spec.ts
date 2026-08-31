import { parse, print } from 'graphql';
import { describe, expect, it } from 'vitest';

import {
    productDetailDocument,
    productListDocument,
    withProductVariantCustomFields,
} from './products.graphql.js';

describe('product fulfillment GraphQL documents', () => {
    it.each([
        ['product detail', productDetailDocument],
        ['product list', productListDocument],
    ])('keeps hidden fulfillment fields in the %s document', (_name, document) => {
        const printed = print(withProductVariantCustomFields(document));

        expect(() => parse(printed)).not.toThrow();
        expect(printed).toContain('fulfillmentType');
        expect(printed).toContain('digitalDeliveryMode');
        expect(printed).toContain('digitalStockPolicy');
    });
});
