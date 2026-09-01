import { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignSqliteRuntimeSchema1788278400000 } from './1788278400000-align-sqlite-runtime-schema';

async function collectQueries(databaseType: string, direction: 'up' | 'down' = 'up') {
    const query = vi.fn().mockResolvedValue(undefined);
    const queryRunner = {
        connection: { options: { type: databaseType } },
        query,
    } as unknown as QueryRunner;
    const migration = new AlignSqliteRuntimeSchema1788278400000();

    if (direction === 'up') {
        await migration.up(queryRunner);
    } else {
        await migration.down();
    }

    return query.mock.calls.map(call => call[0] as string);
}

describe('SQLite runtime schema alignment', () => {
    it.each(['mysql', 'mariadb', 'postgres'])('does not execute SQLite SQL on %s', async databaseType => {
        await expect(collectQueries(databaseType, 'up')).resolves.toEqual([]);
        await expect(collectQueries(databaseType, 'down')).resolves.toEqual([]);
    });

    it('uses a non-destructive no-op rollback', async () => {
        await expect(collectQueries('sqlite', 'down')).resolves.toEqual([]);
    });

    it('copies the same columns for every rebuilt table', async () => {
        const queries = await collectQueries('better-sqlite3');
        const copyQueries = queries.filter(query => query.startsWith('INSERT INTO "temporary_'));

        expect(copyQueries.length).toBeGreaterThan(20);
        for (const query of copyQueries) {
            const match = query.match(/^INSERT INTO "temporary_([^"]+)"\((.+)\) SELECT (.+) FROM "\1"$/u);
            expect(match, query).not.toBeNull();
            expect(match?.[2], query).toBe(match?.[3]);
        }
    });

    it('aligns every audited table and keeps storageKey uniqueness as one named index', async () => {
        const queries = await collectQueries('sqlite');
        const rebuiltTables = new Set(
            queries
                .map(query => query.match(/^CREATE TABLE "temporary_([^"]+)"/u)?.[1])
                .filter((tableName): tableName is string => tableName != null),
        );

        expect([...rebuiltTables].sort()).toEqual(
            [
                'catalog_import_job',
                'catalog_import_row',
                'catalog_inventory_lot',
                'catalog_inventory_lot_movement',
                'catalog_inventory_policy',
                'catalog_supplier',
                'customer_coupon',
                'image_compliance_audit_event',
                'image_generation_config',
                'image_generation_cost_event',
                'image_generation_dispatch',
                'image_generation_job',
                'image_generation_output',
                'image_generation_runtime_status',
                'image_model_config',
                'image_private_asset',
                'image_prompt_optimization',
                'image_provider_credential',
                'image_usage_quota_bucket',
                'image_usage_quota_event',
                'product',
                'product_variant',
                'referral_program_config',
                'store_usdt_manual_refund',
            ].sort(),
        );

        const privateAssetTables = queries.filter(query =>
            query.startsWith('CREATE TABLE "temporary_image_private_asset"'),
        );
        expect(privateAssetTables).toHaveLength(2);
        expect(privateAssetTables.every(query => !query.includes('UQ_1fc089a5d1f00e49613178fd263'))).toBe(
            true,
        );
        expect(
            queries.filter(query =>
                query.startsWith(
                    'CREATE UNIQUE INDEX "IDX_image_private_asset_storage_key" ON "image_private_asset"',
                ),
            ),
        ).toHaveLength(1);
    });
});
