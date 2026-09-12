import { Product, ProductVariant, StockLevel, StockMovement, type RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { rollbackState } from './catalog-import-rollback-state';
import { CatalogImportService } from './catalog-import.service';
import { CatalogImportRow } from './entities/catalog-import-row.entity';

const importedAt = new Date('2026-09-01T06:00:00.000Z');

describe('catalog import rollback safety', () => {
    it('allows rollback only when the product, SKU and dependent data still match', async () => {
        const { service, connection } = createService(
            [{ id: 'product-1', updatedAt: importedAt }],
            [{ id: 'variant-1', updatedAt: importedAt }],
        );

        const row = importedRow();
        row.appliedSnapshot = {
            ...row.appliedSnapshot,
            rollbackState: await rollbackState(connection as never, {} as never, 'variant-1'),
        };
        await expect(assertRollbackSafe(service, [row])).resolves.toBeUndefined();
    });

    it('blocks the whole rollback when a SKU was modified after the import', async () => {
        const { service } = createService(
            [{ id: 'product-1', updatedAt: importedAt }],
            [{ id: 'variant-1', updatedAt: new Date('2026-09-01T06:05:00.000Z') }],
        );

        await expect(assertRollbackSafe(service, [importedRow()])).rejects.toThrow(/已停止回滚（第 7 行）/u);
    });

    it.each(['sale', 'allocation', 'sale-and-return', 'legacy'])(
        'blocks %s without relying on SKU timestamps',
        async scenario => {
            const { service, connection, stocks, ledger } = createService(
                [{ id: 'product-1', updatedAt: importedAt }],
                [{ id: 'variant-1', updatedAt: importedAt }],
            );
            const row = importedRow();
            if (scenario !== 'legacy')
                row.appliedSnapshot = {
                    ...row.appliedSnapshot,
                    rollbackState: await rollbackState(connection as never, {} as never, 'variant-1'),
                };
            if (scenario === 'sale') stocks[0].stockOnHand -= 5;
            if (scenario === 'allocation') stocks[0].stockAllocated += 1;
            if (scenario === 'sale-and-return') {
                ledger.count = '3';
                ledger.lastId = '3';
            }
            await expect(assertRollbackSafe(service, [row])).rejects.toThrow(/已停止回滚/u);
        },
    );

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
    const stocks = [{ id: 'stock-1', stockOnHand: 120, stockAllocated: 0 }];
    const ledger = { count: '1', lastId: '1' };
    const getRepository = vi.fn((_ctx: RequestContext, entity: unknown) => {
        const query: Record<string, any> = {};
        for (const method of ['setFindOptions', 'setLock', 'where', 'orderBy', 'select', 'addSelect']) {
            query[method] = vi.fn(() => query);
        }
        query.getMany = () =>
            Promise.resolve(
                entity === Product
                    ? products
                    : entity === ProductVariant
                      ? variants
                      : entity === StockLevel
                        ? stocks
                        : [],
            );
        query.getRawOne = () => Promise.resolve(entity === StockMovement ? ledger : undefined);
        return { createQueryBuilder: () => query };
    });
    const connection = { getRepository, rawConnection: { options: { type: 'mysql' } } };
    const service = new CatalogImportService(
        connection as never,
        undefined as never,
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
    return { service, getRepository, connection, stocks, ledger };
}

function assertRollbackSafe(service: CatalogImportService, rows: CatalogImportRow[]): Promise<void> {
    const method = Reflect.get(service, 'assertRollbackSafe') as (
        this: CatalogImportService,
        ctx: RequestContext,
        rows: CatalogImportRow[],
    ) => Promise<void>;
    return method.call(service, {} as RequestContext, rows);
}
