import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { ProductOptionGroup } from '../../entity/product-option-group/product-option-group.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { Product } from '../../entity/product/product.entity';

import { ProductService } from './product.service';

function createHarness(updatedAt = new Date('2026-08-27T10:00:00.000Z')) {
    const product = new Product({
        id: 'product-1',
        updatedAt,
        optionGroups: [new ProductOptionGroup({ id: 'group-1' }), new ProductOptionGroup({ id: 'group-2' })],
        variants: [],
    });
    const lockQueryBuilder = {
        innerJoin: vi.fn().mockReturnThis(),
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(product),
    };
    const productRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(lockQueryBuilder),
        save: vi.fn().mockResolvedValue(product),
    };
    const variantRepository = { save: vi.fn() };
    const connection = {
        getEntityOrThrow: vi.fn().mockResolvedValue(product),
        getRepository: vi.fn((_ctx, entity) =>
            entity === ProductVariant ? variantRepository : productRepository,
        ),
    };
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const service = new ProductService(
        connection as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        eventBus as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
    vi.spyOn(service, 'findOne').mockResolvedValue(product as any);
    return { service, product, productRepository, variantRepository, lockQueryBuilder, eventBus };
}

describe('ProductService optimistic composite changes', () => {
    it('removes multiple option groups after one locked version check', async () => {
        const harness = createHarness();

        await expect(
            harness.service.removeOptionGroupsFromProduct(
                {} as any,
                'product-1',
                ['group-1', 'group-2'],
                harness.product.updatedAt.toISOString(),
            ),
        ).resolves.toMatchObject({ id: 'product-1' });

        expect(harness.lockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(harness.product.optionGroups).toEqual([]);
        expect(harness.productRepository.save).toHaveBeenCalledOnce();
        expect(harness.variantRepository.save).not.toHaveBeenCalled();
        expect(harness.eventBus.publish).toHaveBeenCalledTimes(2);
    });

    it('rejects a stale composite change before writing', async () => {
        const harness = createHarness();

        await expect(
            harness.service.removeOptionGroupsFromProduct(
                {} as any,
                'product-1',
                ['group-1'],
                '2026-08-27T09:59:59.000Z',
            ),
        ).rejects.toThrow(/CONCURRENT_MODIFICATION/);
        expect(harness.productRepository.save).not.toHaveBeenCalled();
        expect(harness.eventBus.publish).not.toHaveBeenCalled();
    });
});

describe('ProductService category filtering', () => {
    it('maps collectionId filters through variant collection membership', async () => {
        const query = { getManyAndCount: vi.fn().mockResolvedValue([[], 0]) };
        const listQueryBuilder = {
            filterObjectHasProperty: vi.fn((_filter, property) => property === 'collectionId'),
            build: vi.fn().mockReturnValue(query),
        };
        const service = new ProductService(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            listQueryBuilder as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { translate: vi.fn() } as any,
            {} as any,
        );

        await service.findAll(
            { channelId: 'channel-1' } as any,
            { filter: { collectionId: { eq: 'collection-1' } } } as any,
        );

        expect(listQueryBuilder.build).toHaveBeenCalledWith(
            Product,
            expect.anything(),
            expect.objectContaining({
                relations: expect.arrayContaining(['variants', 'variants.collections']),
                customPropertyMap: expect.objectContaining({
                    collectionId: 'variants.collections.id',
                }),
            }),
        );
    });
});
