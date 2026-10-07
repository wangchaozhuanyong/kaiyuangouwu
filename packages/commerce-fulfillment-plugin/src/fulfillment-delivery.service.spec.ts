import { describe, expect, it, vi } from 'vitest';

import { CheckoutResourcesService } from './checkout-resources.service';
import { FulfillmentDeliveryEvent } from './entities/fulfillment-delivery-event.entity';
import { FulfillmentDeliveryRecord } from './entities/fulfillment-delivery-record.entity';
import { FulfillmentDeliveryService } from './fulfillment-delivery.service';
import { OrderProcessingChangedEvent } from './order-processing-changed.event';

function createHarness() {
    const events: FulfillmentDeliveryEvent[] = [];
    const customer = {
        id: 'customer-1',
        firstName: 'Buyer',
        lastName: 'One',
        emailAddress: 'buyer@example.com',
    };
    const order = {
        id: 'order-1',
        state: 'PaymentSettled',
        active: false,
        orderPlacedAt: new Date(),
        totalWithTax: 100,
        payments: [{ id: 'payment-1', state: 'Settled', amount: 100, method: 'real-payment', refunds: [] }],
        fulfillments: [],
        salesChannelId: 'channel-1',
        customer,
        lines: [
            {
                id: 'line-1',
                quantity: 2,
                orderPlacedQuantity: 2,
                customFields: { fulfillmentTypeSnapshot: 'physical' },
            },
        ],
    } as any;
    const fulfillment = {
        id: 'fulfillment-1',
        state: 'Shipped',
        handlerCode: 'manual-fulfillment',
        method: 'Carrier A',
        trackingCode: 'TRACK-A',
        lines: [{ orderLineId: 'line-1', quantity: 1 }],
        orders: [order],
    } as any;
    const record = new FulfillmentDeliveryRecord({
        id: 'record-1',
        fulfillment,
        fulfillmentId: fulfillment.id,
        order,
        orderId: order.id,
        channel: { id: 'channel-1' },
        channelId: 'channel-1',
        status: 'IN_TRANSIT',
        carrier: fulfillment.method,
        trackingCode: fulfillment.trackingCode,
        exceptionReason: null,
        proofReference: null,
        shippedAt: new Date(),
        deliveredAt: null,
        nextActionDueAt: new Date(Date.now() + 60_000),
        events,
    });
    const recordRepository = {
        findOne: vi.fn().mockImplementation(() => Promise.resolve(record)),
        save: vi.fn().mockImplementation((value: FulfillmentDeliveryRecord) => Promise.resolve(value)),
        findAndCount: vi.fn(),
    };
    const eventRepository = {
        exists: vi
            .fn()
            .mockImplementation(({ where }: any) =>
                Promise.resolve(events.some(event => event.idempotencyKey === where.idempotencyKey)),
            ),
        save: vi.fn().mockImplementation((value: FulfillmentDeliveryEvent) => {
            value.id = `event-${events.length + 1}`;
            value.createdAt = new Date();
            value.updatedAt = value.createdAt;
            events.push(value);
            return Promise.resolve(value);
        }),
    };
    const orderQueryBuilder = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        setLock: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([order]),
    };
    const fulfillmentQueryBuilder = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        setLock: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockImplementation(() => Promise.resolve(fulfillment)),
    };
    const fulfillmentRepository = {
        findOne: vi.fn().mockResolvedValue(fulfillment),
        save: vi.fn().mockImplementation((value: any) => Promise.resolve(value)),
        createQueryBuilder: vi.fn().mockReturnValue(fulfillmentQueryBuilder),
    };
    const orderRepository = { createQueryBuilder: vi.fn().mockReturnValue(orderQueryBuilder) };
    const rawDeliveryRepository = { find: vi.fn().mockResolvedValue([record]) };
    const connection = {
        rawConnection: {
            options: { type: 'mysql' },
            getRepository: vi.fn().mockReturnValue(rawDeliveryRepository),
        },
        withTransaction: vi.fn((_ctx: any, work: (ctx: any) => unknown) => work(_ctx)),
        getRepository: vi.fn((_ctx: any, entity: any) => {
            if (entity === FulfillmentDeliveryRecord) return recordRepository;
            if (entity === FulfillmentDeliveryEvent) return eventRepository;
            if (entity.name === 'Fulfillment') return fulfillmentRepository;
            if (entity.name === 'Order') return orderRepository;
            throw new Error(`Unexpected entity ${entity.name}`);
        }),
    };
    const fulfillmentService = {
        transitionToState: vi.fn().mockImplementation(() => {
            fulfillment.state = 'Delivered';
            return Promise.resolve({ fulfillment });
        }),
    };
    const customerService = { findOneByUserId: vi.fn().mockResolvedValue(customer) };
    const requestContextService = { create: vi.fn().mockResolvedValue({ channelId: 'channel-1' }) };
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const orderService = { lockOrderForRefund: vi.fn().mockResolvedValue(undefined) };
    const receipts = { statuses: vi.fn().mockResolvedValue([]) };
    const resourceHold = vi.fn().mockResolvedValue(null);
    const resources = Object.assign(Object.create(CheckoutResourcesService.prototype), {
        order: vi.fn().mockResolvedValue(order),
        hold: resourceHold,
    }) as CheckoutResourcesService;
    const canDeliver = vi.spyOn(resources, 'canDeliver');
    const service = new FulfillmentDeliveryService(
        connection as any,
        fulfillmentService as any,
        customerService as any,
        requestContextService as any,
        eventBus as any,
        orderService as any,
        receipts as any,
        resources,
    );
    const ctx = {
        activeUserId: 'admin-1',
        channelId: 'channel-1',
        channel: { id: 'channel-1' },
    } as any;
    return {
        service,
        ctx,
        fulfillment,
        order,
        record,
        events,
        fulfillmentService,
        eventBus,
        requestContextService,
        rawDeliveryRepository,
        orderService,
        receipts,
        resourceHold,
        canDeliver,
        orderQueryBuilder,
        fulfillmentQueryBuilder,
        connection,
        recordRepository,
        eventRepository,
    };
}
function shipmentHarness() {
    const test = createHarness();
    test.fulfillment.state = 'Pending';
    test.order.fulfillments = [test.fulfillment];
    return test;
}
function guard(test: ReturnType<typeof shipmentHarness>, toState: 'Pending' | 'Shipped' = 'Shipped') {
    return test.service.guardPhysicalFulfillmentPayment(test.ctx, test.fulfillment, [test.order], toState);
}

describe('physical shipment eligibility', () => {
    it.each(['PaymentAuthorized', 'PaymentSettled', 'PartiallyShipped', 'PartiallyDelivered'])(
        'permits funded physical orders in %s and reads authoritative data after locking',
        async state => {
            const test = shipmentHarness();
            test.order.state = state;
            test.order.payments[0].state = state === 'PaymentAuthorized' ? 'Authorized' : 'Settled';
            await expect(guard(test)).resolves.toBeUndefined();
            expect(test.orderService.lockOrderForRefund).toHaveBeenCalledWith(test.ctx, 'order-1');
            expect(test.orderService.lockOrderForRefund.mock.invocationCallOrder[0]).toBeLessThan(
                test.fulfillmentQueryBuilder.getOne.mock.invocationCallOrder[0],
            );
            expect(test.fulfillmentQueryBuilder.setLock).toHaveBeenCalledWith(
                'pessimistic_write',
                undefined,
                undefined,
            );
            expect(test.orderQueryBuilder.setLock).toHaveBeenCalledWith(
                'pessimistic_write',
                undefined,
                undefined,
            );
        },
    );

    it.each(['Cancelled', 'Modifying', 'ArrangingPayment', 'Draft'])(
        'rejects actual %s despite a stale paid order',
        async state => {
            const test = shipmentHarness();
            const staleOrder = { ...test.order };
            test.order.state = state;
            await expect(
                test.service.guardPhysicalFulfillmentPayment(
                    test.ctx,
                    test.fulfillment,
                    [staleOrder],
                    'Shipped',
                ),
            ).resolves.toMatch(/已取消|结束订单修改|订单未付款/);
        },
    );

    it.each(['wrong-channel', 'missing-owner', 'active', 'unplaced'])('rejects %s', async situation => {
        const test = shipmentHarness();
        if (situation === 'wrong-channel') test.order.salesChannelId = 'other-store';
        if (situation === 'missing-owner') test.order.salesChannelId = null;
        if (situation === 'active') test.order.active = true;
        if (situation === 'unplaced') test.order.orderPlacedAt = null;
        await expect(guard(test)).resolves.toMatch(/当前经营店铺|订单未付款/);
    });

    it('combines real settled and authorized payments but rejects simulated order identity', async () => {
        const test = shipmentHarness();
        test.order.payments = [
            { state: 'Settled', amount: 40, method: 'real', refunds: [] },
            { state: 'Authorized', amount: 60, method: 'real', refunds: [] },
            { state: 'Cancelled', amount: 900, method: 'real', refunds: [] },
        ];
        await expect(guard(test)).resolves.toBeUndefined();
        test.order.payments[1].amount = 59;
        await expect(guard(test)).resolves.toContain('金额不足');
        test.order.payments.push({
            state: 'Settled',
            amount: 500,
            method: 'controlled-test-payment-fixture',
            refunds: [],
        });
        await expect(guard(test)).resolves.toContain('模拟付款');
        test.order.payments.pop();
        test.order.payments[1].amount = -1;
        await expect(guard(test)).resolves.toContain('金额不足');
    });

    it.each(['Settled', 'Authorized'])(
        'excludes legacy %s payments marked simulated in public metadata',
        async state => {
            const test = shipmentHarness();
            test.order.payments = [
                {
                    state,
                    amount: 100,
                    method: 'legacy-ordinary-provider',
                    refunds: [],
                    metadata: { public: { testPayment: true } },
                },
            ];
            await expect(guard(test, 'Pending')).resolves.toContain('模拟付款');
            await expect(guard(test, 'Shipped')).resolves.toContain('模拟付款');
            test.order.payments[0].metadata.public.testPayment = false;
            await expect(guard(test)).resolves.toBeUndefined();
        },
    );

    it.each(
        ['Settled', 'Authorized'].flatMap(realState =>
            ['Settled', 'Authorized', 'Declined', 'Cancelled'].flatMap(testState =>
                ['method', 'server-marker'].map(identity => [realState, testState, identity]),
            ),
        ),
    )('rejects full %s real funding plus %s test identity via %s', async (realState, testState, identity) => {
        const test = shipmentHarness();
        test.order.payments[0].state = realState;
        test.order.payments.push({
            state: testState,
            amount: 100,
            method: identity === 'method' ? 'controlled-test-payment-platform' : 'historical-provider',
            metadata: { public: { testPayment: identity === 'server-marker' } },
            refunds: [],
        });
        await expect(guard(test, 'Pending')).resolves.toContain('模拟付款');
        await expect(guard(test)).resolves.toContain('模拟付款');
        expect(test.fulfillmentService.transitionToState).not.toHaveBeenCalled();
    });

    it.each(['Created', 'TestSettled', 'unknown', 'manual-review'])(
        'rejects review evidence %s despite full real funding',
        async evidence => {
            const test = shipmentHarness();
            test.order.payments.push({
                state: evidence === 'manual-review' ? 'Settled' : evidence,
                amount: 1,
                method: 'real-provider',
                metadata: { manualReview: { required: evidence === 'manual-review' } },
                refunds: [],
            });
            await expect(guard(test)).resolves.toContain('待核验');
            expect(test.fulfillmentService.transitionToState).not.toHaveBeenCalled();
        },
    );

    it.each(['REVIEW', 'HELD', 'RELEASED'])(
        'rejects nonconfirmed resource hold %s despite full real funding',
        async state => {
            const test = shipmentHarness();
            test.resourceHold.mockResolvedValue({ state });
            await expect(guard(test)).resolves.toContain('待核验');
        },
    );

    it('allows historical real funding without a hold and uses the fresh locked order', async () => {
        const test = shipmentHarness();
        await expect(guard(test)).resolves.toBeUndefined();
        expect(test.canDeliver).toHaveBeenCalledWith(test.ctx, test.order.id, test.order);
        expect(test.orderQueryBuilder.getMany.mock.invocationCallOrder[0]).toBeLessThan(
            test.canDeliver.mock.invocationCallOrder[0],
        );
    });

    it('does not trust an earlier pure-real snapshot after persisted test evidence is added', async () => {
        const test = shipmentHarness();
        const staleOrder = { ...test.order, payments: [...test.order.payments] };
        test.order.payments.push({ state: 'Cancelled', method: 'controlled-test-payment-platform' });
        await expect(
            test.service.guardPhysicalFulfillmentPayment(test.ctx, test.fulfillment, [staleOrder], 'Shipped'),
        ).resolves.toContain('模拟付款');
    });

    it('blocks mixed funding when confirming a previously shipped package', async () => {
        const test = createHarness();
        test.record.proofReference = 'delivery-proof';
        test.order.payments.push({
            state: 'Settled',
            amount: 100,
            method: 'controlled-test-payment-platform',
            metadata: { public: { testPayment: true } },
            refunds: [],
        });
        await expect(
            test.service.guardDeliveredTransition(test.ctx, test.fulfillment, [test.order]),
        ).resolves.toContain('模拟付款');
        expect(test.fulfillmentService.transitionToState).not.toHaveBeenCalled();
    });

    it('blocks added-price orders and missing payment amounts while permitting recorded zero-price settlement', async () => {
        const test = shipmentHarness();
        test.order.totalWithTax = 101;
        await expect(guard(test)).resolves.toContain('金额不足');
        test.order.totalWithTax = 100;
        delete test.order.payments[0].amount;
        await expect(guard(test)).resolves.toContain('金额不足');
        test.order.totalWithTax = 0;
        test.order.payments[0].amount = 0;
        await expect(guard(test)).resolves.toBeUndefined();
        test.order.payments = [];
        await expect(guard(test)).resolves.toContain('金额不足');
    });

    it.each(['Pending', 'Settled'])(
        'reserves %s per-piece refunds and avoids double-subtracting cancellation',
        async state => {
            const test = shipmentHarness();
            test.order.payments[0].refunds = [{ state, lines: [{ orderLineId: 'line-1', quantity: 1 }] }];
            test.fulfillment.lines[0].quantity = 2;
            await expect(guard(test)).resolves.toContain('超过当前可发数量');
            test.fulfillment.lines[0].quantity = 1;
            test.order.lines[0].quantity = 1;
            await expect(guard(test)).resolves.toBeUndefined();
        },
    );

    it('restores failed refunds and leaves monetary compensation independent of item entitlement', async () => {
        const test = shipmentHarness();
        test.fulfillment.lines[0].quantity = 2;
        test.order.payments[0].refunds = [
            { state: 'Failed', total: 100, lines: [{ orderLineId: 'line-1', quantity: 2 }] },
        ];
        await expect(guard(test)).resolves.toBeUndefined();
        test.order.payments[0].refunds = [{ state: 'Settled', total: 30, lines: [] }];
        await expect(guard(test)).resolves.toBeUndefined();
    });

    it.each(['Shipped', 'Delivered'])(
        'counts other %s units but does not count Created packages as already sent',
        async state => {
            const test = shipmentHarness();
            test.order.fulfillments.push(
                { id: 'created-other', state: 'Created', lines: [{ orderLineId: 'line-1', quantity: 2 }] },
                { id: 'sent-other', state, lines: [{ orderLineId: 'line-1', quantity: 1 }] },
            );
            await expect(guard(test)).resolves.toBeUndefined();
            test.fulfillment.lines[0].quantity = 2;
            await expect(guard(test)).resolves.toContain('超过当前可发数量');
        },
    );

    it('aggregates duplicate package lines before comparing the remaining valid quantity', async () => {
        const test = shipmentHarness();
        test.order.payments[0].refunds = [
            { state: 'Pending', lines: [{ orderLineId: 'line-1', quantity: 1 }] },
        ];
        test.fulfillment.lines.push({ orderLineId: 'line-1', quantity: 1 });
        await expect(guard(test)).resolves.toContain('超过当前可发数量');
    });

    it.each(['missing-order', 'missing-line', 'empty-lines', 'ambiguous-line', 'changed-package-owner'])(
        'rejects incomplete or ambiguous authoritative ownership (%s)',
        async situation => {
            const test = shipmentHarness();
            if (situation === 'missing-order') test.orderQueryBuilder.getMany.mockResolvedValue([]);
            if (situation === 'missing-line') test.fulfillment.lines[0].orderLineId = 'missing';
            if (situation === 'empty-lines') test.fulfillment.lines = [];
            if (situation === 'ambiguous-line') test.order.lines.push({ ...test.order.lines[0] });
            if (situation === 'changed-package-owner') test.fulfillment.orders = [{ id: 'other-order' }];
            await expect(guard(test)).resolves.toContain('缺少订单归属');
        },
    );

    it.each(['unknown-type', 'missing-quantity', 'bad-package-quantity', 'bad-refund-quantity'])(
        'blocks incomplete history rather than guessing eligibility (%s)',
        async situation => {
            const test = shipmentHarness();
            if (situation === 'unknown-type') delete test.order.lines[0].customFields.fulfillmentTypeSnapshot;
            if (situation === 'missing-quantity') delete test.order.lines[0].orderPlacedQuantity;
            if (situation === 'bad-package-quantity') test.fulfillment.lines[0].quantity = 0;
            if (situation === 'bad-refund-quantity')
                test.order.payments[0].refunds = [
                    { state: 'Pending', lines: [{ orderLineId: 'line-1', quantity: -1 }] },
                ];
            await expect(guard(test)).resolves.toMatch(/历史订单|份数/);
        },
    );

    it('supports explicit legacy variant metadata and keeps a physical snapshot authoritative', async () => {
        const test = shipmentHarness();
        test.order.lines[0].productVariant = { customFields: { fulfillmentType: 'physical' } };
        delete test.order.lines[0].customFields.fulfillmentTypeSnapshot;
        await expect(guard(test)).resolves.toBeUndefined();
        test.order.lines[0].customFields.fulfillmentTypeSnapshot = 'physical';
        test.order.lines[0].productVariant.customFields.fulfillmentType = 'digital';
        await expect(guard(test)).resolves.toBeUndefined();
    });

    it('blocks digital shipment and requires authoritative content before digital Pending creation', async () => {
        const test = shipmentHarness();
        test.order.lines[0].customFields.fulfillmentTypeSnapshot = 'digital';
        await expect(guard(test)).resolves.toContain('数字交付流程');
        test.fulfillment.handlerCode = 'manual-service-fulfillment';
        test.order.lines[0].customFields.digitalDeliveryModeSnapshot = 'manual_service';
        await expect(guard(test, 'Pending')).resolves.toContain('成品记录缺失');
        test.receipts.statuses.mockResolvedValue([
            { orderLineId: 'line-1', eligibleQuantity: 2, readyQuantity: 2, state: 'READY' },
        ]);
        await expect(guard(test, 'Pending')).resolves.toBeUndefined();
        await expect(guard(test)).resolves.toContain('数字交付流程');
        test.order.lines.push({
            id: 'physical',
            quantity: 1,
            orderPlacedQuantity: 1,
            customFields: { fulfillmentTypeSnapshot: 'physical' },
        });
        test.fulfillment.lines.push({ orderLineId: 'physical', quantity: 1 });
        await expect(guard(test, 'Pending')).resolves.toContain('数字交付流程');
    });

    it('rechecks readiness after the order lock before allowing Delivered', async () => {
        const test = shipmentHarness();
        test.order.lines[0].customFields = {
            fulfillmentTypeSnapshot: 'digital',
            digitalDeliveryModeSnapshot: 'manual_service',
        };
        test.fulfillment.handlerCode = 'manual-service-fulfillment';
        test.receipts.statuses.mockResolvedValue([
            { orderLineId: 'line-1', eligibleQuantity: 2, readyQuantity: 0, state: 'WAITING' },
        ]);
        await expect(
            test.service.guardDeliveredTransition(test.ctx, test.fulfillment, [test.order]),
        ).resolves.toContain('尚未准备好');
        expect(test.orderService.lockOrderForRefund.mock.invocationCallOrder[0]).toBeLessThan(
            test.receipts.statuses.mock.invocationCallOrder[0],
        );
        test.receipts.statuses.mockResolvedValue([
            { orderLineId: 'line-1', eligibleQuantity: 2, readyQuantity: 2, state: 'READY' },
        ]);
        await expect(
            test.service.guardDeliveredTransition(test.ctx, test.fulfillment, [test.order]),
        ).resolves.toBeUndefined();
        test.order.state = 'Cancelled';
        await expect(
            test.service.guardDeliveredTransition(test.ctx, test.fulfillment, [test.order]),
        ).resolves.toContain('已取消');
    });

    it('checks all orders and locks them in stable order before dispatching a shared package', async () => {
        const test = shipmentHarness();
        const unpaid = {
            ...test.order,
            id: 'a-order',
            state: 'ArrangingPayment',
            lines: [
                {
                    id: 'other-line',
                    quantity: 1,
                    orderPlacedQuantity: 1,
                    customFields: { fulfillmentTypeSnapshot: 'physical' },
                },
            ],
        };
        test.fulfillment.lines.push({ orderLineId: 'other-line', quantity: 1 });
        test.fulfillment.orders.push(unpaid);
        test.orderQueryBuilder.getMany.mockResolvedValue([test.order, unpaid]);
        await expect(
            test.service.guardPhysicalFulfillmentPayment(
                test.ctx,
                test.fulfillment,
                [test.order, unpaid],
                'Shipped',
            ),
        ).resolves.toContain('订单未付款');
        expect(test.orderService.lockOrderForRefund.mock.calls.map(call => call[1])).toEqual([
            'a-order',
            'order-1',
        ]);
    });

    it('uses fresh package state and logistics after waiting for the order lock', async () => {
        const test = shipmentHarness();
        const stale = { ...test.fulfillment, method: '', trackingCode: '' };
        await expect(
            test.service.guardPhysicalFulfillmentPayment(test.ctx, stale, [test.order], 'Shipped'),
        ).resolves.toBeUndefined();
        expect(stale).toMatchObject({ method: 'Carrier A', trackingCode: 'TRACK-A' });
        test.fulfillment.state = 'Shipped';
        await expect(
            test.service.guardPhysicalFulfillmentPayment(test.ctx, stale, [test.order], 'Shipped'),
        ).resolves.toContain('包裹状态已变化');
    });

    it('requires logistics before Shipped and uses PostgreSQL root-only current locks or SQLite write serialization', async () => {
        const test = shipmentHarness();
        test.fulfillment.trackingCode = '';
        await expect(guard(test)).resolves.toContain('运单号');
        await expect(guard(test, 'Pending')).resolves.toBeUndefined();
        test.connection.rawConnection.options.type = 'postgres';
        await guard(test);
        expect(test.orderQueryBuilder.setLock).toHaveBeenLastCalledWith('pessimistic_write', undefined, [
            'order',
        ]);
        expect(test.fulfillmentQueryBuilder.setLock).toHaveBeenLastCalledWith(
            'pessimistic_write',
            undefined,
            ['fulfillment'],
        );
        test.connection.rawConnection.options.type = 'better-sqlite3';
        test.orderQueryBuilder.setLock.mockClear();
        await guard(test);
        expect(test.orderQueryBuilder.setLock).not.toHaveBeenCalled();
        expect(test.orderService.lockOrderForRefund).toHaveBeenCalledTimes(4);
    });

    it('serializes two Created packages against one remaining unit and rejects the second dispatch', async () => {
        const test = shipmentHarness();
        test.order.lines[0].quantity = 1;
        test.order.lines[0].orderPlacedQuantity = 1;
        const first = { ...test.fulfillment, id: 'first', state: 'Created' };
        const second = { ...test.fulfillment, id: 'second', state: 'Created' };
        test.order.fulfillments = [first, second];
        const packages = new Map([
            ['first', first],
            ['second', second],
        ]);
        let id = '';
        test.fulfillmentQueryBuilder.where.mockImplementation((_sql, params) => {
            id = params.fulfillmentId;
            return test.fulfillmentQueryBuilder;
        });
        test.fulfillmentQueryBuilder.getOne.mockImplementation(() => Promise.resolve(packages.get(id)));
        let previous = Promise.resolve();
        const releases = new Map<object, () => void>();
        test.orderService.lockOrderForRefund.mockImplementation(async (ctx: object) => {
            const pending = previous;
            previous = new Promise<void>(resolve => releases.set(ctx, resolve));
            await pending;
        });
        const dispatch = async (value: any) => {
            const ctx = { ...test.ctx };
            try {
                const result = await test.service.guardPhysicalFulfillmentPayment(
                    ctx,
                    value,
                    [test.order],
                    'Shipped',
                );
                if (result === undefined) value.state = 'Shipped';
                return result;
            } finally {
                releases.get(ctx)?.();
            }
        };
        const results = await Promise.all([dispatch(first), dispatch(second)]);
        expect(results[0]).toBeUndefined();
        expect(results[1]).toContain('超过当前可发数量');
        expect(first.state).toBe('Shipped');
        expect(second.state).toBe('Created');
    });
});

describe('FulfillmentDeliveryService', () => {
    it('closes exception, reship and evidence-backed delivery as an audited workflow', async () => {
        const test = createHarness();
        await expect(
            test.service.guardDeliveredTransition(test.ctx, test.fulfillment, [test.order]),
        ).resolves.toContain('配送证据流程');

        await expect(
            test.service.updateForAdmin(test.ctx, {
                fulfillmentId: test.fulfillment.id,
                status: 'EXCEPTION',
                note: 'Carrier returned the parcel',
                idempotencyKey: 'exception-1',
            }),
        ).resolves.toMatchObject({ status: 'EXCEPTION' });
        await expect(
            test.service.updateForAdmin(test.ctx, {
                fulfillmentId: test.fulfillment.id,
                status: 'IN_TRANSIT',
                carrier: 'Carrier B',
                trackingCode: 'TRACK-B',
                note: 'Replacement parcel dispatched',
                idempotencyKey: 'reship-1',
            }),
        ).resolves.toMatchObject({ status: 'IN_TRANSIT', carrier: 'Carrier B' });
        await expect(
            test.service.updateForAdmin(test.ctx, {
                fulfillmentId: test.fulfillment.id,
                status: 'DELIVERED',
                proofReference: 'POD-123',
                note: 'Carrier proof of delivery received',
                idempotencyKey: 'delivered-1',
            }),
        ).resolves.toMatchObject({ status: 'DELIVERED', proofReference: 'POD-123' });

        expect(test.events.map(event => event.status)).toEqual(['EXCEPTION', 'IN_TRANSIT', 'DELIVERED']);
        expect(test.eventBus.publish).toHaveBeenCalledTimes(6);
        const published = test.eventBus.publish.mock.calls.map(([event]) => event);
        const notifications = published.filter(event => !(event instanceof OrderProcessingChangedEvent));
        expect(notifications[0].notification.mode).toBe('INCIDENT_FIRING');
        expect(notifications[1].notification.mode).toBe('INCIDENT_RESOLVED');
        expect(published.filter(event => event instanceof OrderProcessingChangedEvent)).toHaveLength(3);
        expect(test.fulfillmentService.transitionToState).toHaveBeenCalledWith(
            test.ctx,
            test.fulfillment.id,
            'Delivered',
        );
        await expect(
            test.service.guardDeliveredTransition(test.ctx, test.fulfillment, [test.order]),
        ).resolves.toBeUndefined();
    });

    it('lets only the owning customer confirm receipt and keeps retries idempotent', async () => {
        const test = createHarness();
        const customerCtx = { ...test.ctx, activeUserId: 'customer-user-1' };
        await test.service.confirmForCustomer(customerCtx, {
            fulfillmentId: test.fulfillment.id,
            idempotencyKey: 'customer-confirm-1',
        });
        await test.service.confirmForCustomer(customerCtx, {
            fulfillmentId: test.fulfillment.id,
            idempotencyKey: 'customer-confirm-1',
        });

        expect(test.record.proofReference).toBe('CUSTOMER_CONFIRMED');
        expect(test.events).toHaveLength(1);
        expect(test.fulfillmentService.transitionToState).toHaveBeenCalledOnce();
        expect(
            test.eventBus.publish.mock.calls
                .map(([event]) => event)
                .filter(event => event instanceof OrderProcessingChangedEvent),
        ).toHaveLength(1);
    });

    it('never creates physical delivery evidence for digital fulfillment', async () => {
        const test = createHarness();
        test.order.lines[0].customFields.fulfillmentTypeSnapshot = 'digital';
        await test.service.recordShippedTransition(test.ctx, test.fulfillment, [test.order]);
        await expect(
            test.service.guardDeliveredTransition(test.ctx, test.fulfillment, [test.order]),
        ).resolves.toMatch(/履约状态|尚未完成|状态已变化/);
        expect(test.events).toHaveLength(0);
    });

    it('reconciles carrier exceptions into the durable incident channel', async () => {
        const test = createHarness();
        test.record.status = 'EXCEPTION';
        test.record.exceptionReason = 'Carrier returned the parcel';
        await expect(test.service.reconcileOverdue()).resolves.toEqual({ flagged: 1 });
        expect(test.requestContextService.create).toHaveBeenCalledWith({
            apiType: 'admin',
            channelOrToken: test.record.channel,
        });
        expect(test.eventBus.publish.mock.calls[0][0].notification).toMatchObject({
            mode: 'INCIDENT_FIRING',
            eventType: 'fulfillment.delivery.attention',
            fingerprint: 'fulfillment.delivery:channel-1:record-1',
        });
        expect(
            test.eventBus.publish.mock.calls
                .map(([event]) => event)
                .filter(event => event instanceof OrderProcessingChangedEvent),
        ).toHaveLength(0);
    });

    it.each(['EXCEPTION', 'IN_TRANSIT', 'DELIVERED'] as const)(
        'publishes one committed-context task refresh for %s and no duplicate on idempotent replay',
        async status => {
            const test = createHarness();
            if (status === 'IN_TRANSIT') test.record.status = 'EXCEPTION';
            const txCtx = { ...test.ctx, transactionFixture: 'delivery-change' };
            test.connection.withTransaction.mockImplementation((_ctx, work) => work(txCtx));
            const input = {
                fulfillmentId: test.fulfillment.id,
                status,
                note: 'Verified delivery state change',
                carrier: 'Updated carrier',
                trackingCode: 'UPDATED-TRACK',
                proofReference: 'VERIFIED-POD',
                idempotencyKey: 'delivery-refresh-' + status,
            };
            await test.service.updateForAdmin(test.ctx, input);
            await test.service.updateForAdmin(test.ctx, input);
            const calls = test.eventBus.publish.mock.calls;
            const changed = calls
                .map(([event]) => event)
                .filter(event => event instanceof OrderProcessingChangedEvent);
            expect(changed).toHaveLength(1);
            expect(changed[0].ctx).toBe(txCtx);
            expect(changed[0].orderId).toBe(String(test.order.id));
            expect(test.events).toHaveLength(1);
            const changeIndex = calls.findIndex(([event]) => event instanceof OrderProcessingChangedEvent);
            expect(test.eventBus.publish.mock.invocationCallOrder[changeIndex]).toBeGreaterThan(
                test.eventRepository.save.mock.invocationCallOrder[0],
            );
            if (status === 'DELIVERED') {
                expect(test.eventBus.publish.mock.invocationCallOrder[changeIndex]).toBeGreaterThan(
                    test.fulfillmentService.transitionToState.mock.invocationCallOrder[0],
                );
            }
        },
    );

    it('does not publish a task refresh for a rejected operation or failed Delivered transition', async () => {
        const test = createHarness();
        await expect(
            test.service.updateForAdmin(test.ctx, {
                fulfillmentId: test.fulfillment.id,
                status: 'IN_TRANSIT',
                note: 'Already in transit',
                carrier: 'Carrier A',
                trackingCode: 'TRACK-A',
                idempotencyKey: 'invalid-recovery',
            }),
        ).rejects.toThrow('只有异常配送');
        test.fulfillmentService.transitionToState.mockResolvedValueOnce({
            transitionError: 'delivery rejected',
        });
        await expect(
            test.service.updateForAdmin(test.ctx, {
                fulfillmentId: test.fulfillment.id,
                status: 'DELIVERED',
                note: 'Verified delivery',
                proofReference: 'POD',
                idempotencyKey: 'rejected-delivery',
            }),
        ).rejects.toThrow('delivery rejected');
        expect(
            test.eventBus.publish.mock.calls
                .map(([event]) => event)
                .filter(event => event instanceof OrderProcessingChangedEvent),
        ).toHaveLength(0);
    });
});
