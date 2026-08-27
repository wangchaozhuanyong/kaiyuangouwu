import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../../../common/error/errors';

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
