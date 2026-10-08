import { CurrencyCode, OrderLine, ProductVariantPrice } from '@vendure/core';
import { CalculatedPropertySubscriber } from '@vendure/core/dist/entity/subscribers';
import { StoreDefaultCurrencyPriceSelectionStrategy } from '@vendure/store-management-plugin/currency-conversion';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commerceOrderProcess, fulfillDigitalOrder } from './commerce-order-process';

describe('commerceOrderProcess digital fulfillment', () => {
    let hydratedOrder: any;
    const checkoutResources = {
        hold: vi.fn().mockResolvedValue(null),
        confirm: vi.fn(),
        isConfirmedSimulation: vi.fn().mockResolvedValue(false),
        canDeliver: vi.fn().mockResolvedValue(false),
        reserve: vi.fn(),
        assertCancellationAllowed: vi.fn(),
        markReview: vi.fn(),
        outstandingAllocation: vi.fn().mockResolvedValue(0),
    };
    const orderService = {
        createFulfillment: vi.fn(),
    };
    const productVariantService = { getSaleableStockLevel: vi.fn() };
    const stockMovementService = { createAllocationsForOrderLines: vi.fn() };
    const stockQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
    };
    const connection = {
        getEntityOrThrow: vi.fn(),
        getRepository: vi.fn().mockReturnValue({
            find: vi.fn().mockResolvedValue([]),
            manager: { connection: { options: { type: 'mysql' } } },
            createQueryBuilder: vi.fn().mockReturnValue(stockQueryBuilder),
        }),
    };
    const configService = {
        catalogOptions: {
            stockLocationStrategy: {
                getAvailableStock: vi.fn(
                    (
                        _ctx: any,
                        _variantId: any,
                        stockLevels: Array<{ stockOnHand: number; stockAllocated: number }>,
                    ) => ({
                        stockOnHand: stockLevels.reduce((total, level) => total + level.stockOnHand, 0),
                        stockAllocated: stockLevels.reduce((total, level) => total + level.stockAllocated, 0),
                    }),
                ),
            },
        },
    };
    const globalSettingsService = {
        getSettings: vi.fn().mockResolvedValue({ trackInventory: true, outOfStockThreshold: 0 }),
    };
    const autoCardService = {
        availabilityError: vi.fn().mockResolvedValue(undefined),
        allocateSettledOrder: vi.fn().mockResolvedValue([]),
        completeAvailableDeliveries: vi.fn(),
    };
    const productPackagingService = {
        rulesForVariantIds: vi.fn().mockResolvedValue([]),
        ensureStockLevelPairs: vi.fn().mockResolvedValue(undefined),
        variantIdsForLock: vi.fn((variantIds: string[]) => variantIds),
        autoUnpackForOrder: vi.fn().mockResolvedValue(undefined),
    };
    const commerceModeService = {
        activeMode: vi.fn().mockResolvedValue('HYBRID'),
        assertProductTypeAllowed: vi.fn(),
    };
    const manualDigitalDeliveryService = {
        createSettledOrderTasks: vi.fn().mockResolvedValue([]),
        cancelOrder: vi.fn().mockResolvedValue(undefined),
    };
    const digitalProducts = {
        config: vi.fn().mockResolvedValue(null),
        reservation: vi.fn(),
        reserveOrder: vi.fn(),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        checkoutResources.hold.mockReset().mockResolvedValue(null);
        checkoutResources.isConfirmedSimulation.mockResolvedValue(false);
        checkoutResources.canDeliver.mockResolvedValue(false);
        digitalProducts.reservation.mockReset();
        digitalProducts.reserveOrder.mockReset();
        orderService.createFulfillment.mockResolvedValue({ id: 'fulfillment-1' });
        productVariantService.getSaleableStockLevel.mockResolvedValue(10);
        stockQueryBuilder.getMany.mockResolvedValue([]);
        connection.getEntityOrThrow.mockImplementation(() => Promise.resolve(hydratedOrder));
        const services = [
            {},
            orderService,
            productVariantService,
            stockMovementService,
            connection,
            configService,
            globalSettingsService,
            autoCardService,
            productPackagingService,
            commerceModeService,
            manualDigitalDeliveryService,
            digitalProducts,
            checkoutResources,
        ];
        await commerceOrderProcess.init?.({ get: vi.fn(() => services.shift()) } as any);
        hydratedOrder = undefined;
    });

    it('creates a pending digital fulfillment after payment settles', async () => {
        const order = {
            state: 'PaymentSettled',
            customer: { emailAddress: 'buyer@example.com' },
            lines: [
                {
                    id: 'digital-line',
                    quantity: 2,
                    customFields: {
                        fulfillmentTypeSnapshot: 'digital',
                        digitalDeliveryModeSnapshot: 'file_download',
                    },
                    productVariant: {
                        customFields: {
                            fulfillmentType: 'digital',
                            digitalDeliveryMode: 'file_download',
                        },
                    },
                },
                {
                    id: 'physical-line',
                    quantity: 1,
                    customFields: { fulfillmentTypeSnapshot: 'physical' },
                    productVariant: { customFields: { fulfillmentType: 'physical' } },
                },
            ],
        };
        hydratedOrder = order;

        await commerceOrderProcess.onTransitionEnd?.('ArrangingPayment', 'PaymentSettled', {
            ctx: { channelId: 'channel-1' },
            order,
        } as any);

        expect(orderService.createFulfillment).not.toHaveBeenCalled();
        expect(stockMovementService.createAllocationsForOrderLines).toHaveBeenCalledWith(expect.anything(), [
            { orderLineId: 'physical-line', quantity: 1 },
        ]);
    });

    it('does not allocate legacy physical stock when the checkout completion is a confirmed simulation', async () => {
        checkoutResources.isConfirmedSimulation.mockResolvedValue(true);
        const order = {
            id: 'simulation-order',
            lines: [
                { id: 'physical-line', quantity: 1, customFields: { fulfillmentTypeSnapshot: 'physical' } },
            ],
        };
        hydratedOrder = order;
        await commerceOrderProcess.onTransitionEnd?.('ArrangingPayment', 'PaymentSettled', {
            ctx: { channelId: 'channel-1' },
            order,
        } as any);
        expect(checkoutResources.confirm).toHaveBeenCalled();
        expect(stockMovementService.createAllocationsForOrderLines).not.toHaveBeenCalled();
    });

    it('allows known simulation completion after its temporary resources have already been released', async () => {
        checkoutResources.isConfirmedSimulation.mockResolvedValue(true);
        checkoutResources.hold.mockResolvedValueOnce({ state: 'RELEASED' } as any);
        expect(
            await commerceOrderProcess.onTransitionStart?.('ArrangingPayment', 'PaymentSettled', {
                ctx: { channelId: 'channel-1' },
                order: { id: 'simulation-order', lines: [] },
            } as any),
        ).toBeUndefined();
        expect(checkoutResources.markReview).not.toHaveBeenCalled();
    });

    it('does not deliver digital products when payment is only authorized', async () => {
        await commerceOrderProcess.onTransitionEnd?.('ArrangingPayment', 'PaymentAuthorized', {
            ctx: {},
            order: {
                lines: [
                    {
                        id: 'digital-line',
                        quantity: 1,
                        customFields: { fulfillmentTypeSnapshot: 'digital' },
                        productVariant: { customFields: { fulfillmentType: 'digital' } },
                    },
                ],
            },
        } as any);

        expect(orderService.createFulfillment).not.toHaveBeenCalled();
    });

    it('leaves a manual digital service pending for an administrator to complete', async () => {
        const order = {
            state: 'PaymentSettled',
            customer: { emailAddress: 'buyer@example.com' },
            lines: [
                {
                    id: 'manual-line',
                    quantity: 1,
                    customFields: {
                        fulfillmentTypeSnapshot: 'digital',
                        digitalDeliveryModeSnapshot: 'manual_service',
                    },
                    productVariant: {
                        customFields: {
                            fulfillmentType: 'digital',
                            digitalDeliveryMode: 'manual_service',
                        },
                    },
                },
            ],
        };
        hydratedOrder = order;

        await commerceOrderProcess.onTransitionEnd?.('ArrangingPayment', 'PaymentSettled', {
            ctx: { channelId: 'channel-1' },
            order,
        } as any);

        expect(autoCardService.allocateSettledOrder).not.toHaveBeenCalled();
        expect(orderService.createFulfillment).not.toHaveBeenCalled();
    });

    it('locks stock rows and records a delivery exception when paid physical stock is insufficient', async () => {
        stockQueryBuilder.getMany.mockResolvedValue([
            {
                productVariantId: 'variant-1',
                stockLocationId: 'location-1',
                stockOnHand: 1,
                stockAllocated: 1,
            },
        ]);
        const order = {
            lines: [
                {
                    id: 'physical-line',
                    quantity: 1,
                    customFields: { fulfillmentTypeSnapshot: 'physical' },
                    productVariant: {
                        id: 'variant-1',
                        name: 'Limited item',
                        trackInventory: 'TRUE',
                        useGlobalOutOfStockThreshold: true,
                        customFields: { fulfillmentType: 'physical' },
                    },
                },
            ],
        };
        const ctx = { translate: vi.fn().mockReturnValue('insufficient stock') };

        await expect(
            commerceOrderProcess.onTransitionStart?.('ArrangingPayment', 'PaymentSettled', {
                ctx,
                order,
            } as any),
        ).resolves.toBeUndefined();
        expect(checkoutResources.markReview).toHaveBeenCalledWith(ctx, order, 'insufficient stock');
        expect(stockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(productVariantService.getSaleableStockLevel).not.toHaveBeenCalled();
    });

    it('does not create another fulfillment for unrelated transitions', async () => {
        await commerceOrderProcess.onTransitionEnd?.('PaymentSettled', 'Shipped', {
            ctx: {},
            order: { lines: [] },
        } as any);

        expect(orderService.createFulfillment).not.toHaveBeenCalled();
    });

    it('reserves a hydrated OrderLine without flattening calculated getters during digital delivery', async () => {
        checkoutResources.canDeliver.mockResolvedValue(true);
        const hydratedLine = new OrderLine({
            id: 'digital-line',
            quantity: 3,
            orderPlacedQuantity: 3,
            listPrice: 1000,
            initialListPrice: 1000,
            listPriceIncludesTax: false,
            taxLines: [],
            adjustments: [],
            linesReferences: [],
            customFields: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'manual_service',
            } as any,
            productVariant: { customFields: { fulfillmentType: 'digital' } } as any,
        });
        new CalculatedPropertySubscriber().afterLoad(hydratedLine);
        expect(Object.getOwnPropertyDescriptor(hydratedLine, 'unitPrice')).toMatchObject({
            get: expect.any(Function),
            set: undefined,
            enumerable: true,
        });
        hydratedOrder = {
            id: 'paid-order',
            active: false,
            state: 'PaymentSettled',
            totalWithTax: 1000,
            lines: [hydratedLine],
            payments: [
                {
                    state: 'Settled',
                    amount: 1000,
                    method: 'real-payment',
                    refunds: [{ state: 'Settled', lines: [{ orderLineId: hydratedLine.id, quantity: 1 }] }],
                },
            ],
        };
        digitalProducts.reservation.mockResolvedValue({ state: 'CONSUMED' });
        const reserved: OrderLine[] = [];
        digitalProducts.reserveOrder.mockImplementation((_ctx, order) => {
            reserved.push(...order.lines);
        });

        await fulfillDigitalOrder({ channelId: 'store' } as any, hydratedOrder.id);

        expect(reserved).toHaveLength(1);
        expect(reserved[0]).toBeInstanceOf(OrderLine);
        expect(reserved[0]).not.toBe(hydratedLine);
        expect(reserved[0]).toMatchObject({
            id: 'digital-line',
            quantity: 2,
            unitPrice: 1000,
            linePrice: 2000,
        });
        expect(hydratedOrder.lines[0]).toBe(hydratedLine);
        expect(hydratedLine.quantity).toBe(3);
        expect(hydratedLine.linePrice).toBe(3000);
        expect(checkoutResources.markReview).not.toHaveBeenCalled();
    });

    it('does not restore refunded digital quantities during the delivery retry continuation', async () => {
        checkoutResources.canDeliver.mockResolvedValue(true);
        const digitalLine = (id: string, quantity: number) => ({
            id,
            quantity,
            orderPlacedQuantity: quantity,
            customFields: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'manual_service',
            },
            productVariant: { customFields: { fulfillmentType: 'digital' } },
        });
        hydratedOrder = {
            id: 'paid-order',
            active: false,
            state: 'PaymentSettled',
            totalWithTax: 1000,
            lines: [digitalLine('fully-refunded', 1), digitalLine('partially-refunded', 3)],
            payments: [
                {
                    state: 'Settled',
                    amount: 1000,
                    method: 'real-payment',
                    refunds: [
                        {
                            state: 'Settled',
                            lines: [
                                { orderLineId: 'fully-refunded', quantity: 1 },
                                { orderLineId: 'partially-refunded', quantity: 1 },
                            ],
                        },
                    ],
                },
            ],
        };
        digitalProducts.reservation.mockResolvedValue({ state: 'CONSUMED' });
        const reserved: Array<{ id: string; quantity: number }> = [];
        digitalProducts.reserveOrder.mockImplementation((_ctx, order) => {
            reserved.push(...order.lines.map(({ id, quantity }: any) => ({ id, quantity })));
        });
        await fulfillDigitalOrder({ channelId: 'store' } as any, hydratedOrder.id);
        expect(reserved).toEqual([{ id: 'partially-refunded', quantity: 2 }]);
        expect(hydratedOrder.lines.map((line: any) => line.quantity)).toEqual([1, 3]);
        expect(orderService.createFulfillment).not.toHaveBeenCalled();
    });
});

describe('checkout price selection', () => {
    function fixture(defaultCurrency: CurrencyCode, currency = defaultCurrency) {
        const ctx = {
            channelId: 'store',
            currencyCode: currency,
            channel: {
                id: 'store',
                code: 'operating-store',
                defaultCurrencyCode: defaultCurrency,
                customFields: { cnyToMyrRate: 0.6 },
            },
            copy: vi.fn((options: Record<string, unknown>) => ({ ...ctx, ...options })),
        };
        const variant = {
            id: 'variant',
            productId: 'product',
            enabled: true,
            product: {
                enabled: true,
                channels: [ctx.channel],
                customFields: { pricingMode: 'FIXED' },
            },
            customFields: { fulfillmentType: 'digital', digitalStockPolicy: 'unlimited' },
        };
        const order = {
            id: 'order',
            currencyCode: currency,
            customFields: { deliveryEmail: 'buyer@example.com' },
            lines: [
                {
                    id: 'line',
                    productVariantId: variant.id,
                    productVariant: variant,
                    quantity: 1,
                    customFields: { fulfillmentTypeSnapshot: 'digital' },
                },
            ],
        };
        const prices = [
            new ProductVariantPrice({
                channelId: ctx.channelId,
                currencyCode: defaultCurrency,
                price: 10000,
            }),
        ];
        const priceRepository = {
            find: vi.fn(() => Promise.resolve(prices.filter(price => price.channelId === ctx.channelId))),
            findOne: vi.fn(({ where }: any) =>
                Promise.resolve(
                    prices.find(
                        price =>
                            price.channelId === where.channelId && price.currencyCode === where.currencyCode,
                    ),
                ),
            ),
        };
        const strategy = new StoreDefaultCurrencyPriceSelectionStrategy();
        const selectPrice = vi.fn(strategy.selectPrice.bind(strategy));
        const services: Record<string, unknown> = {
            TransactionalConnection: {
                getRepository: (_ctx: unknown, entity: { name: string }) =>
                    entity.name === 'ProductVariantPrice'
                        ? priceRepository
                        : {
                              find: vi.fn().mockResolvedValue([variant]),
                              findOne: vi
                                  .fn()
                                  .mockResolvedValue(entity.name === 'ProductVariant' ? variant : null),
                          },
            },
            ConfigService: { catalogOptions: { productVariantPriceSelectionStrategy: { selectPrice } } },
            AutoCardService: { availabilityError: vi.fn() },
            CommerceModeService: {
                activeMode: vi.fn().mockResolvedValue('HYBRID'),
                assertProductTypeAllowed: vi.fn(),
            },
            DigitalProductService: { config: vi.fn().mockResolvedValue(null) },
        };
        const run = async () => {
            await commerceOrderProcess.init?.({
                get: (token: { name: string }) => services[token.name] ?? {},
            } as any);
            return commerceOrderProcess.onTransitionStart?.('AddingItems', 'ArrangingPayment', {
                ctx,
                order,
            } as any);
        };
        return { ctx, order, prices, priceRepository, selectPrice, run };
    }

    it.each([
        [CurrencyCode.CNY, CurrencyCode.MYR, 6000],
        [CurrencyCode.MYR, CurrencyCode.CNY, 16667],
    ])(
        'accepts %s source prices for %s checkout without persisted derived prices',
        async (base, target, value) => {
            const test = fixture(base, target);
            await expect(test.run()).resolves.toBeUndefined();
            expect(test.selectPrice.mock.results[0].value).toMatchObject({
                currencyCode: target,
                price: value,
            });
            expect(test.priceRepository.find).toHaveBeenCalledWith({
                where: { variant: { id: 'variant' }, channelId: 'store' },
            });
        },
    );

    it('selects the persisted order currency while preserving the request store', async () => {
        const test = fixture(CurrencyCode.CNY, CurrencyCode.CNY);
        test.order.currencyCode = CurrencyCode.MYR;
        await expect(test.run()).resolves.toBeUndefined();
        expect(test.selectPrice).toHaveBeenCalledWith(
            expect.objectContaining({ channel: test.ctx.channel, currencyCode: CurrencyCode.MYR }),
            test.prices,
        );
        expect(test.ctx.currencyCode).toBe(CurrencyCode.CNY);
    });

    it.each(['missing-source', 'foreign-store', 'invalid-rate'])(
        'rejects %s before reserving payment',
        async reason => {
            const test = fixture(CurrencyCode.CNY, CurrencyCode.MYR);
            if (reason === 'missing-source') test.prices.length = 0;
            if (reason === 'foreign-store') test.prices[0].channelId = 'other-store';
            if (reason === 'invalid-rate') test.ctx.channel.customFields.cnyToMyrRate = 0;
            await expect(test.run()).resolves.toBe('本店售价未配置，请刷新购物车');
        },
    );

    it.each([CurrencyCode.CNY, CurrencyCode.USD])(
        'keeps configured same-currency selection for %s',
        async currency => {
            const test = fixture(currency);
            await expect(test.run()).resolves.toBeUndefined();
            expect(test.selectPrice).toHaveBeenCalled();
        },
    );
});
