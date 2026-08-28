import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignCatalogManagementSchema1787832000000 } from './1787832000000-align-catalog-management-schema';

function createTables(aligned = false) {
    return new Map<string, Table>([
        [
            'product_variant',
            new Table({
                name: 'product_variant',
                columns: [
                    {
                        name: 'customFieldsPackagequantity',
                        type: aligned ? 'double' : 'float',
                        isNullable: true,
                        default: aligned ? 1 : undefined,
                    },
                ],
            }),
        ],
        ...['catalog_import_job', 'catalog_inventory_lot'].map(
            tableName =>
                [
                    tableName,
                    new Table({
                        name: tableName,
                        columns: [
                            {
                                name: 'version',
                                type: 'int',
                                isNullable: false,
                                default: aligned ? undefined : 1,
                            },
                        ],
                    }),
                ] as const,
        ),
    ]);
}

describe('catalog management schema alignment', () => {
    it('changes MySQL column metadata in place without dropping data-bearing columns', async () => {
        const tables = createTables();
        const changeColumn = vi.fn().mockResolvedValue(undefined);
        const dropColumn = vi.fn();
        const addColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
            dropColumn,
            addColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogManagementSchema1787832000000().up(queryRunner);

        expect(changeColumn).toHaveBeenCalledTimes(3);
        const alignedColumns = changeColumn.mock.calls.map(call => {
            const [table, _current, aligned] = call as unknown as [Table, TableColumn, TableColumn];
            return {
                table: table.name,
                name: aligned.name,
                type: aligned.type,
                isNullable: aligned.isNullable,
                default: aligned.default,
            };
        });
        expect(alignedColumns).toEqual([
            {
                table: 'product_variant',
                name: 'customFieldsPackagequantity',
                type: 'double',
                isNullable: true,
                default: 1,
            },
            {
                table: 'catalog_import_job',
                name: 'version',
                type: 'int',
                isNullable: false,
                default: undefined,
            },
            {
                table: 'catalog_inventory_lot',
                name: 'version',
                type: 'int',
                isNullable: false,
                default: undefined,
            },
        ]);
        expect(dropColumn).not.toHaveBeenCalled();
        expect(addColumn).not.toHaveBeenCalled();
    });

    it('is idempotent when MySQL metadata is already aligned', async () => {
        const tables = createTables(true);
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mariadb' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogManagementSchema1787832000000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });

    it.each(['postgres', 'sqlite'] as const)('leaves %s unchanged', async databaseType => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignCatalogManagementSchema1787832000000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });

    it('skips missing tables and columns safely', async () => {
        const tables = new Map<string, Table>([
            ['product_variant', new Table({ name: 'product_variant', columns: [] })],
        ]);
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignCatalogManagementSchema1787832000000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });
});
