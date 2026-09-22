import { describe, expect, it, vi } from 'vitest';

import { FulfillmentDeliveryEvent } from './entities/fulfillment-delivery-event.entity';
import { FulfillmentDeliveryRecord } from './entities/fulfillment-delivery-record.entity';
import { FulfillmentDeliveryService } from './fulfillment-delivery.service';

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
        salesChannelId: 'channel-1',
        customer,
        lines: [{ id: 'line-1', customFields: { fulfillmentTypeSnapshot: 'physical' } }],
    } as any;
    const fulfillment = {
        id: 'fulfillment-1',
        state: 'Shipped',
        method: 'Carrier A',
        trackingCode: 'TRACK-A',
        lines: [{ orderLineId: 'line-1', quantity: 1 }],
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
        getMany: vi.fn().mockResolvedValue([order]),
    };
    const fulfillmentRepository = {
        findOne: vi.fn().mockResolvedValue(fulfillment),
        save: vi.fn().mockImplementation((value: any) => Promise.resolve(value)),
    };
    const orderRepository = { createQueryBuilder: vi.fn().mockReturnValue(orderQueryBuilder) };
    const rawDeliveryRepository = { find: vi.fn().mockResolvedValue([record]) };
    const connection = {
        rawConnection: {
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
    const service = new FulfillmentDeliveryService(
        connection as any,
        fulfillmentService as any,
        customerService as any,
        requestContextService as any,
        eventBus as any,
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
    };
}

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
        expect(test.eventBus.publish).toHaveBeenCalledTimes(3);
        expect(test.eventBus.publish.mock.calls[0][0].notification.mode).toBe('INCIDENT_FIRING');
        expect(test.eventBus.publish.mock.calls[1][0].notification.mode).toBe('INCIDENT_RESOLVED');
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
    });

    it('never creates physical delivery evidence for digital fulfillment', async () => {
        const test = createHarness();
        test.order.lines[0].customFields.fulfillmentTypeSnapshot = 'digital';
        await test.service.recordShippedTransition(test.ctx, test.fulfillment, [test.order]);
        await expect(
            test.service.guardDeliveredTransition(test.ctx, test.fulfillment, [test.order]),
        ).resolves.toBeUndefined();
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
    });
});
