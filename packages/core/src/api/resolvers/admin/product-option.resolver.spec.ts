import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../../../common/error/errors';
import {
    ProductOptionGroupAdminEntityResolver,
    ProductOptionGroupEntityResolver,
} from '../entity/product-option-group-entity.resolver';

import { ProductOptionResolver } from './product-option.resolver';

describe('ProductOptionResolver composite permissions', () => {
    it('does not create an option group when the caller cannot update products', async () => {
        const productOptionGroupService = { create: vi.fn() };
        const resolver = new ProductOptionResolver(productOptionGroupService as any, {} as any, {} as any);
        const ctx = { userHasPermissions: vi.fn().mockReturnValue(false) };

        await expect(
            resolver.createProductOptionGroupForProduct(
                ctx as any,
                'product-1',
                new Date('2026-08-27T10:00:00.000Z'),
                { code: 'size', translations: [] },
            ),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(productOptionGroupService.create).not.toHaveBeenCalled();
    });
});

describe('ProductOptionGroupAdminEntityResolver products', () => {
    it('scopes linked products to the current option group while preserving list options', async () => {
        const productService = {
            findAll: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
        };
        const resolver = new ProductOptionGroupAdminEntityResolver({} as any, productService as any);
        const ctx = {} as any;

        await resolver.products(ctx, { id: 42 } as any, {
            options: {
                take: 3,
                sort: { updatedAt: 'DESC' },
                filter: { name: { contains: 'shirt' } },
            },
        });

        expect(productService.findAll).toHaveBeenCalledWith(ctx, {
            take: 3,
            sort: { updatedAt: 'DESC' },
            filter: {
                name: { contains: 'shirt' },
                optionGroupId: { eq: '42' },
            },
        });
    });
});

describe('ProductOptionGroupEntityResolver child ownership', () => {
    it('filters preloaded children through the canonical scoped option reader', async () => {
        const options = [{ id: 1 }, { id: 2 }, { id: 3, deletedAt: new Date() }];
        const service = { findOne: vi.fn().mockResolvedValue({ options }) };
        const connection = {
            platformStoreGovernanceEnabled: true,
            findByIdsInChannel: vi.fn().mockResolvedValue([{ id: 1 }]),
        };
        const resolver = new ProductOptionGroupEntityResolver(service as any, {} as any, connection as any);
        const ctx = { channelId: 2 } as any;
        expect(await resolver.options(ctx, { id: 4, options } as any)).toEqual([{ id: 1 }]);
        expect(connection.findByIdsInChannel).toHaveBeenCalledWith(ctx, expect.any(Function), [1, 2], 2, {});
    });
    it('preserves the bounded authorized-product dependency path', async () => {
        const option = { id: 8 };
        const service = {
            getOptionGroupsByProductId: vi.fn().mockResolvedValue([{ id: 4, options: [option] }]),
        };
        const connection = { platformStoreGovernanceEnabled: true, findByIdsInChannel: vi.fn() };
        const resolver = new ProductOptionGroupEntityResolver(service as any, {} as any, connection as any);
        expect(await resolver.options({} as any, { id: 4, authorizedProductId: 'product-1' } as any)).toEqual(
            [option],
        );
        expect(service.getOptionGroupsByProductId).toHaveBeenCalledWith({}, 'product-1');
        expect(connection.findByIdsInChannel).not.toHaveBeenCalled();
    });
    it('retains native behavior when platform governance is disabled', async () => {
        const options = [{ id: 1 }];
        const service = { findOne: vi.fn().mockResolvedValue({ options }) };
        const connection = { platformStoreGovernanceEnabled: false, findByIdsInChannel: vi.fn() };
        const resolver = new ProductOptionGroupEntityResolver(service as any, {} as any, connection as any);
        expect(await resolver.options({} as any, { id: 4, options } as any)).toEqual(options);
        expect(connection.findByIdsInChannel).not.toHaveBeenCalled();
    });
});
