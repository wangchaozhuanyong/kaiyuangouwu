import { JobQueueService, ProcessContext, RequestContextService, SettingsStoreService } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_WORKER_HEARTBEAT_KEY, SystemWorkerHealthService } from './system-worker-health.service';

function fixture(isWorker = true) {
    let record: any;
    const settings = {
        get: vi.fn(() => Promise.resolve(record)),
        set: vi.fn((_ctx: unknown, key: string, value: unknown) => {
            expect(key).toBe(SYSTEM_WORKER_HEARTBEAT_KEY);
            record = value;
            return Promise.resolve({ key, result: true });
        }),
    };
    const jobs = { getJobQueues: vi.fn(() => [{ name: 'mail', running: true }]) };
    const service = new SystemWorkerHealthService(
        { isWorker } as ProcessContext,
        jobs as unknown as JobQueueService,
        { create: () => Promise.resolve({}) } as unknown as RequestContextService,
        settings as unknown as SettingsStoreService,
    );
    return {
        service,
        settings,
        jobs,
        read: () => record,
        replace: (value: unknown) => {
            record = value;
        },
    };
}
afterEach(() => vi.useRealTimers());

describe('independent worker heartbeat', () => {
    it('never replaces worker status from an API process', async () => {
        const x = fixture(false);
        await x.service.onApplicationBootstrap();
        await x.service.onApplicationShutdown();
        expect(x.settings.set).not.toHaveBeenCalled();
    });
    it('publishes actual queue state and refreshes it periodically', async () => {
        vi.useFakeTimers();
        const x = fixture();
        await x.service.onApplicationBootstrap();
        expect(x.read()).toMatchObject({ state: 'RUNNING', queues: [{ name: 'mail', running: true }] });
        const first = x.read().heartbeatAt;
        x.jobs.getJobQueues.mockReturnValue([{ name: 'mail', running: false }]);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(x.read().heartbeatAt).not.toBe(first);
        expect(x.read().queues[0].running).toBe(false);
        await x.service.onApplicationShutdown();
        expect(x.read().state).toBe('STOPPED');
        const calls = x.settings.set.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(x.settings.set).toHaveBeenCalledTimes(calls);
    });
    it('does not overwrite a replacement worker during shutdown', async () => {
        const x = fixture();
        await x.service.onApplicationBootstrap();
        x.replace({ ...x.read(), workerId: 'replacement-worker' });
        await x.service.onApplicationShutdown();
        expect(x.read().state).toBe('RUNNING');
        expect(x.read().workerId).toBe('replacement-worker');
    });
    it('does not accumulate overlapping writes when the database is slow', async () => {
        vi.useFakeTimers();
        const x = fixture();
        await x.service.onApplicationBootstrap();
        let finish!: () => void;
        const gate = new Promise<void>(resolve => {
            finish = resolve;
        });
        x.settings.set.mockImplementationOnce(async (_ctx, key) => {
            await gate;
            return Promise.resolve({ key, result: true });
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(x.settings.set).toHaveBeenCalledTimes(2);
        finish();
        await x.service.onApplicationShutdown();
    });
});
