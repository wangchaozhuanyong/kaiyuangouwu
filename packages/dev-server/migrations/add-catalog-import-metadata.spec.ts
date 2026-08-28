import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddCatalogImportMetadata1787828400000 } from './1787828400000-add-catalog-import-metadata';

describe('catalog import metadata migration', () => {
    it('adds auditable sheet metadata without rewriting the original catalog migration', async () => {
        const dataSource = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'catalog_import_job',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
            );
            const migration = new AddCatalogImportMetadata1787828400000();
            await migration.up(queryRunner);

            const migrated = await queryRunner.getTable('catalog_import_job');
            expect(migrated?.findColumnByName('sheetName')).toBeDefined();
            expect(migrated?.findColumnByName('detectedHeaders')?.type).toBe('text');
            expect(migrated?.findColumnByName('fieldMapping')?.type).toBe('text');

            await migration.down(queryRunner);
            const rolledBack = await queryRunner.getTable('catalog_import_job');
            expect(rolledBack?.findColumnByName('sheetName')).toBeUndefined();
            expect(rolledBack?.findColumnByName('detectedHeaders')).toBeUndefined();
            expect(rolledBack?.findColumnByName('fieldMapping')).toBeUndefined();
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
