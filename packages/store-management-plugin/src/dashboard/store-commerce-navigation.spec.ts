import { describe, expect, it } from 'vitest';

import { hiddenNavigationIds } from './store-commerce-navigation-rules';

describe('store commerce navigation', () => {
    it('hides physical operations for digital-only stores', () => {
        expect(hiddenNavigationIds('DIGITAL_ONLY')).toEqual([
            'product-variants',
            'stock-locations',
            'shipping-methods',
        ]);
    });

    it('hides digital delivery operations for physical-only stores', () => {
        expect(hiddenNavigationIds('PHYSICAL_ONLY')).toEqual([
            'auto-card-delivery',
            'manual-digital-delivery',
        ]);
    });

    it('keeps every operation visible for hybrid stores', () => {
        expect(hiddenNavigationIds('HYBRID')).toEqual([]);
    });
});
