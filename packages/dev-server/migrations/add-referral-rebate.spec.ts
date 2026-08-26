import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddReferralRebate1787774400000 } from './1787774400000-add-referral-rebate';

describe('referral rebate migration', () => {
    it.each(['mysql', 'postgres', 'sqlite', 'sqljs'] as const)(
        'creates the complete referral ledger schema for %s',
        async databaseType => {
            const created: Table[] = [];
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn().mockResolvedValue(false),
                createTable: vi.fn((table: Table) => {
                    created.push(table);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddReferralRebate1787774400000().up(queryRunner);

            expect(created.map(table => table.name)).toEqual([
                'referral_program_config',
                'referral_account',
                'referral_wallet',
                'referral_relationship',
                'referral_reward',
                'referral_ledger_entry',
                'referral_balance_use',
                'referral_withdrawal',
                'storefront_daily_visitor',
            ]);
            const tableByName = (name: string): Table => {
                const table = created.find(candidate => candidate.name === name);
                expect(table).toBeDefined();
                if (!table) throw new Error(`Expected migration to create ${name}`);
                return table;
            };
            const wallet = tableByName('referral_wallet');
            expect(
                wallet.indices.find(index => index.name === 'IDX_referral_wallet_account_currency')?.isUnique,
            ).toBe(true);
            expect(wallet.findColumnByName('availableBalance')?.default).toBe(0);
            const relationship = tableByName('referral_relationship');
            expect(
                relationship.indices.find(index => index.name === 'IDX_referral_relationship_channel_invitee')
                    ?.isUnique,
            ).toBe(true);
            const reward = tableByName('referral_reward');
            expect(reward.findColumnByName('settledEligibleRefundTotal')?.default).toBe(0);
            const ledger = tableByName('referral_ledger_entry');
            expect(
                ledger.indices.find(index => index.name === 'IDX_referral_ledger_idempotency')?.isUnique,
            ).toBe(true);
            expect(created[0].findColumnByName('createdAt')?.type).toBe(
                databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime',
            );
            expect(created[0].findColumnByName('id')?.type).toBe(
                databaseType === 'mysql' ? 'int' : 'integer',
            );
        },
    );

    it('applies and rolls back against a real SQL.js database', async () => {
        const dataSource = new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();

        try {
            await queryRunner.query(
                'CREATE TABLE "channel" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL)',
            );
            await queryRunner.query(
                'CREATE TABLE "customer" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL)',
            );
            await queryRunner.query('CREATE TABLE "order" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL)');

            const migration = new AddReferralRebate1787774400000();
            await migration.up(queryRunner);

            await expect(queryRunner.hasTable('referral_program_config')).resolves.toBe(true);
            await expect(queryRunner.hasTable('referral_ledger_entry')).resolves.toBe(true);
            await expect(queryRunner.hasTable('storefront_daily_visitor')).resolves.toBe(true);

            await migration.down(queryRunner);

            await expect(queryRunner.hasTable('referral_program_config')).resolves.toBe(false);
            await expect(queryRunner.hasTable('referral_ledger_entry')).resolves.toBe(false);
            await expect(queryRunner.hasTable('storefront_daily_visitor')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });

    it('drops dependent tables in reverse order', async () => {
        const dropped: string[] = [];
        const queryRunner = {
            hasTable: vi.fn().mockResolvedValue(true),
            dropTable: vi.fn((name: string) => {
                dropped.push(name);
                return Promise.resolve();
            }),
        } as unknown as QueryRunner;

        await new AddReferralRebate1787774400000().down(queryRunner);

        expect(dropped[0]).toBe('storefront_daily_visitor');
        expect(dropped.at(-1)).toBe('referral_program_config');
    });
});
