import { Collection, RequestContextCacheService } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { couponCollectionsForVariant } from './store-coupon-collections';

describe('coupon collection display batching', () => {
    it.each([12, 48])(
        '%i products with 3 variants share one membership and one hierarchy read',
        async products => {
            const ids = Array.from({ length: products * 3 }, (_, id) => String(id));
            const findVariants = vi.fn((_options: unknown) =>
                Promise.resolve(ids.map(id => ({ id, collections: [{ id: 'leaf' }, { id: 'foreign' }] }))),
            );
            const findCollections = vi.fn((_options: unknown) =>
                Promise.resolve([
                    { id: 'leaf', parentId: 'parent' },
                    { id: 'parent', parentId: 'root' },
                ]),
            );
            const connection = {
                getRepository: (_ctx: unknown, entity: unknown) => ({
                    find: entity === Collection ? findCollections : findVariants,
                }),
            };
            const ctx = { channelId: 'A' } as any;
            const cache = new RequestContextCacheService();
            const result = await Promise.all(
                ids.map(id => couponCollectionsForVariant(ctx, id, connection as any, cache)),
            );
            expect(result).toEqual(ids.map(() => ['leaf', 'parent']));
            expect(findVariants).toHaveBeenCalledTimes(1);
            expect(findCollections).toHaveBeenCalledTimes(1);
            expect(findVariants.mock.calls[0][0]).toMatchObject({ where: { channels: { id: 'A' } } });
            expect(findCollections.mock.calls[0][0]).toMatchObject({
                where: { channels: { id: 'A' }, isRoot: false },
            });
        },
    );

    it('handles moved/cyclic hierarchy safely and does not reuse another store request', async () => {
        const findCollections = vi.fn(({ where }: any) =>
            Promise.resolve(
                where.channels.id === 'A'
                    ? [
                          { id: 'leaf', parentId: 'parent' },
                          { id: 'parent', parentId: 'leaf' },
                      ]
                    : [
                          { id: 'leaf', parentId: 'other' },
                          { id: 'other', parentId: 'root' },
                      ],
            ),
        );
        const connection = {
            getRepository: (_ctx: unknown, entity: unknown) => ({
                find:
                    entity === Collection
                        ? findCollections
                        : vi.fn(() => Promise.resolve([{ id: 'variant', collections: [{ id: 'leaf' }] }])),
            }),
        };
        const cache = new RequestContextCacheService();
        expect(
            await couponCollectionsForVariant({ channelId: 'A' } as any, 'variant', connection as any, cache),
        ).toEqual(['leaf', 'parent']);
        expect(
            await couponCollectionsForVariant({ channelId: 'B' } as any, 'variant', connection as any, cache),
        ).toEqual(['leaf', 'other']);
    });
});
