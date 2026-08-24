import { describe, expect, it } from 'vitest';

import { getFulfillmentMethodDisplay } from './fulfillment-details.js';

describe('getFulfillmentMethodDisplay', () => {
    it('uses the localized UI label for current digital fulfillments', () => {
        expect(
            getFulfillmentMethodDisplay(
                { handlerCode: 'digital-fulfillment', method: 'digital-fulfillment' },
                '电子交付',
                '人工数字服务',
            ),
        ).toBe('电子交付');
    });

    it('uses the localized UI label for historical digital fulfillment records', () => {
        expect(
            getFulfillmentMethodDisplay(
                { handlerCode: 'digital-fulfillment', method: 'Digital delivery' },
                '电子交付',
                '人工数字服务',
            ),
        ).toBe('电子交付');
    });

    it('uses the localized UI label for manual digital service fulfillment', () => {
        expect(
            getFulfillmentMethodDisplay(
                { handlerCode: 'manual-service-fulfillment', method: 'manual-digital-service' },
                '电子交付',
                '人工数字服务',
            ),
        ).toBe('人工数字服务');
    });

    it('preserves method names owned by other fulfillment handlers', () => {
        expect(
            getFulfillmentMethodDisplay(
                { handlerCode: 'manual-fulfillment', method: 'Warehouse pickup' },
                '电子交付',
                '人工数字服务',
            ),
        ).toBe('Warehouse pickup');
    });
});
