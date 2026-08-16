import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { EnableSearchStockIndex1786773000000 } from './1786773000000-enable-search-stock-index';

describe('EnableSearchStockIndex1786773000000', () => {
    let dataSource: DataSource | undefined;

    afterEach(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it('applies and rolls back both stock columns in a temporary database', async () => {
        dataSource = await new DataSource({ type: 'sqljs' }).initialize();
        await dataSource.query(
            'CREATE TABLE "search_index_item" ("productVariantId" integer NOT NULL PRIMARY KEY)',
        );
        const queryRunner = dataSource.createQueryRunner();
        const migration = new EnableSearchStockIndex1786773000000();

        await migration.up(queryRunner);
        const migrated = await queryRunner.getTable('search_index_item');
        expect(migrated?.findColumnByName('inStock')).toMatchObject({ type: 'boolean' });
        expect(migrated?.findColumnByName('productInStock')).toMatchObject({ type: 'boolean' });

        await migration.down(queryRunner);
        const reverted = await queryRunner.getTable('search_index_item');
        expect(reverted?.findColumnByName('inStock')).toBeUndefined();
        expect(reverted?.findColumnByName('productInStock')).toBeUndefined();
        await queryRunner.release();
    });
});
