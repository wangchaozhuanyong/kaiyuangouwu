import type { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogImportQueueService } from './catalog-import-queue.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';

describe('catalog import execution progress', () => {
    it('persists progress once per percentage and commits cache entries only after a successful transaction', async () => {
        const rows = Array.from({ length: 4074 }, (_, index) => ({
            id: index,
            rowNumber: index + 2,
            productKey: 'same-product',
            sourceKey: `source-${index}`,
            action: 'CREATE',
            appliedAt: null,
            appliedSnapshot: null,
            targetProductId: null,
            targetVariantId: null,
            normalizedData: { sku: `sku-${index}` },
        })) as unknown as CatalogImportRow[];
        const jobRepository = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
        const rowRepository = {
            save: vi.fn().mockResolvedValue(undefined),
            count: vi.fn().mockResolvedValue(1),
        };
        let first = true;
        const connection = {
            getRepository: (_ctx: RequestContext, entity: unknown) =>
                entity === CatalogImportJob ? jobRepository : rowRepository,
            withTransaction: async (ctx: RequestContext, work: (ctx: RequestContext) => Promise<void>) => {
                await work(ctx);
                if (first) {
                    first = false;
                    throw new Error('commit failed');
                }
            },
        };
        const categories = {
            withDeferredFilters: async (_ctx: RequestContext, work: () => Promise<void>) => {
                await work();
                expect(
                    jobRepository.update.mock.calls.some(
                        ([, patch]) => patch.state === 'COMPLETED_WITH_ERRORS',
                    ),
                ).toBe(false);
            },
        };
        const service = new CatalogImportService(
            connection as never,
            undefined as never,
            { stockLocations: () => Promise.resolve([]) } as never,
            undefined as never,
            undefined as never,
            undefined as never,
            categories as never,
            undefined as never,
            undefined as never,
            { reindex: () => Promise.resolve() } as never,
            undefined as never,
        );
        vi.spyOn(service, 'findJob').mockResolvedValue({ id: 'job' } as CatalogImportJob);
        vi.spyOn(service, 'findRows').mockResolvedValue(rows);
        Reflect.set(service, 'refreshCounts', () => Promise.resolve());
        Reflect.set(
            service,
            'applyRow',
            (
                _ctx: RequestContext,
                _job: CatalogImportJob,
                row: CatalogImportRow,
                productByKey: Map<string, string>,
            ) => {
                if (row.rowNumber === 3) expect(productByKey.has('same-product')).toBe(false);
                row.targetProductId = 'product';
                row.targetVariantId = `variant-${row.id}`;
                row.appliedAt = new Date();
                row.appliedSnapshot = { productId: 'product' };
                return Promise.resolve();
            },
        );
        const progress = vi.fn();
        await service.executeJob({} as RequestContext, 'job', progress);
        expect(progress).toHaveBeenCalledTimes(101);
        expect(new Set(progress.mock.calls.map(([value]) => value)).size).toBe(101);
        expect(progress).toHaveBeenLastCalledWith(100);
        expect(rows[0]).toMatchObject({
            action: 'ERROR',
            targetProductId: null,
            targetVariantId: null,
            appliedAt: null,
            appliedSnapshot: null,
            message: 'commit failed',
        });
        expect(rowRepository.save).toHaveBeenCalledTimes(1);
        expect(jobRepository.update).toHaveBeenLastCalledWith(
            'job',
            expect.objectContaining({
                state: 'COMPLETED_WITH_ERRORS',
                progress: 100,
            }),
        );
    });
    it('marks infrastructure failures retryable instead of leaving an import running forever', async () => {
        const repository = {
            findOne: vi.fn().mockResolvedValue({ id: 'job', state: 'QUEUED', channel: {} }),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
        };
        const queue = new CatalogImportQueueService(
            { rawConnection: { getRepository: () => repository } } as never,
            { create: vi.fn().mockResolvedValue({}) } as never,
            undefined as never,
            { executeJob: vi.fn().mockRejectedValue(new Error('category queue unavailable')) } as never,
        );
        await expect(
            Reflect.get(queue, 'process').call(queue, { data: { importJobId: 'job' } }),
        ).rejects.toThrow('category queue unavailable');
        expect(repository.update).toHaveBeenCalledWith(
            { id: 'job', state: 'RUNNING' },
            {
                state: 'FAILED',
                errorMessage: 'category queue unavailable',
            },
        );
    });
});
