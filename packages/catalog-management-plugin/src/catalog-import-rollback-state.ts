import { ID } from '@vendure/common/lib/shared-types';
import {
    ProductVariantPrice,
    RequestContext,
    StockLevel,
    StockMovement,
    TransactionalConnection,
} from '@vendure/core';
import { createHash } from 'crypto';

import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';
import { CatalogVariantSupplier } from './entities/catalog-variant-supplier.entity';
import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryPolicy } from './entities/inventory-policy.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';

/** These records can change without touching ProductVariant.updatedAt. */
export async function rollbackState(
    connection: TransactionalConnection,
    ctx: RequestContext,
    variantId: ID,
    lock = false,
): Promise<string> {
    const state: unknown[] = [];
    const targets = [
        [StockLevel, 'productVariantId'],
        [ProductVariantPrice, 'variant'],
        [InventoryLot, 'variantId'],
        [InventoryPolicy, 'variantId'],
        [VariantCostRecord, 'variantId'],
        [CatalogVariantSupplier, 'variantId'],
        [CatalogSourceBinding, 'variantId'],
    ] as const;
    for (const [entity, column] of targets) {
        const query = connection
            .getRepository(ctx, entity)
            .createQueryBuilder('record')
            .where(`record.${column} = :variantId`, { variantId })
            .orderBy('record.id', 'ASC');
        if (lock && supportsRollbackLocks(connection)) query.setLock('pessimistic_write');
        state.push(await query.getMany());
    }
    // The ledger detects an intervening sale/release even when quantities return to the same value.
    state.push(
        await connection
            .getRepository(ctx, StockMovement)
            .createQueryBuilder('movement')
            .select('COUNT(*)', 'count')
            .addSelect('MAX(movement.id)', 'lastId')
            .where('movement.productVariant = :variantId', { variantId })
            .getRawOne(),
    );
    return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

export function supportsRollbackLocks(connection: TransactionalConnection): boolean {
    return ['mysql', 'mariadb', 'postgres', 'aurora-mysql', 'aurora-postgres'].includes(
        connection.rawConnection.options.type,
    );
}
