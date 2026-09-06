import { Channel, Permission, ProductService, RequestContext, TransactionalConnection } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogChannelAssignmentsService } from './catalog-channel-assignments.service';

function setup(owner: boolean) {
    const channels = [
        { id: 1, code: '__default_channel__' },
        { id: 2, code: '店铺 A' },
        { id: 3, code: '店铺 B' },
    ];
    const query = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([{ id: 10, channels }]),
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
        expect(products.findAll).toHaveBeenCalledWith(ctx, { take: 100 }, ['translations']);
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
});
