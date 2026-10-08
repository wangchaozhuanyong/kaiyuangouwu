import { describe, expect, it, vi } from 'vitest';

import { AfterSalesService } from './after-sales.service';
import { PhysicalReturnService } from './physical-return.service';

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
        active: false,
        orderPlacedAt: new Date(),
        currencyCode: 'MYR',
        totalWithTax: 9800,
        payments: [{ state: 'Settled', amount: 9800, method: 'synthetic-provider', metadata: {} }],
        customer,
        lines: [line],
    } as any;
    const savedItems: any[] = [];
    const savedEvents: any[] = [];
    let savedRequest: any;
    const requestQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        getQuery: vi
            .fn()
            .mockReturnValue('SELECT ownerRequest.orderId FROM after_sales_request ownerRequest'),
        getParameters: vi.fn().mockReturnValue({}),
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
        setParameters: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 1 }),
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(order),
    };
    const orderRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(orderQueryBuilder),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const refundRepository = {
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue({
            id: 'refund-1',
            state: 'Settled',
            total: 4_900,
            payment: { order },
        }),
    };
    const receiptRepository = { find: vi.fn().mockResolvedValue([]) };
    const connection = {
        rawConnection: { options: { type: overrides.databaseType ?? 'mysql' } },
        getEntityOrThrow: vi.fn().mockResolvedValue(order),
        getRepository: vi.fn((_ctx: any, entity: any): any => {
            if (entity.name === 'AfterSalesRequest') return requestRepository;
            if (entity.name === 'AfterSalesItem') return itemRepository;
            if (entity.name === 'AfterSalesEvent') return eventRepository;
            if (entity.name === 'Order') return orderRepository;
            if (entity.name === 'Refund') return refundRepository;
            if (entity.name === 'PhysicalReturnReceipt') return receiptRepository;
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
        dispatchAfterSalesReplacement: vi.fn().mockResolvedValue({ id: 'inventory-outbound-1' }),
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
        receiptRepository,
        connection,
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
                type: 'REFUND_ONLY',
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
    it.each(['Pending', 'Failed', 'Settled'])(
        'requires every original-payment fragment to settle before closing after-sales (%s)',
        async state => {
            const test = createHarness({ requestState: 'APPROVED', requestApprovedAmount: 4900 });
            const request = {
                id: 'request-1',
                type: 'REFUND_ONLY',
                state: 'APPROVED',
                approvedAmount: 4900,
                requestedAmount: 4900,
                orderId: 'order-1',
                order: test.order,
                items: [],
                events: [],
                refundId: null,
            };
            test.requestRepository.findOne.mockResolvedValueOnce(request).mockResolvedValueOnce(null);
            const anchor: any = {
                id: 'refund-1',
                state: 'Settled',
                total: 2450,
                payment: { order: test.order },
                metadata: { refundRequest: { modificationGroupKey: 'original-group' } },
            };
            test.refundRepository.findOne.mockResolvedValue(anchor);
            test.refundRepository.find.mockResolvedValue([
                anchor,
                { ...anchor, id: 'refund-2', state },
                {
                    ...anchor,
                    id: 'foreign-group',
                    total: 99999,
                    metadata: { refundRequest: { modificationGroupKey: 'another-group' } },
                },
            ]);
            const operation = test.service.transitionForAdmin(test.ctx, {
                id: 'request-1',
                state: 'COMPLETED',
                resolution: 'Synthetic split refund reviewed.',
                refundId: 'refund-1',
            });
            if (state !== 'Settled') {
                await expect(operation).rejects.toThrow('尚未全部退回');
                expect(test.requestRepository.update).not.toHaveBeenCalled();
            } else {
                await operation;
                expect(test.requestRepository.update).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.objectContaining({ state: 'COMPLETED' }),
                );
            }
        },
    );

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

    it.each([
        { lines: [{ orderLineId: 'line-2', quantity: 1 }], expected: 'reject' },
        { lines: [{ orderLineId: 'line-1', quantity: 2 }], expected: 'reject' },
        { lines: [{ orderLineId: 'line-1', quantity: 1 }], expected: 'complete' },
    ])('matches refund items and quantities before closing ($expected)', async ({ lines, expected }) => {
        const test = createHarness();
        const request = {
            id: 'request-1',
            type: 'REFUND_ONLY',
            state: 'APPROVED',
            orderId: test.order.id,
            order: test.order,
            approvedAmount: 4900,
            requestedAmount: 4900,
            items: [{ orderLineId: 'line-1', quantity: 1 }],
            events: [],
        };
        test.requestRepository.findOne.mockResolvedValueOnce(request).mockResolvedValueOnce(null);
        test.refundRepository.findOne.mockResolvedValue({
            id: 'refund-1',
            state: 'Settled',
            total: 4900,
            lines,
            payment: { order: test.order },
        });
        const operation = test.service.transitionForAdmin(test.ctx, {
            id: 'request-1',
            state: 'COMPLETED',
            refundId: 'refund-1',
            resolution: 'Reviewed refund.',
        });
        if (expected === 'reject') {
            await expect(operation).rejects.toThrow('商品或数量与当前售后申请不一致');
            expect(test.requestRepository.update).not.toHaveBeenCalled();
        } else {
            await operation;
            expect(test.requestRepository.update).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ state: 'COMPLETED' }),
            );
        }
    });

    it('keeps amount-only compensation for refund-only requests but rejects it for physical returns', async () => {
        const test = createHarness();
        const request = {
            id: 'request-1',
            type: 'RETURN_AND_REFUND',
            state: 'APPROVED',
            returnStatus: 'INSPECTED',
            orderId: test.order.id,
            order: test.order,
            approvedAmount: 4900,
            requestedAmount: 4900,
            items: [{ orderLineId: 'line-1', quantity: 1 }],
            events: [],
        };
        test.requestRepository.findOne.mockResolvedValue(request);
        await expect(
            test.service.transitionForAdmin(test.ctx, {
                id: 'request-1',
                state: 'COMPLETED',
                refundId: 'refund-1',
                resolution: 'Reviewed return.',
            }),
        ).rejects.toThrow('商品或数量与当前售后申请不一致');
        expect(test.requestRepository.update).not.toHaveBeenCalled();
    });

    it('matches a split refund group once rather than counting the money sources as extra returned items', async () => {
        const test = createHarness();
        const request = {
            id: 'request-1',
            type: 'REFUND_ONLY',
            state: 'APPROVED',
            orderId: test.order.id,
            order: test.order,
            approvedAmount: 4900,
            requestedAmount: 4900,
            items: [{ orderLineId: 'line-1', quantity: 1 }],
            events: [],
        };
        test.requestRepository.findOne.mockResolvedValueOnce(request).mockResolvedValueOnce(null);
        const anchor = {
            id: 'refund-1',
            state: 'Settled',
            total: 2450,
            payment: { order: test.order },
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
            metadata: { refundRequest: { quantityGroup: { key: 'group-1' } } },
        };
        test.refundRepository.findOne.mockResolvedValue(anchor);
        test.refundRepository.find.mockResolvedValue([anchor, { ...anchor, id: 'refund-2', lines: [] }]);
        await test.service.transitionForAdmin(test.ctx, {
            id: 'request-1',
            state: 'COMPLETED',
            refundId: 'refund-1',
            resolution: 'Original money sources returned.',
        });
        expect(test.requestRepository.update).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ state: 'COMPLETED' }),
        );
    });

    it('does not mark a replacement shipped when outbound inventory fails', async () => {
        const test = createHarness();
        test.requestRepository.findOne.mockResolvedValue({
            id: 'request-1',
            code: 'AS-1',
            type: 'RESHIP',
            state: 'APPROVED',
            replacementStatus: 'PENDING',
            orderId: test.order.id,
            order: test.order,
            events: [],
            items: [{ fulfillmentType: 'physical', quantity: 1, orderLine: test.line }],
        });
        test.inventoryControl.dispatchAfterSalesReplacement.mockRejectedValue(new Error('本店可用库存不足'));
        await expect(
            test.service.updateReplacementForAdmin(test.ctx, {
                id: 'request-1',
                status: 'SHIPPED',
                carrier: 'Carrier',
                trackingCode: 'TRACK-1',
                note: 'Ship replacement.',
                idempotencyKey: 'ship-replacement-001',
            }),
        ).rejects.toThrow('可用库存不足');
        expect(test.requestRepository.update).not.toHaveBeenCalled();
        expect(test.savedEvents).toHaveLength(0);
    });

    it('uses one outbound identity when exception tracking is registered again', async () => {
        const test = createHarness();
        const request = {
            id: 'request-1',
            code: 'AS-1',
            type: 'RESHIP',
            state: 'APPROVED',
            replacementStatus: 'PENDING',
            orderId: test.order.id,
            order: test.order,
            events: [],
            items: [{ fulfillmentType: 'physical', quantity: 1, orderLine: test.line }],
        };
        test.requestRepository.findOne.mockResolvedValue(request);
        const input = {
            id: 'request-1',
            status: 'SHIPPED' as const,
            carrier: 'Carrier',
            trackingCode: 'TRACK-1',
            note: 'Ship replacement.',
            idempotencyKey: 'ship-replacement-001',
        };
        await test.service.updateReplacementForAdmin(test.ctx, input);
        request.replacementStatus = 'EXCEPTION';
        await test.service.updateReplacementForAdmin(test.ctx, {
            ...input,
            trackingCode: 'TRACK-2',
            idempotencyKey: 'ship-replacement-002',
        });
        expect(test.inventoryControl.dispatchAfterSalesReplacement).toHaveBeenCalledTimes(2);
        const [first, second] = test.inventoryControl.dispatchAfterSalesReplacement.mock.calls;
        expect(first[1].idempotencyKey).toBe(second[1].idempotencyKey);
        expect(first[1].lines).toEqual(second[1].lines);
    });

    it('does not consume real stock for a simulated-payment replacement request', async () => {
        const test = createHarness();
        test.order.payments[0].metadata = { public: { testPayment: true } };
        test.requestRepository.findOne.mockResolvedValue({
            id: 'request-1',
            code: 'AS-1',
            type: 'RESHIP',
            state: 'APPROVED',
            replacementStatus: 'PENDING',
            orderId: test.order.id,
            order: test.order,
            events: [],
            items: [{ fulfillmentType: 'physical', quantity: 1, orderLine: test.line }],
        });
        await expect(
            test.service.updateReplacementForAdmin(test.ctx, {
                id: 'request-1',
                status: 'SHIPPED',
                carrier: 'Carrier',
                trackingCode: 'TRACK-1',
                note: 'Replacement.',
                idempotencyKey: 'simulated-shipment-001',
            }),
        ).rejects.toThrow('真实换货补发出库');
        expect(test.inventoryControl.dispatchAfterSalesReplacement).not.toHaveBeenCalled();
        expect(test.requestRepository.update).not.toHaveBeenCalled();
    });

    it.each([
        'mixed-test',
        'manual-review',
        'unknown-payment',
        'active',
        'unplaced',
        'Cancelled',
        'Modifying',
        'ArrangingAdditionalPayment',
    ])('blocks replacement inventory while original-order evidence is %s', async reason => {
        const test = createHarness();
        if (reason === 'mixed-test')
            test.order.payments.push({
                state: 'Settled',
                amount: 9800,
                method: 'controlled-test-payment-1',
                metadata: {},
            });
        else if (reason === 'manual-review')
            test.order.payments[0].metadata = { manualReview: { required: true } };
        else if (reason === 'unknown-payment')
            test.order.payments.push({
                state: 'Created',
                amount: 9800,
                method: 'synthetic-provider',
                metadata: {},
            });
        else if (reason === 'active') test.order.active = true;
        else if (reason === 'unplaced') test.order.orderPlacedAt = null;
        else test.order.state = reason;
        test.requestRepository.findOne.mockResolvedValue({
            id: 'request-1',
            code: 'AS-1',
            type: 'RESHIP',
            state: 'APPROVED',
            replacementStatus: 'PENDING',
            orderId: test.order.id,
            order: test.order,
            events: [],
            items: [{ fulfillmentType: 'physical', quantity: 1, orderLine: test.line }],
        });
        await expect(
            test.service.updateReplacementForAdmin(test.ctx, {
                id: 'request-1',
                status: 'SHIPPED',
                carrier: 'Carrier',
                trackingCode: 'TRACK-1',
                note: 'Replacement.',
                idempotencyKey: 'blocked-shipment-001',
            }),
        ).rejects.toThrow();
        expect(test.inventoryControl.dispatchAfterSalesReplacement).not.toHaveBeenCalled();
        expect(test.requestRepository.update).not.toHaveBeenCalled();
    });

    it('completes inspection of legacy returns from multiple warehouses without another stock write', async () => {
        const test = createHarness();
        await test.service.create(test.ctx, {
            orderId: 'order-1',
            type: 'RETURN_AND_REFUND',
            reason: 'DAMAGED',
            description: 'Historical multi-warehouse return.',
            items: [{ orderLineId: 'line-1', quantity: 2 }],
        });
        await test.service.transitionForAdmin(test.ctx, {
            id: 'request-1',
            state: 'APPROVED',
            resolution: 'Approved.',
            returnInstructions: 'Return to sales warehouses.',
        });
        await test.service.receiveReturnForAdmin(test.ctx, {
            id: 'request-1',
            note: 'Received.',
            idempotencyKey: 'multi-receive-001',
        });
        test.receiptRepository.find.mockResolvedValue([
            { orderLineId: 'line-1', quality: 'GOOD', quantity: 1, stockLocationId: 'warehouse-1' },
            { orderLineId: 'line-1', quality: 'GOOD', quantity: 1, stockLocationId: 'warehouse-2' },
        ]);
        await test.service.inspectReturnForAdmin(test.ctx, {
            id: 'request-1',
            note: 'History verified.',
            idempotencyKey: 'multi-inspect-001',
            items: [{ itemId: 'item-1', acceptedQuantity: 2, rejectedQuantity: 0 }],
        });
        expect(test.inventoryControl.receiveCustomerReturn).not.toHaveBeenCalled();
        expect(test.savedItems[0]).toMatchObject({
            acceptedReturnQuantity: 2,
            returnStockLocationId: null,
            returnLotCode: null,
        });
    });

    it.each([1, 2])(
        'does not restock a legacy receipt twice when inspecting %i returned units',
        async quantity => {
            const test = createHarness();
            await test.service.create(test.ctx, {
                orderId: 'order-1',
                type: 'RETURN_AND_REFUND',
                reason: 'DAMAGED',
                description: 'Synthetic historical return.',
                items: [{ orderLineId: 'line-1', quantity }],
            });
            await test.service.transitionForAdmin(test.ctx, {
                id: 'request-1',
                state: 'APPROVED',
                resolution: 'Approved return.',
                returnInstructions: 'Return to the warehouse.',
            });
            await test.requestRepository.update({ id: 'request-1' }, { returnStatus: 'NOT_REQUIRED' });
            const level = {
                id: 'stock-1',
                stockOnHand: 5,
                stockLocation: { channels: [{ id: 'channel-1' }] },
            };
            const receipts: any[] = [];
            const receiptQuery = {
                where: vi.fn().mockReturnThis(),
                setLock: vi.fn().mockReturnThis(),
                getOne: vi.fn(() => Promise.resolve(receipts[0] ?? null)),
                getMany: vi.fn(() => Promise.resolve(receipts)),
            };
            const receiptRepository = {
                manager: {
                    queryRunner: { isTransactionActive: true },
                    connection: { options: { type: 'mysql' } },
                },
                createQueryBuilder: vi.fn(() => receiptQuery),
                find: vi.fn(() => Promise.resolve(receipts)),
                save: vi.fn((receipt: any) => {
                    if (!receipt.id) {
                        receipt.id = 'receipt-1';
                        receipts.push(receipt);
                    }
                    return Promise.resolve(receipt);
                }),
            };
            const originalRepository = test.connection.getRepository.getMockImplementation();
            if (!originalRepository) throw new Error('Missing test repository');
            test.connection.getRepository.mockImplementation((ctx, entity) => {
                if (entity.name === 'PhysicalReturnReceipt') return receiptRepository;
                if (entity.name === 'StockLevel') return { findOne: vi.fn().mockResolvedValue(level) };
                if (entity.name === 'Sale')
                    return { find: vi.fn().mockResolvedValue([{ quantity: -quantity }]) };
                if (['InventoryLot', 'InventoryLotMovement'].includes(entity.name))
                    return { exists: vi.fn().mockResolvedValue(false) };
                return originalRepository(ctx, entity);
            });
            test.connection.getEntityOrThrow.mockImplementation((_ctx, entity) => {
                if (entity.name === 'AfterSalesRequest') return test.requestRepository.findOne();
                if (entity.name === 'OrderLine') return Promise.resolve(test.line);
                return Promise.resolve(test.order);
            });
            const stock = {
                createCancellationsForOrderLines: vi.fn((_ctx, lines) => {
                    level.stockOnHand += lines[0].quantity;
                    return Promise.resolve();
                }),
            };
            const locks = {
                lock: vi.fn((_ctx, entity) =>
                    entity.name === 'AfterSalesRequest'
                        ? test.requestRepository.findOne()
                        : Promise.resolve(level),
                ),
            };
            const legacy = new PhysicalReturnService(test.connection as any, locks as any, stock as any);
            const input = {
                requestId: 'request-1',
                orderLineId: 'line-1',
                stockLocationId: 'warehouse-1',
                quantity: 1,
                quality: 'GOOD' as const,
                idempotencyKey: 'legacy-return-001',
            };
            await legacy.receive(test.ctx, input);
            expect(level.stockOnHand).toBe(6);
            test.inventoryControl.receiveCustomerReturn.mockImplementation((_ctx, operation) => {
                level.stockOnHand += operation.lines.reduce(
                    (sum: number, line: { quantity: number }) => sum + line.quantity,
                    0,
                );
                return Promise.resolve({ id: 'inventory-operation-1' });
            });
            await test.service.receiveReturnForAdmin(test.ctx, {
                id: 'request-1',
                note: 'Received.',
                idempotencyKey: 'unified-receive-001',
            });
            await test.service.inspectReturnForAdmin(test.ctx, {
                id: 'request-1',
                note: 'Inspected.',
                idempotencyKey: 'unified-inspect-001',
                items: [
                    {
                        itemId: 'item-1',
                        acceptedQuantity: quantity,
                        rejectedQuantity: 0,
                        stockLocationId: 'warehouse-1',
                        lotCode: 'RETURN-LOT',
                    },
                ],
            });
            expect(level.stockOnHand).toBe(5 + quantity);
            expect(test.savedItems[0].acceptedReturnQuantity).toBe(quantity);
            await legacy.receive(test.ctx, input);
            expect(level.stockOnHand).toBe(5 + quantity);
            receiptQuery.getOne.mockResolvedValue(null);
            await expect(
                legacy.receive(test.ctx, { ...input, idempotencyKey: 'second-receipt-002' }),
            ).rejects.toThrow('统一退货签收和质检');
            expect(level.stockOnHand).toBe(5 + quantity);
        },
    );

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
        expect(test.inventoryControl.dispatchAfterSalesReplacement).toHaveBeenCalledWith(
            test.ctx,
            expect.objectContaining({
                reference: completed.code,
                lines: [{ productVariantId: 'variant-1', quantity: 1 }],
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
