import { describe, expect, it } from 'vitest';

import {
    getShippingMethodFulfillmentHandlers,
    isShippingMethodFulfillmentHandler,
} from './shipping-method-fulfillment-handlers.js';

describe('shipping method fulfillment handlers', () => {
    it('excludes the system-managed digital delivery handler', () => {
        expect(
            getShippingMethodFulfillmentHandlers([
                { code: 'manual-fulfillment', description: 'Manual fulfillment' },
                { code: 'digital-fulfillment', description: 'Digital fulfillment' },
            ]),
        ).toEqual([{ code: 'manual-fulfillment', description: 'Manual fulfillment' }]);
    });

    it('keeps regular shipping fulfillment handlers available', () => {
        expect(isShippingMethodFulfillmentHandler('manual-fulfillment')).toBe(true);
        expect(isShippingMethodFulfillmentHandler('digital-fulfillment')).toBe(false);
    });
});
