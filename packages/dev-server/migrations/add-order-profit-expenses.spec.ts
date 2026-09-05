import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddOrderProfitExpenses1788652800000 } from './1788652800000-add-order-profit-expenses';

describe('order profit expenses migration', () => {
    it('applies and rolls back the expense table against SQL.js', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            for (const tableName of ['channel', 'order']) {
                await queryRunner.createTable(
                    new Table({
                        name: tableName,
                        columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                    }),
                );
            }
            const migration = new AddOrderProfitExpenses1788652800000();

            await migration.up(queryRunner);

            const table = await queryRunner.getTable('catalog_order_profit_expense');
            expect(table?.findColumnByName('carrierShippingCostMicrounits')?.isNullable).toBe(true);
            expect(table?.findColumnByName('paymentFeeMicrounits')?.type).toBe('bigint');
            expect(
                table?.indices.find(index => index.name === 'IDX_catalog_order_profit_expense_scope')
                    ?.isUnique,
            ).toBe(true);
            expect(table?.foreignKeys.map(key => key.referencedTableName).sort()).toEqual([
                'channel',
                'order',
            ]);

            await migration.up(queryRunner);
            await migration.down(queryRunner);
            await expect(queryRunner.hasTable('catalog_order_profit_expense')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
