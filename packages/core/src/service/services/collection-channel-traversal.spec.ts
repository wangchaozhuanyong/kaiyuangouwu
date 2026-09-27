import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { CollectionEntityResolver } from '../../api/resolvers/entity/collection-entity.resolver';
import { Collection } from '../../entity/collection/collection.entity';

import { CollectionService } from './collection.service';

const rows = [
    { id: 'a', parentId: 'root', position: 2, channels: ['A'] },
    { id: 'b', parentId: 'root', position: 1, channels: ['B'] },
    { id: 'shared', parentId: 'root', position: 3, channels: ['A', 'B'] },
    { id: 'a-child', parentId: 'a', position: 1, channels: ['A'] },
    { id: 'b-child', parentId: 'a', position: 2, channels: ['B'] },
];

describe('Collection traversal through a shared structural root', () => {
    it('uses one existing root across stores and translates its cached entity for each request', async () => {
        const root = new Collection({ id: '1', isRoot: true });
        const query = {
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue(root),
        };
        const rawRepository = vi.fn();
        const translate = vi.fn((entity: Collection, ctx: RequestContext) => ({
            ...entity,
            name: `Root ${ctx.languageCode}`,
            slug: '__root_collection__',
        }));
        const service = Object.assign(Object.create(CollectionService.prototype), {
            connection: {
                getRepository: () => ({ createQueryBuilder: () => query }),
                rawConnection: { getRepository: rawRepository },
            },
            translator: { translate },
        }) as CollectionService;
        const a = await service.getBreadcrumbs(
            { channelId: 'A', languageCode: 'en' } as RequestContext,
            root,
        );
        const b = await service.getBreadcrumbs(
            { channelId: 'B', languageCode: 'zh_Hans' } as RequestContext,
            root,
        );
        expect(a).toEqual([{ id: '1', name: 'Root en', slug: '__root_collection__' }]);
        expect(b).toEqual([{ id: '1', name: 'Root zh_Hans', slug: '__root_collection__' }]);
        expect(query.getOne).toHaveBeenCalledOnce();
        expect(query.orderBy).toHaveBeenCalledWith('collection.id', 'ASC');
        expect(rawRepository).not.toHaveBeenCalled();
    });

    it('returns only active-store children and descendants when stores share one root', async () => {
        const find = vi.fn(({ where }: { where: { parent: { id: string }; channels?: { id: string } } }) =>
            rows.filter(
                row =>
                    row.parentId === where.parent.id &&
                    (!where.channels || row.channels.includes(where.channels.id)),
            ),
        );
        const service = Object.assign(Object.create(CollectionService.prototype), {
            connection: { getRepository: () => ({ find }) },
            translator: { translate: (row: unknown) => row },
        }) as CollectionService;
        expect(
            (await service.getChildren({ channelId: 'A' } as RequestContext, 'root')).map(row => row.id),
        ).toEqual(['a', 'shared']);
        expect(
            (await service.getChildren({ channelId: 'B' } as RequestContext, 'root')).map(row => row.id),
        ).toEqual(['b', 'shared']);
        expect(
            (await service.getDescendants({ channelId: 'A' } as RequestContext, 'root')).map(row => row.id),
        ).toEqual(['a', 'a-child', 'shared']);
    });

    it('scopes eager children before sorting and applying the Shop privacy filter', async () => {
        const current = [
            new Collection({ id: 'shared', position: 3 }),
            new Collection({ id: 'private-a', position: 1, isPrivate: true }),
            new Collection({ id: 'a', position: 2 }),
        ];
        const findByIds = vi.fn(() => Promise.resolve([...current]));
        const service = { findByIds } as unknown as CollectionService;
        const resolver = new CollectionEntityResolver(
            {} as any,
            service,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        const ctx = { channelId: 'A' } as RequestContext;
        const root = new Collection({
            id: 'root',
            children: [...current, new Collection({ id: 'b', position: 0 })],
        });
        expect((await resolver.children(ctx, root, 'shop')).map(row => row.id)).toEqual(['a', 'shared']);
        expect((await resolver.children(ctx, root, 'admin')).map(row => row.id)).toEqual([
            'private-a',
            'a',
            'shared',
        ]);
        expect(findByIds).toHaveBeenCalledWith(ctx, ['shared', 'private-a', 'a', 'b']);
    });
});
