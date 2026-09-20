import { QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { CloseAfterSalesWorkflow1789596000000 } from './1789596000000-close-after-sales-workflow';

describe('after-sales workflow migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds portable, idempotent workflow evidence on %s',
        async databaseType => {
            const idType = databaseType === 'mysql' ? 'int' : 'integer';
            const tables = new Map(
                [
                    new Table({
                        name: 'after_sales_request',
                        columns: [
                            { name: 'id', type: idType, isPrimary: true },
                            { name: 'channelId', type: idType },
                        ],
                    }),
                    new Table({
                        name: 'after_sales_item',
                        columns: [
                            { name: 'id', type: idType, isPrimary: true },
                            { name: 'requestId', type: idType },
                        ],
                    }),
                    new Table({
                        name: 'after_sales_event',
                        columns: [
                            { name: 'id', type: idType, isPrimary: true },
                            { name: 'requestId', type: idType },
                        ],
                    }),
                ].map(table => [table.name, table]),
            );
            const createForeignKey = vi.fn((table: Table, key: TableForeignKey) => {
                table.addForeignKey(key);
                return Promise.resolve();
            });
            const createIndex = vi.fn((table: Table, index: TableIndex) => {
                table.addIndex(index);
                return Promise.resolve();
            });
            const runner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
                addColumn: vi.fn((table: Table, column: TableColumn) => {
                    table.addColumn(column);
                    return Promise.resolve();
                }),
                createForeignKey,
                createIndex,
            } as unknown as QueryRunner;
            const migration = new CloseAfterSalesWorkflow1789596000000();

            await migration.up(runner);
            await migration.up(runner);

            expect(tables.get('after_sales_request')?.findColumnByName('nextActionDueAt')).toMatchObject({
                type: databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime',
                isNullable: true,
            });
            expect(tables.get('after_sales_item')?.findColumnByName('returnStockLocationId')).toMatchObject({
                type: idType,
                isNullable: true,
            });
            expect(createForeignKey).toHaveBeenCalledOnce();
            expect(createIndex).toHaveBeenCalledTimes(2);
            await expect(migration.down()).rejects.toThrow('Retain after-sales return');
        },
    );
});
