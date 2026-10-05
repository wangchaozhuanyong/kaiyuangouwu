import { describe, expect, it, vi } from 'vitest';

import { OrderService } from './order.service';
describe('shared order modification validator', () => {
    it.each([true, false])(
        'rejects before modifier side effects with dryRun=%s after locking and loading refunds',
        async dryRun => {
            const sequence: string[] = [];
            const order = { id: 'order', orderPlacedAt: new Date(), payments: [], lines: [] };
            const service = Object.assign(Object.create(OrderService.prototype), {
                orderModificationValidators: new Map(),
                lockOrderForRefund: vi.fn(() => {
                    return Promise.resolve().then(() => {
                        sequence.push('lock');
                    });
                }),
                getOrderOrThrow: vi.fn(() => {
                    return Promise.resolve().then(() => {
                        sequence.push('reload');
                        return order;
                    });
                }),
                orderModifier: { modifyOrder: vi.fn() },
            }) as OrderService;
            service.registerOrderModificationValidator('digital-quantity', (_ctx, current) => {
                return Promise.resolve().then(() => {
                    expect(current).toBe(order);
                    sequence.push('validate');
                    throw new Error('数字行已有按份退款，禁止增加');
                });
            });
            await expect(service.modifyOrder({} as any, { orderId: 'order', dryRun })).rejects.toThrow(
                '禁止增加',
            );
            expect(sequence).toEqual(['lock', 'reload', 'validate']);
            expect((service as any).getOrderOrThrow.mock.calls[0][2]).toEqual(
                expect.arrayContaining(['payments', 'payments.refunds', 'payments.refunds.lines']),
            );
            expect((service as any).orderModifier.modifyOrder).not.toHaveBeenCalled();
        },
    );
    it('permits a valid preview after every registered validator passes', async () => {
        const order = { id: 'order', payments: [], lines: [] };
        const service = Object.assign(Object.create(OrderService.prototype), {
            orderModificationValidators: new Map(),
            lockOrderForRefund: vi.fn(),
            getOrderOrThrow: vi.fn().mockResolvedValue(order),
            orderModifier: { modifyOrder: vi.fn().mockResolvedValue({ order }) },
        }) as OrderService;
        const first = vi.fn().mockResolvedValue(undefined);
        const second = vi.fn().mockResolvedValue(undefined);
        service.registerOrderModificationValidator('first', first);
        service.registerOrderModificationValidator('second', second);
        await expect(service.modifyOrder({} as any, { orderId: 'order', dryRun: true })).resolves.toBe(order);
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
        expect((service as any).orderModifier.modifyOrder).toHaveBeenCalledOnce();
    });
});
