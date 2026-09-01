import { DataSource, QueryRunner, TableColumn } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddReferralPosterTemplates1787785200000 } from './1787785200000-add-referral-poster-templates';
import { AddMobileReferralPosterCopy1787806800000 } from './1787806800000-add-mobile-referral-poster-copy';
import { RepairReferralPosterTemplateCopy1788274800000 } from './1788274800000-repair-referral-poster-template-copy';

async function createPosterDatabase() {
    const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.query('CREATE TABLE "channel" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
    await queryRunner.query('CREATE TABLE "asset" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
    await queryRunner.query(
        'CREATE TABLE "referral_program_config" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "defaultPosterTemplate" varchar(32) NOT NULL)',
    );
    await queryRunner.query('INSERT INTO "channel" ("id") VALUES (1)');
    await new AddReferralPosterTemplates1787785200000().up(queryRunner);
    return { dataSource, queryRunner };
}

async function destroyPosterDatabase(dataSource: DataSource, queryRunner: QueryRunner) {
    await queryRunner.release();
    await dataSource.destroy();
}

describe('repair referral poster template copy migration', () => {
    it('repairs a legacy table while preserving existing merchant copy', async () => {
        const { dataSource, queryRunner } = await createPosterDatabase();
        try {
            await queryRunner.query(
                `INSERT INTO "referral_poster_template" ("channelId", "name", "headlineZh")
                 VALUES (1, '自定义分享海报', '保留我的自定义标题')`,
            );
            const migration = new RepairReferralPosterTemplateCopy1788274800000();

            await migration.up(queryRunner);

            const table = await queryRunner.getTable('referral_poster_template');
            expect(table?.columns).toHaveLength(55);
            expect(table?.findColumnByName('featureOneTitleZh')?.length).toBe('100');
            expect(table?.findColumnByName('ctaTextZh')?.length).toBe('140');
            expect(table?.findColumnByName('footerTextEn')?.length).toBe('220');
            await expect(
                queryRunner.query(
                    `SELECT "headlineZh", "featureOneTitleZh", "footerTextEn"
                     FROM "referral_poster_template" WHERE "name" = '自定义分享海报'`,
                ),
            ).resolves.toEqual([
                {
                    headlineZh: '保留我的自定义标题',
                    featureOneTitleZh: '热门工具汇集',
                    footerTextEn: 'One-stop platform for AI tools and digital services',
                },
            ]);

            await migration.down();
            expect((await queryRunner.getTable('referral_poster_template'))?.columns).toHaveLength(55);
            await migration.up(queryRunner);
            expect((await queryRunner.getTable('referral_poster_template'))?.columns).toHaveLength(55);
        } finally {
            await destroyPosterDatabase(dataSource, queryRunner);
        }
    });

    it('does not alter a table that already has the complete mobile copy schema', async () => {
        const { dataSource, queryRunner } = await createPosterDatabase();
        try {
            await new AddMobileReferralPosterCopy1787806800000().up(queryRunner);
            const before = await queryRunner.getTable('referral_poster_template');

            await new RepairReferralPosterTemplateCopy1788274800000().up(queryRunner);

            const after = await queryRunner.getTable('referral_poster_template');
            expect(after?.columns.map(column => column.name)).toEqual(
                before?.columns.map(column => column.name),
            );
        } finally {
            await destroyPosterDatabase(dataSource, queryRunner);
        }
    });

    it('preserves existing copy when only part of the repair schema is present', async () => {
        const { dataSource, queryRunner } = await createPosterDatabase();
        try {
            await queryRunner.addColumn(
                'referral_poster_template',
                new TableColumn({
                    name: 'featureOneTitleZh',
                    type: 'varchar',
                    length: '100',
                    isNullable: false,
                    default: "'热门工具汇集'",
                }),
            );
            await queryRunner.query(
                `INSERT INTO "referral_poster_template" ("channelId", "name", "featureOneTitleZh")
                 VALUES (1, '部分迁移海报', '保留已有卖点')`,
            );

            await new RepairReferralPosterTemplateCopy1788274800000().up(queryRunner);

            expect((await queryRunner.getTable('referral_poster_template'))?.columns).toHaveLength(55);
            await expect(
                queryRunner.query(
                    `SELECT "featureOneTitleZh", "featureTwoTitleZh"
                     FROM "referral_poster_template" WHERE "name" = '部分迁移海报'`,
                ),
            ).resolves.toEqual([
                {
                    featureOneTitleZh: '保留已有卖点',
                    featureTwoTitleZh: '便捷开通服务',
                },
            ]);
        } finally {
            await destroyPosterDatabase(dataSource, queryRunner);
        }
    });

    it('is a no-op when the poster template table does not exist', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await expect(
                new RepairReferralPosterTemplateCopy1788274800000().up(queryRunner),
            ).resolves.toBeUndefined();
        } finally {
            await destroyPosterDatabase(dataSource, queryRunner);
        }
    });
});
