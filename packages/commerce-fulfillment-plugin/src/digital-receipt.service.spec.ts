import { Order } from '@vendure/core';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { DigitalReceiptService } from './digital-receipt.service';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { DigitalReceiptAccess } from './entities/digital-product.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';

function fixture(size: number) {
    const orders = Array.from(
        { length: size },
        (_, index) =>
            ({
                id: String(index),
                salesChannelId: 'shop',
                active: false,
                state: 'PaymentSettled',
                totalWithTax: 100,
                payments: [{ state: 'Settled', amount: 100, method: 'offline', refunds: [] }],
                lines: [
                    {
                        id: `line-${index}`,
                        quantity: 1,
                        orderPlacedQuantity: 1,
                        customFields: {
                            fulfillmentTypeSnapshot: 'digital',
                            digitalDeliveryModeSnapshot: index % 2 ? 'auto_card' : 'manual_service',
                        },
                    },
                ],
            }) as unknown as Order,
    );
    const selections: string[] = [];
    const joins = vi.fn();
    const reads = vi.fn();
    const query = (entity: unknown) => {
        const builder: any = {};
        for (const method of ['select', 'addSelect', 'where', 'groupBy'])
            builder[method] = (sql: string) => {
                selections.push(sql);
                return builder;
            };
        builder.innerJoin = (...args: unknown[]) => {
            joins(...args);
            return builder;
        };
        builder.getRawMany = () => {
            reads(entity);
            return Promise.resolve(
                entity === ManualDigitalDelivery
                    ? orders
                          .filter((_, index) => index % 2 === 0)
                          .map(order => ({
                              orderLineId: order.lines[0].id,
                              state: 'EMAIL_FAILED',
                              quantity: 1,
                              hasPackages: 1,
                          }))
                    : orders
                          .filter((_, index) => index % 2 === 1)
                          .map(order => ({ deliveryId: `delivery-${order.id}`, quantity: 1 })),
            );
        };
        return builder;
    };
    const connection = {
        getRepository: (_ctx: unknown, entity: unknown) => ({
            createQueryBuilder: () => query(entity),
            find: () => {
                reads(entity);
                return Promise.resolve(
                    entity === AutoCardDelivery
                        ? orders
                              .filter((_, index) => index % 2 === 1)
                              .map(order => ({
                                  id: `delivery-${order.id}`,
                                  orderLineId: order.lines[0].id,
                                  state: 'SENT',
                                  quantity: 1,
                              }))
                        : orders.map(order => ({ orderLineId: order.lines[0].id, claimedQuantity: 0 })),
                );
            },
        }),
    };
    const metadataForOrders = vi.fn(() => Promise.resolve(new Map()));
    const service = new DigitalReceiptService(
        connection as never,
        {} as never,
        {} as never,
        { metadataForOrders } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
    );
    return {
        service,
        orders,
        reads,
        selections,
        joins,
        metadataForOrders,
        ctx: { channelId: 'shop' } as any,
    };
}

describe('batch digital receipt metadata', () => {
    it.each([20, 1000, 10000])(
        'reads %i orders with a fixed query count, without loading encrypted content',
        async size => {
            const f = fixture(size);
            const result = await f.service.statusesForOrders(f.ctx, f.orders);
            expect(result.size).toBe(size);
            expect(f.reads.mock.calls.map(call => call[0])).toEqual([
                AutoCardDelivery,
                ManualDigitalDelivery,
                DigitalReceiptAccess,
                AutoCardPoolItem,
            ]);
            expect(f.metadataForOrders).toHaveBeenCalledTimes(1);
            expect(f.joins).toHaveBeenCalledWith(
                AutoCardDelivery,
                'poolDelivery',
                'poolDelivery.id = pool.deliveryId AND poolDelivery.channelId = :channelId',
                { channelId: 'shop' },
            );
            expect(f.selections.some(sql => sql.includes('pool.channelId'))).toBe(false);
            expect(f.selections).toContain(
                "CASE WHEN manual.encryptedPackages IS NOT NULL AND manual.encryptedPackages <> '' THEN 1 ELSE 0 END",
            );
            expect(f.selections).not.toContain('manual.encryptedPackages');
            expect(result.get('0')?.[0]).toMatchObject({
                state: 'READY',
                readyQuantity: 1,
                notificationState: 'EMAIL_FAILED',
                packages: [],
                downloadUrl: null,
            });
            expect(result.get('1')?.[0]).toMatchObject({
                state: 'READY',
                readyQuantity: 1,
                notificationState: 'SENT',
            });
        },
    );
    it('retains entitlement guards and rejects orders from another channel before reading', async () => {
        const f = fixture(2);
        f.orders[0].state = 'Cancelled';
        const result = await f.service.statusesForOrders(f.ctx, f.orders);
        expect(result.get('0')?.[0]).toMatchObject({ state: 'UNAVAILABLE', readyQuantity: 0 });
        f.orders[0].salesChannelId = 'other-shop';
        f.reads.mockClear();
        await expect(f.service.statusesForOrders(f.ctx, f.orders)).rejects.toThrow();
        expect(f.reads).not.toHaveBeenCalled();
    });
});
