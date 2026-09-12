import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
    JobQueueService,
    Logger,
    ProcessContext,
    RequestContextService,
    SettingsStoreService,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';

export const SYSTEM_WORKER_HEARTBEAT_KEY = 'systemOperations.workerHeartbeat';
const INTERVAL_MS = 15_000;

type WorkerHeartbeat = {
    workerId: string;
    heartbeatAt: string;
    state: 'RUNNING' | 'STOPPED';
    queues: Array<{ name: string; running: boolean }>;
};

/** Shared database heartbeat for the deployment's independent job worker. */
@Injectable()
export class SystemWorkerHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly workerId = randomUUID();
    private timer?: ReturnType<typeof setInterval>;
    private pending?: Promise<void>;

    constructor(
        private readonly processContext: ProcessContext,
        private readonly jobs: JobQueueService,
        private readonly contexts: RequestContextService,
        private readonly settings: SettingsStoreService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        if (!this.processContext.isWorker) return;
        await this.publish();
        this.timer = setInterval(() => {
            void this.publish();
        }, INTERVAL_MS);
        this.timer.unref?.();
    }

    async onApplicationShutdown(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        if (!this.processContext.isWorker) return;
        await this.pending;
        try {
            const ctx = await this.contexts.create({ apiType: 'admin' });
            const current = await this.settings.get<WorkerHeartbeat>(ctx, SYSTEM_WORKER_HEARTBEAT_KEY);
            // An old process shutting down must not mark its replacement as stopped.
            if (current?.workerId === this.workerId) {
                await this.settings.set(ctx, SYSTEM_WORKER_HEARTBEAT_KEY, {
                    ...current,
                    state: 'STOPPED',
                    heartbeatAt: new Date().toISOString(),
                });
            }
        } catch {
            Logger.warn('Worker shutdown heartbeat could not be saved', 'SystemWorkerHealth');
        }
    }

    private publish(): Promise<void> {
        if (this.pending) return this.pending;
        this.pending = this.writeHeartbeat()
            .catch(() => {
                Logger.warn('Worker heartbeat could not be saved', 'SystemWorkerHealth');
            })
            .finally(() => {
                this.pending = undefined;
            });
        return this.pending;
    }

    private async writeHeartbeat(): Promise<void> {
        const ctx = await this.contexts.create({ apiType: 'admin' });
        const result = await this.settings.set(ctx, SYSTEM_WORKER_HEARTBEAT_KEY, {
            workerId: this.workerId,
            heartbeatAt: new Date().toISOString(),
            state: 'RUNNING',
            queues: this.jobs.getJobQueues(),
        } satisfies WorkerHeartbeat);
        if (!result.result) throw new Error('Worker heartbeat storage failed');
    }
}
