import { OrderLineEvent } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { FulfillmentModelService } from './fulfillment-model.service';

describe('FulfillmentModelService', () => {
    it('does not override digital product inventory tracking', () => {
        const registerBlockingEventHandler = vi.fn();
        const service = new FulfillmentModelService(
            { registerBlockingEventHandler } as any,
            { getRepository: vi.fn() } as any,
        );

        service.onApplicationBootstrap();

        expect(registerBlockingEventHandler).toHaveBeenCalledTimes(1);
        expect(registerBlockingEventHandler).toHaveBeenCalledWith(
            expect.objectContaining({
                event: OrderLineEvent,
                id: 'commerce-fulfillment-snapshot-order-line-type',
            }),
        );
    });
});
