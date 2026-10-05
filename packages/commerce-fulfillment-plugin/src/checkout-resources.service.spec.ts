import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutResourcesService } from './checkout-resources.service';
function fixture() {
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
        update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const events = {
        publish: vi.fn(),
        registerBlockingEventHandler: vi.fn(({ id, handler }) => handlers.set(id, handler)),
    };
    const digital = { lock: vi.fn(), reserveOrder: vi.fn() };
    const connection = {
        rawConnection: { getRepository: vi.fn(() => repository) },
        getRepository: vi.fn(() => repository),
        getEntityOrThrow: vi.fn().mockResolvedValue(order),
    };
    const service = new CheckoutResourcesService(
        connection as any,
        events as any,
        digital as any,
        {} as any,
        {} as any,
    );
    service.onApplicationBootstrap();
    return { order, hold, repository, handlers, service, digital, ctx: { channelId: 'store' } as any };
}
describe('checkout resource payment and retry boundaries', () => {
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
        expect(test.digital.reserveOrder).not.toHaveBeenCalled();
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
