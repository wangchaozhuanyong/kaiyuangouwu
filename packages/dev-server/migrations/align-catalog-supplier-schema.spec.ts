/* eslint-disable @typescript-eslint/require-await -- QueryRunner mocks preserve async database APIs. */
import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignCatalogSupplierSchema1787875200000 } from './1787875200000-align-catalog-supplier-schema';

describe('catalog supplier schema alignment', () => {
    it.each(['mysql', 'mariadb'] as const)('aligns the enabled column on %s', async databaseType => {
        const table = new Table({
            name: 'catalog_supplier',
            columns: [{ name: 'enabled', type: 'tinyint', width: 1, isNullable: false, default: true }],
            indices: [
                {
                    name: 'IDX_catalog_supplier_channel_enabled',
                    columnNames: ['channelId', 'enabled'],
                },
            ],
        });
        const changeColumn = vi.fn(
            async (target: Table, originalColumn: TableColumn, updatedColumn: TableColumn) => {
                target.columns[target.columns.indexOf(originalColumn)] = updatedColumn;
            },
        );
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable: vi.fn(async () => table),
            changeColumn,
        } as unknown as QueryRunner;
        const migration = new AlignCatalogSupplierSchema1787875200000();

        await migration.up(queryRunner);

        expect(changeColumn).toHaveBeenCalledOnce();
        expect(table.findColumnByName('enabled')).toMatchObject({
            type: 'tinyint',
            width: undefined,
            isNullable: false,
            default: 1,
        });

        await migration.up(queryRunner);
        expect(changeColumn).toHaveBeenCalledOnce();
    });

    it.each(['postgres', 'sqlite'] as const)('leaves %s unchanged', async databaseType => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignCatalogSupplierSchema1787875200000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });

    it('accepts an already canonical MySQL column', async () => {
        const table = new Table({
            name: 'catalog_supplier',
            columns: [{ name: 'enabled', type: 'tinyint', isNullable: false, default: "'1'" }],
        });
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn(async () => table),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogSupplierSchema1787875200000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });
});
