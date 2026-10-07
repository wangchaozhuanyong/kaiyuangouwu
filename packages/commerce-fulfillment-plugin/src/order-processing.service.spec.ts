import { RefundReasonType } from '@vendure/common/lib/generated-types';
import { Fulfillment, Order, Refund } from '@vendure/core';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { fulfillDigitalOrder } from './commerce-order-process';
import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { OrderProcessingService } from './order-processing.service';
vi.mock('./commerce-order-process', () => ({ fulfillDigitalOrder: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./digital-receipt.service', () => ({ DigitalReceiptService: class {} }));
vi.mock('@vendure/store-management-plugin', () => ({
    sensitiveStoreFinancePermission: { Permission: 'SensitiveStoreFinance' },
}));
function sale(id: string, amount = 1000, type = 'digital', state = 'PaymentSettled') {
    return {
        id,
        state,
        salesChannelId: 'store-a',
        active: false,
        orderPlacedAt: new Date(),
        totalWithTax: amount,
        totalQuantity: 1,
        shippingWithTax: 0,
        customFields: { deliveryEmail: 'fixture@example.invalid' },
        lines: [
            {
                id: `line-${id}`,
                quantity: 1,
                orderPlacedQuantity: 1,
                proratedUnitPriceWithTax: amount,
                customFields: {
                    fulfillmentTypeSnapshot: type,
                    digitalDeliveryModeSnapshot: 'manual_service',
                },
                productVariant: {
                    sku: `sku-${id}`,
                    name: 'Fixture',
                    customFields: { fulfillmentType: 'physical' },
                },
            },
        ],
        payments: [{ id: `payment-${id}`, state: 'Settled', amount: 1000, method: 'fixture', refunds: [] }],
        fulfillments: [],
        modifications: [],
    } as unknown as Order;
}
function setup(orders = [sale('1')]) {
    const ctx = { channelId: 'store-a', channel: { code: 'store-a' }, userHasPermissions: () => true } as any;
    const andWhere = vi.fn();
    const metadataReads = vi.fn();
    let ids: string[] | undefined;
    const query: any = { alias: 'order' };
    for (const method of ['select', 'leftJoin', 'setFindOptions', 'orderBy', 'addOrderBy'])
        query[method] = () => query;
    query.where = (
        _sql: string,
        params?: {
            ids?: string[];
        },
    ) => {
        ids = params?.ids;
        return query;
    };
    query.andWhere = (...args: unknown[]) => {
        andWhere(...args);
        return query;
    };
    query.getMany = () =>
        Promise.resolve(
            ids ? orders.filter(order => requireFixture(ids).includes(String(order.id))) : orders,
        );
    let afterSales: any = null;
    let refunds: any[] = [];
    let packageRecord: any = null;
    const savePackage = vi.fn(value => Promise.resolve(value));
    const connection = {
        getRepository: (_ctx: unknown, entity: unknown) => {
            if (entity === Order) return { createQueryBuilder: () => query };
            if (entity === AfterSalesRequest)
                return { find: () => Promise.resolve([]), findOne: () => Promise.resolve(afterSales) };
            if (entity === Refund) return { find: () => Promise.resolve(refunds) };
            if (entity === Fulfillment)
                return { findOne: () => Promise.resolve(packageRecord), save: savePackage };
            return {
                find: (options: unknown) => {
                    return Promise.resolve().then(() => {
                        metadataReads(entity, options);
                        return [];
                    });
                },
            };
        },
        withTransaction: (_ctx: unknown, operation: (ctx: unknown) => unknown) =>
            Promise.resolve(operation(ctx)),
    };
    const orderService = {
        findOne: vi.fn((_ctx, id: string) => {
            return Promise.resolve().then(() => {
                const order = orders.find(candidate => String(candidate.id) === String(id));
                return order ? structuredClone(order) : undefined;
            });
        }),
        registerRefundRequestValidator: vi.fn(),
        lockOrderForRefund: vi.fn().mockResolvedValue(undefined),
        transitionToState: vi.fn((_ctx, id, state) =>
            Promise.resolve({ ...orders.find(order => order.id === id), state }),
        ),
        getNextOrderStates: vi.fn(() => []),
        addNoteToOrder: vi.fn().mockResolvedValue(undefined),
        withOrderMutationTransaction: (_ctx: unknown, operation: (ctx: unknown) => unknown) =>
            Promise.resolve(operation(ctx)),
    };
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const receipts = { statuses: vi.fn(() => Promise.resolve([])) };
    const service = new OrderProcessingService(
        connection as never,
        orderService as never,
        { paymentOptions: { paymentMethodHandlers: [] } } as never,
        receipts as never,
        eventBus as never,
    );
    return {
        service,
        ctx,
        orderService,
        andWhere,
        metadataReads,
        eventBus,
        savePackage,
        receipts,
        setAfterSales: (value: unknown) => {
            afterSales = value;
        },
        setRefunds: (value: unknown[]) => {
            refunds = value;
        },
        setPackage: (value: unknown) => {
            packageRecord = value;
        },
    };
}
describe('order processing service contract', () => {
    it('filters real digital tasks before pagination and scopes every order query to its sale owner', async () => {
        const first = sale('1');
        first.state = 'Cancelled';
        first.payments = [];
        const test = sale('2');
        test.payments[0].method = 'controlled-test-payment-fixture';
        const h = setup([first, test, sale('3'), sale('4')]);
        const result = await h.service.list(h.ctx, { category: 'DIGITAL', take: 1, skip: 1 });
        expect(result.totalItems).toBe(2);
        expect(result.items.map(item => item.id)).toEqual(['4']);
        expect(h.andWhere).toHaveBeenCalledWith('order.salesChannelId = :orderSalesChannelId', {
            orderSalesChannelId: 'store-a',
        });
    });
    it('sorts actual money and quantities before slicing, rather than silently using creation time', async () => {
        const h = setup([sale('1', 300), sale('2', 100), sale('3', 200)]);
        const result = await h.service.list(h.ctx, {
            category: 'ALL',
            sortBy: 'totalWithTax',
            sortOrder: 'ASC',
            skip: 1,
            take: 1,
        });
        expect(result.items[0].id).toBe('3');
        expect(result.totalItems).toBe(3);
    });
    it('never loads encrypted manual content when an ordinary order summary is read', async () => {
        const h = setup();
        const summary = await h.service.forOrder(h.ctx, sale('1'));
        expect(summary.kind).toBe('DIGITAL');
        const options = requireFixture(
            h.metadataReads.mock.calls.find(([entity]) => entity === ManualDigitalDelivery),
        )[1];
        expect(options.select).not.toContain('encryptedPackages');
        expect(options.select).not.toContain('packages');
    });
    it('projects published content, notification failure and explicit claiming independently', async () => {
        const h = setup();
        h.receipts.statuses.mockResolvedValue([
            {
                orderLineId: 'line-1',
                state: 'READY',
                readyQuantity: 1,
                claimedQuantity: 0,
                notificationState: 'EMAIL_FAILED',
            },
        ] as never);
        const summary = await h.service.forOrder(h.ctx, sale('1'));
        expect(summary.remainingDigitalQuantity).toBe(0);
        expect(summary.hasException).toBe(true);
        expect(summary.nextAction?.code).toBe('RETRY_NOTIFICATION');
        expect(summary.lines[0].claimedQuantity).toBe(0);
    });
    it('registers the shared refund gate and blocks pure digital shipping at the service boundary', async () => {
        const h = setup();
        h.service.onModuleInit();
        expect(h.orderService.registerRefundRequestValidator).toHaveBeenCalledWith(
            'commerce-order-processing',
            expect.any(Function),
        );
        await expect(
            h.service.validateRefundRequest(h.ctx, sale('1'), {
                paymentId: 'payment-1',
                shipping: 50,
                lines: [],
                reason: 'fixture',
                reasonType: RefundReasonType.SHIPPING,
            }),
        ).rejects.toThrow('纯数字订单');
    });
    it('validates approved after-sales ownership and reserves its existing refund amount', async () => {
        const h = setup();
        const input = {
            paymentId: 'payment-1',
            shipping: 0,
            amount: 400,
            lines: [],
            reason: 'fixture',
            reasonType: RefundReasonType.COMPENSATION,
            afterSalesId: 'request-1',
        };
        await expect(h.service.validateRefundRequest(h.ctx, sale('1'), input)).rejects.toThrow(
            '售后申请不存在',
        );
        h.setAfterSales({ id: 'request-1', state: 'APPROVED', approvedAmount: 500, items: [] });
        h.setRefunds([
            { state: 'Pending', total: 200, metadata: { refundRequest: { afterSalesId: 'request-1' } } },
        ]);
        await expect(h.service.validateRefundRequest(h.ctx, sale('1'), input)).rejects.toThrow('通过金额');
    });
    it('serializes finish and restores real additional-payment or settlement state', async () => {
        const source = sale('1', 1500, 'digital', 'Modifying');
        const h = setup([source]);
        await h.service.finishModification(h.ctx, '1');
        expect(h.orderService.lockOrderForRefund).toHaveBeenCalledWith(h.ctx, '1');
        expect(h.orderService.transitionToState).toHaveBeenCalledWith(
            h.ctx,
            '1',
            'ArrangingAdditionalPayment',
        );
        Object.assign(source, { totalWithTax: 1000 });
        await h.service.finishModification(h.ctx, '1');
        expect(h.orderService.transitionToState).toHaveBeenLastCalledWith(h.ctx, '1', 'PaymentSettled');
        expect(fulfillDigitalOrder).toHaveBeenCalledWith(h.ctx, '1');
        expect(h.orderService.transitionToState.mock.invocationCallOrder.at(-1)).toBeLessThan(
            requireFixture(vi.mocked(fulfillDigitalOrder).mock.invocationCallOrder.at(-1)),
        );
    });
    it('loads each fulfilled line parent before reconciling an already delivered no-price modification', async () => {
        const source = sale('1', 1000, 'digital', 'Modifying');
        source.fulfillments = [
            { id: 'digital-package', state: 'Delivered', lines: [{ orderLineId: 'line-1', quantity: 1 }] },
        ] as any;
        const h = setup([source]);
        h.receipts.statuses.mockResolvedValue([
            {
                orderLineId: 'line-1',
                state: 'READY',
                readyQuantity: 1,
                claimedQuantity: 0,
                notificationState: 'SENT',
            },
        ] as never);
        h.orderService.getNextOrderStates.mockReturnValue(['Delivered'] as never);
        h.orderService.findOne.mockImplementation((_ctx, _id, relations: string[] = []) => {
            return Promise.resolve().then(() => {
                const loaded = structuredClone(source);
                if (relations.includes('fulfillments.lines.fulfillment'))
                    for (const fulfillment of loaded.fulfillments) {
                        for (const line of fulfillment.lines)
                            line.fulfillment = { state: fulfillment.state } as any;
                    }
                return loaded;
            });
        });
        h.orderService.transitionToState.mockImplementation((_ctx, _id, state) => {
            return Promise.resolve().then(() => {
                source.state = state;
                return structuredClone(source);
            });
        });
        const result = await h.service.finishModification(h.ctx, '1');
        expect(result.state).toBe('Delivered');
        expect(h.orderService.transitionToState.mock.calls.map(call => call[2])).toEqual([
            'PartiallyDelivered',
            'Delivered',
        ]);
    });
    it('only permits the original failed refund to retry a linked approved after-sales request', async () => {
        const h = setup();
        const input = {
            paymentId: 'payment-1',
            shipping: 0,
            amount: 400,
            lines: [],
            reason: 'fixture',
            reasonType: RefundReasonType.COMPENSATION,
            afterSalesId: 'request-1',
        };
        h.setAfterSales({
            id: 'request-1',
            state: 'APPROVED',
            approvedAmount: 500,
            items: [],
            refundId: 'refund-1',
        });
        await expect(h.service.validateRefundRequest(h.ctx, sale('1'), input)).rejects.toThrow('已关联退款');
        await expect(
            h.service.validateRefundRequest(h.ctx, sale('1'), input, {
                id: 'refund-1',
                state: 'Failed',
            } as Refund),
        ).resolves.toBeUndefined();
        await expect(
            h.service.validateRefundRequest(h.ctx, sale('1'), input, {
                id: 'other-refund',
                state: 'Failed',
            } as Refund),
        ).rejects.toThrow('已关联退款');
    });
    it('updates an existing physical package with an audit note and rejects another store', async () => {
        const source = sale('1', 1000, 'physical');
        const h = setup([source]);
        const value = {
            id: 'package-1',
            state: 'Created',
            orders: [source],
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
        };
        h.setPackage(value);
        await h.service.prepareShipment(h.ctx, {
            fulfillmentId: 'package-1',
            carrier: 'Carrier',
            trackingCode: 'TRACK-1',
        });
        expect(h.savePackage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'package-1', trackingCode: 'TRACK-1' }),
        );
        expect(h.orderService.addNoteToOrder).toHaveBeenCalled();
        expect(h.eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({ orderId: '1' }));
        value.orders = [Object.assign(sale('2'), { salesChannelId: 'store-b' })];
        await expect(
            h.service.prepareShipment(h.ctx, {
                fulfillmentId: 'package-1',
                carrier: 'Carrier',
                trackingCode: 'TRACK-1',
            }),
        ).rejects.toThrow('不属于');
    });
    it('does not edit a shipped package or silently accept empty tracking details', async () => {
        const h = setup([sale('1', 1000, 'physical')]);
        h.setPackage({ id: 'package-1', state: 'Shipped', orders: [sale('1')], lines: [] });
        await expect(
            h.service.prepareShipment(h.ctx, {
                fulfillmentId: 'package-1',
                carrier: 'Carrier',
                trackingCode: 'TRACK-1',
            }),
        ).rejects.toThrow('尚未发出');
        await expect(
            h.service.prepareShipment(h.ctx, {
                fulfillmentId: 'package-1',
                carrier: '',
                trackingCode: 'TRACK-1',
            }),
        ).rejects.toThrow('有效');
        expect(h.savePackage).not.toHaveBeenCalled();
    });
    it('finishes a mixed settled and authorized payment without claiming full settlement', async () => {
        const source = sale('1', 1000, 'physical', 'Modifying');
        source.payments[0].amount = 300;
        source.payments.push({
            ...source.payments[0],
            id: 'authorization',
            state: 'Authorized',
            amount: 700,
        });
        const h = setup([source]);
        await h.service.finishModification(h.ctx, '1');
        expect(h.orderService.transitionToState).toHaveBeenLastCalledWith(h.ctx, '1', 'PaymentAuthorized');
    });
    it('rejects preparing a package which would exceed remaining units across shipped packages', async () => {
        const source = sale('1', 1000, 'physical');
        source.fulfillments.push({
            id: 'shipped',
            state: 'Shipped',
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
        } as any);
        const h = setup([source]);
        h.setPackage({
            id: 'created',
            state: 'Created',
            orders: [source],
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
        });
        await expect(
            h.service.prepareShipment(h.ctx, {
                fulfillmentId: 'created',
                carrier: 'Carrier',
                trackingCode: 'TRACK-1',
            }),
        ).rejects.toThrow('失去发货资格');
        expect(h.savePackage).not.toHaveBeenCalled();
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
