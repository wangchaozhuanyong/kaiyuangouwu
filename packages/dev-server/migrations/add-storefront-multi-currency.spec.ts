import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddStorefrontMultiCurrency1787763600000 } from './1787763600000-add-storefront-multi-currency';

describe('storefront multi-currency migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds channel settings and enables CNY/MYR on the China storefront for %s',
        async databaseType => {
            const channel = new Table({
                name: 'channel',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'code', type: 'varchar' },
                    { name: 'availableCurrencyCodes', type: 'varchar' },
                ],
            });
            const addedColumns: TableColumn[] = [];
            const execute = vi.fn().mockResolvedValue({ affected: 1 });
            const where = vi.fn().mockReturnValue({ execute });
            const set = vi.fn().mockReturnValue({ where });
            const update = vi.fn().mockReturnValue({ set });
            const createQueryBuilder = vi.fn().mockReturnValue({ update });
            const queryRunner = {
                connection: { options: { type: databaseType } },
                manager: { createQueryBuilder },
                getTable: vi.fn().mockResolvedValue(channel),
                addColumn: vi.fn((_tableName: string, column: TableColumn) => {
                    addedColumns.push(column);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddStorefrontMultiCurrency1787763600000().up(queryRunner);

            expect(addedColumns).toHaveLength(9);
            expect(addedColumns.map(column => column.name)).toContain('customFieldsCurrencyselectorenabled');
            expect(set).toHaveBeenCalledWith({ availableCurrencyCodes: 'CNY,MYR' });
            expect(where).toHaveBeenCalledWith('code = :code', { code: 'cn-mainland' });
            const selectorColumn = addedColumns.find(
                column => column.name === 'customFieldsCurrencyselectorenabled',
            );
            expect(selectorColumn?.type).toBe(databaseType === 'mysql' ? 'tinyint' : 'boolean');
            const rateColumn = addedColumns.find(column => column.name === 'customFieldsCnytomyrrate');
            expect(rateColumn?.type).toBe(
                databaseType === 'mysql'
                    ? 'double'
                    : databaseType === 'postgres'
                      ? 'double precision'
                      : 'float',
            );
            const dateColumn = addedColumns.find(
                column => column.name === 'customFieldsCurrencyrateupdatedat',
            );
            expect(dateColumn?.type).toBe(databaseType === 'postgres' ? 'timestamp' : 'datetime');
            expect(dateColumn?.precision).toBe(databaseType === 'mysql' ? 6 : undefined);
        },
    );
});
