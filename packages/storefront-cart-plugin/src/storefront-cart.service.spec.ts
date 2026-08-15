import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { StorefrontCart } from './entities/storefront-cart.entity';
import { StorefrontCartService } from './storefront-cart.service';

describe('StorefrontCartService Channel isolation', () => {
    it('keeps separate carts for the same owner in different Channels', async () => {
        const carts = [
            new StorefrontCart({
                id: 'cart-a',
                channelId: 'store-a',
                ownerType: 'CUSTOMER',
                ownerId: 'customer-1',
                initialized: true,
            }),
            new StorefrontCart({
                id: 'cart-b',
                channelId: 'store-b',
                ownerType: 'CUSTOMER',
                ownerId: 'customer-1',
                initialized: true,
            }),
        ];
        const repository = {
            findOne: vi.fn(async ({ where }) =>
                carts.find(
                    cart =>
                        String(cart.channelId) === String(where.channelId) &&
                        cart.ownerType === where.ownerType &&
                        String(cart.ownerId) === String(where.ownerId),
                ) ?? null,
            ),
        };
        const connection = { getRepository: vi.fn().mockReturnValue(repository) };
        const service = new StorefrontCartService(
            connection as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        const owner = { ownerType: 'CUSTOMER', ownerId: 'customer-1' };

        const storeACart = await (service as any).findOrCreateCart({ channelId: 'store-a' }, owner);
        const storeBCart = await (service as any).findOrCreateCart({ channelId: 'store-b' }, owner);

        expect(storeACart.id).toBe('cart-a');
        expect(storeBCart.id).toBe('cart-b');
        expect(repository.findOne).toHaveBeenNthCalledWith(1, {
            where: { channelId: 'store-a', ownerType: 'CUSTOMER', ownerId: 'customer-1' },
        });
        expect(repository.findOne).toHaveBeenNthCalledWith(2, {
            where: { channelId: 'store-b', ownerType: 'CUSTOMER', ownerId: 'customer-1' },
        });
    });
});
