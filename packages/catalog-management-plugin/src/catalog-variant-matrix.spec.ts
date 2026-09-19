import {
    ProductOptionGroupService,
    ProductService,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogVariantMatrixService } from './catalog-variant-matrix.service';

function setup() {
    const txCtx = { channelId: 1 } as unknown as RequestContext;
    const connection = {
        withTransaction: vi.fn((_ctx, work) => work(txCtx)),
    };
    const product = {
        id: 10,
        updatedAt: new Date('2026-09-19T00:00:00Z'),
        variants: [{ id: 20 }],
        optionGroups: [{ id: 30 }],
    };
    const products = {
        findOne: vi.fn().mockResolvedValue(product),
        addOptionGroupToProduct: vi.fn().mockResolvedValue(product),
        removeOptionGroupsFromProduct: vi.fn().mockResolvedValue(product),
    };
    const variants = {
        update: vi.fn().mockResolvedValue([{ id: 20 }]),
        create: vi.fn().mockResolvedValue([{ id: 21 }]),
    };
    const optionGroups = {
        getOptionGroupsByProductId: vi.fn().mockResolvedValue([{ id: 30 }]),
    };
    return {
        ctx: {} as RequestContext,
        txCtx,
        connection,
        products,
        variants,
        service: new CatalogVariantMatrixService(
            connection as unknown as TransactionalConnection,
            products as unknown as ProductService,
            variants as unknown as ProductVariantService,
            optionGroups as unknown as ProductOptionGroupService,
        ),
    };
}

describe('CatalogVariantMatrixService', () => {
    it('applies group and variant changes in one transaction context', async () => {
        const { service, ctx, txCtx, connection, products, variants } = setup();
        await service.apply(ctx, {
            productId: 10,
            targetOptionGroupIds: [30, 31],
            updateVariants: [{ id: 20, optionIds: [40, 50] }],
            createVariants: [{ productId: 10, sku: 'NEW', optionIds: [41, 50], translations: [] }],
        });

        expect(connection.withTransaction).toHaveBeenCalledWith(ctx, expect.any(Function));
        expect(products.addOptionGroupToProduct).toHaveBeenCalledWith(txCtx, 10, 31);
        expect(variants.update).toHaveBeenCalledWith(txCtx, [{ id: 20, optionIds: [40, 50] }]);
        expect(variants.create).toHaveBeenCalledWith(txCtx, [
            { productId: 10, sku: 'NEW', optionIds: [41, 50], translations: [] },
        ]);
    });

    it('rejects a variant from another product before writing', async () => {
        const { service, ctx, products, variants } = setup();
        await expect(
            service.apply(ctx, {
                productId: 10,
                targetOptionGroupIds: [30],
                updateVariants: [{ id: 999, optionIds: [40] }],
                createVariants: [],
            }),
        ).rejects.toThrow('不属于当前商品');
        expect(products.addOptionGroupToProduct).not.toHaveBeenCalled();
        expect(variants.update).not.toHaveBeenCalled();
    });
});
