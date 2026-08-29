import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCatalogProductSourceCreatedAt1787857200000 } from './1787857200000-add-catalog-product-source-created-at';

describe('catalog product source-created-at migration', () => {
    it('adds and rolls back the private product source date column', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'product',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
            );
            const migration = new AddCatalogProductSourceCreatedAt1787857200000();
            await migration.up(queryRunner);
            expect(
                (await queryRunner.getTable('product'))?.findColumnByName('customFieldsSourcecreatedat'),
            ).toBeDefined();

            await migration.down(queryRunner);
            expect(
                (await queryRunner.getTable('product'))?.findColumnByName('customFieldsSourcecreatedat'),
            ).toBeUndefined();
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
