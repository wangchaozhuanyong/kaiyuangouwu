import { afterEach, describe, expect, it, vi } from 'vitest';

import { CatalogImportLease, CatalogImportLeaseLostError } from './catalog-import-lease';
import { createImportLeaseFixture } from './catalog-import-lease.fixture';
import { CatalogImportQueueService } from './catalog-import-queue.service';

type Fixture = Awaited<ReturnType<typeof createImportLeaseFixture>>;
let f: Fixture | undefined;
afterEach(async () => {
    await f?.db.destroy();
    f = undefined;
});
describe('catalog import execution lease', () => {
    it('claims once and rejects stale writes after an expired attempt is replaced', async () => {
        f = await createImportLeaseFixture();
        const lease = new CatalogImportLease(f.connection);
        const job = await f.createJob();
        const first = await lease.claim(f.ctx, job.id);
        expect(first).toBeTruthy();
        if (!first) throw new Error('Expected the first execution lease');
        expect(await lease.claim(f.ctx, job.id)).toBeNull();
        expect(await lease.recoverExpired(f.ctx, job.id)).toBe(false);
        await f.jobRepository.update(job.id, { leaseUntil: new Date(0) });
        expect(await lease.recoverExpired(f.ctx, job.id)).toBe(true);
        const second = await lease.claim(f.ctx, job.id);
        expect(second).not.toBe(first);
        let wrote = false;
        await expect(
            lease.owned(f.ctx, job.id, first, () => {
                wrote = true;
                return Promise.resolve();
            }),
        ).rejects.toBeInstanceOf(CatalogImportLeaseLostError);
        expect(wrote).toBe(false);
        expect((await f.jobRepository.findOneByOrFail({ id: job.id })).executionToken).toBe(second);
    });
    it('never treats a legacy running task with null lease ownership as expired', async () => {
        f = await createImportLeaseFixture();
        const job = await f.createJob({ state: 'RUNNING', executionToken: null, leaseUntil: null });
        expect(await new CatalogImportLease(f.connection).recoverExpired(f.ctx, job.id)).toBe(false);
        expect((await f.jobRepository.findOneByOrFail({ id: job.id })).state).toBe('RUNNING');
    });
    it.each([0, 99, 100, 101, 205])(
        'scans %i queued rows once even though dispatch leaves their state queued',
        async count => {
            f = await createImportLeaseFixture();
            const context = f.ctx;
            for (let i = 0; i < count; i++) await f.createJob();
            const dispatch = vi.fn().mockResolvedValue(undefined);
            const strategy = {
                findOne: vi.fn(),
                findManyById: vi.fn(),
                removeSettledJobs: vi.fn(),
                findMany: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
            };
            const queue = new CatalogImportQueueService(
                f.connection,
                { create: () => Promise.resolve(context) } as never,
                undefined as never,
                undefined as never,
                { isWorker: true } as never,
                { jobQueueOptions: { jobQueueStrategy: strategy } } as never,
            );
            vi.spyOn(queue, 'dispatch').mockImplementation(dispatch);
            const result = await queue.recoverInterruptedJobs();
            expect(result.scanned).toBe(count);
            expect(dispatch).toHaveBeenCalledTimes(count);
            expect(new Set(dispatch.mock.calls.map(([id]) => String(id))).size).toBe(count);
            expect(await f.jobRepository.countBy({ state: 'QUEUED' })).toBe(count);
        },
    );
    it('leaves API startup recovery read-only and preserves active pending messages', async () => {
        f = await createImportLeaseFixture();
        const fixture = f;
        const job = await f.createJob();
        const strategy = {
            findOne: vi.fn(),
            findManyById: vi.fn(),
            removeSettledJobs: vi.fn(),
            findMany: vi
                .fn()
                .mockResolvedValue({ items: [{ data: { importJobId: String(job.id) } }], totalItems: 1 }),
        };
        const makeQueue = (isWorker: boolean) =>
            new CatalogImportQueueService(
                fixture.connection,
                { create: () => Promise.resolve(fixture.ctx) } as never,
                undefined as never,
                undefined as never,
                { isWorker } as never,
                { jobQueueOptions: { jobQueueStrategy: strategy } } as never,
            );
        const api = makeQueue(false);
        expect((await api.recoverInterruptedJobs()).scanned).toBe(0);
        expect(strategy.findMany).not.toHaveBeenCalled();
        const worker = makeQueue(true);
        const dispatch = vi.spyOn(worker, 'dispatch').mockResolvedValue(undefined);
        expect((await worker.recoverInterruptedJobs()).pending).toBe(1);
        expect(dispatch).not.toHaveBeenCalled();
    });
    it('recovers mixed expired tasks, keeps healthy/legacy owners and continues after a dispatch failure', async () => {
        f = await createImportLeaseFixture();
        const context = f.ctx;
        const lease = new CatalogImportLease(f.connection);
        const healthy = await f.createJob();
        await lease.claim(f.ctx, healthy.id);
        const expired = await f.createJob();
        await lease.claim(f.ctx, expired.id);
        await f.jobRepository.update(expired.id, { leaseUntil: new Date(0) });
        const legacy = await f.createJob({ state: 'RUNNING' });
        const queued = await f.createJob();
        const strategy = {
            findOne: vi.fn(),
            findManyById: vi.fn(),
            removeSettledJobs: vi.fn(),
            findMany: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
        };
        const queue = new CatalogImportQueueService(
            f.connection,
            { create: () => Promise.resolve(context) } as never,
            undefined as never,
            undefined as never,
            { isWorker: true } as never,
            { jobQueueOptions: { jobQueueStrategy: strategy } } as never,
        );
        const dispatch = vi
            .spyOn(queue, 'dispatch')
            .mockRejectedValueOnce(new Error('synthetic queue unavailable'))
            .mockResolvedValue(undefined);
        const result = await queue.recoverInterruptedJobs();
        expect(result).toMatchObject({ scanned: 4, recovered: 1, legacy: 1, enqueued: 1, failed: 1 });
        expect(dispatch).toHaveBeenCalledTimes(2);
        expect((await f.jobRepository.findOneByOrFail({ id: healthy.id })).state).toBe('RUNNING');
        expect((await f.jobRepository.findOneByOrFail({ id: legacy.id })).state).toBe('RUNNING');
        expect((await f.jobRepository.findOneByOrFail({ id: queued.id })).state).toBe('QUEUED');
    });
});
