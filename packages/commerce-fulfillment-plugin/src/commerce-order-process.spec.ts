import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commerceOrderProcess } from './commerce-order-process';

describe('commerceOrderProcess digital fulfillment', () => {
    let hydratedOrder: any;
    const orderService = {
        createFulfillment: vi.fn(),
    };
    const productVariantService = { getSaleableStockLevel: vi.fn() };
    const stockMovementService = { createAllocationsForOrderLines: vi.fn() };
    const stockQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
    };
    const connection = {
        getEntityOrThrow: vi.fn(),
        getRepository: vi.fn().mockReturnValue({
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
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        orderService.createFulfillment.mockResolvedValue({ id: 'fulfillment-1' });
        productVariantService.getSaleableStockLevel.mockResolvedValue(10);
        stockQueryBuilder.getMany.mockResolvedValue([]);
        connection.getEntityOrThrow.mockImplementation(() => Promise.resolve(hydratedOrder));
        const services = [
            orderService,
            productVariantService,
            stockMovementService,
            connection,
            configService,
            globalSettingsService,
            autoCardService,
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

        expect(orderService.createFulfillment).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                lines: [{ orderLineId: 'digital-line', quantity: 2 }],
                handler: { code: 'digital-fulfillment', arguments: [] },
            }),
        );
        expect(stockMovementService.createAllocationsForOrderLines).toHaveBeenCalledWith(expect.anything(), [
            { orderLineId: 'physical-line', quantity: 1 },
        ]);
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

        expect(autoCardService.allocateSettledOrder).toHaveBeenCalled();
        expect(orderService.createFulfillment).not.toHaveBeenCalled();
    });

    it('locks stock rows and performs a final stock check before confirming payment', async () => {
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
        ).resolves.toBe('insufficient stock');
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
});
