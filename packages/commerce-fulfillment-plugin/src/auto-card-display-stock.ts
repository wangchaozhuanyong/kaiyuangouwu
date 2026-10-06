import { ID, RequestContext, RequestContextCacheService, TransactionalConnection } from '@vendure/core';

import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';

/** Quantity projection only. Credentials and pool records never enter a display cache. */
export function autoCardDisplayStock(
    ctx: RequestContext,
    configId: ID,
    connection: TransactionalConnection,
    cache: RequestContextCacheService,
): Promise<number> {
    return cache.load(ctx, `auto-card-display-stock:${ctx.channelId}`, configId, async ids => {
        const rows = await connection
            .getRepository(ctx, AutoCardPoolItem)
            .createQueryBuilder('item')
            .select('item.configId', 'configId')
            .addSelect('COUNT(*)', 'available')
            .where('item.configId IN (:...ids)', { ids })
            .andWhere('item.state = :state', { state: 'AVAILABLE' })
            .groupBy('item.configId')
            .getRawMany<{ configId: ID; available: string | number }>();
        const counts = new Map(rows.map(row => [String(row.configId), Number(row.available)]));
        return ids.map(id => counts.get(id) ?? 0);
    });
}
