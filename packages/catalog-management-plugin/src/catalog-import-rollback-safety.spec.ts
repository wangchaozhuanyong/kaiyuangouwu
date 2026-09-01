import { Product, ProductVariant, type RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogImportService } from './catalog-import.service';
import { CatalogImportRow } from './entities/catalog-import-row.entity';

const importedAt = new Date('2026-09-01T06:00:00.000Z');

describe('catalog import rollback safety', () => {
    it('allows rollback while the imported product and SKU timestamps still match', async () => {
        const { service } = createService(
            [{ id: 'product-1', updatedAt: importedAt }],
            [{ id: 'variant-1', updatedAt: importedAt }],
        );

        await expect(assertRollbackSafe(service, [importedRow()])).resolves.toBeUndefined();
    });

    it('blocks the whole rollback when a SKU was modified after the import', async () => {
        const { service } = createService(
            [{ id: 'product-1', updatedAt: importedAt }],
            [{ id: 'variant-1', updatedAt: new Date('2026-09-01T06:05:00.000Z') }],
        );

        await expect(assertRollbackSafe(service, [importedRow()])).rejects.toThrow(/已停止回滚（第 7 行）/u);
    });

    it('does not query product tables when there are no applied rows', async () => {
        const { service, getRepository } = createService([], []);

        await expect(assertRollbackSafe(service, [])).resolves.toBeUndefined();
        expect(getRepository).not.toHaveBeenCalled();
    });
});

function importedRow(): CatalogImportRow {
    return new CatalogImportRow({
        rowNumber: 7,
        targetProductId: 'product-1',
        targetVariantId: 'variant-1',
        appliedAt: importedAt,
        appliedSnapshot: {
            afterSnapshot: {
                productUpdatedAt: importedAt.toISOString(),
                variantUpdatedAt: importedAt.toISOString(),
            },
        },
    });
}

function createService(
    products: Array<{ id: string; updatedAt: Date }>,
    variants: Array<{ id: string; updatedAt: Date }>,
) {
    const getRepository = vi.fn((_ctx: RequestContext, entity: unknown) => {
        if (entity === Product) return { find: vi.fn().mockResolvedValue(products) };
        if (entity === ProductVariant) {
            return { find: vi.fn().mockResolvedValue(variants) };
        }
        throw new Error('Unexpected repository');
    });
    const service = new CatalogImportService(
        { getRepository } as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
    );
    return { service, getRepository };
}

function assertRollbackSafe(service: CatalogImportService, rows: CatalogImportRow[]): Promise<void> {
    const method = Reflect.get(service, 'assertRollbackSafe') as (
        this: CatalogImportService,
        ctx: RequestContext,
        rows: CatalogImportRow[],
    ) => Promise<void>;
    return method.call(service, {} as RequestContext, rows);
}
