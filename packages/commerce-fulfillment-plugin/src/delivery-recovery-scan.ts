import { ID } from '@vendure/common/lib/shared-types';
import { FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';

export interface DeliveryRecoveryCursor {
    createdAt: string;
    id: ID;
    source?: 'database';
}

export type DeliveryRecoveryCursors = Record<string, DeliveryRecoveryCursor | undefined>;

/** A bounded keyset page. The scheduled task stores cursors in its existing durable lastResult. */
export async function scanDeliveryRecoveryPage<T extends { id: ID; createdAt: Date }>(
    repository: Repository<T>,
    criteria: Array<FindOptionsWhere<T>>,
    cursors: DeliveryRecoveryCursors,
    queue: string,
    take: number,
    relations: FindManyOptions<T>['relations'],
): Promise<T[]> {
    const cursor = cursors[queue];
    const validCursor =
        cursor &&
        cursor.source === 'database' &&
        (typeof cursor.id === 'string' || typeof cursor.id === 'number') &&
        typeof cursor.createdAt === 'string' &&
        Number.isFinite(Date.parse(cursor.createdAt));
    const options: FindManyOptions<T> = {
        where: criteria,
        relations,
        order: { createdAt: 'ASC', id: 'ASC' } as FindManyOptions<T>['order'],
        take,
    };
    const databaseType = repository.manager.connection.options.type;
    const timestampCast = ['mysql', 'mariadb'].includes(databaseType) ? 'CHAR' : 'TEXT';
    const query = repository
        .createQueryBuilder('recovery')
        .setFindOptions(options)
        .addSelect(`CAST(recovery.createdAt AS ${timestampCast})`, 'recovery_cursor_timestamp');
    const page = validCursor
        ? query
              .clone()
              .andWhere(
                  '(recovery.createdAt > :recoveryCreatedAt OR (recovery.createdAt = :recoveryCreatedAt AND recovery.id > :recoveryId))',
                  { recoveryCreatedAt: cursor.createdAt, recoveryId: cursor.id },
              )
        : query;
    let result = await page.getRawAndEntities<{
        recovery_cursor_timestamp: string;
        recovery_id: ID;
    }>();
    // Exhaustion starts the next pass, including rows that became eligible behind the cursor.
    if (!result.entities.length && validCursor) result = await query.getRawAndEntities();
    const last = result.entities[result.entities.length - 1];
    const rawLast = last && result.raw.find(row => String(row.recovery_id) === String(last.id));
    // Vendure timestamps have microseconds. Never round the DB paging key through a JS Date.
    if (last && !rawLast) throw new Error('Digital recovery page is missing its database cursor');
    cursors[queue] = rawLast
        ? { createdAt: rawLast.recovery_cursor_timestamp, id: last.id, source: 'database' }
        : undefined;
    return result.entities;
}
