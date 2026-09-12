import {
    ProductVariant,
    RequestContextService,
    StockLevel,
    StockLevelService,
    TransactionalConnection,
    mergeConfig,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { rollbackState } from '../src/catalog-import-rollback-state';
import { CatalogImportService } from '../src/catalog-import.service';
import { CatalogManagementPlugin } from '../src/catalog-management.plugin';
import { CatalogImportJob } from '../src/entities/catalog-import-job.entity';
import { CatalogImportRow } from '../src/entities/catalog-import-row.entity';

describe('catalog rollback data integrity (AUD-001 / AUD-002)', () => {
    const { server } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [CatalogManagementPlugin],
            importExportOptions: { importAssetsDir: path.join(__dirname, '../../core/e2e/fixtures/assets') },
        }),
    );
    let connection: TransactionalConnection;
    let service: CatalogImportService;
    let ctx: any;
    let sequence = 0;
    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
            customerCount: 0,
        });
        connection = server.app.get(TransactionalConnection);
        service = server.app.get(CatalogImportService);
        ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    }, TEST_SETUP_TIMEOUT_MS);
    afterAll(async () => {
        await server.destroy();
    });
    async function fixture(count = 1) {
        const variants = await connection
            .getRepository(ctx, ProductVariant)
            .find({ take: count, order: { id: 'ASC' }, relations: ['productVariantPrices'] });
        const stock = await connection
            .getRepository(ctx, StockLevel)
            .findOneByOrFail({ productVariantId: variants[0].id });
        const job = await connection.getRepository(ctx, CatalogImportJob).save(
            new CatalogImportJob({
                channelId: ctx.channelId,
                stockLocationId: stock.stockLocationId,
                currencyCode: ctx.currencyCode,
                originalFilename: 'synthetic.csv',
                mimeType: 'text/csv',
                byteSize: 1,
                fileHash: `repair-${++sequence}`,
                state: 'COMPLETED',
                totalRows: count,
            }),
        );
        for (let i = 0; i < variants.length; i++) {
            const variant = variants[i];
            await connection
                .getRepository(ctx, StockLevel)
                .update(
                    { productVariantId: variant.id, stockLocationId: stock.stockLocationId },
                    { stockOnHand: 100, stockAllocated: 0 },
                );
            const before = await (service as any).snapshotVariant(ctx, variant, job);
            await server.app
                .get(StockLevelService)
                .updateStockOnHandForLocation(ctx, variant.id, stock.stockLocationId, 20);
            const after = await (service as any).snapshotVariant(ctx, variant, job);
            await connection.getRepository(ctx, CatalogImportRow).save(
                new CatalogImportRow({
                    jobId: job.id,
                    rowNumber: i + 1,
                    productKey: String(variant.productId),
                    sourceKey: `repair-${sequence}-${i}`,
                    rowFingerprint: 'synthetic',
                    action: 'UPDATE',
                    targetProductId: variant.productId,
                    targetVariantId: variant.id,
                    normalizedData: {} as any,
                    beforeSnapshot: before,
                    appliedSnapshot: {
                        stockLocationId: String(stock.stockLocationId),
                        afterSnapshot: after,
                        rollbackState: await rollbackState(connection, ctx, variant.id),
                    },
                    appliedAt: new Date(),
                }),
            );
        }
        return { job, variants, stockLocationId: stock.stockLocationId };
    }
    const stocks = async (ids: any[]) =>
        Promise.all(
            ids.map(
                async id =>
                    (
                        await connection
                            .getRepository(ctx, StockLevel)
                            .findOneByOrFail({ productVariantId: id })
                    ).stockOnHand,
            ),
        );
    it('rejects a sale made after import while preserving the resulting 115 units', async () => {
        const f = await fixture();
        await server.app
            .get(StockLevelService)
            .updateStockOnHandForLocation(ctx, f.variants[0].id, f.stockLocationId, -5);
        await expect(service.rollback(ctx, f.job.id)).rejects.toThrow(/已停止回滚/u);
        expect(await stocks(f.variants.map(v => v.id))).toEqual([115]);
    });
    it('rolls back every row and the job state when the second compensation fails, then supports retry', async () => {
        const f = await fixture(2);
        const original = (service as any).rollbackRow.bind(service);
        let calls = 0;
        const spy = vi
            .spyOn(service as unknown as { rollbackRow: (...args: any[]) => Promise<void> }, 'rollbackRow')
            .mockImplementation(async (...args: any[]) => {
                if (++calls === 2) throw new Error('injected second row failure');
                return await original(...args);
            });
        await expect(service.rollback(ctx, f.job.id)).rejects.toThrow('injected second row failure');
        spy.mockRestore();
        expect(await stocks(f.variants.map(v => v.id))).toEqual([120, 120]);
        expect((await service.findJob(ctx, f.job.id)).state).toBe('COMPLETED');
        await service.rollback(ctx, f.job.id);
        expect(await stocks(f.variants.map(v => v.id))).toEqual([100, 100]);
        expect((await service.findJob(ctx, f.job.id)).state).toBe('ROLLED_BACK');
    });
    it('serializes duplicate rollback requests without double compensation', async () => {
        const f = await fixture();
        const spy = vi.spyOn(
            service as unknown as { rollbackRow: (...args: any[]) => Promise<void> },
            'rollbackRow',
        );
        await Promise.all([service.rollback(ctx, f.job.id), service.rollback(ctx, f.job.id)]);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        expect(await stocks(f.variants.map(v => v.id))).toEqual([100]);
    });
    it('holds stock locks between checking the snapshot and restoring stock', async () => {
        const f = await fixture();
        let checked!: () => void;
        let release!: () => void;
        const checkedPromise = new Promise<void>(r => (checked = r));
        const gate = new Promise<void>(r => (release = r));
        const original = (service as any).assertRollbackSafe.bind(service);
        const spy = vi
            .spyOn(
                service as unknown as { assertRollbackSafe: (...args: any[]) => Promise<void> },
                'assertRollbackSafe',
            )
            .mockImplementation(async (...args: any[]) => {
                await original(...args);
                checked();
                await gate;
            });
        const rollback = service.rollback(ctx, f.job.id);
        await checkedPromise;
        const sale = server.app
            .get(StockLevelService)
            .updateStockOnHandForLocation(ctx, f.variants[0].id, f.stockLocationId, -5);
        await new Promise(r => setTimeout(r, 100));
        release();
        await Promise.all([rollback, sale]);
        spy.mockRestore();
        expect(await stocks(f.variants.map(v => v.id))).toEqual([95]);
    });
});
