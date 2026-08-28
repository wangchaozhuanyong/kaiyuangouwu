import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCatalogManagement1787824800000 } from './1787824800000-add-catalog-management';

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
