import 'reflect-metadata';
import { expect, it, vi } from 'vitest';

import { CartDeliveryCommandAdapter } from './cart-delivery-command.adapter';

it('uses the card pool only for automatic digital cards and leaves other inventory to Vendure', async () => {
    const carts = { registerStockResolver: vi.fn() };
    const cards = { availableStockForVariant: vi.fn().mockResolvedValue(0) };
    const commands = { register: vi.fn() };
    new CartDeliveryCommandAdapter(commands as any, {} as any, carts as any, cards as any).onModuleInit();
    const resolve = carts.registerStockResolver.mock.calls[0][0];
    expect(
        await resolve({}, { id: 'physical', customFields: { fulfillmentType: 'physical' } }),
    ).toBeUndefined();
    expect(
        await resolve(
            {},
            {
                id: 'manual',
                customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'manual_service' },
            },
        ),
    ).toBeUndefined();
    expect(cards.availableStockForVariant).not.toHaveBeenCalled();
    expect(
        await resolve(
            {},
            { id: 'cards', customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' } },
        ),
    ).toBe(0);
    expect(cards.availableStockForVariant).toHaveBeenCalledWith({}, 'cards');
});
