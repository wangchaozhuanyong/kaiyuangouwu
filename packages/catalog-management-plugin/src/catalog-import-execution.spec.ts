import type { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CATALOG_IMPORT_HEARTBEAT_MS, CatalogImportLeaseLostError } from './catalog-import-lease';
import { CatalogImportQueueService } from './catalog-import-queue.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';

describe('catalog import execution progress', () => {
    it.each(
        ['before-row', 'before-completion'].flatMap(phase =>
            ['error', 'lease-lost', 'unknown'].map(kind => ({ phase, kind })),
        ),
    )('preserves $kind heartbeat failure $phase', async ({ phase, kind }) => {
        vi.useFakeTimers();
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        let entered!: () => void;
        const ready = new Promise<void>(resolve => {
            entered = resolve;
        });
        const pause = () => {
            entered();
            return gate;
        };
        const originalCause = { synthetic: 'original-cause' };
        const failure =
            kind === 'error'
                ? Object.assign(new Error('synthetic heartbeat failure'), { cause: originalCause })
                : kind === 'lease-lost'
                  ? new CatalogImportLeaseLostError()
                  : { synthetic: 'unknown-heartbeat-failure' };
        const context = {
            activeUserId: 'actor',
            userHasPermissions: () => true,
        } as unknown as RequestContext;
        const jobRepository = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
        const categories = {
            withDeferredFilters: async (_ctx: RequestContext, work: () => Promise<void>) => {
                await work();
                if (phase === 'before-completion') await pause();
            },
        };
        const service = new CatalogImportService(
            { getRepository: () => jobRepository } as never,
            undefined as never,
            { stockLocations: () => Promise.resolve([]) } as never,
            undefined as never,
            undefined as never,
            undefined as never,
            categories as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
        );
        const owned = vi
            .fn()
            .mockRejectedValueOnce(failure)
            .mockImplementation(
                (
                    _ctx: RequestContext,
                    _id: unknown,
                    _token: string,
                    work: (ctx: RequestContext) => Promise<unknown>,
                ) => work(context),
            );
        Reflect.set(service, 'executionLease', {
            claim: vi.fn().mockResolvedValue('owned-attempt'),
            owned,
        });
        vi.spyOn(service, 'findRows').mockResolvedValue(
            phase === 'before-row'
                ? [{ action: 'CREATE', productKey: 'synthetic', sourceKey: 'synthetic' } as CatalogImportRow]
                : [],
        );
        try {
            const execution = service
                .executeJob(context, 'job', () => (phase === 'before-row' ? pause() : Promise.resolve()))
                .catch((caught: unknown) => caught);
            await ready;
            await vi.advanceTimersByTimeAsync(CATALOG_IMPORT_HEARTBEAT_MS);
            expect(owned).toHaveBeenCalledOnce();
            release();
            const error = await execution;
            expect(error).toBeInstanceOf(Error);
            if (!(error instanceof Error)) throw new Error('Expected an error heartbeat result');
            if (failure instanceof Error) {
                expect(error).toBe(failure);
                if (kind === 'error') expect(Reflect.get(error, 'cause')).toBe(originalCause);
            } else {
                expect(error.message).toBe('[object Object]');
                expect(Reflect.get(error, 'cause')).toBe(failure);
            }
            if (kind === 'lease-lost') {
                expect(jobRepository.update).not.toHaveBeenCalled();
            } else {
                expect(jobRepository.update).toHaveBeenCalledWith(
                    { id: 'job', state: 'RUNNING', executionToken: 'owned-attempt' },
                    expect.objectContaining({ state: 'FAILED', errorMessage: error.message }),
                );
            }
        } finally {
            release();
            vi.useRealTimers();
        }
    });

    it('marks preview preparation failures and saves a readable error on the job', async () => {
        const job = {
            id: 'job',
            state: 'RECEIVING',
            totalRows: 1,
            channelId: 'channel',
            stockLocationId: 'location',
            currencyCode: 'MYR',
            clearBlankFields: false,
        } as CatalogImportJob;
        const rowRepository = {
            find: vi
                .fn()
                .mockResolvedValue([
                    { sourceKey: 'source-1', normalizedData: { supplier: '' } } as CatalogImportRow,
                ]),
        };
        const jobRepository = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
        const connection = {
            getRepository: (_ctx: RequestContext, entity: unknown) => {
                if (entity === CatalogImportRow) return rowRepository;
                if (entity === CatalogImportJob) return jobRepository;
                return { find: vi.fn().mockResolvedValue([]) };
            },
        };
        const service = new CatalogImportService(
            connection as never,
            undefined as never,
            { stockLocations: vi.fn().mockResolvedValue([]) } as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            { findByNames: vi.fn().mockResolvedValue(new Map()) } as never,
        );
        vi.spyOn(service, 'findJob').mockResolvedValue(job);
        Reflect.set(service, 'buildCatalogIndex', vi.fn().mockRejectedValue(new Error('asset query failed')));

        await expect(
            service.finalizePreview({ channelId: 'channel' } as RequestContext, 'job'),
        ).rejects.toThrow('asset query failed');
        expect(jobRepository.update).toHaveBeenCalledWith(
            'job',
            expect.objectContaining({
                state: 'FAILED',
                errorMessage: 'asset query failed',
                completedAt: expect.any(Date),
            }),
        );
    });

    it('notifies once per percentage and commits cache entries only after a successful transaction', async () => {
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
            findOneByOrFail: vi.fn(({ id }: { id: number }) => Promise.resolve({ ...rows[id] })),
            find: vi.fn(() => Promise.resolve(rows)),
            save: vi.fn((row: CatalogImportRow) => {
                Object.assign(rows[Number(row.id)], row);
                return Promise.resolve(row);
            }),
        };
        let first = true;
        const connection = {
            getRepository: (_ctx: RequestContext, entity: unknown) =>
                entity === CatalogImportJob ? jobRepository : rowRepository,
            withTransaction: async <T>(ctx: RequestContext, work: (ctx: RequestContext) => Promise<T>) => {
                const result = await work(ctx);
                if (first) {
                    first = false;
                    throw new Error('commit failed');
                }
                return result;
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
        Reflect.set(service, 'executionLease', {
            claim: vi.fn().mockResolvedValue('owned-attempt'),
            owned: (
                ctx: RequestContext,
                _id: string,
                _token: string,
                work: (ctx: RequestContext, job: CatalogImportJob) => Promise<unknown>,
            ) => connection.withTransaction(ctx, () => work(ctx, { id: 'job' } as CatalogImportJob)),
        });
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
        await service.executeJob(
            { activeUserId: 'actor', userHasPermissions: () => true } as unknown as RequestContext,
            'job',
            progress,
        );
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
            { id: 'job', state: 'RUNNING', executionToken: 'owned-attempt' },
            expect.objectContaining({
                state: 'COMPLETED_WITH_ERRORS',
                progress: 100,
            }),
        );
    });
    it('does not let a queue failure overwrite a different execution owner', async () => {
        const repository = {
            findOne: vi.fn().mockResolvedValue({ id: 'job', actorId: 'actor', state: 'QUEUED', channel: {} }),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
        };
        const queue = new CatalogImportQueueService(
            { rawConnection: { getRepository: () => repository } } as never,
            { create: vi.fn().mockResolvedValue({ userHasPermissions: () => true }) } as never,
            undefined as never,
            { executeJob: vi.fn().mockRejectedValue(new Error('category queue unavailable')) } as never,
        );
        await expect(
            Reflect.get(queue, 'process').call(queue, { data: { importJobId: 'job' } }),
        ).rejects.toThrow('category queue unavailable');
        expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects direct execution and enqueue before any database access without import permission', async () => {
        const connection = { getRepository: vi.fn() };
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
        const ctx = { activeUserId: 'actor', userHasPermissions: () => false } as unknown as RequestContext;
        await expect(service.executeJob(ctx, 'job', vi.fn())).rejects.toThrow('没有此门店的导入执行权限');
        await expect(service.queueExecution(ctx, 'job')).rejects.toThrow('没有此门店的导入执行权限');
        expect(connection.getRepository).not.toHaveBeenCalled();
    });

    it('records the administrator authorizing a retry before dispatching it', async () => {
        const job = { id: 'job', state: 'FAILED', actorId: 'revoked-actor', version: 7 } as CatalogImportJob;
        const saved = vi.fn((_criteria, patch) => {
            Object.assign(job, patch);
            return Promise.resolve({ affected: 1 });
        });
        const connection = { getRepository: () => ({ count: () => Promise.resolve(0), update: saved }) };
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
        vi.spyOn(service, 'findJob').mockResolvedValue(job);
        const dispatch = vi.fn().mockImplementation(() => {
            expect(saved).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'job', state: 'FAILED', version: 7 }),
                expect.objectContaining({
                    actorId: 'authorized-retry-actor',
                    state: 'QUEUED',
                    executionToken: null,
                    leaseUntil: null,
                }),
            );
            expect(job.actorId).toBe('authorized-retry-actor');
            return Promise.resolve();
        });
        service.registerEnqueuer(dispatch);
        const ctx = {
            activeUserId: 'authorized-retry-actor',
            userHasPermissions: () => true,
        } as unknown as RequestContext;
        await service.queueExecution(ctx, 'job');
        expect(dispatch).toHaveBeenCalledWith('job');
    });
});
