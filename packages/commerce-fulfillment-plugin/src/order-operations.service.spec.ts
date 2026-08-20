import { describe, expect, it, vi } from 'vitest';

import { OrderOperationsService, PHYSICAL_FULFILLMENT_TODO_STATES } from './order-operations.service';

describe('OrderOperationsService', () => {
    it('counts distinct physical orders in the active channel and fulfillment states', async () => {
        const queryBuilder = {
            innerJoin: vi.fn(),
            where: vi.fn(),
            andWhere: vi.fn(),
            distinct: vi.fn(),
            getCount: vi.fn().mockResolvedValue(3),
        };
        for (const method of ['innerJoin', 'where', 'andWhere', 'distinct'] as const) {
            queryBuilder[method].mockReturnValue(queryBuilder);
        }
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => queryBuilder),
            })),
        };
        const service = new OrderOperationsService(connection as any);

        await expect(service.countPhysicalFulfillmentTodos({ channelId: 'channel-2' } as any)).resolves.toBe(
            3,
        );

        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
            'order.channels',
            'channel',
            'channel.id = :channelId',
            { channelId: 'channel-2' },
        );
        expect(queryBuilder.where).toHaveBeenCalledWith('order.active = :active', {
            active: false,
        });
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('order.state IN (:...states)', {
            states: PHYSICAL_FULFILLMENT_TODO_STATES,
        });
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
            'line.customFields.fulfillmentTypeSnapshot = :fulfillmentType',
            { fulfillmentType: 'physical' },
        );
        expect(queryBuilder.distinct).toHaveBeenCalledWith(true);
    });
});
