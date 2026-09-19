import { Channel, Permission, ProductService, RequestContext, TransactionalConnection } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogChannelAssignmentsService } from './catalog-channel-assignments.service';

function setup(owner: boolean) {
    const channels = [
        { id: 1, code: '__default_channel__' },
        { id: 2, code: '店铺 A' },
        { id: 3, code: '店铺 B' },
    ];
    let requestedIds: Array<string | number> = [];
    const query = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn((_clause, variables) => {
            requestedIds = variables.ids;
            return query;
        }),
        getMany: vi.fn(() => Promise.resolve(requestedIds.map(id => ({ id, channels })))),
    };
    const channelRepository = { find: vi.fn().mockResolvedValue(owner ? channels : [channels[1]]) };
    const connection = {
        getRepository: vi.fn((_: unknown, entity: unknown) =>
            entity === Channel ? channelRepository : { createQueryBuilder: () => query },
        ),
    };
    const products = {
        findAll: vi
            .fn()
            .mockResolvedValue({ items: [{ id: 10, name: '共享商品', enabled: true }], totalItems: 1 }),
    };
    const ctx = {
        channelId: 2,
        channel: channels[1],
        userHasPermissions: () => owner,
        session: {
            user: {
                channelPermissions: [
                    { id: 2, permissions: [Permission.ReadProduct] },
                    { id: 3, permissions: [Permission.ReadOrder] },
                ],
            },
        },
    } as unknown as RequestContext;
    return {
        ctx,
        products,
        query,
        channelRepository,
        service: new CatalogChannelAssignmentsService(
            connection as unknown as TransactionalConnection,
            products as unknown as ProductService,
        ),
    };
}

describe('catalog channel assignments', () => {
    it('shows the owner all real memberships from a non-default source store', async () => {
        const { service, ctx, products, query } = setup(true);
        const result = await service.list(ctx);
        expect(result.items[0].channels.map(channel => channel.id)).toEqual([1, 2, 3]);
        expect(result.items[0].channels[0].isDefault).toBe(true);
        expect(result.summary).toMatchObject({ totalItems: 1, unassignedItems: 0, multiChannelItems: 1 });
        expect(products.findAll).toHaveBeenCalledWith(ctx, { skip: 0, take: 100 }, ['translations']);
        expect(query.where).toHaveBeenCalledWith('product.id IN (:...ids)', { ids: [10] });
    });

    it('does not disclose other stores to staff with only one readable product channel', async () => {
        const { service, ctx, channelRepository } = setup(false);
        const result = await service.list(ctx);
        expect(result.channels.map(channel => channel.id)).toEqual([2]);
        expect(result.items[0].channels.map(channel => channel.id)).toEqual([2]);
        expect(channelRepository.find.mock.calls[0][0]).toMatchObject({ where: { id: expect.anything() } });
    });

    it('rejects an unbounded page before reading any products', async () => {
        const { service, ctx, products } = setup(true);
        await expect(service.list(ctx, { take: 101 })).rejects.toThrow('100');
        expect(products.findAll).not.toHaveBeenCalled();
    });

    it('does not query arbitrary product memberships for an empty scoped page', async () => {
        const { service, ctx, products, query } = setup(true);
        products.findAll.mockResolvedValue({ items: [], totalItems: 0 });
        expect((await service.list(ctx)).items).toEqual([]);
        expect(query.getMany).not.toHaveBeenCalled();
    });

    it('aggregates beyond the first 100 products and returns the requested page', async () => {
        const { service, ctx, products } = setup(true);
        const all = Array.from({ length: 150 }, (_, index) => ({
            id: index + 1,
            name: `商品 ${index + 1}`,
            enabled: true,
        }));
        products.findAll.mockImplementation((_ctx, options) =>
            Promise.resolve({
                items: all.slice(options.skip ?? 0, (options.skip ?? 0) + (options.take ?? 100)),
                totalItems: all.length,
            }),
        );

        const result = await service.list(ctx, { skip: 100, take: 25 });
        expect(products.findAll).toHaveBeenCalledTimes(2);
        expect(result.summary.totalItems).toBe(150);
        expect(result.totalItems).toBe(150);
        expect(result.items).toHaveLength(25);
        expect(result.items[0].id).toBe(101);
    });
});
