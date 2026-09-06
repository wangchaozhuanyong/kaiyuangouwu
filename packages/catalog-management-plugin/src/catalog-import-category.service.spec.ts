import { Collection, FacetValue, type RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogImportCategoryService } from './catalog-import-category.service';

const ctx = { channelId: 'channel-1', languageCode: 'zh-Hans' } as unknown as RequestContext;

function fixture() {
    const collections: Collection[] = [];
    const facets = [
        { id: 'f-primary', code: 'catalog-import-primary-category', name: '食品' },
        { id: 'f-other-primary', code: 'catalog-import-primary-category', name: '其他' },
        { id: 'f-child', code: 'catalog-import-category', name: '食品 > 饮料' },
        { id: 'f-other-child', code: 'catalog-import-category', name: '其他 > 饮料' },
    ];
    const query = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: () => Promise.resolve(collections),
    };
    const connection = {
        getRepository: vi.fn((_ctx, entity) => {
            if (entity === Collection) return { createQueryBuilder: () => query };
            if (entity === FacetValue)
                return {
                    find: (options: { where: { facet: { code: string } } }) =>
                        Promise.resolve(
                            facets
                                .filter(facet => facet.code === options.where.facet.code)
                                .map(facet => ({ id: facet.id, translations: [{ name: facet.name }] })),
                        ),
                };
            throw new Error('Unexpected repository');
        }),
    };
    const service = {
        create: vi.fn((_ctx, input) => {
            const collection = {
                ...input,
                id: `c-${collections.length}`,
                parentId: input.parentId ?? 'root',
                parent: input.parentId
                    ? collections.find(item => item.id === input.parentId)
                    : { isRoot: true },
                filters: input.filters.map((filter: { code: string; arguments: unknown[] }) => ({
                    code: filter.code,
                    args: filter.arguments,
                })),
            } as Collection;
            collections.push(collection);
            return Promise.resolve(collection);
        }),
        update: vi.fn((_ctx, input) => {
            const collection = collections.find(item => item.id === input.id);
            if (!collection) throw new Error('Missing fixture collection');
            collection.filters = input.filters.map((filter: { code: string; arguments: unknown[] }) => ({
                code: filter.code,
                args: filter.arguments,
            }));
            return Promise.resolve(collection);
        }),
        findOneBySlug: vi.fn().mockResolvedValue(undefined),
        setApplyAllFiltersOnProductUpdates: vi.fn(),
        triggerApplyFiltersJob: vi.fn().mockResolvedValue(undefined),
    };
    return {
        imports: new CatalogImportCategoryService(connection as never, service as never),
        service,
        collections,
        query,
    };
}

describe('hierarchical import categories', () => {
    it('creates no empty child and reuses children only under their own parent', async () => {
        const { imports, collections, query } = fixture();
        await imports.moveImportedCategory(ctx, 'p1', '', '食品');
        expect(collections).toHaveLength(1);
        await imports.moveImportedCategory(ctx, 'p2', '', '食品 > 饮料');
        await imports.moveImportedCategory(ctx, 'p3', '', '其他 > 饮料');
        expect(collections).toHaveLength(4);
        const children = collections.filter(item => item.translations[0].name === '饮料');
        expect(children[0].parentId).not.toBe(children[1].parentId);
        expect(query.innerJoin).toHaveBeenCalledWith(
            'collection.channels',
            'channel',
            'channel.id = :channelId',
            { channelId: 'channel-1' },
        );
    });

    it('handles 4074 assignments without 4074 growing filter rewrites', async () => {
        const { imports, service, collections } = fixture();
        for (let row = 0; row < 4074; row++)
            await imports.moveImportedCategory(ctx, `p-${row}`, '', '食品 > 饮料');
        expect(service.create).toHaveBeenCalledTimes(2);
        expect(service.update).not.toHaveBeenCalled();
        expect(JSON.stringify(collections.map(item => item.filters))).not.toContain('p-');
    });

    it('removes only the legacy manual child membership when moved to the primary level', async () => {
        const { imports, collections, service } = fixture();
        await imports.moveImportedCategory(ctx, 'p1', '', '食品 > 饮料');
        collections[1].filters.push({
            code: 'product-id-filter',
            args: [
                { name: 'productIds', value: '["p1","p2"]' },
                { name: 'combineWithAnd', value: 'false' },
            ],
        });
        await imports.moveImportedCategory(ctx, 'p1', '食品 > 饮料', '食品');
        expect(collections).toHaveLength(2);
        expect(service.update).toHaveBeenCalledTimes(1);
        expect(collections[1].filters.find(item => item.code === 'product-id-filter')?.args[0].value).toBe(
            '["p2"]',
        );
    });

    it('restores processing on failure and waits for overlapping imports to finish', async () => {
        const { imports, service } = fixture();
        await expect(
            imports.withDeferredFilters(ctx, async () => {
                await imports.withDeferredFilters(ctx, () => {
                    expect(service.setApplyAllFiltersOnProductUpdates.mock.calls).toEqual([[false]]);
                    return Promise.resolve();
                });
                expect(service.triggerApplyFiltersJob).not.toHaveBeenCalled();
                throw new Error('row failure');
            }),
        ).rejects.toThrow('row failure');
        expect(service.setApplyAllFiltersOnProductUpdates.mock.calls).toEqual([[false], [true]]);
        expect(service.triggerApplyFiltersJob).toHaveBeenCalledTimes(1);
    });
});
