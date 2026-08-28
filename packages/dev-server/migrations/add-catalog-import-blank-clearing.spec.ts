import { DataSource, QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddCatalogImportBlankClearing1787839200000 } from './1787839200000-add-catalog-import-blank-clearing';

describe('catalog import blank clearing migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds a non-null, disabled-by-default mode on %s',
        async databaseType => {
            const table = new Table({
                name: 'catalog_import_job',
                columns: [{ name: 'id', type: 'integer', isPrimary: true }],
            });
            const addColumn = vi.fn();
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn().mockResolvedValue(table),
                addColumn,
            } as unknown as QueryRunner;

            await new AddCatalogImportBlankClearing1787839200000().up(queryRunner);

            expect(addColumn).toHaveBeenCalledOnce();
            const column = addColumn.mock.calls[0][1] as TableColumn;
            expect(column).toMatchObject({
                name: 'clearBlankFields',
                type: 'boolean',
                isNullable: false,
                default: false,
            });
        },
    );

    it('is idempotent and reversible against an actual sqljs schema', async () => {
        const dataSource = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'catalog_import_job',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
            );
            const migration = new AddCatalogImportBlankClearing1787839200000();
            await migration.up(queryRunner);
            await migration.up(queryRunner);

            expect(
                (await queryRunner.getTable('catalog_import_job'))?.findColumnByName('clearBlankFields'),
            ).toMatchObject({ isNullable: false });

            await migration.down(queryRunner);
            expect(
                (await queryRunner.getTable('catalog_import_job'))?.findColumnByName('clearBlankFields'),
            ).toBeUndefined();
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
