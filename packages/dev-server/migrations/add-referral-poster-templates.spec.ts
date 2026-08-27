import { DataSource, QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddReferralPosterTemplates1787785200000 } from './1787785200000-add-referral-poster-templates';

describe('referral poster template migration', () => {
    it.each(['mysql', 'postgres', 'sqlite', 'sqljs'] as const)(
        'creates the portable poster template table for %s',
        async databaseType => {
            let created: Table | undefined;
            const configTable = new Table({
                name: 'referral_program_config',
                columns: [
                    new TableColumn({ name: 'id', type: 'int', isPrimary: true }),
                    new TableColumn({
                        name: 'defaultPosterTemplate',
                        type: 'varchar',
                        length: '32',
                    }),
                ],
            });
            const changeColumn = vi.fn().mockResolvedValue(undefined);
            const queryRunner = {
                connection: { options: { type: databaseType } },
                getTable: vi.fn().mockResolvedValue(configTable),
                changeColumn,
                hasTable: vi.fn().mockResolvedValue(false),
                createTable: vi.fn((table: Table) => {
                    created = table;
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddReferralPosterTemplates1787785200000().up(queryRunner);

            expect(changeColumn).toHaveBeenCalledOnce();
            expect(created?.name).toBe('referral_poster_template');
            expect(created?.findColumnByName('posterBackgroundAssetId')?.isNullable).toBe(true);
            expect(created?.findColumnByName('shareBackgroundAssetId')?.isNullable).toBe(true);
            expect(created?.findColumnByName('layoutVariant')?.default).toBe("'STANDARD_CENTER'");
            expect(created?.foreignKeys).toHaveLength(3);
        },
    );

    it('applies and rolls back against a real SQL.js database', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.query('CREATE TABLE "channel" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
            await queryRunner.query('CREATE TABLE "asset" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
            await queryRunner.query(
                'CREATE TABLE "referral_program_config" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "defaultPosterTemplate" varchar(32) NOT NULL)',
            );
            const migration = new AddReferralPosterTemplates1787785200000();

            await migration.up(queryRunner);

            const table = await queryRunner.getTable('referral_poster_template');
            expect(table).toBeDefined();
            expect(table?.findColumnByName('rewardTextZh')?.length).toBe('220');
            expect(
                (await queryRunner.getTable('referral_program_config'))?.findColumnByName(
                    'defaultPosterTemplate',
                )?.length,
            ).toBe('64');

            await migration.down(queryRunner);
            await expect(queryRunner.hasTable('referral_poster_template')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
