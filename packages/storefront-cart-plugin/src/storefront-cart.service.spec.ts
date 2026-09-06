import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontCartLine } from './entities/storefront-cart-line.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import { isRegisteredProductionPaymentMethod, StorefrontCartService } from './storefront-cart.service';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('StorefrontCartService selection projection', () => {
    function setup(selected = [true, true, false], quantities = [1, 1, 1]) {
        let order: any = {
            id: 'order-1',
            code: 'TEST',
            active: true,
            state: 'AddingItems',
            lines: [1, 2].map(id => ({ id: `order-line-${id}`, productVariantId: id, quantity: 1 })),
        };
        const cart = new StorefrontCart({
            id: 'cart-1',
            revision: 2,
            projectedRevision: 1,
            checkoutOrder: order,
            lines: [1, 2, 3].map(
                (id, index) =>
                    new StorefrontCartLine({
                        id: `cart-line-${id}`,
                        productVariantId: id,
                        productVariant: { enabled: true, product: { enabled: true } } as any,
                        selected: selected[index],
                        quantity: quantities[index],
                        orderLineId: id < 3 ? `order-line-${id}` : null,
                    }),
            ),
        });
        const repository = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
        const orderService = {
            applyPriceAdjustments: vi.fn((_ctx, current) => Promise.resolve(current)),
            removeAllItemsFromOrder: vi.fn(() => Promise.resolve((order = { ...order, lines: [] }))),
            removeItemsFromOrder: vi.fn((_ctx, _id, ids) =>
                Promise.resolve(
                    (order = { ...order, lines: order.lines.filter((line: any) => !ids.includes(line.id)) }),
                ),
            ),
            addItemsToOrder: vi.fn((_ctx, _id, items) => {
                order = {
                    ...order,
                    lines: [
                        ...order.lines,
                        ...items.map((item: any) => ({
                            ...item,
                            id: `new-line-${item.productVariantId}`,
                        })),
                    ],
                };
                return Promise.resolve({ order, errorResults: [] });
            }),
            adjustOrderLines: vi.fn((_ctx, _id, changes) => {
                order = {
                    ...order,
                    lines: order.lines.map((line: any) => ({
                        ...line,
                        quantity:
                            changes.find((change: any) => change.orderLineId === line.id)?.quantity ??
                            line.quantity,
                    })),
                };
                return Promise.resolve({ order, errorResults: [] });
            }),
        };
        const service = new StorefrontCartService(
            { getRepository: () => repository } as any,
            {} as any,
            {} as any,
            orderService as any,
            {} as any,
            {} as any,
            {} as any,
        );
        vi.spyOn(service as any, 'loadCart').mockImplementation(() =>
            Promise.resolve({
                ...cart,
                checkoutOrder: order,
            }),
        );
        const project = (force = false) =>
            (service as any).projectCart(
                { channelId: 'store-a' },
                cart,
                { ownerType: 'CUSTOMER', ownerId: 'customer-1' },
                force,
            );
        return { project, orderService, repository };
    }

    it('deselects only the changed line without removing and re-adding retained items', async () => {
        const { project, orderService } = setup([true, false, false]);
        const result = await project();
        expect(orderService.removeAllItemsFromOrder).not.toHaveBeenCalled();
        expect(orderService.removeItemsFromOrder).toHaveBeenCalledWith(expect.anything(), 'order-1', [
            'order-line-2',
        ]);
        expect(orderService.addItemsToOrder).not.toHaveBeenCalled();
        expect(result.checkoutOrder.lines.map((line: any) => line.id)).toEqual(['order-line-1']);
    });

    it('adds only newly selected items and preserves existing order line ids', async () => {
        const { project, orderService } = setup([true, true, true]);
        const result = await project();
        expect(orderService.removeAllItemsFromOrder).not.toHaveBeenCalled();
        expect(orderService.addItemsToOrder).toHaveBeenCalledWith(expect.anything(), 'order-1', [
            { productVariantId: 3, quantity: 1 },
        ]);
        expect(result.checkoutOrder.lines.map((line: any) => line.id)).toEqual([
            'order-line-1',
            'order-line-2',
            'new-line-3',
        ]);
    });

    it('adjusts only quantities that changed', async () => {
        const { project, orderService } = setup([true, true, false], [3, 1, 1]);
        await project();
        expect(orderService.adjustOrderLines).toHaveBeenCalledWith(expect.anything(), 'order-1', [
            { orderLineId: 'order-line-1', quantity: 3 },
        ]);
        expect(orderService.removeAllItemsFromOrder).not.toHaveBeenCalled();
        expect(orderService.addItemsToOrder).not.toHaveBeenCalled();
    });

    it('still revalidates every selected item when checkout forces projection', async () => {
        const { project, orderService } = setup();
        await project(true);
        expect(orderService.removeAllItemsFromOrder).not.toHaveBeenCalled();
        expect(orderService.applyPriceAdjustments).toHaveBeenCalledOnce();
        expect(orderService.adjustOrderLines).toHaveBeenCalledWith(expect.anything(), 'order-1', [
            { orderLineId: 'order-line-1', quantity: 1 },
            { orderLineId: 'order-line-2', quantity: 1 },
        ]);
    });

    it('does not mark projection complete when an order mutation fails', async () => {
        const { project, orderService, repository } = setup([true, true, true]);
        orderService.addItemsToOrder.mockResolvedValueOnce({
            order: null,
            errorResults: [{ errorCode: 'INSUFFICIENT_STOCK_ERROR', message: 'Out of stock' }],
        } as any);
        expect(await project()).toMatchObject({ errorCode: 'CART_PROJECTION_ERROR' });
        expect(repository.update).not.toHaveBeenCalled();
    });
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
            find: vi.fn().mockResolvedValue([customerCart]),
            findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(customerCart),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
        };
        const connection = {
            rawConnection: { options: { type: 'sqljs' } },
            getRepository: vi.fn().mockReturnValue(cartRepository),
        };
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
