import { describe, expect, it, vi } from 'vitest';

import { StoreNotificationReadService, notificationEventKey } from './store-notification-read.service';

const version = '2026-09-24T11:00:00.000Z';
const orderReference = { kind: 'ORDER' as const, sourceId: 'order-1', version };
const afterSalesReference = { kind: 'AFTER_SALES' as const, sourceId: 'request-1', version };

function harness({
    orders = [],
    requests = [],
    readRows = [],
}: {
    orders?: Array<{ id: string; updatedAt: Date }>;
    requests?: Array<{ id: string; updatedAt: Date }>;
    readRows?: Array<{ eventKey: string }>;
} = {}) {
    const insert = {
        insert: vi.fn().mockReturnThis(),
        into: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        orIgnore: vi.fn().mockReturnThis(),
        updateEntity: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({}),
    };
    const orderFind = vi.fn().mockResolvedValue(orders);
    const requestFind = vi.fn().mockResolvedValue(requests);
    const readFind = vi.fn().mockResolvedValue(readRows);
    const connection = {
        getRepository: vi.fn((_ctx: unknown, entity: { name: string }) => {
            if (entity.name === 'Order') return { find: orderFind };
            if (entity.name === 'AfterSalesRequest') return { find: requestFind };
            if (entity.name === 'StoreNotificationRead')
                return { find: readFind, createQueryBuilder: () => insert };
            throw new Error(`Unexpected repository ${entity.name}`);
        }),
    };
    const ctx = { channelId: 'channel-1', activeUserId: 'user-1' } as any;
    const service = new StoreNotificationReadService(
        connection as any,
        { findOneByUserId: vi.fn().mockResolvedValue({ id: 'customer-1' }) } as any,
    );
    return { service, ctx, insert, orderFind, requestFind, readFind };
}

describe('store notification read state', () => {
    it('marks only the current owned versions and uses an idempotent insert', async () => {
        const test = harness({
            orders: [{ id: 'order-1', updatedAt: new Date(version) }],
            requests: [{ id: 'request-1', updatedAt: new Date(version) }],
        });

        const keys = await test.service.markRead(test.ctx, [
            orderReference,
            orderReference,
            afterSalesReference,
        ]);

        expect(keys).toEqual([
            notificationEventKey(orderReference),
            notificationEventKey(afterSalesReference),
        ]);
        expect(test.insert.orIgnore).toHaveBeenCalledOnce();
        expect(test.insert.values).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ customerId: 'customer-1', channelId: 'channel-1' }),
            ]),
        );
        expect(test.orderFind).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ customerId: 'customer-1', salesChannelId: 'channel-1' }),
            }),
        );
        expect(test.requestFind).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ customerId: 'customer-1', channelId: 'channel-1' }),
            }),
        );
    });

    it('does not premark a late or changed notification', async () => {
        const test = harness({
            orders: [{ id: 'order-1', updatedAt: new Date('2026-09-24T11:05:00.000Z') }],
        });

        await expect(test.service.markRead(test.ctx, [orderReference])).resolves.toEqual([]);
        expect(test.insert.execute).not.toHaveBeenCalled();
    });

    it('does not mark records excluded by customer and channel ownership', async () => {
        const test = harness();

        await expect(test.service.markRead(test.ctx, [orderReference, afterSalesReference])).resolves.toEqual(
            [],
        );
        expect(test.insert.execute).not.toHaveBeenCalled();
    });

    it('reads only the active customer and channel keys', async () => {
        const key = notificationEventKey(orderReference);
        const test = harness({ readRows: [{ eventKey: key }] });

        await expect(test.service.readKeys(test.ctx, [orderReference])).resolves.toEqual([key]);
        expect(test.readFind).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ customerId: 'customer-1', channelId: 'channel-1' }),
            }),
        );
    });

    it('rejects unbounded or invalid message references', async () => {
        const test = harness();

        await expect(test.service.markRead(test.ctx, Array(101).fill(orderReference))).rejects.toThrow('100');
        await expect(
            test.service.markRead(test.ctx, [{ ...orderReference, version: 'not-a-date' }]),
        ).rejects.toThrow('无效');
        expect(test.insert.execute).not.toHaveBeenCalled();
    });
});
