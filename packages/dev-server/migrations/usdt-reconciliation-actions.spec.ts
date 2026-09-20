import { DataSource, QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddUsdtReconciliationActions1789498800000 } from './1789498800000-add-usdt-reconciliation-actions';

describe('USDT reconciliation action migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'adds portable resolution fields and append-only evidence on %s',
        async databaseType => {
            const idType = databaseType === 'mysql' ? 'int' : 'integer';
            const tables = new Map([
                ['channel', idTable('channel', idType)],
                ['user', idTable('user', idType)],
                ['storefront_usdt_payment_intent', idTable('storefront_usdt_payment_intent', idType, true)],
            ]);
            const addColumn = vi.fn();
            const createTable = vi.fn();
            const builder = updateBuilder();
            await new AddUsdtReconciliationActions1789498800000().up({
                connection: { options: { type: databaseType } },
                manager: { createQueryBuilder: vi.fn(() => builder) },
                getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
                addColumn,
                createTable,
            } as unknown as QueryRunner);

            expect(addColumn.mock.calls.map(call => call[1].name)).toEqual([
                'manualReviewCode',
                'resolvedAt',
                'resolvedByUserId',
                'resolutionActionId',
            ]);
            expect(builder.execute).toHaveBeenCalledTimes(5);
            const table = createTable.mock.calls[0][0] as Table;
            expect(table.findColumnByName('operatorUserId')?.type).toBe(idType);
            expect(table.findColumnByName('usdtAmountBaseUnits')).toMatchObject({
                type: 'decimal',
                precision: 30,
                scale: 0,
                isNullable: true,
            });
            expect(table.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'IDX_store_usdt_reconciliation_intent_created' }),
                    expect.objectContaining({
                        name: 'IDX_store_usdt_reconciliation_transaction',
                        isUnique: true,
                    }),
                ]),
            );
        },
    );

    it('applies twice on SQL.js and refuses to delete financial evidence on rollback', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.createTable(idTable('channel', 'integer'));
            await runner.createTable(idTable('user', 'integer'));
            await runner.createTable(idTable('storefront_usdt_payment_intent', 'integer', true));
            const migration = new AddUsdtReconciliationActions1789498800000();
            await migration.up(runner);
            await migration.up(runner);
            await runner.query('INSERT INTO channel DEFAULT VALUES');
            await runner.query('INSERT INTO user DEFAULT VALUES');
            await runner.query('INSERT INTO storefront_usdt_payment_intent DEFAULT VALUES');
            await runner.query(
                `INSERT INTO store_usdt_reconciliation_action
                    (channelId, intentId, orderId, action, outcome, operatorUserId, reason)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [1, 1, 1, 'RETRY_SETTLEMENT', 'SETTLED', 1, '人工复核后重试'],
            );
            await expect(migration.down()).rejects.toThrow('Retain USDT reconciliation evidence');
            await expect(runner.hasTable('store_usdt_reconciliation_action')).resolves.toBe(true);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});

function idTable(name: string, type: string, reviewFields = false): Table {
    return new Table({
        name,
        columns: [
            {
                name: 'id',
                type,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment',
            },
            ...(reviewFields
                ? [
                      new TableColumn({ name: 'status', type: 'varchar', length: '24', isNullable: true }),
                      new TableColumn({
                          name: 'failureReason',
                          type: 'varchar',
                          length: '500',
                          isNullable: true,
                      }),
                  ]
                : []),
        ],
    });
}

function updateBuilder() {
    return {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 0 }),
    };
}
