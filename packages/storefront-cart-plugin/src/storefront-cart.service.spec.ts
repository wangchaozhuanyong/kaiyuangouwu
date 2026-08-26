import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { StorefrontCart } from './entities/storefront-cart.entity';
import { isRegisteredProductionPaymentMethod, StorefrontCartService } from './storefront-cart.service';

describe('production payment readiness', () => {
    const method = (code: string, handlerCode: string, name: string) =>
        ({
            code,
            handler: { code: handlerCode },
            translations: [{ name, description: '' }],
        }) as any;

    it('requires a registered non-test payment handler', () => {
        const handlers = new Set(['stripe-payment']);

        expect(
            isRegisteredProductionPaymentMethod(method('stripe', 'stripe-payment', 'Card payment'), handlers),
        ).toBe(true);
        expect(
            isRegisteredProductionPaymentMethod(
                method('dummy', 'dummy-payment-handler', 'Test payment'),
                new Set(['dummy-payment-handler']),
            ),
        ).toBe(false);
        expect(
            isRegisteredProductionPaymentMethod(
                method('stripe-sandbox', 'stripe-payment', 'Card payment'),
                handlers,
            ),
        ).toBe(false);
        expect(
            isRegisteredProductionPaymentMethod(
                method('stripe', 'unregistered-handler', 'Card payment'),
                handlers,
            ),
        ).toBe(false);
        expect(
            isRegisteredProductionPaymentMethod(
                method('referral-balance', 'referral-balance-payment', '邀请返利余额'),
                new Set(['referral-balance-payment']),
            ),
        ).toBe(false);
    });
});

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
            findOne: vi.fn(
                ({ where }) =>
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
