import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { LessThanOrEqual } from 'typeorm';

import { supportsRollbackLocks } from './catalog-import-rollback-state';
import { CatalogImportJob } from './entities/catalog-import-job.entity';

export const CATALOG_IMPORT_LEASE_MS = 120_000;
export const CATALOG_IMPORT_HEARTBEAT_MS = 30_000;

export class CatalogImportLeaseLostError extends Error {
    constructor() {
        super('导入执行租约已失效，本次执行已停止');
        this.name = 'CatalogImportLeaseLostError';
    }
}

/** All execution writes share the job-row lock and an attempt-specific token. */
export class CatalogImportLease {
    constructor(private readonly connection: TransactionalConnection) {}

    async databaseNow(ctx: RequestContext): Promise<Date> {
        const type = this.connection.rawConnection.options.type;
        const expression =
            type === 'postgres'
                ? 'clock_timestamp()'
                : type === 'mysql' || type === 'mariadb'
                  ? 'CURRENT_TIMESTAMP(6)'
                  : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
        const rows = await this.connection
            .getRepository(ctx, CatalogImportJob)
            .query('SELECT ' + expression + ' AS importLeaseNow');
        const value = rows[0]?.importLeaseNow;
        const now =
            value instanceof Date
                ? value
                : new Date(
                      typeof value === 'string' && !/[zZ]|[+-][0-9]{2}:[0-9]{2}$/.test(value)
                          ? value.replace(' ', 'T') + 'Z'
                          : value,
                  );
        if (!Number.isFinite(now.getTime())) throw new Error('Cannot read database import lease clock');
        return now;
    }

    private async lockedJob(ctx: RequestContext, id: ID) {
        const query = this.connection
            .getRepository(ctx, CatalogImportJob)
            .createQueryBuilder('job')
            .where('job.id = :id', { id })
            .andWhere('job.channelId = :channelId', { channelId: ctx.channelId });
        if (supportsRollbackLocks(this.connection)) query.setLock('pessimistic_write');
        return query.getOne();
    }

    async claim(ctx: RequestContext, id: ID): Promise<string | null> {
        return this.connection.withTransaction(ctx, async tx => {
            const job = await this.lockedJob(tx, id);
            if (!job || job.state !== 'QUEUED') return null;
            if (String(job.actorId ?? '') !== String(ctx.activeUserId ?? ''))
                throw new CatalogImportLeaseLostError();
            const now = await this.databaseNow(tx);
            const token = randomUUID();
            const result = await this.connection.getRepository(tx, CatalogImportJob).update(
                { id, channelId: tx.channelId, state: 'QUEUED', version: job.version },
                {
                    state: 'RUNNING',
                    executionToken: token,
                    leaseUntil: new Date(now.getTime() + CATALOG_IMPORT_LEASE_MS),
                    startedAt: now,
                    errorMessage: null,
                },
            );
            return result.affected === 1 ? token : null;
        });
    }

    async owned<T>(
        ctx: RequestContext,
        id: ID,
        token: string,
        work: (tx: RequestContext, job: CatalogImportJob) => Promise<T>,
        release = false,
    ): Promise<T> {
        return this.connection.withTransaction(ctx, async tx => {
            const job = await this.lockedJob(tx, id);
            const now = await this.databaseNow(tx);
            if (
                !job ||
                job.state !== 'RUNNING' ||
                job.executionToken !== token ||
                !job.leaseUntil ||
                job.leaseUntil.getTime() <= now.getTime()
            )
                throw new CatalogImportLeaseLostError();
            const result = await work(tx, job);
            // The lock fences recovery during long row transactions; renew from the
            // database clock at commit, rather than expiring an otherwise healthy row.
            const update = await this.connection.getRepository(tx, CatalogImportJob).update(
                { id, ...(!release ? { state: 'RUNNING' as const } : {}), executionToken: token },
                release
                    ? { executionToken: null, leaseUntil: null }
                    : {
                          leaseUntil: new Date(
                              (await this.databaseNow(tx)).getTime() + CATALOG_IMPORT_LEASE_MS,
                          ),
                      },
            );
            if (update.affected !== 1) throw new CatalogImportLeaseLostError();
            return result;
        });
    }

    async recoverExpired(ctx: RequestContext, id: ID): Promise<boolean> {
        return this.connection.withTransaction(ctx, async tx => {
            const job = await this.lockedJob(tx, id);
            const now = await this.databaseNow(tx);
            // A legacy/null lease has no proof that its old executor has exited.
            if (
                !job ||
                job.state !== 'RUNNING' ||
                !job.executionToken ||
                !job.leaseUntil ||
                job.leaseUntil.getTime() > now.getTime()
            )
                return false;
            const result = await this.connection.getRepository(tx, CatalogImportJob).update(
                {
                    id,
                    channelId: tx.channelId,
                    state: 'RUNNING',
                    executionToken: job.executionToken,
                    leaseUntil: LessThanOrEqual(now),
                },
                {
                    state: 'QUEUED',
                    executionToken: null,
                    leaseUntil: null,
                    errorMessage: '已恢复租约到期的导入任务',
                },
            );
            return result.affected === 1;
        });
    }
}
