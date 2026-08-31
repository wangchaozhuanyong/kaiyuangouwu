import { OrderLineEvent } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { FulfillmentModelService } from './fulfillment-model.service';

describe('FulfillmentModelService channel mode validation', () => {
    it('does not re-run mode conflict checks when another channel custom field is updated', async () => {
        const handlers = new Map<string, (event: any) => Promise<void>>();
        const eventBus = {
            registerBlockingEventHandler: vi.fn((definition: any) => {
                handlers.set(definition.id, definition.handler);
            }),
        };
        const channel = { id: 'channel-1', customFields: { commerceMode: 'DIGITAL_ONLY' } };
        const connection = {
            rawConnection: {
                getRepository: vi.fn(() => ({ find: vi.fn().mockResolvedValue([channel]) })),
            },
        };
        const commerceModeService = {
            modeForChannel: vi.fn((value: typeof channel) => value.customFields.commerceMode),
            conflicts: vi.fn().mockResolvedValue([{ message: 'existing draft order' }]),
        };
        const service = new FulfillmentModelService(
            eventBus as any,
            connection as any,
            commerceModeService as any,
        );
        await service.onApplicationBootstrap();
        const handler = handlers.get('commerce-fulfillment-validate-channel-mode');
        expect(handler).toBeDefined();
        expect(handlers.has('commerce-fulfillment-snapshot-order-line-type')).toBe(true);
        expect(eventBus.registerBlockingEventHandler).toHaveBeenCalledWith(
            expect.objectContaining({ event: OrderLineEvent }),
        );

        await expect(
            handler?.({
                type: 'updated',
                entity: {
                    ...channel,
                    customFields: { commerceMode: 'DIGITAL_ONLY', cnyPerUsdtRate: 7.1 },
                },
                input: {
                    id: channel.id,
                    customFields: { commerceMode: 'DIGITAL_ONLY', cnyPerUsdtRate: 7.1 },
                },
                ctx: {},
            }),
        ).resolves.toBeUndefined();
        expect(commerceModeService.conflicts).not.toHaveBeenCalled();

        await expect(
            handler?.({
                type: 'updated',
                entity: { ...channel, customFields: { commerceMode: 'PHYSICAL_ONLY' } },
                input: { id: channel.id, customFields: { commerceMode: 'PHYSICAL_ONLY' } },
                ctx: {},
            }),
        ).rejects.toThrow('经营模式切换被阻止');
        expect(commerceModeService.conflicts).toHaveBeenCalledOnce();
    });
});
