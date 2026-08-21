import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { AlignSearchStockDefaults1787328000000 } from './1787328000000-align-search-stock-defaults';

describe('AlignSearchStockDefaults1787328000000', () => {
    let dataSource: DataSource | undefined;

    afterEach(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it('adds and rolls back defaults without changing the stock columns', async () => {
        dataSource = await new DataSource({ type: 'sqljs' }).initialize();
        await dataSource.query(
            'CREATE TABLE "search_index_item" (' +
                '"productVariantId" integer NOT NULL PRIMARY KEY, ' +
                '"inStock" boolean NOT NULL, ' +
                '"productInStock" boolean NOT NULL' +
                ')',
        );
        const queryRunner = dataSource.createQueryRunner();
        const migration = new AlignSearchStockDefaults1787328000000();

        await migration.up(queryRunner);
        await dataSource.query('INSERT INTO "search_index_item" ("productVariantId") VALUES (1)');
        expect(await dataSource.query('SELECT "inStock", "productInStock" FROM "search_index_item"')).toEqual(
            [{ inStock: 1, productInStock: 1 }],
        );

        const migrated = await queryRunner.getTable('search_index_item');
        expect(migrated?.findColumnByName('inStock')).toMatchObject({ type: 'boolean', isNullable: false });
        expect(migrated?.findColumnByName('productInStock')).toMatchObject({
            type: 'boolean',
            isNullable: false,
        });

        await migration.down(queryRunner);
        const reverted = await queryRunner.getTable('search_index_item');
        expect(reverted?.findColumnByName('inStock')?.default).toBeUndefined();
        expect(reverted?.findColumnByName('productInStock')?.default).toBeUndefined();
        await queryRunner.release();
    });
});
