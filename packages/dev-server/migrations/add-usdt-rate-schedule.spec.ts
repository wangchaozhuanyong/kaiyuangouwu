import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddUsdtRateSchedule1787788800000 } from './1787788800000-add-usdt-rate-schedule';

describe('USDT rate schedule migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds portable per-Channel schedule fields for %s',
        async databaseType => {
            const addedColumns: TableColumn[] = [];
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi
                    .fn()
                    .mockResolvedValue(
                        new Table({ name: 'channel', columns: [{ name: 'id', type: 'int' }] }),
                    ),
                addColumn: vi.fn((_tableName: string, column: TableColumn) => {
                    addedColumns.push(column);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddUsdtRateSchedule1787788800000().up(queryRunner);

            expect(addedColumns).toHaveLength(3);
            expect(
                addedColumns.find(column => column.name === 'customFieldsUsdtrateschedulemode'),
            ).toMatchObject({ type: 'varchar', length: '16', default: "'INTERVAL'" });
            expect(
                addedColumns.find(column => column.name === 'customFieldsUsdtrateintervalminutes'),
            ).toMatchObject({ type: 'int', default: 5 });
            expect(
                addedColumns.find(column => column.name === 'customFieldsUsdtratedailytime'),
            ).toMatchObject({ type: 'varchar', length: '5', default: "'10:00'" });
        },
    );
});
