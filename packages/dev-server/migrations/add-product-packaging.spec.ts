import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddProductPackaging1787911200000 } from './1787911200000-add-product-packaging';

describe('product packaging migration', () => {
    it('applies and rolls back the packaging schema against SQL.js', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            for (const tableName of ['channel', 'product', 'product_variant', 'stock_location', 'order']) {
                await queryRunner.createTable(
                    new Table({
                        name: tableName,
                        columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                    }),
                );
            }
            const migration = new AddProductPackaging1787911200000();

            await migration.up(queryRunner);

            await expect(queryRunner.hasTable('product_packaging_rule')).resolves.toBe(true);
            await expect(queryRunner.hasTable('packaging_unpack_event')).resolves.toBe(true);

            const rule = await queryRunner.getTable('product_packaging_rule');
            expect(rule?.findColumnByName('unitsPerPackage')?.type).toBe('int');
            expect(rule?.foreignKeys).toHaveLength(4);
            expect(
                rule?.indices.find(index => index.name === 'IDX_product_packaging_rule_channel_product')
                    ?.isUnique,
            ).toBe(true);

            const event = await queryRunner.getTable('packaging_unpack_event');
            expect(event?.findColumnByName('orderId')?.isNullable).toBe(true);
            expect(event?.foreignKeys).toHaveLength(4);

            await migration.down(queryRunner);
            await expect(queryRunner.hasTable('packaging_unpack_event')).resolves.toBe(false);
            await expect(queryRunner.hasTable('product_packaging_rule')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
