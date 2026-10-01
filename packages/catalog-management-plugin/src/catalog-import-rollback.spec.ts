import { Product, ProductVariant, RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogImportRollback } from './catalog-import-rollback';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';

describe('catalog import rollback', () => {
    it('uses an auditable idempotent stock adjustment when disabling an imported variant', async () => {
        const ctx = {} as RequestContext;
        const variantRepository = {
            findOne: vi.fn().mockResolvedValue({ id: 'variant-23' }),
        };
        const productRepository = {
            findOne: vi.fn().mockResolvedValue(null),
        };
        const otherRepository = {
            delete: vi.fn().mockResolvedValue(undefined),
            save: vi.fn().mockResolvedValue(undefined),
        };
        const connection = {
            getRepository: vi.fn((_ctx: RequestContext, entity: unknown) =>
                entity === ProductVariant
                    ? variantRepository
                    : entity === Product
                      ? productRepository
                      : otherRepository,
            ),
        };
        const operations = { updateVariant: vi.fn().mockResolvedValue(undefined) };
        const productVariantService = { update: vi.fn().mockResolvedValue(undefined) };
        const suppliers = { setVariantSupplier: vi.fn().mockResolvedValue(undefined) };
        const productService = { update: vi.fn().mockResolvedValue(undefined) };
        const rollback = new CatalogImportRollback(
            connection as never,
            operations as never,
            productVariantService as never,
            suppliers as never,
            productService as never,
            { moveImportedCategory: vi.fn().mockResolvedValue(undefined) } as never,
        );
        const job = {
            id: '17',
            stockLocationId: '4',
            currencyCode: 'CNY',
        } as unknown as CatalogImportJob;
        const row = {
            id: '23',
            rowNumber: 2,
            targetVariantId: 'variant-23',
            targetProductId: 'product-17',
            beforeSnapshot: { productCreated: true, variantCreated: true, stockOnHand: 0 },
            appliedSnapshot: { stockLocationId: '4' },
        } as unknown as CatalogImportRow;

        await rollback.rollbackRow(ctx, job, row);

        expect(operations.updateVariant).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                productVariantId: 'variant-23',
                stockOnHand: 0,
                stockAdjustmentReason: '回滚商品导入任务 17 第 2 行',
                stockAdjustmentIdempotencyKey: 'catalog-import-rollback:17:23',
            }),
            true,
        );
        expect(productVariantService.update).toHaveBeenCalledWith(ctx, [
            { id: 'variant-23', enabled: false },
        ]);
    });
});
