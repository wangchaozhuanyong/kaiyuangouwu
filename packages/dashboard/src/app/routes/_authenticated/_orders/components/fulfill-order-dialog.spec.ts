import { describe, expect, it } from 'vitest';

import { getInitialFulfillCount, getPreferredFulfillmentHandlerCode } from './fulfill-order-dialog.js';

describe('getPreferredFulfillmentHandlerCode', () => {
    it('uses the manual digital service handler when no shipping method is required', () => {
        expect(
            getPreferredFulfillmentHandlerCode({
                shippingLines: [],
                lines: [
                    {
                        customFields: {
                            fulfillmentTypeSnapshot: 'digital',
                            digitalDeliveryModeSnapshot: 'manual_service',
                        },
                        productVariant: { customFields: {} },
                    },
                ],
            } as any),
        ).toBe('manual-service-fulfillment');
    });

    it('keeps the configured shipping handler for mixed or physical orders', () => {
        expect(
            getPreferredFulfillmentHandlerCode({
                shippingLines: [{ shippingMethod: { fulfillmentHandlerCode: 'manual-fulfillment' } }],
                lines: [],
            } as any),
        ).toBe('manual-fulfillment');
    });

    it('does not include manual digital lines in a physical shipment', () => {
        const manualLine = {
            customFields: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'manual_service',
            },
            productVariant: { customFields: {} },
        } as any;
        const physicalLine = {
            customFields: { fulfillmentTypeSnapshot: 'physical' },
            productVariant: { customFields: {} },
        } as any;

        expect(getInitialFulfillCount('manual-fulfillment', manualLine, 2)).toBe(0);
        expect(getInitialFulfillCount('manual-fulfillment', physicalLine, 2)).toBe(2);
        expect(getInitialFulfillCount('manual-service-fulfillment', manualLine, 2)).toBe(2);
        expect(getInitialFulfillCount('manual-service-fulfillment', physicalLine, 2)).toBe(0);
    });
});
