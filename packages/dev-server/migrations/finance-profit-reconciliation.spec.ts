import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { CloseFinanceProfitReconciliation1789693200000 } from './1789693200000-close-finance-profit-reconciliation';

describe('finance profit reconciliation migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)('uses portable identity columns on %s', async type => {
        const created: Table[] = [];
        await new CloseFinanceProfitReconciliation1789693200000().up({
            connection: { options: { type } },
            hasTable: vi.fn((name: string) => Promise.resolve(name === 'catalog_order_profit_expense')),
            hasColumn: vi.fn().mockResolvedValue(false),
            addColumn: vi.fn().mockResolvedValue(undefined),
            createTable: vi.fn((table: Table) => {
                created.push(table);
                return Promise.resolve();
            }),
        } as unknown as QueryRunner);
        expect(created).toHaveLength(1);
        expect(created[0].findColumnByName('id')?.type).toBe(type === 'mysql' ? 'int' : 'integer');
        expect(created[0].indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'UQ_catalog_profit_expense_event_key', isUnique: true }),
            ]),
        );
    });

    it('applies twice and preserves finance evidence on rollback', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            for (const name of ['channel', 'order']) {
                await runner.createTable(
                    new Table({ name, columns: [{ name: 'id', type: 'integer', isPrimary: true }] }),
                );
            }
            await runner.createTable(
                new Table({
                    name: 'catalog_order_profit_expense',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true }],
                }),
            );
            const migration = new CloseFinanceProfitReconciliation1789693200000();
            await migration.up(runner);
            await migration.up(runner);
            await expect(
                runner.hasColumn('catalog_order_profit_expense', 'chargebackMicrounits'),
            ).resolves.toBe(true);
            await expect(runner.hasTable('catalog_order_profit_expense_event')).resolves.toBe(true);
            await expect(migration.down()).rejects.toThrow('Retain chargeback values');
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
