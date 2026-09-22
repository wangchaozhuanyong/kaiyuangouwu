import { describe, expect, it, vi } from 'vitest';

import { AfterSalesService } from './after-sales.service';

function orderLine(
    type: 'physical' | 'digital' = 'physical',
    digitalDeliveryMode = 'file_download',
    refundPolicy = 'MERCHANT_REVIEW',
) {
    return {
        id: 'line-1',
        productVariantId: 'variant-1',
        quantity: 2,
        proratedUnitPriceWithTax: 4_900,
        customFields: {
            fulfillmentTypeSnapshot: type,
            digitalDeliveryModeSnapshot: digitalDeliveryMode,
            refundPolicySnapshot: refundPolicy,
        },
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
        databaseType?: string;
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
        salesChannelId: 'channel-1',
        state: 'PaymentSettled',
        currencyCode: 'MYR',
        customer,
        lines: [line],
    } as any;
    const savedItems: any[] = [];
    const savedEvents: any[] = [];
    let savedRequest: any;
    const requestQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'request-1' }),
    };
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
        update: vi.fn((_criteria: any, patch: any) => {
            if (savedRequest) savedRequest = { ...savedRequest, ...patch, updatedAt: new Date() };
            return Promise.resolve({ affected: 1 });
        }),
        createQueryBuilder: vi.fn().mockReturnValue(requestQueryBuilder),
    };
    const itemRepository = {
        save: vi.fn((items: any[]) => {
            savedItems.push(...items.map((item, index) => ({ ...item, id: `item-${index + 1}` })));
            return savedItems;
        }),
        update: vi.fn((criteria: any, patch: any) => {
            const item = savedItems.find(candidate => String(candidate.id) === String(criteria.id));
            if (item) Object.assign(item, patch);
            return Promise.resolve({ affected: item ? 1 : 0 });
        }),
    };
    const eventRepository = {
        exists: vi.fn().mockResolvedValue(false),
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
        update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const refundRepository = {
        findOne: vi.fn().mockResolvedValue({
            id: 'refund-1',
            state: 'Settled',
            total: 4_900,
            payment: { order },
        }),
    };
    const connection = {
        rawConnection: { options: { type: overrides.databaseType ?? 'mysql' } },
        getEntityOrThrow: vi.fn().mockResolvedValue(order),
        getRepository: vi.fn((_ctx: any, entity: any) => {
            if (entity.name === 'AfterSalesRequest') return requestRepository;
            if (entity.name === 'AfterSalesItem') return itemRepository;
            if (entity.name === 'AfterSalesEvent') return eventRepository;
            if (entity.name === 'Order') return orderRepository;
            if (entity.name === 'Refund') return refundRepository;
            throw new Error(`Unexpected entity ${String(entity.name)}`);
        }),
    };
    const customerService = { findOneByUserId: vi.fn().mockResolvedValue(customer) };
    const translations = {
        prepareLocalizedFields: vi.fn(fields =>
            Promise.resolve(
                fields.map((field: any) => ({
                    path: field.path,
                    sourceText: field.sourceText,
                    translatedText: `translated-${field.path}`,
                    status: 'AUTO_TRANSLATED',
                    origin: 'AUTO',
                    locked: false,
                })),
            ),
        ),
        recordPreparedFields: vi.fn(() => Promise.resolve(undefined)),
    };
    const inventoryControl = {
        receiveCustomerReturn: vi.fn().mockResolvedValue({ id: 'inventory-operation-1' }),
    };
    const service = new AfterSalesService(
        connection as any,
        customerService as any,
        translations as any,
        inventoryControl as any,
    );
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
        refundRepository,
        eventRepository,
        orderQueryBuilder,
        orderRepository,
        inventoryControl,
        requestQueryBuilder,
    };
}

describe('AfterSalesService', () => {
    it('accepts partial-delivery requests without completing or refunding them automatically', async () => {
        const test = createHarness();
        test.order.state = 'PartiallyDelivered';
        const result = await test.service.create(test.ctx, {
            orderId: 'order-1',
            type: 'REFUND_ONLY',
            reason: 'OTHER',
            description: 'Mixed order partial delivery',
            items: [{ orderLineId: 'line-1', quantity: 1 }],
        });
        expect(result).toMatchObject({ state: 'PENDING', requestedAmount: 4_900 });
        expect(test.refundRepository.findOne).not.toHaveBeenCalled();
    });

    it.each(['AddingItems', 'ArrangingPayment', 'PaymentAuthorized', 'Cancelled'])(
        'still rejects after-sales for %s orders',
        async state => {
            const test = createHarness();
            test.order.state = state;
            await expect(
                test.service.create(test.ctx, {
                    orderId: 'order-1',
                    type: 'REFUND_ONLY',
                    reason: 'OTHER',
                    description: 'Ineligible order',
                    items: [{ orderLineId: 'line-1', quantity: 1 }],
                }),
            ).rejects.toThrow('当前订单状态暂不支持申请售后');
            expect(test.requestRepository.save).not.toHaveBeenCalled();
        },
    );

    it.each(['sqlite', 'better-sqlite3', 'sqljs'])(
        'serializes %s requests with a transaction write',
        async databaseType => {
            const test = createHarness({ databaseType });
            const result = await test.service.create(test.ctx, {
                orderId: 'order-1',
                type: 'REFUND_ONLY',
                reason: 'OTHER',
                description: 'Local request test',
                items: [{ orderLineId: 'line-1', quantity: 1 }],
            });
            expect(result.state).toBe('PENDING');
            expect(test.orderRepository.update).toHaveBeenCalledWith({ id: 'order-1' }, { id: 'order-1' });
            expect(test.orderQueryBuilder.setLock).not.toHaveBeenCalled();
        },
    );

    it('does not swallow database write errors', async () => {
        const test = createHarness({ databaseType: 'sqlite' });
        test.orderRepository.update.mockRejectedValueOnce(new Error('database unavailable'));
        await expect(
            test.service.create(test.ctx, {
                orderId: 'order-1',
                type: 'REFUND_ONLY',
                reason: 'OTHER',
                description: 'Local request test',
                items: [{ orderLineId: 'line-1', quantity: 1 }],
            }),
        ).rejects.toThrow('database unavailable');
        expect(test.requestRepository.save).not.toHaveBeenCalled();
    });
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

    it('allows auto-card refund requests to use the product refund policy', async () => {
        const test = createHarness({ line: orderLine('digital', 'auto_card') });

        await expect(
            test.service.create(test.ctx, {
                orderId: 'order-1',
                type: 'REFUND_ONLY',
                reason: 'DIGITAL_CONTENT_ISSUE',
                description: 'The credential email has not arrived.',
                items: [{ orderLineId: 'line-1', quantity: 1 }],
            }),
        ).resolves.toMatchObject({ state: 'PENDING' });
    });

    it('blocks self-service refunds only when the product snapshot is non-refundable', async () => {
        const test = createHarness({ line: orderLine('digital', 'auto_card', 'NON_REFUNDABLE') });

        await expect(
            test.service.create(test.ctx, {
                orderId: 'order-1',
                type: 'REFUND_ONLY',
                reason: 'DIGITAL_CONTENT_ISSUE',
                description: 'The credential email has not arrived.',
                items: [{ orderLineId: 'line-1', quantity: 1 }],
            }),
        ).rejects.toThrow('所选商品不支持自助退款');
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

    it('searches after-sales work by request, order or customer identity', async () => {
        const test = createHarness();
        test.requestRepository.findAndCount.mockResolvedValue([[], 0]);

        await test.service.findForAdmin(test.ctx, { search: ' AS-2026 ' });

        const call = test.requestRepository.findAndCount.mock.calls[0][0];
        expect(call.where).toHaveLength(4);
        expect(call.where).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: expect.objectContaining({ _type: 'like' }) }),
                expect.objectContaining({ customerName: expect.objectContaining({ _type: 'like' }) }),
                expect.objectContaining({ customerEmail: expect.objectContaining({ _type: 'like' }) }),
                expect.objectContaining({ order: expect.objectContaining({ code: expect.anything() }) }),
            ]),
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

    it('links a settled refund from the same order before completing paid after-sales', async () => {
        const test = createHarness({ requestState: 'APPROVED', requestApprovedAmount: 4_900 });
        test.requestRepository.findOne
            .mockResolvedValueOnce({
                id: 'request-1',
                state: 'APPROVED',
                approvedAmount: 4_900,
                requestedAmount: 4_900,
                orderId: 'order-1',
                order: test.order,
                items: [],
                events: [],
                refundId: null,
            })
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                id: 'request-1',
                state: 'COMPLETED',
                approvedAmount: 4_900,
                requestedAmount: 4_900,
                orderId: 'order-1',
                order: test.order,
                items: [],
                events: [],
                refundId: 'refund-1',
            });

        await test.service.transitionForAdmin(test.ctx, {
            id: 'request-1',
            state: 'COMPLETED',
            resolution: 'Refund completed.',
            refundId: 'refund-1',
        });

        expect(test.refundRepository.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: 'refund-1', state: 'Settled' }),
            }),
        );
        expect(test.requestRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'request-1', state: 'APPROVED' }),
            expect.objectContaining({ state: 'COMPLETED', refundId: 'refund-1' }),
        );
    });

    it('does not expose a legacy Chinese resolution to an English client', () => {
        const test = createHarness();
        const request = {
            items: [],
            events: [],
            resolution: '旧中文处理说明',
            resolutionZh: '旧中文处理说明',
            resolutionEn: '仍然是中文处理说明',
        };

        expect(
            (test.service as any).normalizeRelations(request, { languageCode: 'en' }).resolution,
        ).toBeNull();
    });

    it('closes the exchange loop from approval through audited restock and delivery confirmation', async () => {
        const test = createHarness();
        await test.service.create(test.ctx, {
            orderId: 'order-1',
            type: 'EXCHANGE',
            reason: 'DAMAGED',
            description: 'The physical item arrived damaged.',
            items: [{ orderLineId: 'line-1', quantity: 1 }],
        });

        await test.service.transitionForAdmin(test.ctx, {
            id: 'request-1',
            state: 'APPROVED',
            resolution: 'Exchange approved.',
            returnInstructions: 'Send the item to the returns warehouse.',
        });
        await test.service.submitReturnShipmentForCustomer(test.ctx, {
            id: 'request-1',
            carrier: 'Test Carrier',
            trackingCode: 'RETURN-001',
            idempotencyKey: 'customer-return-001',
        });
        await test.service.receiveReturnForAdmin(test.ctx, {
            id: 'request-1',
            note: 'Warehouse received the parcel.',
            idempotencyKey: 'warehouse-received-001',
        });
        await test.service.inspectReturnForAdmin(test.ctx, {
            id: 'request-1',
            note: 'One sellable unit accepted.',
            idempotencyKey: 'inspection-001',
            items: [
                {
                    itemId: 'item-1',
                    acceptedQuantity: 1,
                    rejectedQuantity: 0,
                    stockLocationId: 'warehouse-1',
                    lotCode: 'RETURN-LOT-001',
                },
            ],
        });
        await test.service.updateReplacementForAdmin(test.ctx, {
            id: 'request-1',
            status: 'SHIPPED',
            carrier: 'Replacement Carrier',
            trackingCode: 'REPLACEMENT-001',
            note: 'Replacement shipped.',
            idempotencyKey: 'replacement-shipped-001',
        });
        await test.service.confirmReplacementForCustomer(test.ctx, {
            id: 'request-1',
            idempotencyKey: 'replacement-delivered-001',
        });
        const completed = await test.service.transitionForAdmin(test.ctx, {
            id: 'request-1',
            state: 'COMPLETED',
            resolution: 'Exchange completed after delivery confirmation.',
        });

        expect(completed).toMatchObject({
            state: 'COMPLETED',
            returnStatus: 'INSPECTED',
            replacementStatus: 'DELIVERED',
        });
        expect(test.inventoryControl.receiveCustomerReturn).toHaveBeenCalledWith(
            test.ctx,
            expect.objectContaining({
                reference: expect.stringMatching(/^AS-/),
                lines: [
                    expect.objectContaining({
                        productVariantId: 'variant-1',
                        stockLocationId: 'warehouse-1',
                        lotCode: 'RETURN-LOT-001',
                        quantity: 1,
                    }),
                ],
            }),
        );
        expect(test.savedEvents.map(event => event.eventType)).toEqual(
            expect.arrayContaining([
                'RETURN_SHIPPED',
                'RETURN_RECEIVED',
                'RETURN_INSPECTED',
                'REPLACEMENT_SHIPPED',
                'REPLACEMENT_DELIVERED',
            ]),
        );
    });
});

it.each(['channel-2', null])(
    'rejects after-sales for foreign or unknown sale owner %s before saving requests',
    async salesChannelId => {
        const test = createHarness();
        test.order.salesChannelId = salesChannelId;
        await expect(
            test.service.create(test.ctx, {
                orderId: test.order.id,
                type: 'REFUND_ONLY',
                reason: 'NOT_AS_DESCRIBED',
                description: 'The received product differs from its description.',
                items: [{ orderLineId: 'line-1', quantity: 1 }],
            }),
        ).rejects.toThrow();
        expect(test.requestRepository.save).not.toHaveBeenCalled();
        expect(test.savedEvents).toHaveLength(0);
    },
);
