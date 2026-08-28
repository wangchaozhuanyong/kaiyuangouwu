import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontCart } from './entities/storefront-cart.entity';
import { isRegisteredProductionPaymentMethod, StorefrontCartService } from './storefront-cart.service';

afterEach(() => {
    vi.restoreAllMocks();
});

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
                method('referral-balance', 'referral-balance-payment', '邀请返利余额'),
                new Set(['referral-balance-payment']),
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

describe('StorefrontCartService login merge', () => {
    it('invalidates checkout projection without rebuilding the active order during login', async () => {
        const customerCart = new StorefrontCart({
            id: 'customer-cart',
            channelId: 'store-a',
            ownerType: 'CUSTOMER',
            ownerId: 'customer-1',
            state: 'OPEN',
            revision: 2,
            checkoutOrderId: null,
            projectedRevision: 2,
            initialized: true,
        });
        const cartRepository = {
            findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(customerCart),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
        };
        const connection = { getRepository: vi.fn().mockReturnValue(cartRepository) };
        const customerService = {
            findOneByUserId: vi.fn().mockResolvedValue({ id: 'customer-1' }),
        };
        const orderService = {
            getActiveOrderForUser: vi.fn().mockResolvedValue(null),
        };
        const service = new StorefrontCartService(
            connection as any,
            {} as any,
            customerService as any,
            orderService as any,
            {} as any,
            {} as any,
            {} as any,
        );
        const projectCartSpy = vi.spyOn(service as any, 'projectCart');

        await expect(
            service.mergeAfterLogin({ channelId: 'store-a', session: { id: 'session-1' } } as any, 'user-1'),
        ).resolves.toBeUndefined();

        expect(cartRepository.update).toHaveBeenCalledWith('customer-cart', {
            checkoutOrderId: null,
            projectedRevision: null,
            lastActivityAt: expect.any(Date),
        });
        expect(projectCartSpy).not.toHaveBeenCalled();
    });
});
