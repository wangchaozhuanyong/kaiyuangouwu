import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignCatalogImportBlankClearing1787842800000 } from './1787842800000-align-catalog-import-blank-clearing';

describe('catalog import blank clearing schema alignment', () => {
    it.each(['mysql', 'mariadb'] as const)(
        'removes legacy boolean display width on %s without replacing the column',
        async databaseType => {
            const table = new Table({
                name: 'catalog_import_job',
                columns: [
                    {
                        name: 'clearBlankFields',
                        type: 'tinyint',
                        width: 1,
                        isNullable: false,
                        default: "'0'",
                    },
                ],
            });
            const changeColumn = vi.fn().mockResolvedValue(undefined);
            const dropColumn = vi.fn();
            const addColumn = vi.fn();
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn().mockResolvedValue(table),
                changeColumn,
                dropColumn,
                addColumn,
            } as unknown as QueryRunner;

            await new AlignCatalogImportBlankClearing1787842800000().up(queryRunner);

            expect(changeColumn).toHaveBeenCalledOnce();
            const aligned = changeColumn.mock.calls[0][2] as TableColumn;
            expect(aligned).toMatchObject({
                name: 'clearBlankFields',
                type: 'tinyint',
                isNullable: false,
                default: 0,
            });
            expect(aligned.width).toBeUndefined();
            expect(dropColumn).not.toHaveBeenCalled();
            expect(addColumn).not.toHaveBeenCalled();
        },
    );

    it('is idempotent when MySQL metadata is already aligned', async () => {
        const table = new Table({
            name: 'catalog_import_job',
            columns: [
                {
                    name: 'clearBlankFields',
                    type: 'tinyint',
                    isNullable: false,
                    default: 0,
                },
            ],
        });
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(table),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogImportBlankClearing1787842800000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });

    it.each(['postgres', 'sqlite'] as const)('leaves %s unchanged', async databaseType => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignCatalogImportBlankClearing1787842800000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });

    it('skips a missing table safely', async () => {
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(undefined),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogImportBlankClearing1787842800000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });
});
