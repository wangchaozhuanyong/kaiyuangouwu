import { describe, expect, it } from 'vitest';

import {
    getShippingMethodFulfillmentHandlers,
    isShippingMethodFulfillmentHandler,
} from './shipping-method-fulfillment-handlers.js';

describe('shipping method fulfillment handlers', () => {
    it('excludes non-shipping digital delivery handlers', () => {
        expect(
            getShippingMethodFulfillmentHandlers([
                { code: 'manual-fulfillment', description: 'Manual fulfillment' },
                { code: 'digital-fulfillment', description: 'Digital fulfillment' },
                { code: 'manual-service-fulfillment', description: 'Manual digital service' },
            ]),
        ).toEqual([{ code: 'manual-fulfillment', description: 'Manual fulfillment' }]);
    });

    it('keeps regular shipping fulfillment handlers available', () => {
        expect(isShippingMethodFulfillmentHandler('manual-fulfillment')).toBe(true);
        expect(isShippingMethodFulfillmentHandler('digital-fulfillment')).toBe(false);
        expect(isShippingMethodFulfillmentHandler('manual-service-fulfillment')).toBe(false);
    });
});
