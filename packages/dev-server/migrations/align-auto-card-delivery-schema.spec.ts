import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignAutoCardDeliverySchema1787598000000 } from './1787598000000-align-auto-card-delivery-schema';

describe('AlignAutoCardDeliverySchema migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'repairs an earlier auto-card schema on %s',
        async databaseType => {
            const tables = new Map([
                [
                    'auto_card_config',
                    new Table({
                        name: 'auto_card_config',
                        columns: [
                            { name: 'id', type: 'int' },
                            { name: 'instructions', type: 'text', isNullable: true },
                        ],
                    }),
                ],
                [
                    'auto_card_delivery',
                    new Table({
                        name: 'auto_card_delivery',
                        columns: [
                            { name: 'id', type: 'int' },
                            { name: 'instructionsSnapshot', type: 'text', isNullable: true },
                        ],
                    }),
                ],
            ]);
            const changedColumns: TableColumn[] = [];
            const query = vi.fn().mockResolvedValue(undefined);
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
                addColumn: vi.fn((table: Table, column: TableColumn) => {
                    table.addColumn(column);
                    return Promise.resolve();
                }),
                changeColumn: vi.fn((_table: Table, _old: TableColumn, column: TableColumn) => {
                    changedColumns.push(column);
                    return Promise.resolve();
                }),
                query,
            } as unknown as QueryRunner;

            await new AlignAutoCardDeliverySchema1787598000000().up(queryRunner);

            expect(tables.get('auto_card_delivery')?.findColumnByName('languageCode')).toMatchObject({
                type: 'varchar',
                length: '16',
            });
            expect(changedColumns.map(column => [column.name, column.type, column.isNullable])).toEqual(
                databaseType === 'mysql'
                    ? [['languageCode', 'varchar', false]]
                    : [
                          ['languageCode', 'varchar', false],
                          ['instructions', 'text', false],
                          ['instructionsSnapshot', 'text', false],
                      ],
            );
            expect(query).toHaveBeenCalledTimes(databaseType === 'mysql' ? 5 : 3);
        },
    );
});
