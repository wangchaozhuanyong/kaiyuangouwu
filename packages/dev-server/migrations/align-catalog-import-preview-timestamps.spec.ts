import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignCatalogImportPreviewTimestamps1789387200000 } from './1789387200000-align-catalog-import-preview-timestamps';

describe('catalog import preview timestamp alignment', () => {
    it.each(['mysql', 'mariadb'])('aligns both preview versions to microseconds on %s', async type => {
        const table = new Table({
            name: 'catalog_import_row',
            columns: [
                { name: 'expectedProductUpdatedAt', type: 'datetime', isNullable: true },
                { name: 'expectedVariantUpdatedAt', type: 'datetime', isNullable: true },
            ],
        });
        const changeColumn = vi.fn(() => Promise.resolve());
        const runner = {
            connection: { options: { type } },
            getTable: vi.fn(() => Promise.resolve(table)),
            changeColumn,
        } as unknown as QueryRunner;
        const migration = new AlignCatalogImportPreviewTimestamps1789387200000();

        await migration.up(runner);
        expect(changeColumn).toHaveBeenCalledTimes(2);
        expect(table.columns.map(column => column.precision)).toEqual([6, 6]);
        await migration.up(runner);
        expect(changeColumn).toHaveBeenCalledTimes(2);
        await expect(migration.down(runner)).rejects.toThrow('without losing saved preview versions');
        expect(changeColumn).toHaveBeenCalledTimes(2);
        expect(table.columns.map(column => column.precision)).toEqual([6, 6]);
    });

    it.each(['postgres', 'sqljs'])('does not change %s timestamp storage', async type => {
        const getTable = vi.fn();
        const runner = { connection: { options: { type } }, getTable } as unknown as QueryRunner;
        const migration = new AlignCatalogImportPreviewTimestamps1789387200000();

        await migration.up(runner);
        await migration.down(runner);
        expect(getTable).not.toHaveBeenCalled();
    });

    it('fails closed when a required preview column is missing', async () => {
        const table = new Table({
            name: 'catalog_import_row',
            columns: [new TableColumn({ name: 'expectedProductUpdatedAt', type: 'datetime' })],
        });
        const changeColumn = vi.fn(() => Promise.resolve());
        const runner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn(() => Promise.resolve(table)),
            changeColumn,
        } as unknown as QueryRunner;

        await expect(new AlignCatalogImportPreviewTimestamps1789387200000().up(runner)).rejects.toThrow(
            'expectedVariantUpdatedAt must exist',
        );
        expect(changeColumn).not.toHaveBeenCalled();
    });
});
