import { Injectable, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { SortOrder } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ConfigService,
    isInspectableJobQueueStrategy,
    Job,
    JobQueue,
    JobQueueService,
    Logger,
    Permission,
    ProcessContext,
    RequestContextService,
    ScheduledTask,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';

import { CatalogImportLease } from './catalog-import-lease';
import { CatalogImportService } from './catalog-import.service';
import { CATALOG_IMPORT_QUEUE, manageCatalogImportPermission } from './constants';
import { CatalogImportJob } from './entities/catalog-import-job.entity';

interface CatalogImportQueueData {
    importJobId: string;
}

@Injectable()
export class CatalogImportQueueService implements OnApplicationBootstrap {
    private queue: JobQueue<CatalogImportQueueData>;
    private recovering = false;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly requestContextService: RequestContextService,
        private readonly jobQueueService: JobQueueService,
        private readonly imports: CatalogImportService,
        @Optional() private readonly processContext?: ProcessContext,
        @Optional() private readonly config?: ConfigService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.queue = await this.jobQueueService.createQueue({
            name: CATALOG_IMPORT_QUEUE,
            process: job => this.process(job),
        });
        this.imports.registerEnqueuer(jobId => this.dispatch(jobId));
        if (this.processContext?.isWorker) await this.recoverInterruptedJobs();
    }

    async dispatch(jobId: ID): Promise<void> {
        await this.queue.add({ importJobId: String(jobId) }, { retries: 2 });
    }

    private async process(job: Job<CatalogImportQueueData>): Promise<{ importJobId: string }> {
        const importJob = await this.connection.rawConnection.getRepository(CatalogImportJob).findOne({
            where: { id: job.data.importJobId as ID },
            relations: ['channel'],
        });
        if (!importJob || importJob.state !== 'QUEUED') return { importJobId: job.data.importJobId };
        const actor = importJob.actorId
            ? await this.connection.rawConnection.getRepository(User).findOne({
                  where: { id: importJob.actorId as ID },
                  relations: { roles: { channels: true } },
              })
            : null;
        const ctx = await this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: importJob.channel,
            user: actor ?? undefined,
        });
        try {
            if (
                !actor ||
                actor.deletedAt ||
                !ctx.userHasPermissions([Permission.SuperAdmin, manageCatalogImportPermission.Update])
            ) {
                await this.connection.rawConnection.getRepository(CatalogImportJob).update(
                    { id: importJob.id, state: 'QUEUED', version: importJob.version },
                    {
                        state: 'FAILED',
                        errorMessage:
                            '导入执行账号已失效或不再拥有当前门店的导入权限，请由有权限的管理员重新执行',
                        completedAt: new Date(),
                    },
                );
                throw new UserInputError('导入执行权限已失效');
            }
            await this.imports.executeJob(ctx, importJob.id, progress => job.setProgress(progress));
        } catch (error) {
            // executeJob alone owns the attempt token. A stale queue callback must
            // never overwrite another executor's RUNNING or completed state.
            throw error;
        }
        return { importJobId: job.data.importJobId };
    }

    private async pendingImports(): Promise<Set<string> | undefined> {
        const strategy = this.config?.jobQueueOptions.jobQueueStrategy;
        if (!strategy || !isInspectableJobQueueStrategy(strategy)) return undefined;
        const ids = new Set<string>();
        let skip = 0;
        let upper = Number.MAX_SAFE_INTEGER;
        while (skip < upper) {
            const page = await strategy.findMany({
                filter: { queueName: { eq: CATALOG_IMPORT_QUEUE }, state: { in: ['PENDING', 'RETRYING'] } },
                sort: { id: SortOrder.ASC },
                skip,
                take: 100,
            });
            upper = Math.min(upper, page.totalItems);
            for (const job of page.items) {
                const id = (job.data as CatalogImportQueueData | undefined)?.importJobId;
                if (id) ids.add(String(id));
            }
            if (!page.items.length) break;
            skip += page.items.length;
        }
        return ids;
    }

    async recoverInterruptedJobs() {
        const result = { scanned: 0, recovered: 0, enqueued: 0, legacy: 0, pending: 0, failed: 0 };
        if (!this.processContext?.isWorker || this.recovering) return result;
        this.recovering = true;
        try {
            const repository = this.connection.rawConnection.getRepository(CatalogImportJob);
            const mysql = ['mysql', 'mariadb', 'aurora-mysql'].includes(
                this.connection.rawConnection.options.type,
            );
            // Keep the native fractional timestamp as text. Hydrating it through
            // JavaScript Date would truncate MySQL microseconds at page boundaries.
            const nativeDate = mysql ? 'CAST(job.createdAt AS CHAR)' : 'CAST(job.createdAt AS TEXT)';
            const upper = await repository
                .createQueryBuilder('job')
                .select('job.id', 'id')
                .addSelect(nativeDate, 'createdAt')
                .where('job.state IN (:...states)', { states: ['QUEUED', 'RUNNING'] })
                .orderBy('job.createdAt', 'DESC')
                .addOrderBy('job.id', 'DESC')
                .getRawOne<{ id: ID; createdAt: string }>();
            if (!upper) return result;
            let pending: Set<string> | undefined;
            try {
                pending = await this.pendingImports();
            } catch {
                Logger.warn('Import queue inspection unavailable; queued recovery deferred', 'CatalogImport');
            }
            const leases = new CatalogImportLease(this.connection);
            let cursor: { id: ID; createdAt: string } | undefined;
            for (;;) {
                const query = repository
                    .createQueryBuilder('job')
                    .select('job.id', 'id')
                    .addSelect(nativeDate, 'createdAt')
                    .where('job.state IN (:...states)', { states: ['QUEUED', 'RUNNING'] })
                    .andWhere(
                        '(job.createdAt < :upperDate OR (job.createdAt = :upperDate AND job.id <= :upperId))',
                        { upperDate: upper.createdAt, upperId: upper.id },
                    )
                    .orderBy('job.createdAt', 'ASC')
                    .addOrderBy('job.id', 'ASC')
                    .take(100);
                if (cursor)
                    query.andWhere(
                        '(job.createdAt > :cursorDate OR (job.createdAt = :cursorDate AND job.id > :cursorId))',
                        { cursorDate: cursor.createdAt, cursorId: cursor.id },
                    );
                const jobs = await query.getRawMany<{ id: ID; createdAt: string }>();
                if (!jobs.length) break;
                // Advance even when QUEUED rows stay queued or dispatch fails.
                cursor = jobs[jobs.length - 1];
                for (const reference of jobs) {
                    result.scanned++;
                    try {
                        const candidate = await repository.findOne({
                            where: { id: reference.id },
                            relations: ['channel'],
                        });
                        if (!candidate || !['QUEUED', 'RUNNING'].includes(candidate.state)) continue;
                        if (candidate.state === 'RUNNING') {
                            if (!candidate.executionToken || !candidate.leaseUntil) {
                                result.legacy++;
                                continue;
                            }
                            const ctx = await this.requestContextService.create({
                                apiType: 'admin',
                                channelOrToken: candidate.channel,
                            });
                            if (!(await leases.recoverExpired(ctx, candidate.id))) continue;
                            result.recovered++;
                        }
                        if (!pending) continue;
                        if (pending.has(String(candidate.id))) {
                            result.pending++;
                            continue;
                        }
                        const current = await repository.findOneBy({ id: candidate.id });
                        if (!current || current.state !== 'QUEUED') continue;
                        await this.dispatch(candidate.id);
                        pending.add(String(candidate.id));
                        result.enqueued++;
                    } catch {
                        result.failed++;
                        Logger.warn('Import recovery deferred for job ' + reference.id, 'CatalogImport');
                    }
                }
            }
            if (result.legacy)
                Logger.warn(
                    result.legacy + ' legacy import jobs have no execution lease; reviewed recovery required',
                    'CatalogImport',
                );
            return result;
        } finally {
            this.recovering = false;
        }
    }
}

export const reconcileCatalogImportsTask = new ScheduledTask({
    id: 'recover-catalog-imports',
    description: 'Recover queued imports and expired fenced import executions',
    schedule: cron => cron.every(1).minutes(),
    execute: ({ injector }) => injector.get(CatalogImportQueueService).recoverInterruptedJobs(),
});
