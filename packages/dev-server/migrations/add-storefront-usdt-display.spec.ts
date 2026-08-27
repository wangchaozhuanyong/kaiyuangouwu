import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddStorefrontUsdtDisplay1787778000000 } from './1787778000000-add-storefront-usdt-display';

describe('storefront USDT display migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds portable USDT rate fields for %s',
        async databaseType => {
            const channel = new Table({ name: 'channel', columns: [{ name: 'id', type: 'int' }] });
            const addedColumns: TableColumn[] = [];
            let quoteTable: Table | undefined;
            const createIndex = vi.fn().mockResolvedValue(undefined);
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn().mockResolvedValue(channel),
                hasTable: vi.fn().mockResolvedValue(false),
                addColumn: vi.fn((_tableName: string, column: TableColumn) => {
                    addedColumns.push(column);
                    return Promise.resolve();
                }),
                createTable: vi.fn((table: Table) => {
                    quoteTable = table;
                    return Promise.resolve();
                }),
                createIndex,
            } as unknown as QueryRunner;

            await new AddStorefrontUsdtDisplay1787778000000().up(queryRunner);

            expect(addedColumns).toHaveLength(5);
            expect(addedColumns.find(column => column.name === 'customFieldsUsdtdisplayenabled')?.type).toBe(
                databaseType === 'mysql' ? 'tinyint' : 'boolean',
            );
            expect(addedColumns.find(column => column.name === 'customFieldsCnyperusdtrate')?.type).toBe(
                databaseType === 'mysql'
                    ? 'double'
                    : databaseType === 'postgres'
                      ? 'double precision'
                      : 'float',
            );
            const updatedAt = addedColumns.find(column => column.name === 'customFieldsUsdtrateupdatedat');
            expect(updatedAt?.type).toBe(databaseType === 'postgres' ? 'timestamp' : 'datetime');
            expect(updatedAt?.precision).toBe(databaseType === 'mysql' ? 6 : undefined);
            expect(quoteTable?.name).toBe('storefront_usdt_checkout_quote');
            expect(quoteTable?.findColumnByName('fiatPerUsdtRate')?.type).toBe(
                databaseType === 'mysql'
                    ? 'double'
                    : databaseType === 'postgres'
                      ? 'double precision'
                      : 'float',
            );
            expect(quoteTable?.findColumnByName('id')?.type).toBe(
                databaseType === 'mysql' ? 'int' : 'integer',
            );
            expect(quoteTable?.foreignKeys).toHaveLength(2);
            expect(createIndex).toHaveBeenCalledOnce();
        },
    );
});
