import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledTask } from '../../scheduler/scheduled-task';

import { DefaultSchedulerStrategy } from './default-scheduler-strategy';
import { StaleTaskService } from './stale-task.service';

const port = Number(process.env.CLOSEOUT_MYSQL_PORT);
const leaseSchema = new EntitySchema({
    name: 'CloseoutSchedulerLease',
    columns: {
        id: { type: Number, primary: true, generated: true },
        taskId: { type: String, unique: true },
        enabled: { type: Boolean, default: true },
        lockedAt: { type: Date, precision: 3, nullable: true },
        lastExecutedAt: { type: Date, precision: 3, nullable: true },
        manuallyTriggeredAt: { type: Date, precision: 3, nullable: true },
        lastResult: { type: 'json', nullable: true },
    },
});

describe.skipIf(!process.env.CLOSEOUT_MYSQL_PORT)('scheduler real MySQL execution lease', () => {
    let db: DataSource;
    beforeAll(async () => {
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Isolated MySQL required');
        db = new DataSource({
            type: 'mysql',
            host: '127.0.0.1',
            port,
            username: 'root',
            database: 'prelaunch_closeout_20261014',
            timezone: 'Z',
            entities: [leaseSchema],
            synchronize: true,
        });
        await db.initialize();
    });
    afterAll(async () => db?.destroy());
    beforeEach(async () => {
        await db.getRepository('CloseoutSchedulerLease').clear();
        await db
            .getRepository('CloseoutSchedulerLease')
            .save({ taskId: 'lease-test', lastResult: { scanCursors: { mail: 'keep' } } });
    });
    const read = () => db.getRepository('CloseoutSchedulerLease').findOneByOrFail({ taskId: 'lease-test' });
    function worker() {
        const rawConnection = {
            options: db.options,
            getRepository: () => db.getRepository('CloseoutSchedulerLease'),
            transaction: (work: (manager: unknown) => Promise<unknown>) =>
                db.transaction(manager =>
                    work({ getRepository: () => manager.getRepository('CloseoutSchedulerLease') }),
                ),
        };
        const connection = { rawConnection };
        const strategy = new DefaultSchedulerStrategy();
        Object.assign(strategy, {
            connection,
            injector: {},
            pluginOptions: { defaultTimeout: 300 },
            staleTaskService: new StaleTaskService(connection as never),
        });
        vi.spyOn(strategy as any, 'ensureTaskIsRegistered').mockResolvedValue(undefined);
        return strategy;
    }
    it('recovers a dead worker lease without waiting for a weekly cron interval', async () => {
        const strategy = worker();
        await db
            .getRepository('CloseoutSchedulerLease')
            .update({ taskId: 'lease-test' }, { lockedAt: new Date(Date.now() - 61_000) });
        const execute = vi.fn().mockResolvedValue({ recovered: true });
        const task = {
            id: 'lease-test',
            options: { timeout: 60_000, schedule: '0 0 * * 6' },
            execute,
        } as unknown as ScheduledTask;
        await strategy.executeTask(task)();
        expect(execute).toHaveBeenCalledTimes(1);
        expect((await read()).lockedAt).toBeNull();
        expect((await read()).lastResult).toEqual({ recovered: true });
    });
    it('does not overlap a timed-out writer across workers and retains the previous checkpoint', async () => {
        const firstWorker = worker();
        const secondWorker = worker();
        let finish!: (result: unknown) => void;
        let signal!: AbortSignal;
        const execute = vi.fn((_injector, cancel) => {
            signal = cancel;
            return new Promise(resolve => {
                finish = resolve;
            });
        });
        const task = {
            id: 'lease-test',
            options: { timeout: 300, schedule: '* * * * * *' },
            execute,
        } as unknown as ScheduledTask;
        const run = firstWorker.executeTask(task)();
        try {
            await vi.waitFor(() => expect(signal?.aborted).toBe(true), { timeout: 3000 });
            await vi.waitFor(async () =>
                expect((await read()).lastResult).toMatchObject({ error: 'Task timed out' }),
            );
            const lease = (await read()).lockedAt;
            await new Promise(resolve => setTimeout(resolve, 350));
            expect((await read()).lockedAt.getTime()).toBeGreaterThan(lease.getTime());
            await secondWorker.executeTask(task)();
            expect(execute).toHaveBeenCalledTimes(1);
        } finally {
            finish({ scanCursors: { mail: 'late-result' } });
            await run;
        }
        const done = await read();
        expect(done.lockedAt).toBeNull();
        expect(done.lastResult).toMatchObject({ scanCursors: { mail: 'keep' }, error: 'Task timed out' });
    });
    it('cannot release or overwrite a replacement owner with a stale completion', async () => {
        const strategy = worker();
        let finish!: () => void;
        let signal!: AbortSignal;
        const task = {
            id: 'lease-test',
            options: { timeout: 3000, schedule: '* * * * * *' },
            execute: (_i: unknown, cancel: AbortSignal) => {
                signal = cancel;
                return new Promise<void>(resolve => {
                    finish = resolve;
                });
            },
        } as unknown as ScheduledTask;
        const run = strategy.executeTask(task)();
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        const replacement = new Date(Date.now() + 30_000);
        await db
            .getRepository('CloseoutSchedulerLease')
            .update({ taskId: 'lease-test' }, { lockedAt: replacement, lastResult: { replacement: true } });
        try {
            await vi.waitFor(() => expect(signal.aborted).toBe(true), { timeout: 3000 });
        } finally {
            finish();
            await run;
        }
        const row = await read();
        expect(row.lockedAt).toEqual(replacement);
        expect(row.lastResult).toEqual({ replacement: true });
    });
});
