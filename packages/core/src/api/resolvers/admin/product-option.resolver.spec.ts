import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../../../common/error/errors';
import { ProductOptionGroupAdminEntityResolver } from '../entity/product-option-group-entity.resolver';

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
