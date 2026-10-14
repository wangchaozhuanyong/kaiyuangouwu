import { UpdateScheduledTaskInput } from '@vendure/common/lib/generated-types';
import { Cron } from 'croner';
import ms, { type StringValue } from 'ms';

import { Injector } from '../../common';
import { assertFound } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection';
import { ProcessContext } from '../../process-context';
import { ScheduledTask } from '../../scheduler/scheduled-task';
import { SchedulerStrategy, TaskReport } from '../../scheduler/scheduler-strategy';

import {
    DEFAULT_LOCK_HOLD_FRACTION,
    DEFAULT_MAX_LOCK_HOLD_MS,
    DEFAULT_SCHEDULER_PLUGIN_OPTIONS,
} from './constants';
import { ScheduledTaskRecord } from './scheduled-task-record.entity';
import { StaleTaskService } from './stale-task.service';
import { DefaultSchedulerPluginOptions } from './types';

/**
 * @description
 * The default {@link SchedulerStrategy} implementation that uses the database to
 * execute scheduled tasks. This strategy is configured when you use the
 * {@link DefaultSchedulerPlugin}.
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 */
export class DefaultSchedulerStrategy implements SchedulerStrategy {
    private connection: TransactionalConnection;
    private injector: Injector;
    private intervalRef: NodeJS.Timeout | undefined;
    private readonly tasks: Map<string, { task: ScheduledTask; isRegistered: boolean }> = new Map();
    private pluginOptions: DefaultSchedulerPluginOptions;
    private readonly runningTasks = new Map<
        string,
        { controller: AbortController; stopHeartbeat: () => void }
    >();
    private lastLockTimestamp = 0;
    private staleTaskService: StaleTaskService;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        this.pluginOptions = injector.get(DEFAULT_SCHEDULER_PLUGIN_OPTIONS);
        this.injector = injector;
        this.staleTaskService = injector.get(StaleTaskService);

        const runTriggerCheck =
            injector.get(ConfigService).schedulerOptions.runTasksInWorkerOnly === false ||
            injector.get(ProcessContext).isWorker;

        if (runTriggerCheck) {
            this.intervalRef = setInterval(
                () => void this.checkForManuallyTriggeredTasks(),
                this.pluginOptions.manualTriggerCheckInterval as number,
            );
        }
    }

    destroy() {
        if (this.intervalRef) {
            clearInterval(this.intervalRef);
        }
        for (const execution of this.runningTasks.values()) {
            execution.controller.abort(new Error('Scheduler shutting down'));
        }
        // An unfinished executor must not release a lock while it can still write.
        // Keep renewing until it ends; dead processes recover through stale locks.
    }

    registerTask(task: ScheduledTask): void {
        this.tasks.set(task.id, {
            task,
            isRegistered: false,
        });
    }

    executeTask(task: ScheduledTask) {
        return async (_job?: Cron) => {
            await this.runTask(task, { skipHoldCheck: false });
        };
    }

    private async runManually(task: ScheduledTask): Promise<void> {
        await this.runTask(task, { skipHoldCheck: true });
    }

    private async runTask(task: ScheduledTask, options: { skipHoldCheck: boolean }): Promise<void> {
        if (this.runningTasks.has(task.id)) return;
        await this.ensureTaskIsRegistered(task);
        await this.staleTaskService.cleanStaleLocksForTask(task);
        const acquiredAt = await this.tryAcquireLock(task, { skipHoldCheck: options.skipHoldCheck });
        if (!acquiredAt) return;
        let ownedAt = acquiredAt;
        const repository = this.connection.rawConnection.getRepository(ScheduledTaskRecord);
        const controller = new AbortController();
        const timeout = task.options.timeout ?? this.pluginOptions.defaultTimeout;
        const timeoutMs = typeof timeout === 'number' ? timeout : ms(timeout as StringValue);
        let stopped = false;
        let heartbeatWork = Promise.resolve();
        let failure: string | undefined;
        let previousResult: Record<string, any> = {};
        let previousResultLoaded = false;
        const loadPreviousResult = async () => {
            const previous = await repository.findOne({ where: { taskId: task.id } });
            if (previous?.lastResult && typeof previous.lastResult === 'object')
                previousResult = previous.lastResult;
            previousResultLoaded = true;
        };
        const heartbeat = setInterval(
            () => {
                heartbeatWork = heartbeatWork
                    .then(async () => {
                        if (stopped) return;
                        const renewedAt = new Date(Math.max(Date.now(), ownedAt.getTime() + 1));
                        const renewed = await repository.update(
                            { taskId: task.id, lockedAt: ownedAt },
                            { lockedAt: renewedAt },
                        );
                        if (!renewed.affected) throw new Error('Task execution ownership lost');
                        ownedAt = renewedAt;
                    })
                    .catch(() => {
                        failure ??= 'Task execution ownership lost';
                        controller.abort(new Error(failure));
                    });
            },
            Math.max(1, Math.min(10_000, Math.floor(timeoutMs / 3))),
        );
        heartbeat.unref?.();
        const stopHeartbeat = () => {
            stopped = true;
            clearInterval(heartbeat);
        };
        this.runningTasks.set(task.id, { controller, stopHeartbeat });
        const timeoutTimer = setTimeout(() => {
            failure ??= 'Task timed out';
            controller.abort(new Error(failure));
            heartbeatWork = heartbeatWork
                .then(async () => {
                    if (stopped || !previousResultLoaded) return;
                    await repository.update(
                        { taskId: task.id, lockedAt: ownedAt },
                        { lastResult: { ...previousResult, error: failure } as any },
                    );
                })
                .catch(() => {
                    controller.abort(new Error('Task status could not be recorded'));
                });
            Logger.warn(`Scheduled task ${task.id} timed out after ${timeoutMs}ms; retaining execution lock`);
        }, timeoutMs);
        try {
            // Timeout requests cancellation; it cannot terminate arbitrary JavaScript.
            // Await the executor and renew its lock so another worker cannot overlap it.
            await loadPreviousResult();
            const result = await task.execute(this.injector, controller.signal);
            stopHeartbeat();
            await heartbeatWork;
            if (controller.signal.aborted) failure ??= 'Task execution cancelled';
            await repository.update(
                { taskId: task.id, lockedAt: ownedAt },
                {
                    lastExecutedAt: new Date(),
                    lockedAt: null,
                    lastResult: failure ? ({ ...previousResult, error: failure } as any) : (result ?? ''),
                },
            );
        } catch (error) {
            stopHeartbeat();
            await heartbeatWork;
            const message = failure ?? (error instanceof Error ? error.message : 'Unknown error');
            Logger.error(`Scheduled task "${task.id}" failed with error: ${message}`);
            // A transient initial read must not turn an unknown checkpoint into an
            // empty one. If recovery also fails, keep the existing database result.
            if (!previousResultLoaded) await loadPreviousResult();
            await repository.update(
                { taskId: task.id, lockedAt: ownedAt },
                {
                    lastExecutedAt: new Date(),
                    lockedAt: null,
                    lastResult: { ...previousResult, error: message } as any,
                },
            );
        } finally {
            clearTimeout(timeoutTimer);
            stopHeartbeat();
            this.runningTasks.delete(task.id);
        }
    }

    async getTasks(): Promise<TaskReport[]> {
        await this.ensureAllTasksAreRegistered();
        return this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .getMany()
            .then(tasks => {
                return tasks.map(task => this.entityToReport(task));
            });
    }

    async getTask(id: string): Promise<TaskReport | undefined> {
        await this.ensureTaskIsRegistered(id);
        return this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .where('task.taskId = :id', { id })
            .getOne()
            .then(task => (task ? this.entityToReport(task) : undefined));
    }

    async updateTask(input: UpdateScheduledTaskInput): Promise<TaskReport> {
        await this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .update()
            .set({ enabled: input.enabled })
            .where('taskId = :id', { id: input.id })
            .execute();
        return assertFound(this.getTask(input.id));
    }

    async triggerTask(task: ScheduledTask): Promise<void> {
        Logger.info(`Triggering task: ${task.id}`);
        await this.ensureTaskIsRegistered(task);
        await this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .update()
            .set({ manuallyTriggeredAt: new Date() })
            .where('taskId = :id', { id: task.id })
            .execute();
    }

    private async checkForManuallyTriggeredTasks() {
        // Since this is run on an interval, there is an edge case where, during shutdown,
        // the connection may not be initialized anymore.
        if (!this.connection.rawConnection.isInitialized) {
            return;
        }
        let taskEntities: ScheduledTaskRecord[] = [];
        try {
            taskEntities = await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .createQueryBuilder('task')
                .where('task.manuallyTriggeredAt IS NOT NULL')
                .getMany();
        } catch (e) {
            // This branch can be reached if the connection is closed and then this method
            // is called on the interval. Usually encountered in tests.
            const errorMessage = e instanceof Error ? e.message : 'Unknown error';
            Logger.error(`Error checking for manually triggered tasks: ${errorMessage}`);
        }

        Logger.debug(`Checking for manually triggered tasks: ${taskEntities.length}`);

        for (const taskEntity of taskEntities) {
            await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .update({ taskId: taskEntity.taskId }, { manuallyTriggeredAt: null });

            const task = this.tasks.get(taskEntity.taskId);
            if (task) {
                Logger.info(`Executing manually triggered task: ${task.task.id}`);
                void this.runManually(task.task);
            }
        }
    }

    private entityToReport(task: ScheduledTaskRecord): TaskReport {
        return {
            id: task.taskId,
            lastExecutedAt: task.lastExecutedAt,
            isRunning: task.lockedAt !== null,
            lastResult: task.lastResult,
            enabled: task.enabled,
        };
    }

    /**
     * Hold window after task completion during which scheduled re-acquisitions
     * are rejected. Prevents a worker with a lagging clock from re-running a
     * task that has just completed on a faster worker.
     */
    private computeLockHoldMs(task: ScheduledTask): number {
        let intervalMs: number;
        try {
            intervalMs = this.staleTaskService.getScheduleIntervalMs(task);
        } catch {
            return DEFAULT_MAX_LOCK_HOLD_MS;
        }
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            return DEFAULT_MAX_LOCK_HOLD_MS;
        }
        return Math.floor(Math.min(intervalMs * DEFAULT_LOCK_HOLD_FRACTION, DEFAULT_MAX_LOCK_HOLD_MS));
    }

    private async ensureAllTasksAreRegistered() {
        for (const task of this.tasks.values()) {
            await this.ensureTaskIsRegistered(task.task);
        }
    }

    /**
     * Attempts to acquire a lock for the given task.
     *
     * For databases that support pessimistic locking (PostgreSQL, MySQL, MariaDB),
     * we use SELECT ... FOR UPDATE to ensure only one worker can acquire the lock.
     * This is necessary because PostgreSQL's MVCC can allow multiple concurrent
     * UPDATE statements to succeed when using a simple "UPDATE ... WHERE lockedAt IS NULL" pattern.
     *
     * For databases that don't support pessimistic locking (SQLite, SQL.js),
     * we fall back to the atomic UPDATE approach which works correctly for single-connection scenarios.
     *
     * `skipHoldCheck` lets manual triggers bypass the post-completion hold
     * window (see `computeLockHoldMs`); they are already deduplicated via
     * `manuallyTriggeredAt` and have no inter-worker race.
     */
    private async tryAcquireLock(
        task: ScheduledTask,
        options: { skipHoldCheck?: boolean } = {},
    ): Promise<Date | undefined> {
        const lockedAt = new Date(Math.max(Date.now(), this.lastLockTimestamp + 1));
        this.lastLockTimestamp = lockedAt.getTime();
        const dbType = this.connection.rawConnection.options.type;
        const supportsPessimisticLocking = ['postgres', 'mysql', 'mariadb'].includes(dbType);
        const holdThreshold = options.skipHoldCheck
            ? null
            : new Date(Date.now() - this.computeLockHoldMs(task));

        if (supportsPessimisticLocking) {
            // Use a transaction with pessimistic locking to ensure only one worker
            // can acquire the lock.
            return this.connection.rawConnection.transaction(async manager => {
                // First, try to select the task row with a FOR UPDATE lock.
                // This will block other transactions trying to select the same row
                // until this transaction commits or rolls back.
                const qb = manager
                    .getRepository(ScheduledTaskRecord)
                    .createQueryBuilder('task')
                    .setLock('pessimistic_write')
                    .where('task.taskId = :taskId', { taskId: task.id })
                    .andWhere('task.lockedAt IS NULL')
                    .andWhere('task.enabled = TRUE');
                if (holdThreshold) {
                    qb.andWhere('(task.lastExecutedAt IS NULL OR task.lastExecutedAt <= :holdThreshold)', {
                        holdThreshold,
                    });
                }
                const taskRecord = await qb.getOne();

                if (!taskRecord) {
                    // Task is either already locked, disabled, or doesn't exist
                    return undefined;
                }

                // Now update the lock within the same transaction
                await manager.getRepository(ScheduledTaskRecord).update({ id: taskRecord.id }, { lockedAt });

                return lockedAt;
            });
        } else {
            // For databases without pessimistic locking support (SQLite, SQL.js),
            // use the atomic UPDATE approach. This works for single-connection scenarios
            // but may have race conditions with multiple connections.
            const qb = this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .createQueryBuilder('task')
                .update()
                .set({ lockedAt })
                .where('taskId = :taskId', { taskId: task.id })
                .andWhere('lockedAt IS NULL')
                .andWhere('enabled = TRUE');
            if (holdThreshold) {
                qb.andWhere('(lastExecutedAt IS NULL OR lastExecutedAt <= :holdThreshold)', {
                    holdThreshold,
                });
            }
            const result = await qb.execute();

            return result.affected ? lockedAt : undefined;
        }
    }

    private async ensureTaskIsRegistered(taskOrId: ScheduledTask | string) {
        const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId.id;
        const task = this.tasks.get(taskId);
        if (task && !task.isRegistered) {
            await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .createQueryBuilder()
                .insert()
                .into(ScheduledTaskRecord)
                .values({ taskId })
                // Fix for versions lower than MariaDB v10.5 and MySQL: updateEntity(false) prevents TypeORM from
                // using the RETURNING clause after an INSERT. Keep in mind that this query won't return the id of the inserted record.
                .updateEntity(false)
                .orIgnore()
                .execute();

            this.tasks.set(taskId, { task: task.task, isRegistered: true });
        }
    }
}
