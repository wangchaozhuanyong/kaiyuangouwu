import { describe, expect, it } from 'vitest';

import { fixedFulfillmentTypeForMode } from './use-commerce-mode.js';

describe('commerce mode fulfillment type', () => {
    it('fixes single-mode stores to their supported product type', () => {
        expect(fixedFulfillmentTypeForMode('DIGITAL_ONLY')).toBe('digital');
        expect(fixedFulfillmentTypeForMode('PHYSICAL_ONLY')).toBe('physical');
    });

    it('keeps the product type selectable for hybrid and loading states', () => {
        expect(fixedFulfillmentTypeForMode('HYBRID')).toBeUndefined();
        expect(fixedFulfillmentTypeForMode(undefined)).toBeUndefined();
    });
});
