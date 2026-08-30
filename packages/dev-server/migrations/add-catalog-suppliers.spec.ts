import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCatalogSuppliers1787868000000 } from './1787868000000-add-catalog-suppliers';

describe('catalog suppliers migration', () => {
    it('creates channel-scoped suppliers and one default supplier per SKU', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            for (const tableName of ['channel', 'product_variant']) {
                await queryRunner.createTable(
                    new Table({
                        name: tableName,
                        columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                    }),
                );
            }
            const migration = new AddCatalogSuppliers1787868000000();
            await migration.up(queryRunner);

            const suppliers = await queryRunner.getTable('catalog_supplier');
            const associations = await queryRunner.getTable('catalog_variant_supplier');
            expect(suppliers).toBeDefined();
            expect(
                suppliers?.indices.find(index => index.name === 'IDX_catalog_supplier_channel_name')
                    ?.isUnique,
            ).toBe(true);
            expect(
                associations?.indices.find(
                    index => index.name === 'IDX_catalog_variant_supplier_channel_variant',
                )?.isUnique,
            ).toBe(true);

            await queryRunner.query('INSERT INTO channel DEFAULT VALUES');
            await queryRunner.query('INSERT INTO product_variant DEFAULT VALUES');
            const [{ id: channelId }] = await queryRunner.query('SELECT id FROM channel LIMIT 1');
            const [{ id: variantId }] = await queryRunner.query('SELECT id FROM product_variant LIMIT 1');
            await queryRunner.query(
                `INSERT INTO catalog_supplier
                    (channelId, code, name, normalizedName, enabled)
                 VALUES (?, ?, ?, ?, ?)`,
                [channelId, 'SUP-A', '供货商A', '供货商a', true],
            );
            await queryRunner.query(
                `INSERT INTO catalog_supplier
                    (channelId, code, name, normalizedName, enabled)
                 VALUES (?, ?, ?, ?, ?)`,
                [channelId, 'SUP-B', '供货商B', '供货商b', true],
            );
            const supplierRows = await queryRunner.query(
                'SELECT id, code FROM catalog_supplier ORDER BY code',
            );
            await queryRunner.query(
                `INSERT INTO catalog_variant_supplier (channelId, variantId, supplierId)
                 VALUES (?, ?, ?)`,
                [channelId, variantId, supplierRows[0].id],
            );
            await queryRunner.query(
                'UPDATE catalog_variant_supplier SET supplierId = ? WHERE channelId = ? AND variantId = ?',
                [supplierRows[1].id, channelId, variantId],
            );
            const [binding] = await queryRunner.query(
                'SELECT supplierId FROM catalog_variant_supplier WHERE channelId = ? AND variantId = ?',
                [channelId, variantId],
            );
            expect(String(binding.supplierId)).toBe(String(supplierRows[1].id));
            await expect(
                queryRunner.query(
                    `INSERT INTO catalog_variant_supplier (channelId, variantId, supplierId)
                     VALUES (?, ?, ?)`,
                    [channelId, variantId, supplierRows[0].id],
                ),
            ).rejects.toThrow();
            await expect(
                queryRunner.query(
                    `INSERT INTO catalog_supplier
                        (channelId, code, name, normalizedName, enabled)
                     VALUES (?, ?, ?, ?, ?)`,
                    [channelId, 'SUP-C', '供货商A副本', '供货商a', true],
                ),
            ).rejects.toThrow();

            await migration.down(queryRunner);
            await expect(queryRunner.hasTable('catalog_variant_supplier')).resolves.toBe(false);
            await expect(queryRunner.hasTable('catalog_supplier')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
