import { describe, expect, it } from 'vitest';

import { manualServiceFulfillmentHandler } from './manual-service-fulfillment-handler';

describe('manualServiceFulfillmentHandler', () => {
    it('creates a non-shipping fulfillment record without fake tracking data', async () => {
        const fulfillment = await manualServiceFulfillmentHandler.createFulfillment({} as any, [], [], []);
        expect(fulfillment).toEqual({
            method: 'manual-digital-service',
            trackingCode: '',
        });
    });
});
