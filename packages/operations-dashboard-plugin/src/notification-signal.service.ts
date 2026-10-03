import { Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { createHash } from 'node:crypto';
import { LessThan } from 'typeorm';

import { AdminNotificationSignal } from './entities/admin-notification-signal.entity';

/** Atomic persisted counters in a rolling window, shared across processes and restarts. */
@Injectable()
export class NotificationSignalService {
    constructor(private readonly connection: TransactionalConnection) {}
    async count(identityHash: string, windowMs = 300_000, now = Date.now()) {
        if (!/^[a-f0-9]{64}$/.test(identityHash)) throw new Error('监测标识无效');
        const key = createHash('sha256').update(`${identityHash}:${now}:${windowMs}`).digest('hex');
        const expiresAt = new Date(now + windowMs);
        const repository = this.connection.rawConnection.getRepository(AdminNotificationSignal);
        await repository
            .createQueryBuilder()
            .insert()
            .values({ key, identityHash, count: 0, expiresAt })
            .orIgnore()
            .updateEntity(false)
            .execute();
        await repository.increment({ key }, 'count', 1);
        return { count: await this.current(identityHash, now), key: identityHash, expiresAt };
    }
    async current(identityHash: string, now = Date.now()): Promise<number> {
        const result = await this.connection.rawConnection
            .getRepository(AdminNotificationSignal)
            .createQueryBuilder('signal')
            .select('SUM(signal.count)', 'count')
            .where('signal.identityHash = :identityHash AND signal.expiresAt > :now', {
                identityHash,
                now: new Date(now),
            })
            .getRawOne();
        return Number(result?.count ?? 0);
    }
    async reset(identityHash: string) {
        await this.connection.rawConnection.getRepository(AdminNotificationSignal).delete({ identityHash });
    }
    async purge(now = new Date()) {
        await this.connection.rawConnection
            .getRepository(AdminNotificationSignal)
            .delete({ expiresAt: LessThan(now) });
    }
}
