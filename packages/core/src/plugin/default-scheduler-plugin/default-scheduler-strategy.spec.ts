import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduledTask } from '../../scheduler/scheduled-task';

import { DefaultSchedulerStrategy } from './default-scheduler-strategy';
import { StaleTaskService } from './stale-task.service';

function setup() {
    const row: any = {
        taskId: 'recovery',
        lockedAt: null,
        enabled: true,
        lastResult: { scanCursors: { email: 'checkpoint' } },
    };
    const updates: any[] = [];
    const repository = {
        findOne: vi.fn(() => Promise.resolve({ ...row })),
        update: vi.fn((where: any, value: any) => {
            if (where.lockedAt && row.lockedAt?.getTime() !== where.lockedAt.getTime())
                return Promise.resolve({ affected: 0 });
            Object.assign(row, value);
            updates.push({ ...value });
            return Promise.resolve({ affected: 1 });
        }),
        createQueryBuilder: () => {
            let value: any;
            const query: any = {
                set: (next: any) => {
                    value = next;
                    return query;
                },
                execute: () => {
                    if (row.lockedAt || !row.enabled) return Promise.resolve({ affected: 0 });
                    Object.assign(row, value);
                    return Promise.resolve({ affected: 1 });
                },
            };
            for (const key of ['update', 'where', 'andWhere']) query[key] = () => query;
            return query;
        },
    };
    const connection = { rawConnection: { options: { type: 'sqljs' }, getRepository: () => repository } };
    const strategy = new DefaultSchedulerStrategy();
    Object.assign(strategy, {
        connection,
        injector: {},
        pluginOptions: { defaultTimeout: 60_000 },
        staleTaskService: { cleanStaleLocksForTask: vi.fn(), getScheduleIntervalMs: () => 60_000 },
    });
    vi.spyOn(strategy as any, 'ensureTaskIsRegistered').mockResolvedValue(undefined);
    return { row, repository, updates, connection, strategy };
}
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});
describe('scheduler execution ownership', () => {
    it('retains and renews a timed-out executor until it actually ends, then records failure', async () => {
        vi.useFakeTimers();
        const h = setup();
        let finish!: (result: any) => void;
        let signal!: AbortSignal;
        const execute = vi.fn((_injector, value) => {
            signal = value;
            return new Promise(resolve => {
                finish = resolve;
            });
        });
        const task = { id: 'recovery', options: { timeout: 60_000 }, execute } as unknown as ScheduledTask;
        const first = h.strategy.executeTask(task)();
        await vi.advanceTimersByTimeAsync(61_000);
        expect(signal.aborted).toBe(true);
        expect(h.row.lockedAt).not.toBeNull();
        expect(h.row.lastResult).toMatchObject({
            error: 'Task timed out',
            scanCursors: { email: 'checkpoint' },
        });
        const other = setup();
        Object.assign(other.strategy, { connection: h.connection });
        await other.strategy.executeTask(task)();
        await h.strategy.executeTask(task)();
        expect(execute).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(61_000);
        expect(h.row.lockedAt.getTime()).toBeGreaterThan(Date.now() - 11_000);
        finish({ scanCursors: { email: 'late-invalid' } });
        await first;
        expect(h.row.lockedAt).toBeNull();
        expect(h.row.lastResult).toMatchObject({
            error: 'Task timed out',
            scanCursors: { email: 'checkpoint' },
        });
    });
    it('does not unlock or overwrite a later owner after a stale observation', async () => {
        vi.useFakeTimers();
        const h = setup();
        let finish!: () => void;
        let signal!: AbortSignal;
        const task = {
            id: 'recovery',
            options: { timeout: 60_000 },
            execute: (_i: unknown, s: AbortSignal) => {
                signal = s;
                return new Promise<void>(resolve => {
                    finish = resolve;
                });
            },
        } as unknown as ScheduledTask;
        const run = h.strategy.executeTask(task)();
        await vi.advanceTimersByTimeAsync(1);
        const replacement = new Date(Date.now() + 500);
        h.row.lockedAt = replacement;
        h.row.lastResult = { newOwner: true };
        await vi.advanceTimersByTimeAsync(10_000);
        expect(signal.aborted).toBe(true);
        finish();
        await run;
        expect(h.row.lockedAt).toEqual(replacement);
        expect(h.row.lastResult).toEqual({ newOwner: true });
    });
    it('shutdown aborts executors but retains unfinished ownership', async () => {
        vi.useFakeTimers();
        const h = setup();
        let finish!: () => void;
        let signal!: AbortSignal;
        const task = {
            id: 'recovery',
            options: {},
            execute: (_i: unknown, s: AbortSignal) => {
                signal = s;
                return new Promise<void>(r => {
                    finish = r;
                });
            },
        } as unknown as ScheduledTask;
        const run = h.strategy.executeTask(task)();
        await vi.advanceTimersByTimeAsync(1);
        h.strategy.destroy();
        expect(signal.aborted).toBe(true);
        expect(h.row.lockedAt).not.toBeNull();
        await vi.advanceTimersByTimeAsync(61_000);
        expect(h.row.lockedAt.getTime()).toBeGreaterThan(Date.now() - 11_000);
        finish();
        await run;
        expect(h.row.lockedAt).toBeNull();
    });
    it('normal completion persists the result and releases its own lock', async () => {
        const h = setup();
        const task = {
            id: 'recovery',
            options: {},
            execute: vi.fn().mockResolvedValue({ processed: 1 }),
        } as unknown as ScheduledTask;
        await h.strategy.executeTask(task)();
        expect(h.row.lockedAt).toBeNull();
        expect(h.row.lastResult).toEqual({ processed: 1 });
    });
    it('a shorter schedule does not expire a live lock before the configured timeout', async () => {
        const update = vi.fn();
        const task: any = { id: 'recovery', options: { schedule: '* * * * * *', timeout: 60_000 } };
        const query: any = {
            getOne: () => Promise.resolve({ taskId: 'recovery', lockedAt: new Date(Date.now() - 5000) }),
        };
        for (const key of ['select', 'where', 'andWhere']) query[key] = () => query;
        const service = new StaleTaskService({
            rawConnection: { getRepository: () => ({ createQueryBuilder: () => query, update }) },
        } as never);
        vi.spyOn(service, 'getScheduleIntervalMs').mockReturnValue(1000);
        await service.cleanStaleLocksForTask(task);
        expect(update).not.toHaveBeenCalled();
    });
});
