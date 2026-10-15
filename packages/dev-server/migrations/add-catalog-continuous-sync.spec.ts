import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCatalogContinuousSync1792022400000 } from './1792022400000-add-catalog-continuous-sync';

describe('opt-in catalog synchronization migration', () => {
    it('creates disabled rules and preserves resource and accepted-order history when resumed', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        try {
            const runner = database.createQueryRunner();
            const migration = new AddCatalogContinuousSync1792022400000();
            await migration.up(runner);
            await runner.query(
                'INSERT INTO catalog_sync_rule (sourceChannelId, sourceCollectionId, targetChannelId, actorUserId) VALUES (1, 2, 3, 4)',
            );
            const [rule] = await runner.query('SELECT * FROM catalog_sync_rule');
            expect(rule.enabled).toBe(0);
            expect(rule.state).toBe('DISABLED');
            expect(rule.leaseToken).toBeNull();
            await runner.query(
                'INSERT INTO catalog_supply_snapshot (orderId, orderLineId, productVariantId, ' +
                    'channelId, sourceChannelId, ruleId, configuration) VALUES (10, 11, 12, 3, 1, ?, ?)',
                [rule.id, JSON.stringify({ price: 600, currencyCode: 'MYR' })],
            );
            await migration.up(runner);
            expect(await runner.query('SELECT * FROM catalog_supply_snapshot')).toHaveLength(1);
            expect(
                (await runner.getTable('catalog_supply_snapshot'))?.indices.some(
                    index => index.name === 'IDX_catalog_supply_snapshot_scope',
                ),
            ).toBe(true);
            await expect(migration.down()).rejects.toThrow('do not drop delivery history');
            expect(await runner.query('SELECT * FROM catalog_supply_snapshot')).toHaveLength(1);
        } finally {
            await database.destroy();
        }
    });
});
