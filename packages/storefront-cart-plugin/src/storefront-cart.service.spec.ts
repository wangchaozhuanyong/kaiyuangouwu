import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontCartLine } from './entities/storefront-cart-line.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import { StorefrontPaymentAttempt } from './entities/storefront-payment-attempt.entity';
import {
    controlledTestPaymentScopeMatchesOrder,
    isRegisteredProductionPaymentMethod,
    StorefrontCartService,
    testPaymentArguments,
} from './storefront-cart.service';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('unresolved payment protection when reopening a cart', () => {
    it.each(['PROCESSING', 'UNKNOWN', 'APPLIED'])(
        'does not reopen an order with an active %s receipt even before a native payment exists',
        async status => {
            const cart = new StorefrontCart({
                id: 'cart-1',
                revision: 4,
                state: 'PAYMENT_PENDING',
                checkoutOrder: { id: 'order-1' },
            });
            const receiptRepository = { existsBy: vi.fn().mockResolvedValue(true) };
            const cartRepository = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
            const orders = {
                findOne: vi
                    .fn()
                    .mockResolvedValue({ id: 'order-1', state: 'ArrangingPayment', payments: [] }),
                transitionToState: vi.fn().mockResolvedValue({ id: 'order-1', state: 'AddingItems' }),
            };
            const service = new StorefrontCartService(
                {
                    getRepository: (_ctx: unknown, entity: unknown) =>
                        entity === StorefrontPaymentAttempt ? receiptRepository : cartRepository,
                } as any,
                {} as any,
                {} as any,
                orders as any,
                {} as any,
                {} as any,
                {} as any,
                {} as any,
                {} as any,
            );
            vi.spyOn(service, 'getCart').mockResolvedValue(cart);
            vi.spyOn(service as any, 'getOwner').mockResolvedValue({
                ownerType: 'SESSION',
                ownerId: 'guest-1',
            });
            vi.spyOn(service as any, 'loadCart').mockResolvedValue(cart);
            const result = await service.reopenCart({ channelId: 'store-a' } as any, cart.revision);
            expect(result).toMatchObject({ errorCode: 'CART_CHECKOUT_LOCKED_ERROR' });
            expect(receiptRepository.existsBy).toHaveBeenCalledWith({ activeOrderKey: 'store-a:order-1' });
            expect(orders.transitionToState, status).not.toHaveBeenCalled();
            expect(cartRepository.update).not.toHaveBeenCalled();
        },
    );
});

describe('StorefrontCartService selection projection', () => {
    function setup(
        selected = [true, true, false],
        quantities = [1, 1, 1],
        historical = false,
        shippingMethods: string[] = [],
    ) {
        let order: any = {
            id: 'order-1',
            code: 'TEST',
            active: true,
            state: 'AddingItems',
            couponCodes: [],
            shippingLines: shippingMethods.map(shippingMethodId => ({ shippingMethodId })),
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
        const repository = {
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            createQueryBuilder: () => ({ where: () => ({ getExists: () => Promise.resolve(historical) }) }),
        };
        const orderService = {
            applyPriceAdjustments: vi.fn((_ctx, current) => Promise.resolve(current)),
            getEligibleShippingMethods: vi.fn().mockResolvedValue([]),
            setShippingMethod: vi.fn((_ctx, _id, ids) =>
                Promise.resolve(
                    (order = {
                        ...order,
                        shippingLines: ids.map((shippingMethodId: string) => ({ shippingMethodId })),
                    }),
                ),
            ),
            applyCouponCode: vi.fn((_ctx, _id, code) =>
                Promise.resolve((order = { ...order, couponCodes: [code] })),
            ),
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
            { getSaleableStockLevel: vi.fn().mockResolvedValue(100) } as any,
            {} as any,
            {} as any,
            { getActivePaymentMethods: vi.fn().mockResolvedValue([]) } as any,
            {} as any,
        );
        vi.spyOn(service as any, 'loadCart').mockImplementation(() => ({
            ...cart,
            checkoutOrder: order,
        }));
        if (historical)
            vi.spyOn(
                service as unknown as { replaceHistoricalProjection: () => Promise<unknown> },
                'replaceHistoricalProjection',
            ).mockImplementation(() =>
                Promise.resolve(
                    (order = {
                        ...order,
                        id: 'replacement-order',
                        lines: [],
                        shippingLines: [],
                        couponCodes: [],
                    }),
                ),
            );
        const project = (force = false) =>
            (service as any).projectCart(
                { channelId: 'store-a' },
                cart,
                { ownerType: 'CUSTOMER', ownerId: 'customer-1' },
                force,
            );
        return { project, orderService, repository, service, cart };
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

    it('does not apply old physical shipping when the method is ineligible', async () => {
        const { project, orderService } = setup([true, false, false], [1, 1, 1], true, ['old-physical']);
        const result = await project();
        expect(result.checkoutOrder.lines).toHaveLength(1);
        expect(orderService.getEligibleShippingMethods).toHaveBeenCalledWith(
            expect.anything(),
            'replacement-order',
        );
        expect(orderService.setShippingMethod).not.toHaveBeenCalled();
        expect(result.checkoutOrder.shippingLines).toEqual([]);
    });

    it.each([
        {
            customFields: { fulfillmentTypeSnapshot: 'digital' },
            productVariant: { customFields: { fulfillmentType: 'physical' } },
        },
        { productVariant: { customFields: { fulfillmentType: 'digital' } } },
    ])('does not restore an eligible legacy carrier for a digital replacement: %j', async fields => {
        const { project, orderService } = setup([true, false, false], [1, 1, 1], true, ['old-physical']);
        orderService.getEligibleShippingMethods.mockResolvedValueOnce([{ id: 'old-physical' }] as never);
        const add = orderService.addItemsToOrder.getMockImplementation();
        if (!add) throw new Error('Missing fixture add-items implementation');
        orderService.addItemsToOrder.mockImplementationOnce(async (...args) => {
            const added = await add(...args);
            Object.assign(added.order.lines[0], fields);
            return added;
        });
        const result = await project();
        expect(result.checkoutOrder.lines).toHaveLength(1);
        expect(orderService.getEligibleShippingMethods).not.toHaveBeenCalled();
        expect(orderService.setShippingMethod).not.toHaveBeenCalled();
        expect(result.checkoutOrder.shippingLines).toEqual([]);
    });

    it('keeps only original shipping methods that remain eligible for the new selection', async () => {
        const { project, orderService } = setup([true, false, false], [1, 1, 1], true, [
            'pickup',
            'old-physical',
        ]);
        orderService.getEligibleShippingMethods.mockResolvedValueOnce([{ id: 'pickup' }] as never);
        const result = await project();
        expect(orderService.setShippingMethod).toHaveBeenCalledWith(expect.anything(), 'replacement-order', [
            'pickup',
        ]);
        expect(result.checkoutOrder.shippingLines).toEqual([{ shippingMethodId: 'pickup' }]);
    });

    it('allows clearing a historical selection without attempting to reapply coupons or old shipping', async () => {
        const { project, orderService, service, cart } = setup([false, false, false], [1, 1, 1], true, [
            'old-physical',
        ]);
        const checkoutOrder = cart.checkoutOrder;
        if (!checkoutOrder) throw new Error('Missing fixture checkout order');
        checkoutOrder.couponCodes = ['ORIGINAL'];
        const restore = vi.fn().mockRejectedValue(new Error('Empty order cannot use coupons'));
        service.registerProjectionTransfer('fixture', () => Promise.resolve(restore));
        const result = await project();
        expect(result.checkoutOrder.lines).toEqual([]);
        expect(restore).not.toHaveBeenCalled();
        expect(orderService.applyCouponCode).not.toHaveBeenCalled();
        expect(orderService.getEligibleShippingMethods).not.toHaveBeenCalled();
        expect(orderService.setShippingMethod).not.toHaveBeenCalled();
    });
});

describe('replacing a historical checkout projection', () => {
    it.each(['Created', 'Authorized', 'Settled', 'Declined', 'Cancelled'])(
        'does not cancel or replace an order with a %s payment',
        async state => {
            const orders = {
                findOne: vi
                    .fn()
                    .mockResolvedValue({ active: true, state: 'AddingItems', payments: [{ state }] }),
                create: vi.fn(),
                cancelOrder: vi.fn(),
            };
            const stock = { createReleasesForOrderLines: vi.fn() };
            const repository = { existsBy: vi.fn().mockResolvedValue(false), update: vi.fn() };
            const service = new StorefrontCartService(
                { getRepository: () => repository } as any,
                {} as any,
                {} as any,
                orders as any,
                {} as any,
                {} as any,
                {} as any,
                {} as any,
                stock as any,
            );
            const result = await (service as any).replaceHistoricalProjection(
                { channelId: 'store' },
                { id: 'cart' },
                { ownerType: 'CUSTOMER', ownerId: 'owner' },
                { id: 'order' },
            );
            expect(result).toMatchObject({ causeCode: 'ORDER_NOT_EDITABLE' });
            expect(orders.create).not.toHaveBeenCalled();
            expect(orders.cancelOrder).not.toHaveBeenCalled();
            expect(stock.createReleasesForOrderLines).not.toHaveBeenCalled();
            expect(repository.update).not.toHaveBeenCalled();
        },
    );

    it('does not replace an unresolved payment attempt even when the native payment has not appeared', async () => {
        const orders = {
            findOne: vi.fn().mockResolvedValue({ active: true, state: 'AddingItems', payments: [] }),
            create: vi.fn(),
            cancelOrder: vi.fn(),
        };
        const repository = { existsBy: vi.fn().mockResolvedValue(true), update: vi.fn() };
        const service = new StorefrontCartService(
            { getRepository: () => repository } as any,
            {} as any,
            {} as any,
            orders as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        expect(
            await (service as any).replaceHistoricalProjection(
                { channelId: 'store' },
                { id: 'cart' },
                { ownerType: 'CUSTOMER', ownerId: 'owner' },
                { id: 'order' },
            ),
        ).toMatchObject({ causeCode: 'ORDER_NOT_EDITABLE' });
        expect(repository.existsBy).toHaveBeenCalledWith({ activeOrderKey: 'store:order' });
        expect(orders.create).not.toHaveBeenCalled();
        expect(orders.cancelOrder).not.toHaveBeenCalled();
    });
});

describe('production payment readiness', () => {
    const method = (code: string, handlerCode: string, name: string) =>
        ({
            code,
            handler: { code: handlerCode },
            translations: [{ name, description: '' }],
        }) as any;

    it('allows only registered production or controlled test payment handlers', () => {
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
                method('controlled-test-payment-2', 'controlled-test-payment-handler', '测试支付'),
                new Set(['controlled-test-payment-handler']),
            ),
        ).toBe(true);
        expect(
            isRegisteredProductionPaymentMethod(
                method('controlled-test-payment-2', 'controlled-test-payment-handler', '测试支付'),
                new Set(),
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
        ).toBe(true);
        expect(
            isRegisteredProductionPaymentMethod(
                method('stripe', 'unregistered-handler', 'Card payment'),
                handlers,
            ),
        ).toBe(false);
        const usdt = method('usdt-trc20', 'usdt-trc20-chain-handler', 'USDT payment');
        const usdtHandlers = new Set(['usdt-trc20-chain-handler']);
        expect(isRegisteredProductionPaymentMethod(usdt, usdtHandlers, 'CNY')).toBe(false);
        expect(isRegisteredProductionPaymentMethod(usdt, usdtHandlers, 'USDT')).toBe(true);
        expect(
            isRegisteredProductionPaymentMethod(
                method('stripe', 'stripe-payment', 'Card payment'),
                handlers,
                'USDT',
            ),
        ).toBe(false);
        expect(
            isRegisteredProductionPaymentMethod(
                method('referral-balance', 'referral-balance-payment', '邀请返利余额'),
                new Set(['referral-balance-payment']),
            ),
        ).toBe(false);
    });

    it('admits a controlled QA checkout only when its item and note match', () => {
        const paymentMethod = {
            handler: {
                args: [
                    { name: 'channelId', value: '"2"' },
                    { name: 'qaSku', value: '"QA-CHECKOUT"' },
                    { name: 'qaMarker', value: 'QA marker' },
                ],
            },
        } as any;
        const args = testPaymentArguments(paymentMethod);
        const order = {
            code: 'ORDER-1',
            customFields: { customerNote: 'QA marker' },
            lines: [{ quantity: 1, productVariant: { sku: 'QA-CHECKOUT' } }],
        } as any;
        expect(args.channelId).toBe('2');
        expect(controlledTestPaymentScopeMatchesOrder(args, order)).toBe(true);
        expect(controlledTestPaymentScopeMatchesOrder({}, order)).toBe(false);
        order.customFields.customerNote = 'another order';
        expect(controlledTestPaymentScopeMatchesOrder(args, order)).toBe(false);
        order.customFields.customerNote = 'QA marker';
        order.lines[0].productVariant.sku = 'OTHER';
        expect(controlledTestPaymentScopeMatchesOrder(args, order)).toBe(false);
        order.lines[0].productVariant.sku = 'QA-CHECKOUT';
        expect(controlledTestPaymentScopeMatchesOrder({ ...args, orderCode: 'ORDER-2' }, order)).toBe(false);
    });

    it('admits any order when the store explicitly enables all-order simulation', () => {
        const order = {
            code: 'REGULAR-ORDER',
            customFields: { customerNote: '' },
            lines: [
                { quantity: 2, productVariant: { sku: 'SOFA' } },
                { quantity: 1, productVariant: { sku: 'TABLE' } },
            ],
        } as any;
        expect(controlledTestPaymentScopeMatchesOrder({ allowAllOrders: 'true' }, order)).toBe(true);
        expect(controlledTestPaymentScopeMatchesOrder({ allowAllOrders: 'false' }, order)).toBe(false);
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
            { getActivePaymentMethods: vi.fn().mockResolvedValue([]) } as any,
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
            { getSaleableStockLevel: vi.fn().mockResolvedValue(100) } as any,
            {} as any,
            {} as any,
            { getActivePaymentMethods: vi.fn().mockResolvedValue([]) } as any,
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

describe('cart inventory before persistence', () => {
    function setup(stock = 0, selected = false, quantity = 2) {
        const variant = { id: 'variant-1', enabled: true, product: { enabled: true }, customFields: {} };
        const cart = new StorefrontCart({
            id: 'cart-1',
            revision: 1,
            state: 'OPEN',
            lines: [
                new StorefrontCartLine({
                    id: 'line-1',
                    productVariantId: variant.id,
                    productVariant: variant,
                    quantity,
                    selected,
                }),
            ],
        });
        const repository = { update: vi.fn(), save: vi.fn(), delete: vi.fn() };
        const variants = {
            findOne: vi.fn().mockResolvedValue(variant),
            getSaleableStockLevel: vi.fn().mockResolvedValue(stock),
        };
        const service = new StorefrontCartService(
            { getRepository: () => repository } as any,
            {} as any,
            {} as any,
            {} as any,
            variants as any,
            {} as any,
            { orderOptions: { orderLineItemsLimit: 100, orderItemsLimit: 1000 } } as any,
            { getActivePaymentMethods: vi.fn().mockResolvedValue([]) } as any,
            {} as any,
        );
        vi.spyOn(service, 'getCart').mockResolvedValue(cart);
        vi.spyOn(service as any, 'getOwner').mockResolvedValue({
            ownerType: 'CUSTOMER',
            ownerId: 'customer',
        });
        vi.spyOn(service as any, 'claimRevision').mockResolvedValue(undefined);
        const projectCart = vi
            .spyOn(service as any, 'projectCart')
            .mockImplementation((...args: unknown[]) => args[1] as StorefrontCart);
        const apply = (changes: any) => service.applyChanges({} as any, changes, 1, cart);
        return { service, cart, apply, repository, variants, projectCart };
    }
    it('rejects adding to an unselected sold-out line before writing', async () => {
        const { apply, repository } = setup();
        expect(await apply({ add: [{ productVariantId: 'variant-1', quantity: 1 }] })).toMatchObject({
            causeCode: 'INSUFFICIENT_STOCK_ERROR',
        });
        expect(repository.update).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
    });
    it('counts existing unselected quantities and repeated additions in the same batch', async () => {
        const { apply } = setup(3);
        expect(
            await apply({
                add: [
                    { productVariantId: 'variant-1', quantity: 1 },
                    { productVariantId: 'variant-1', quantity: 1 },
                ],
            }),
        ).toMatchObject({ causeCode: 'INSUFFICIENT_STOCK_ERROR' });
    });
    it('rejects selecting quantities that exceed stock', async () => {
        const { apply } = setup(1);
        expect(await apply({ lines: [{ lineId: 'line-1', selected: true }] })).toMatchObject({
            causeCode: 'INSUFFICIENT_STOCK_ERROR',
        });
    });
    it('allows deselecting, reducing an unselected quantity and removing depleted items', async () => {
        const first = setup(0, true);
        expect(await first.apply({ lines: [{ lineId: 'line-1', selected: false }] })).toMatchObject({
            revision: 2,
        });
        const second = setup();
        expect(await second.apply({ lines: [{ lineId: 'line-1', quantity: 1 }] })).toMatchObject({
            revision: 2,
        });
        const third = setup(0, true);
        expect(await third.apply({ remove: ['line-1'] })).toMatchObject({ lines: [] });
    });
    it('select-all skips insufficient stock and deselect-all never depends on inventory', async () => {
        const { service, variants } = setup(1);
        expect(await service.setAllLinesSelected({} as any, true, 1)).toMatchObject({
            lines: [{ selected: false }],
        });
        variants.getSaleableStockLevel.mockClear();
        expect(await service.setAllLinesSelected({} as any, false, 1)).toMatchObject({
            lines: [{ selected: false }],
        });
        expect(variants.getSaleableStockLevel).not.toHaveBeenCalled();
    });
    it('respects untracked inventory and the fulfillment stock source', async () => {
        const unlimited = setup(Number.MAX_SAFE_INTEGER);
        expect(await unlimited.apply({ lines: [{ lineId: 'line-1', selected: true }] })).toMatchObject({
            revision: 2,
        });
        const digital = setup(Number.MAX_SAFE_INTEGER);
        digital.service.registerStockResolver(() => Promise.resolve(0));
        expect(await digital.apply({ add: [{ productVariantId: 'variant-1', quantity: 1 }] })).toMatchObject({
            causeCode: 'INSUFFICIENT_STOCK_ERROR',
        });
        expect(digital.variants.getSaleableStockLevel).not.toHaveBeenCalled();
    });
    it('projects buy-now once and reuses the stock validation performed before writing', async () => {
        const { service, cart, variants, projectCart } = setup(10);
        projectCart.mockImplementationOnce((...args: unknown[]) => {
            const next = args[1] as StorefrontCart;
            next.checkoutOrder = { id: 'order-1' } as any;
            return next;
        });

        const result = await service.beginDirectPurchase(
            {} as any,
            { productVariantId: 'variant-1', quantity: 1 },
            cart,
        );

        expect(result).toMatchObject({ __typename: 'StorefrontCheckoutSession' });
        expect(projectCart).toHaveBeenCalledOnce();
        expect(projectCart).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ revision: 2 }),
            { ownerType: 'CUSTOMER', ownerId: 'customer' },
            true,
            true,
        );
        expect(variants.getSaleableStockLevel).toHaveBeenCalledOnce();
    });
    it('replaces an existing cart quantity with the requested buy-now quantity', async () => {
        const { service, cart, repository, projectCart } = setup(10, true, 2);
        projectCart.mockImplementationOnce((...args: unknown[]) => {
            const next = args[1] as StorefrontCart;
            next.checkoutOrder = { id: 'order-1' } as any;
            return next;
        });

        const result = await service.beginDirectPurchase(
            {} as any,
            { productVariantId: 'variant-1', quantity: 3 },
            cart,
        );

        expect(result).toMatchObject({
            cart: { lines: [{ quantity: 3, selected: true }] },
        });
        expect(repository.update).toHaveBeenCalledWith('line-1', { quantity: 3, selected: true });
        expect(repository.save).not.toHaveBeenCalled();
    });
    it('rechecks stock when buy-now reuses an unchanged selected cart line', async () => {
        const { service, cart, projectCart } = setup(0, true, 2);
        projectCart.mockImplementationOnce((...args: unknown[]) => {
            const next = args[1] as StorefrontCart;
            next.checkoutOrder = { id: 'order-1' } as any;
            return next;
        });

        await service.beginDirectPurchase({} as any, { productVariantId: 'variant-1', quantity: 2 }, cart);

        expect(projectCart).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            true,
            false,
        );
    });
});
