import { describe, expect, it } from 'vitest';

import {
    getNewVariantInventoryInput,
    getProductFulfillmentType,
    getUpdatedFulfillmentCustomFields,
    getVariantDigitalDeliveryMode,
    getVariantFulfillmentType,
} from './product-fulfillment-type.js';

describe('product fulfillment type', () => {
    it('makes new SKU inventory inherit the global tracking setting', () => {
        expect(getNewVariantInventoryInput(12)).toEqual({
            stockOnHand: 12,
            trackInventory: 'INHERIT',
        });
    });

    it('defaults missing fulfillment settings to physical', () => {
        expect(getVariantFulfillmentType({})).toBe('physical');
        expect(getProductFulfillmentType([])).toBe('physical');
    });

    it('derives a uniform physical or digital product type', () => {
        expect(
            getProductFulfillmentType([
                { customFields: { fulfillmentType: 'digital' } },
                { customFields: { fulfillmentType: 'digital' } },
            ]),
        ).toBe('digital');
        expect(
            getProductFulfillmentType([
                { customFields: { fulfillmentType: 'physical' } },
                { customFields: null },
            ]),
        ).toBe('physical');
    });

    it('marks products with different SKU delivery settings as mixed', () => {
        expect(
            getProductFulfillmentType([
                { customFields: { fulfillmentType: 'physical' } },
                { customFields: { fulfillmentType: 'digital' } },
            ]),
        ).toBe('mixed');
    });

    it('preserves unrelated custom fields when changing the fulfillment type', () => {
        expect(getUpdatedFulfillmentCustomFields({ licence: 'pro' }, 'digital')).toEqual({
            licence: 'pro',
            fulfillmentType: 'digital',
            digitalDeliveryMode: 'manual_service',
        });
    });

    it('preserves an existing digital delivery mode and accepts an explicit mode', () => {
        const customFields = { fulfillmentType: 'digital', digitalDeliveryMode: 'file_download' };
        expect(getVariantDigitalDeliveryMode({ customFields })).toBe('file_download');
        expect(getUpdatedFulfillmentCustomFields(customFields, 'digital')).toEqual(customFields);
        expect(getUpdatedFulfillmentCustomFields(customFields, 'digital', 'auto_card')).toEqual({
            fulfillmentType: 'digital',
            digitalDeliveryMode: 'auto_card',
        });
    });

    it('uses manual service when converting a physical SKU to digital', () => {
        expect(
            getUpdatedFulfillmentCustomFields(
                { fulfillmentType: 'physical', digitalDeliveryMode: 'file_download' },
                'digital',
            ),
        ).toEqual({
            fulfillmentType: 'digital',
            digitalDeliveryMode: 'manual_service',
        });
    });
});
