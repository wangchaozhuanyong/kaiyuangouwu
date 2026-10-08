import assert from 'node:assert/strict';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckoutResourcesService } from './checkout-resources.service';
import * as commerceOrder from './commerce-order-process';

afterEach(() => vi.restoreAllMocks());
function fixture(databaseType = 'sqljs') {
    const handlers = new Map<string, (event: any) => Promise<void>>();
    const order = {
        id: 'order',
        salesChannelId: 'store',
        active: false,
        state: 'PaymentSettled',
        orderPlacedAt: new Date() as Date | null,
        totalWithTax: 1000,
        lines: [],
        payments: [
            {
                state: 'Settled',
                amount: 1000,
                method: 'fixture-payment',
                metadata: { public: { testPayment: false } },
            },
        ],
    };
    const hold = { id: 'hold', orderId: order.id, state: 'REVIEW', expiresAt: new Date() };
    const repository = {
        findOne: vi.fn().mockResolvedValue(hold),
        find: vi.fn().mockResolvedValue([hold]),
        update: vi.fn((_criteria: unknown, changes: any) => {
            Object.assign(hold, changes);
            return Promise.resolve({ affected: 1 });
        }),
        save: vi.fn(changes => Promise.resolve(Object.assign(hold, changes))),
    };
    const events = {
        publish: vi.fn(),
        registerBlockingEventHandler: vi.fn(({ id, handler }) => handlers.set(id, handler)),
    };
    const digital = { lock: vi.fn(), reserveOrder: vi.fn(), releaseLine: vi.fn() };
    const stock = { createReleasesForOrderLines: vi.fn() };
    const connection = {
        rawConnection: { getRepository: vi.fn(() => repository), options: { type: databaseType } },
        getRepository: vi.fn((_ctx: unknown, _entity: { name: string }) => repository),
        getEntityOrThrow: vi.fn().mockResolvedValue(order),
        withTransaction: vi.fn(async (ctx, work) => {
            const result = await work(ctx);
            return result;
        }),
    };
    const service = new CheckoutResourcesService(
        connection as any,
        events as any,
        digital as any,
        stock as any,
        { create: vi.fn().mockResolvedValue({ channelId: 'store' }) } as any,
        {} as any,
    );
    service.onApplicationBootstrap();
    return {
        order,
        hold,
        repository,
        handlers,
        service,
        digital,
        stock,
        connection,
        ctx: { channelId: 'store' } as any,
    };
}
describe('checkout resource payment and retry boundaries', () => {
    it.each(['mysql', 'mariadb', 'postgres', 'sqljs'])(
        'reads expiry funding evidence after waiting for order locks on %s',
        async databaseType => {
            const test = fixture(databaseType);
            await test.service.reconcileExpired();
            expect(test.connection.withTransaction).toHaveBeenCalledWith(
                expect.anything(),
                expect.any(Function),
                databaseType === 'sqljs' ? undefined : 'READ COMMITTED',
            );
        },
    );
    it('allows additional gateway payment for a legacy placed order without a hold', async () => {
        const test = fixture();
        test.repository.findOne.mockResolvedValue(null as any);
        await expect(
            requireFixture(test.handlers.get('commerce-resource-payment-attempt'))({
                ctx: test.ctx,
                order: test.order,
                phase: 'STARTED',
            }),
        ).resolves.toBeUndefined();
        expect(test.repository.update).not.toHaveBeenCalled();
    });
    it('requires a hold for a new checkout before calling the gateway', async () => {
        const test = fixture();
        test.order.active = true;
        test.order.orderPlacedAt = null;
        test.repository.findOne.mockResolvedValue(null as any);
        await expect(
            requireFixture(test.handlers.get('commerce-resource-payment-attempt'))({
                ctx: test.ctx,
                order: test.order,
                phase: 'STARTED',
            }),
        ).rejects.toThrow('结算占用已失效');
    });
    it.each(['Modifying', 'ArrangingAdditionalPayment', 'Cancelled'])(
        'blocks direct resource retry in %s before reserving or delivering',
        async state => {
            const test = fixture();
            test.order.state = state;
            await expect(test.service.retryDelivery(test.ctx, test.order.id)).rejects.toThrow('暂不能补交付');
            expect(await test.service.canDeliver(test.ctx, test.order.id)).toBe(false);
            expect(test.digital.reserveOrder).not.toHaveBeenCalled();
        },
    );
    it.each(['method', 'metadata'])(
        'does not treat simulated payment identified by %s as collected money',
        async source => {
            const test = fixture();
            if (source === 'method') test.order.payments[0].method = 'controlled-test-payment-fixture';
            else test.order.payments[0].metadata.public.testPayment = true;
            await expect(test.service.retryDelivery(test.ctx, test.order.id)).rejects.toThrow('暂不能补交付');
            expect(test.digital.reserveOrder).not.toHaveBeenCalled();
        },
    );
    it('keeps an unknown gateway outcome under review without releasing its resources', async () => {
        const test = fixture();
        const release = vi.spyOn(test.service, 'release');
        await requireFixture(test.handlers.get('commerce-resource-payment-attempt'))({
            ctx: test.ctx,
            order: test.order,
            phase: 'FAILED',
        });
        expect(test.repository.update).toHaveBeenCalledWith(
            { orderId: test.order.id },
            { state: 'REVIEW', reviewReason: '付款结果待核验' },
        );
        expect(release).not.toHaveBeenCalled();
    });
    it('retains the original funded reservation after an additional payment is explicitly declined', async () => {
        const test = fixture();
        const release = vi.spyOn(test.service, 'release');
        await requireFixture(test.handlers.get('commerce-resource-payment-attempt'))({
            ctx: test.ctx,
            order: test.order,
            phase: 'RETURNED',
            resultState: 'Declined',
        });
        expect(test.repository.update).toHaveBeenCalledWith(
            { orderId: test.order.id },
            { state: 'CONFIRMED', reviewReason: null },
        );
        expect(release).not.toHaveBeenCalled();
    });
    it('does not accept a simulated zero-price order as real funded delivery', async () => {
        const test = fixture();
        test.order.totalWithTax = test.order.payments[0].amount = 0;
        test.order.payments[0].method = 'controlled-test-payment-fixture';
        await expect(test.service.retryDelivery(test.ctx, test.order.id)).rejects.toThrow('暂不能补交付');
        expect(await test.service.canDeliver(test.ctx, test.order.id)).toBe(false);
        expect(test.digital.reserveOrder).not.toHaveBeenCalled();
    });

    it('releases real temporary resources once after a persisted, server-confirmed simulation', async () => {
        const test = fixture();
        test.order.payments[0].method = 'controlled-test-payment-store';
        test.order.payments[0].metadata.public.testPayment = true;
        test.order.lines = [
            { id: 'card-line', customFields: { fulfillmentTypeSnapshot: 'digital' } },
            { id: 'stock-line', customFields: { fulfillmentTypeSnapshot: 'physical' } },
        ] as any;
        vi.spyOn(test.service, 'outstandingAllocation').mockImplementation((_ctx, id) =>
            Promise.resolve(id === 'stock-line' ? 2 : 0),
        );
        const staleOrder = { id: test.order.id, payments: [] } as any;

        await test.service.confirm(test.ctx, staleOrder);
        await test.service.confirm(test.ctx, staleOrder);
        await test.service.release(test.ctx, test.order as any);

        expect(test.hold.state).toBe('RELEASED');
        expect(test.digital.releaseLine.mock.calls).toEqual([
            [test.ctx, 'card-line'],
            [test.ctx, 'stock-line'],
        ]);
        expect(test.stock.createReleasesForOrderLines).toHaveBeenCalledExactlyOnceWith(test.ctx, [
            { orderLineId: 'stock-line', quantity: 2 },
        ]);
        expect(test.repository.update).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ state: 'CONFIRMED' }),
        );
        expect(await test.service.canDeliver(test.ctx, test.order.id)).toBe(false);
    });

    it.each([
        'method-only',
        'metadata-only',
        'mixed-real',
        'unknown-created',
        'unknown-state',
        'manual-review',
    ])('retains resources under review for %s simulation evidence', async evidence => {
        const test = fixture();
        test.order.payments[0].method = 'controlled-test-payment-store';
        test.order.payments[0].metadata.public.testPayment = true;
        if (evidence === 'method-only') test.order.payments[0].metadata.public.testPayment = false;
        if (evidence === 'metadata-only') test.order.payments[0].method = 'real-payment';
        if (evidence === 'mixed-real')
            test.order.payments.push({
                ...test.order.payments[0],
                method: 'real-payment',
                metadata: { public: { testPayment: false } },
            });
        if (evidence === 'unknown-created')
            test.order.payments.push({ ...test.order.payments[0], state: 'Created' });
        if (evidence === 'unknown-state')
            test.order.payments.push({ ...test.order.payments[0], state: 'Error' });
        if (evidence === 'manual-review')
            Object.assign(test.order.payments[0].metadata, { manualReview: { required: true } });

        await test.service.confirm(test.ctx, test.order as any);

        expect(test.hold.state).toBe('REVIEW');
        expect(test.digital.releaseLine).not.toHaveBeenCalled();
        expect(test.repository.save).toHaveBeenCalledWith(
            expect.objectContaining({ reviewReason: expect.stringContaining('请核对原始支付凭证') }),
        );
    });

    it('does not release an unknown earlier gateway attempt when a later payment is declined', async () => {
        const test = fixture();
        test.order.payments[0].state = 'Created';
        const release = vi.spyOn(test.service, 'release');
        await requireFixture(test.handlers.get('commerce-resource-payment-attempt'))({
            ctx: test.ctx,
            order: test.order,
            phase: 'RETURNED',
            resultState: 'Declined',
        });
        expect(test.hold.state).toBe('REVIEW');
        expect(release).not.toHaveBeenCalled();
    });

    it('reconciles an expired completed simulation without confirming its temporary resources', async () => {
        const test = fixture();
        Object.assign(test.hold, { state: 'HELD', expiresAt: new Date(Date.now() - 1000) });
        test.order.payments[0].method = 'controlled-test-payment-store';
        test.order.payments[0].metadata.public.testPayment = true;

        expect(await test.service.reconcileExpired()).toEqual({ examined: 1, released: 1 });
        expect(test.hold.state).toBe('RELEASED');
    });

    it('also releases a legacy digital warehouse allocation after simulated payment', async () => {
        const test = fixture();
        test.order.payments[0].method = 'controlled-test-payment-store';
        test.order.payments[0].metadata.public.testPayment = true;
        test.order.lines = [
            { id: 'legacy-file', customFields: { fulfillmentTypeSnapshot: 'digital' } },
        ] as any;
        vi.spyOn(test.service, 'outstandingAllocation').mockResolvedValue(1);
        await test.service.confirm(test.ctx, test.order as any);
        expect(test.stock.createReleasesForOrderLines).toHaveBeenCalledExactlyOnceWith(test.ctx, [
            { orderLineId: 'legacy-file', quantity: 1 },
        ]);
    });

    it.each(['PAYING', 'REVIEW'])(
        'retains an expired %s attempt even when an older simulation is settled',
        async state => {
            const test = fixture();
            Object.assign(test.hold, { state, expiresAt: new Date(Date.now() - 1000) });
            test.order.payments[0].method = 'controlled-test-payment-store';
            test.order.payments[0].metadata.public.testPayment = true;
            expect(await test.service.reconcileExpired()).toEqual({ examined: 1, released: 0 });
            expect(test.hold.state).toBe(state);
        },
    );

    it.each(['Created', 'Error', 'CustomGatewayPending'])(
        'blocks cancellation and direct retry with an unknown %s payment even without a hold',
        async state => {
            const test = fixture();
            test.repository.findOne.mockResolvedValue(null as any);
            test.order.payments.push({ ...test.order.payments[0], state });
            await expect(test.service.assertCancellationAllowed(test.ctx, test.order.id)).rejects.toThrow(
                '付款结果尚待核验',
            );
            await expect(test.service.retryDelivery(test.ctx, test.order.id)).rejects.toThrow('暂不能补交付');
            expect(await test.service.canDeliver(test.ctx, test.order.id)).toBe(false);
            expect(test.digital.reserveOrder).not.toHaveBeenCalled();
        },
    );

    it.each(['method', 'metadata'])(
        'keeps a declined test identity from becoming deliverable after real funding: %s',
        async source => {
            const test = fixture();
            test.repository.findOne.mockResolvedValue(null as any);
            test.order.payments.push({
                ...test.order.payments[0],
                state: 'Declined',
                method: source === 'method' ? 'controlled-test-payment-store' : 'fixture-payment',
                metadata: { public: { testPayment: source === 'metadata' } },
            });
            expect(await test.service.canDeliver(test.ctx, test.order.id)).toBe(false);
            await expect(test.service.retryDelivery(test.ctx, test.order.id)).rejects.toThrow('模拟付款订单');
            expect(test.digital.reserveOrder).not.toHaveBeenCalled();
            expect(test.digital.releaseLine).not.toHaveBeenCalled();
        },
    );

    it('uses the locked fresh order when checking delivery instead of a previous read snapshot', async () => {
        const test = fixture();
        test.repository.findOne.mockResolvedValue(null as any);
        const fresh = {
            ...test.order,
            payments: [{ ...test.order.payments[0], method: 'controlled-test-payment-store' }],
        };
        expect(await test.service.canDeliver(test.ctx, test.order.id)).toBe(true);
        expect(await test.service.canDeliver(test.ctx, test.order.id, fresh as any)).toBe(false);
    });
});

describe('refunded checkout resource quantities', () => {
    function resourceFixture() {
        const test = fixture('mysql');
        const allocations = new Map<string, number>();
        const sales = new Map<string, number>();
        const reservations = new Map<string, { state: string; quantity: number; releasedQuantity: number }>();
        const query = {
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            addOrderBy: vi.fn().mockReturnThis(),
            setLock: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue([]),
        };
        test.connection.getRepository.mockImplementation((_ctx: unknown, entity: { name: string }) => {
            if (entity.name === 'Sale')
                return {
                    find: vi.fn(({ where }: any) =>
                        Promise.resolve(
                            sales.has(where.orderLine.id)
                                ? [{ quantity: sales.get(where.orderLine.id) }]
                                : [],
                        ),
                    ),
                } as any;
            if (entity.name === 'StockLevel')
                return {
                    manager: { connection: { options: { type: 'mysql' } } },
                    createQueryBuilder: () => query,
                } as any;
            return test.repository;
        });
        vi.spyOn(test.service, 'outstandingAllocation').mockImplementation((_ctx, id) =>
            Promise.resolve(allocations.get(String(id)) ?? 0),
        );
        const createAllocationsForOrderLines = vi.fn(
            (_ctx, lines: Array<{ orderLineId: string; quantity: number }>) => {
                for (const allocation of lines)
                    allocations.set(
                        allocation.orderLineId,
                        (allocations.get(allocation.orderLineId) ?? 0) + allocation.quantity,
                    );
                return Promise.resolve();
            },
        );
        Object.assign(test.stock, { createAllocationsForOrderLines });
        Object.assign(test.digital, {
            config: vi.fn().mockResolvedValue({}),
            reservation: vi.fn((_ctx, id) => Promise.resolve(reservations.get(String(id)))),
        });
        const packaging = {
            rulesForVariantIds: vi.fn().mockResolvedValue([]),
            ensureStockLevelPairs: vi.fn(),
            variantIdsForLock: vi.fn(ids => ids),
            autoUnpackForOrder: vi.fn(),
        };
        Object.assign((test.service as any).packaging, packaging);
        const deliver = vi.spyOn(commerceOrder, 'fulfillDigitalOrder').mockResolvedValue(undefined);
        return {
            ...test,
            allocations,
            sales,
            reservations,
            createAllocationsForOrderLines,
            packaging,
            deliver,
        };
    }
    function line(id: string, quantity: number, type = 'physical', placed = quantity) {
        return {
            id,
            quantity,
            orderPlacedQuantity: placed,
            productVariantId: `variant-${id}`,
            customFields: { fulfillmentTypeSnapshot: type },
        } as any;
    }
    function refund(
        test: ReturnType<typeof resourceFixture>,
        id: string,
        quantity: number,
        state = 'Settled',
    ) {
        Object.assign(test.order.payments[0], {
            refunds: [{ state, lines: [{ orderLineId: id, quantity }] }],
        });
    }

    it.each(['Pending', 'Settled', 'Failed'])(
        'allocates only currently owed physical units with a %s refund',
        async state => {
            const test = resourceFixture();
            test.order.lines = [line('physical', 5)] as any;
            test.allocations.set('physical', 1);
            test.sales.set('physical', 1);
            refund(test, 'physical', 2, state);
            await test.service.retryDelivery(test.ctx, test.order.id);
            const expected = state === 'Failed' ? 3 : 1;
            expect(test.packaging.autoUnpackForOrder.mock.calls[0][2]).toEqual([
                { productVariantId: 'variant-physical', quantity: expected },
            ]);
            expect(test.createAllocationsForOrderLines).toHaveBeenCalledExactlyOnceWith(test.ctx, [
                { orderLineId: 'physical', quantity: expected },
            ]);
            expect(test.hold.state).toBe('CONFIRMED');
        },
    );

    it.each(['amount-only', 'multi-payment-group'])(
        'uses effective item quantities for %s refunds',
        async scenario => {
            const test = resourceFixture();
            test.order.lines = [line('physical', 5)] as any;
            test.allocations.set('physical', 1);
            test.sales.set('physical', 1);
            Object.assign(test.order.payments[0], {
                refunds:
                    scenario === 'amount-only'
                        ? [{ state: 'Settled', total: 1000, lines: [] }]
                        : [
                              {
                                  state: 'Failed',
                                  lines: [{ orderLineId: 'physical', quantity: 2 }],
                                  metadata: { refundRequest: { quantityGroup: { key: 'original-refund' } } },
                              },
                              {
                                  state: 'Pending',
                                  lines: [],
                                  metadata: { refundRequest: { quantityGroup: { key: 'original-refund' } } },
                              },
                          ],
            });
            await test.service.retryDelivery(test.ctx, test.order.id);
            expect(test.createAllocationsForOrderLines).toHaveBeenCalledExactlyOnceWith(test.ctx, [
                { orderLineId: 'physical', quantity: scenario === 'amount-only' ? 3 : 1 },
            ]);
        },
    );

    it.each(['physical', 'digital'])(
        'keeps fully item-refunded %s orders under review without reserving again',
        async type => {
            const test = resourceFixture();
            test.order.lines = [line('refunded', 1, type)] as any;
            refund(test, 'refunded', 1);
            await expect(test.service.retryDelivery(test.ctx, test.order.id)).rejects.toThrow('已全部退款');
            expect(test.hold.state).toBe('REVIEW');
            expect(test.createAllocationsForOrderLines).not.toHaveBeenCalled();
            expect(test.digital.reserveOrder).not.toHaveBeenCalled();
            expect(test.deliver).not.toHaveBeenCalled();
        },
    );

    it('omits fully refunded lines and reserves only remaining digital quantities in a mixed order', async () => {
        const test = resourceFixture();
        test.order.lines = [line('physical', 1), line('digital', 3, 'digital')] as any;
        Object.assign(test.order.payments[0], {
            refunds: [
                {
                    state: 'Settled',
                    lines: [
                        { orderLineId: 'physical', quantity: 1 },
                        { orderLineId: 'digital', quantity: 1 },
                    ],
                },
            ],
        });
        test.reservations.set('digital', { state: 'CONSUMED', quantity: 3, releasedQuantity: 1 });
        const reserved: Array<{ id: string; quantity: number }> = [];
        test.digital.reserveOrder.mockImplementation((_ctx, order) =>
            reserved.push(...order.lines.map(({ id, quantity }: any) => ({ id, quantity }))),
        );
        await test.service.retryDelivery(test.ctx, test.order.id);
        expect(reserved).toEqual([{ id: 'digital', quantity: 2 }]);
        expect(test.order.lines.map((item: any) => item.quantity)).toEqual([1, 3]);
        expect(test.createAllocationsForOrderLines).not.toHaveBeenCalled();
        expect(test.hold.state).toBe('CONFIRMED');
    });

    it('recognizes remaining physical resources using the placed quantity cap after item refunds', async () => {
        const test = resourceFixture();
        test.order.lines = [line('physical', 6, 'physical', 4)] as any;
        refund(test, 'physical', 1);
        test.allocations.set('physical', 3);
        test.hold.state = 'HELD';
        await test.service.confirm(test.ctx, test.order as any);
        expect(test.hold.state).toBe('CONFIRMED');
    });

    it('keeps a digital shortage under review while preserving consumed, unrefunded entitlements', async () => {
        const test = resourceFixture();
        test.order.lines = [line('digital', 3, 'digital')] as any;
        refund(test, 'digital', 1);
        test.hold.state = 'HELD';
        test.reservations.set('digital', { state: 'CONSUMED', quantity: 3, releasedQuantity: 1 });
        await test.service.confirm(test.ctx, test.order as any);
        expect(test.hold.state).toBe('CONFIRMED');
        test.hold.state = 'HELD';
        test.reservations.set('digital', { state: 'HELD', quantity: 1, releasedQuantity: 0 });
        await test.service.confirm(test.ctx, test.order as any);
        expect(test.hold.state).toBe('REVIEW');
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
