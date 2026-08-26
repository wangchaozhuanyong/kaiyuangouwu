import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddUsdtTrc20Payments1787781600000 } from './1787781600000-add-usdt-trc20-payments';

describe('USDT TRC20 payment migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates the portable secure payment-intent table for %s',
        async databaseType => {
            let created: Table | undefined;
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn().mockResolvedValue(false),
                createTable: vi.fn((table: Table) => {
                    created = table;
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddUsdtTrc20Payments1787781600000().up(queryRunner);

            expect(created?.name).toBe('storefront_usdt_payment_intent');
            expect(created?.findColumnByName('id')?.type).toBe(databaseType === 'mysql' ? 'int' : 'integer');
            expect(created?.findColumnByName('expectedUsdtAmount')).toMatchObject({
                type: 'decimal',
                precision: 24,
                scale: 6,
            });
            expect(created?.findColumnByName('receivingAddressFingerprint')?.isNullable).toBe(false);
            expect(
                created?.indices.find(index => index.name === 'IDX_storefront_usdt_intent_transaction')
                    ?.isUnique,
            ).toBe(true);
            expect(created?.foreignKeys).toHaveLength(4);
            expect(
                created?.indices.find(index => index.name === 'IDX_storefront_usdt_intent_status_expiry'),
            ).toBeDefined();
        },
    );

    it('applies unique matching and transaction constraints in a real SQL.js database', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.query('CREATE TABLE "channel" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
            await queryRunner.query('CREATE TABLE "order" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
            await queryRunner.query('CREATE TABLE "payment" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
            await queryRunner.query(
                'CREATE TABLE "storefront_usdt_checkout_quote" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)',
            );
            const migration = new AddUsdtTrc20Payments1787781600000();

            await migration.up(queryRunner);

            const table = await queryRunner.getTable('storefront_usdt_payment_intent');
            expect(table).toBeDefined();
            expect(
                table?.indices.find(index => index.name === 'IDX_storefront_usdt_intent_match_key'),
            ).toMatchObject({ isUnique: true });
            expect(
                table?.indices.find(index => index.name === 'IDX_storefront_usdt_intent_transaction'),
            ).toMatchObject({ isUnique: true });

            await migration.down(queryRunner);
            await expect(queryRunner.hasTable('storefront_usdt_payment_intent')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
