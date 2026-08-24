import { describe, expect, it, vi } from 'vitest';

import { AfterSalesService } from './after-sales.service';

function orderLine(type: 'physical' | 'digital' = 'physical', digitalDeliveryMode = 'file_download') {
    return {
        id: 'line-1',
        quantity: 2,
        proratedUnitPriceWithTax: 4_900,
        customFields: { fulfillmentTypeSnapshot: type, digitalDeliveryModeSnapshot: digitalDeliveryMode },
        productVariant: {
            name: type === 'digital' ? 'Digital guide' : 'Physical product',
            sku: type === 'digital' ? 'DIGITAL-1' : 'PHYSICAL-1',
            customFields: { fulfillmentType: type, digitalDeliveryMode },
        },
    } as any;
}

function createHarness(
    overrides: {
        line?: any;
        existingRequests?: any[];
        requestState?: string;
        requestApprovedAmount?: number;
    } = {},
) {
    const customer = {
        id: 'customer-1',
        firstName: 'Test',
        lastName: 'Customer',
        emailAddress: 'customer@example.com',
    } as any;
    const line = overrides.line ?? orderLine();
    const order = {
        id: 'order-1',
        code: 'T001',
        state: 'PaymentSettled',
        currencyCode: 'MYR',
        customer,
        lines: [line],
    } as any;
    const savedItems: any[] = [];
    const savedEvents: any[] = [];
    let savedRequest: any;
    const requestRepository = {
        find: vi.fn().mockResolvedValue(overrides.existingRequests ?? []),
        findAndCount: vi.fn(),
        save: vi.fn((request: any) => {
            savedRequest = { ...request, id: 'request-1', createdAt: new Date(), updatedAt: new Date() };
            return savedRequest;
        }),
        findOne: vi.fn(() => ({
            ...savedRequest,
            state: overrides.requestState ?? savedRequest?.state ?? 'PENDING',
            approvedAmount: overrides.requestApprovedAmount ?? savedRequest?.approvedAmount ?? null,
            order,
            items: savedItems,
            events: savedEvents,
        })),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const itemRepository = {
        save: vi.fn((items: any[]) => {
            savedItems.push(...items.map((item, index) => ({ ...item, id: `item-${index + 1}` })));
            return savedItems;
        }),
    };
    const eventRepository = {
        save: vi.fn((event: any) => {
            const saved = { ...event, id: `event-${savedEvents.length + 1}`, createdAt: new Date() };
            savedEvents.push(saved);
            return saved;
        }),
    };
    const orderQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(order),
    };
    const orderRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(orderQueryBuilder),
    };
    const connection = {
        getEntityOrThrow: vi.fn().mockResolvedValue(order),
        getRepository: vi.fn((_ctx: any, entity: any) => {
            if (entity.name === 'AfterSalesRequest') return requestRepository;
            if (entity.name === 'AfterSalesItem') return itemRepository;
            if (entity.name === 'AfterSalesEvent') return eventRepository;
            if (entity.name === 'Order') return orderRepository;
            throw new Error(`Unexpected entity ${String(entity.name)}`);
        }),
    };
    const customerService = { findOneByUserId: vi.fn().mockResolvedValue(customer) };
    const service = new AfterSalesService(connection as any, customerService as any);
    const ctx = {
        activeUserId: 'user-1',
        channelId: 'channel-1',
        channel: { id: 'channel-1' },
    } as any;
    return {
        service,
        ctx,
        line,
        order,
        savedItems,
        savedEvents,
        requestRepository,
        eventRepository,
        orderQueryBuilder,
    };
}

describe('AfterSalesService', () => {
    it('creates a customer-owned request with server-calculated amount snapshots and timeline', async () => {
        const test = createHarness();

        const result = await test.service.create(test.ctx, {
            orderId: 'order-1',
            type: 'REFUND_ONLY',
            reason: 'NOT_AS_DESCRIBED',
            description: 'The received product differs from its description.',
            items: [{ orderLineId: 'line-1', quantity: 2 }],
        });

        expect(result).toMatchObject({ state: 'PENDING', requestedAmount: 9_800 });
        expect(test.orderQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(test.savedItems).toEqual([
            expect.objectContaining({
                orderLineId: 'line-1',
                quantity: 2,
                unitPriceWithTax: 4_900,
                lineAmountWithTax: 9_800,
                sku: 'PHYSICAL-1',
            }),
        ]);
        expect(test.savedEvents).toEqual([
            expect.objectContaining({ state: 'PENDING', actorType: 'CUSTOMER', actorId: 'user-1' }),
        ]);
    });

    it('rejects return-and-refund requests for digital products', async () => {
        const test = createHarness({ line: orderLine('digital') });

        await expect(
            test.service.create(test.ctx, {
                orderId: 'order-1',
                type: 'RETURN_AND_REFUND',
                reason: 'DIGITAL_CONTENT_ISSUE',
                description: 'The digital content cannot be used.',
                items: [{ orderLineId: 'line-1', quantity: 1 }],
            }),
        ).rejects.toThrow('数字商品只能申请仅退款');
    });

    it('rejects all refund requests for automatically delivered credentials', async () => {
        const test = createHarness({ line: orderLine('digital', 'auto_card') });

        await expect(
            test.service.create(test.ctx, {
                orderId: 'order-1',
                type: 'REFUND_ONLY',
                reason: 'DIGITAL_CONTENT_ISSUE',
                description: 'The credential email has not arrived.',
                items: [{ orderLineId: 'line-1', quantity: 1 }],
            }),
        ).rejects.toThrow('自动发卡商品不支持申请退款');
    });

    it('prevents active requests from exceeding the order-line quantity', async () => {
        const test = createHarness({
            existingRequests: [
                {
                    state: 'PENDING',
                    items: [{ orderLineId: 'line-1', quantity: 2 }],
                },
            ],
        });

        await expect(
            test.service.create(test.ctx, {
                orderId: 'order-1',
                type: 'REFUND_ONLY',
                reason: 'OTHER',
                description: 'A second request should not exceed quantity.',
                items: [{ orderLineId: 'line-1', quantity: 1 }],
            }),
        ).rejects.toThrow('可申请售后的数量不足');
    });

    it('supports grouping rejected and cancelled requests as closed work', async () => {
        const test = createHarness();
        test.requestRepository.findAndCount.mockResolvedValue([[], 0]);

        await test.service.findForAdmin(test.ctx, { states: ['REJECTED', 'CANCELLED'] });

        expect(test.requestRepository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    state: expect.objectContaining({
                        _type: 'in',
                        _value: ['REJECTED', 'CANCELLED'],
                    }),
                }),
            }),
        );
    });

    it('uses guarded state transitions and validates approved amounts', async () => {
        const test = createHarness({ requestState: 'PENDING' });
        await test.service.create(test.ctx, {
            orderId: 'order-1',
            type: 'REFUND_ONLY',
            reason: 'DAMAGED',
            description: 'The product arrived damaged.',
            items: [{ orderLineId: 'line-1', quantity: 1 }],
        });

        await expect(
            test.service.transitionForAdmin(test.ctx, {
                id: 'request-1',
                state: 'APPROVED',
                resolution: 'Approved after reviewing the evidence.',
                approvedAmount: 5_000,
            }),
        ).rejects.toThrow('通过金额必须是 0 到申请金额之间的整数金额');

        await test.service.transitionForAdmin(test.ctx, {
            id: 'request-1',
            state: 'APPROVED',
            resolution: 'Approved after reviewing the evidence.',
            approvedAmount: 4_900,
        });
        expect(test.requestRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'request-1', state: 'PENDING' }),
            expect.objectContaining({ state: 'APPROVED', approvedAmount: 4_900 }),
        );
        expect(test.savedEvents.at(-1)).toMatchObject({
            state: 'APPROVED',
            actorType: 'ADMIN',
            actorId: 'user-1',
        });
    });

    it('does not mark a paid refund request completed without a linked real refund', async () => {
        const test = createHarness({ requestState: 'APPROVED', requestApprovedAmount: 4_900 });

        await expect(
            test.service.transitionForAdmin(test.ctx, {
                id: 'request-1',
                state: 'COMPLETED',
                resolution: 'Refund completed.',
            }),
        ).rejects.toThrow('尚未关联已成功的实际退款');
        expect(test.requestRepository.update).not.toHaveBeenCalled();
    });
});
