/* eslint-disable @typescript-eslint/require-await -- QueryRunner mocks preserve async database APIs. */
import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignAfterSalesAutoCardSchema1787680800000 } from './1787680800000-align-after-sales-auto-card-schema';

describe('AlignAfterSalesAutoCardSchema1787680800000', () => {
    it.each(['mysql', 'mariadb', 'postgres', 'sqlite'] as const)(
        'repairs schema drift idempotently on %s',
        async databaseType => {
            const tables: Record<string, Table> = {
                after_sales_request: new Table({
                    name: 'after_sales_request',
                    columns: [
                        { name: 'id', type: databaseType === 'postgres' ? 'integer' : 'int' },
                        { name: 'resolution', type: 'text', isNullable: true },
                    ],
                }),
                auto_card_config: new Table({
                    name: 'auto_card_config',
                    columns: [
                        {
                            name: 'enabled',
                            type: ['mysql', 'mariadb'].includes(databaseType) ? 'tinyint' : 'boolean',
                            width: ['mysql', 'mariadb'].includes(databaseType) ? 1 : undefined,
                            isNullable: true,
                        },
                    ],
                }),
            };
            const addColumn = vi.fn(async (table: Table, column: TableColumn) => {
                table.columns.push(column);
            });
            const changeColumn = vi.fn(
                async (table: Table, originalColumn: TableColumn, updatedColumn: TableColumn) => {
                    const index = table.columns.indexOf(originalColumn);
                    table.columns[index] = updatedColumn;
                },
            );
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn(async (name: string) => tables[name]),
                addColumn,
                changeColumn,
            } as unknown as QueryRunner;
            const migration = new AlignAfterSalesAutoCardSchema1787680800000();

            await migration.up(queryRunner);

            expect(addColumn).toHaveBeenCalledTimes(2);
            expect(
                addColumn.mock.calls.map(([, column]) => ({
                    name: column.name,
                    type: column.type,
                    isNullable: column.isNullable,
                })),
            ).toEqual([
                { name: 'resolutionZh', type: 'text', isNullable: true },
                { name: 'resolutionEn', type: 'text', isNullable: true },
            ]);
            expect(changeColumn).toHaveBeenCalledOnce();
            const updatedEnabled = tables.auto_card_config.findColumnByName('enabled');
            expect(updatedEnabled).toMatchObject({
                type: ['mysql', 'mariadb'].includes(databaseType) ? 'tinyint' : 'boolean',
                isNullable: false,
                default: ['mysql', 'mariadb'].includes(databaseType) ? 1 : true,
            });
            expect(updatedEnabled?.width).toBeUndefined();

            await migration.up(queryRunner);

            expect(addColumn).toHaveBeenCalledTimes(2);
            expect(changeColumn).toHaveBeenCalledOnce();
        },
    );

    it.each([
        ['mysql', "'1'"],
        ['postgres', "'true'::boolean"],
        ['sqlite', '(1)'],
    ] as const)('accepts an existing true default on %s', async (databaseType, defaultValue) => {
        const configTable = new Table({
            name: 'auto_card_config',
            columns: [
                {
                    name: 'enabled',
                    type: databaseType === 'mysql' ? 'tinyint' : 'boolean',
                    isNullable: false,
                    default: defaultValue,
                },
            ],
        });
        const changeColumn = vi.fn(async () => undefined);
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable: vi.fn(async (name: string) => (name === 'auto_card_config' ? configTable : undefined)),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignAfterSalesAutoCardSchema1787680800000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });
});
