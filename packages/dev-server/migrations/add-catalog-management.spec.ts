import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCatalogManagement1787824800000 } from './1787824800000-add-catalog-management';
import { AllowUnsetCatalogCost1791676800000 } from './1791676800000-allow-unset-catalog-cost';

describe('catalog management migration', () => {
    it('creates and rolls back the catalog import, cost, policy and lot schema', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            for (const tableName of ['channel', 'stock_location', 'product', 'product_variant']) {
                await queryRunner.createTable(
                    new Table({
                        name: tableName,
                        columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                    }),
                );
            }
            const migration = new AddCatalogManagement1787824800000();
            await migration.up(queryRunner);

            const expectedTables = [
                'catalog_import_job',
                'catalog_import_row',
                'catalog_source_binding',
                'catalog_variant_cost_record',
                'catalog_inventory_policy',
                'catalog_inventory_lot',
            ];
            for (const tableName of expectedTables) {
                await expect(queryRunner.hasTable(tableName)).resolves.toBe(true);
            }
            const variant = await queryRunner.getTable('product_variant');
            expect(variant?.findColumnByName('customFieldsBarcode')).toBeDefined();
            expect(variant?.findColumnByName('customFieldsShelflifedays')).toBeDefined();
            const bindings = await queryRunner.getTable('catalog_source_binding');
            expect(
                bindings?.indices.find(index => index.name === 'IDX_catalog_source_binding_channel_key')
                    ?.isUnique,
            ).toBe(true);
            const policies = await queryRunner.getTable('catalog_inventory_policy');
            expect(
                policies?.indices.find(
                    index => index.name === 'IDX_catalog_inventory_policy_variant_location',
                )?.isUnique,
            ).toBe(true);

            await queryRunner.query('INSERT INTO channel (id) VALUES (1)');
            await queryRunner.query('INSERT INTO product_variant (id) VALUES (1)');
            const insertCost = (cost: number | null, effectiveAt: string) =>
                queryRunner.query(
                    'INSERT INTO catalog_variant_cost_record (variantId, channelId, currencyCode, costMicrounits, effectiveAt, source) VALUES (?, ?, ?, ?, ?, ?)',
                    [1, 1, 'MYR', cost, effectiveAt, 'MANUAL'],
                );
            await insertCost(12_000, '2026-10-01 00:00:00');
            const unsetCostMigration = new AllowUnsetCatalogCost1791676800000();
            await unsetCostMigration.up(queryRunner);
            await unsetCostMigration.up(queryRunner);
            const costTable = await queryRunner.getTable('catalog_variant_cost_record');
            expect(costTable?.findColumnByName('costMicrounits')?.isNullable).toBe(true);
            expect(costTable?.foreignKeys).toHaveLength(2);
            expect(costTable?.indices.some(index => index.name === 'IDX_catalog_variant_cost_current')).toBe(
                true,
            );
            await insertCost(null, '2026-10-02 00:00:00');
            await insertCost(0, '2026-10-03 00:00:00');
            await unsetCostMigration.down();
            expect(
                await queryRunner.query('SELECT costMicrounits FROM catalog_variant_cost_record ORDER BY id'),
            ).toEqual([{ costMicrounits: 12_000 }, { costMicrounits: null }, { costMicrounits: 0 }]);

            await migration.down(queryRunner);
            for (const tableName of expectedTables) {
                await expect(queryRunner.hasTable(tableName)).resolves.toBe(false);
            }
            const rolledBackVariant = await queryRunner.getTable('product_variant');
            expect(rolledBackVariant?.findColumnByName('customFieldsBarcode')).toBeUndefined();
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
