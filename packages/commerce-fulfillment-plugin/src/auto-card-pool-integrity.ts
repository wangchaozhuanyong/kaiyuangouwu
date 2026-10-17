import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { Brackets, In, LockNotSupportedOnGivenDriverError } from 'typeorm';

import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { DigitalOrderReservation, DigitalVariantConfig } from './entities/digital-product.entity';

/** Fail closed when a historical state overwrite has lost a reservation's card markers.
 * Released IDs remain in reservation JSON, so a reference alone is not a live claim.
 */
export async function inconsistentPoolReservationIds(
    ctx: RequestContext,
    connection: TransactionalConnection,
    configId: ID,
    candidateIds: ID[],
    ownReservationId?: ID,
): Promise<Set<string>> {
    if (!candidateIds.length) return new Set();
    const repository = connection.getRepository(ctx, DigitalOrderReservation);
    const source = repository
        .createQueryBuilder('reservation')
        .subQuery()
        .select('digital.id')
        .from(DigitalVariantConfig, 'digital')
        .innerJoin(
            AutoCardConfig,
            'poolConfig',
            'poolConfig.productVariantId = digital.productVariantId AND poolConfig.channelId = digital.channelId',
        )
        .where('poolConfig.id = :poolConfigId')
        .getQuery();
    if (['mysql', 'mariadb'].includes(connection.rawConnection.options.type)) {
        // Release/consume already use digital-config -> reservation -> pool.
        // Serialize shared-pool claim inspection in that same order; otherwise
        // recovery could hold another order's reservation while awaiting config.
        // The subquery keeps AutoCardConfig outside this locking read.
        await connection
            .getRepository(ctx, DigitalVariantConfig)
            .createQueryBuilder('sourceDigital')
            .where('sourceDigital.id IN ' + source, { poolConfigId: configId })
            .setLock('pessimistic_write')
            .getMany();
    }
    const matchingClaims = (claimIds: ID[]) => {
        const query = repository
            .createQueryBuilder('reservation')
            .where('reservation.configId IN ' + source, { poolConfigId: configId })
            .andWhere('reservation.stockPolicy = :poolPolicy', { poolPolicy: 'pool_derived' })
            .andWhere('reservation.state IN (:...claimStates)', { claimStates: ['HELD', 'CONSUMED'] })
            .andWhere(
                new Brackets(claimQuery => {
                    claimIds.forEach((id, index) =>
                        claimQuery.orWhere(`reservation.poolItemIdsJson LIKE :claimId${index}`, {
                            [`claimId${index}`]: `%${String(id)}%`,
                        }),
                    );
                }),
            );
        // Lock only the reservation table, not the source configuration subquery.
        // This is a current read under MySQL RR, before any pool-item row locks.
        return (
            ['mysql', 'mariadb'].includes(connection.rawConnection.options.type)
                ? query.setLock('pessimistic_read')
                : query
        ).getMany();
    };
    const reservations = await matchingClaims(candidateIds);
    const parsed = reservations.map(row => ({ row, ids: JSON.parse(row.poolItemIdsJson) as ID[] }));
    const ids = [...new Set(parsed.flatMap(item => item.ids.map(String)))];
    if (!ids.length) return new Set(ownReservationId == null ? [] : candidateIds.map(String));
    const markers = await connection.getRepository(ctx, AutoCardPoolItem).find({
        where: { id: In(ids), configId },
        select: { id: true, state: true, assignedAt: true, deliveryId: true },
    });
    // A card released by A can already be reserved/sold to B. Its marker must
    // never be counted as evidence that A's other historical claims are intact.
    const related = (await matchingClaims(ids)).map(row => ({
        row,
        ids: JSON.parse(row.poolItemIdsJson) as ID[],
    }));
    const deliveryIds = markers.flatMap(item => (item.deliveryId == null ? [] : [item.deliveryId]));
    const deliveries = deliveryIds.length
        ? await connection.getRepository(ctx, AutoCardDelivery).find({
              where: { id: In(deliveryIds), configId },
              select: { id: true, orderLineId: true },
          })
        : [];
    const assignedOwners = new Map(
        deliveries.map(delivery => [String(delivery.id), String(delivery.orderLineId)]),
    );
    const ownedMarkers = (row: DigitalOrderReservation, id: string): boolean => {
        const marker = markers.find(item => String(item.id) === id);
        if (!marker) return false;
        if (marker.deliveryId != null)
            return assignedOwners.get(String(marker.deliveryId)) === String(row.orderLineId);
        if (marker.state !== 'RESERVED' || marker.assignedAt != null) return false;
        const holders = related.filter(
            item =>
                item.row.state === 'HELD' &&
                item.row.quantity > item.row.releasedQuantity + item.row.consumedQuantity &&
                item.ids.some(value => String(value) === id),
        );
        // Unreleased reservations claim every listed ID. Partial-release JSON
        // alone cannot resolve overlapping owners; quarantine an ambiguous claim.
        const complete = holders.filter(item => item.row.releasedQuantity === 0);
        const owners = complete.length ? complete : holders;
        return owners.length === 1 && String(owners[0].row.id) === String(row.id);
    };
    const candidates = new Set(candidateIds.map(String));
    const blocked = new Set<string>();
    if (ownReservationId != null) {
        const own = parsed.find(item => String(item.row.id) === String(ownReservationId));
        for (const id of candidates) {
            if (!own || own.row.state !== 'HELD' || !ownedMarkers(own.row, id)) blocked.add(id);
        }
    }
    for (const { row, ids: referenced } of parsed) {
        if (String(row.id) === String(ownReservationId)) continue;
        const unique = [...new Set(referenced.map(String))];
        const expected = Math.max(0, row.quantity - row.releasedQuantity);
        if (unique.filter(id => ownedMarkers(row, id)).length >= expected) continue;
        // With missing markers we cannot distinguish a lost claim from a released
        // card. Quarantine those candidates rather than repairing/reissuing data.
        unique.filter(id => candidates.has(id)).forEach(id => blocked.add(id));
    }
    return blocked;
}

export async function usablePoolItems(
    ctx: RequestContext,
    connection: TransactionalConnection,
    configId: ID,
    quantity: number,
    state: 'AVAILABLE' | 'RESERVED' = 'AVAILABLE',
    reservedIds?: ID[],
    ownReservationId?: ID,
    lock = false,
): Promise<AutoCardPoolItem[]> {
    const repository = connection.getRepository(ctx, AutoCardPoolItem);
    const excluded = new Set<string>();
    for (;;) {
        let query = repository
            .createQueryBuilder('item')
            .where('item.configId = :configId', { configId })
            .andWhere('item.state = :state', { state })
            .andWhere('item.deliveryId IS NULL')
            .andWhere('item.assignedAt IS NULL')
            .orderBy('item.sequence', 'ASC')
            .addOrderBy('item.id', 'ASC')
            .take(quantity);
        if (reservedIds) {
            if (!reservedIds.length) return [];
            query = query.andWhere('item.id IN (:...reservedIds)', { reservedIds });
        }
        if (excluded.size)
            query = query.andWhere('item.id NOT IN (:...excluded)', { excluded: [...excluded] });
        const items = await query.getMany();
        const blocked = await inconsistentPoolReservationIds(
            ctx,
            connection,
            configId,
            items.map(item => item.id),
            ownReservationId,
        );
        if (!blocked.size) {
            if (!lock || !items.length) return items;
            try {
                const current = await query
                    .clone()
                    .andWhere('item.id IN (:...selectedIds)', {
                        selectedIds: items.map(item => item.id),
                    })
                    .setLock('pessimistic_write')
                    .getMany();
                if (current.length === items.length) return current;
                // A release can commit while this transaction waits for the
                // shared configuration lock. Skip snapshot-only candidates and
                // continue to the next card instead of delaying valid recovery.
                const currentIds = new Set(current.map(item => String(item.id)));
                const previousSnapshotSize = excluded.size;
                items
                    .filter(item => !currentIds.has(String(item.id)))
                    .forEach(item => excluded.add(String(item.id)));
                if (excluded.size === previousSnapshotSize) return current;
                continue;
            } catch (error) {
                if (!(error instanceof LockNotSupportedOnGivenDriverError)) throw error;
                return items;
            }
        }
        const previousSize = excluded.size;
        blocked.forEach(id => excluded.add(id));
        if (excluded.size === previousSize) return items.filter(item => !excluded.has(String(item.id)));
    }
}
