import { describe, expect, it, vi } from 'vitest';

import { AutoCardService } from './auto-card.service';
import { AutoCardDeliveryEvent } from './entities/auto-card-delivery-event.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';

function autoCardLine(quantity = 2) {
    return {
        id: 'line-1',
        quantity,
        customFields: {
            fulfillmentTypeSnapshot: 'digital',
            digitalDeliveryModeSnapshot: 'auto_card',
        },
        productVariant: {
            id: 'variant-1',
            name: 'Google account',
            sku: 'GOOGLE-1',
            customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
        },
    } as any;
}

function createHarness(input: { delivery?: any; candidates?: any[]; affected?: number }) {
    const events: any[] = [];
    const delivery =
        input.delivery ??
        ({
            id: 'delivery-1',
            state: 'WAITING_STOCK',
            quantity: 2,
            configId: 'config-1',
            poolItems: [],
            events: [],
        } as any);
    const candidates = input.candidates ?? [
        { id: 'pool-1', sequence: 1, state: 'AVAILABLE' },
        { id: 'pool-2', sequence: 2, state: 'AVAILABLE' },
    ];
    const poolBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(candidates),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        whereInIds: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: input.affected ?? candidates.length }),
    };
    const deliveryRepository = {
        findOne: vi.fn().mockResolvedValue(delivery),
        save: vi.fn((value: any) => Promise.resolve(value)),
    };
    const poolRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(poolBuilder),
    };
    const eventRepository = {
        save: vi.fn((event: any) => {
            events.push(event);
            delivery.events.push(event);
            return Promise.resolve(event);
        }),
    };
    const connection = {
        getRepository: vi.fn((_ctx: any, entity: any) => {
            if (entity === AutoCardDelivery) return deliveryRepository;
            if (entity === AutoCardPoolItem) return poolRepository;
            if (entity === AutoCardDeliveryEvent) return eventRepository;
            throw new Error(`Unexpected repository ${entity?.name}`);
        }),
    };
    const eventBus = { publish: vi.fn() };
    const service = new AutoCardService(
        connection as any,
        {} as any,
        eventBus as any,
        {} as any,
        {} as any,
        {} as any,
    );
    const ctx = {
        channelId: 'channel-1',
        channel: { id: 'channel-1' },
        activeUserId: 'admin-1',
    } as any;
    return { service, ctx, delivery, events, poolBuilder, deliveryRepository, eventBus };
}

describe('AutoCardService allocation invariants', () => {
    it('allocates the requested quantity in pool sequence order', async () => {
        const test = createHarness({});

        const result = await (test.service as any).allocateExistingDelivery(test.ctx, test.delivery);

        expect(test.poolBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(test.poolBuilder.orderBy).toHaveBeenCalledWith('item.sequence', 'ASC');
        expect(test.poolBuilder.take).toHaveBeenCalledWith(2);
        expect(result.state).toBe('ALLOCATED');
        expect(result.poolItems.map((item: any) => item.sequence)).toEqual([1, 2]);
        expect(test.events.at(-1)).toMatchObject({ type: 'ALLOCATED' });
    });

    it('allocates only the remaining quantity after a partial concurrent assignment', async () => {
        const existing = { id: 'pool-1', sequence: 1, state: 'ASSIGNED', deliveryId: 'delivery-1' };
        const test = createHarness({
            delivery: {
                id: 'delivery-1',
                state: 'WAITING_STOCK',
                quantity: 2,
                configId: 'config-1',
                poolItems: [existing],
                events: [],
            },
            candidates: [{ id: 'pool-2', sequence: 2, state: 'AVAILABLE' }],
        });

        const result = await (test.service as any).allocateExistingDelivery(test.ctx, test.delivery);

        expect(test.poolBuilder.take).toHaveBeenCalledWith(1);
        expect(result.poolItems.map((item: any) => item.id)).toEqual(['pool-1', 'pool-2']);
        expect(result.state).toBe('ALLOCATED');
    });

    it('does not dispatch the same allocated delivery again within the retry window', async () => {
        const existing = {
            id: 'delivery-1',
            state: 'ALLOCATED',
            quantity: 1,
            poolItems: [{ id: 'pool-1' }],
            config: { id: 'config-1' },
            lastDispatchedAt: new Date(),
        };
        const test = createHarness({ delivery: existing });
        const order = {
            id: 'order-1',
            state: 'PaymentSettled',
            customFields: { deliveryEmail: 'buyer@example.com' },
            customer: { emailAddress: 'customer@example.com' },
            lines: [autoCardLine(1)],
        } as any;

        const result = await test.service.allocateSettledOrder(test.ctx, order);

        expect(result).toEqual([existing]);
        expect(test.eventBus.publish).not.toHaveBeenCalled();
    });

    it('never downgrades a successful delivery because a duplicate email attempt failed later', async () => {
        const sent = {
            id: 'delivery-1',
            state: 'SENT',
            quantity: 1,
            attemptCount: 1,
            poolItems: [{ id: 'pool-1' }],
            config: { id: 'config-1' },
            order: { id: 'order-1' },
            orderLine: autoCardLine(1),
            events: [],
        };
        const test = createHarness({ delivery: sent });

        await test.service.recordEmailResult(test.ctx, sent.id, false, new Error('duplicate failed'));

        expect(sent.state).toBe('SENT');
        expect(sent.attemptCount).toBe(1);
        expect(test.deliveryRepository.save).not.toHaveBeenCalled();
        expect(test.events.at(-1)).toMatchObject({ type: 'EMAIL_FAILED' });
    });
});
