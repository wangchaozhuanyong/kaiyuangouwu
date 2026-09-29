import { DataSource, QueryRunner } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { referralPosterCopy } from '../../store-management-plugin/src/referral/referral-poster-presets';

import { AddReferralPosterTemplates1787785200000 } from './1787785200000-add-referral-poster-templates';
import { AddMobileReferralPosterCopy1787806800000 } from './1787806800000-add-mobile-referral-poster-copy';
import { RepairReferralPosterTemplateCopy1788274800000 } from './1788274800000-repair-referral-poster-template-copy';
import { NeutralReferralPosterDefaults1790640000000 } from './1790640000000-neutral-referral-poster-defaults';

describe('neutral referral poster column defaults', () => {
    it('uses default-only MySQL statements and does not update poster rows', async () => {
        const statements: string[] = [];
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: () => Promise.resolve({ findColumnByName: () => ({ default: "'legacy'" }) }),
            query: (sql: string) => {
                statements.push(sql);
                return Promise.resolve();
            },
        } as unknown as QueryRunner;

        await new NeutralReferralPosterDefaults1790640000000().up(queryRunner);

        expect(statements).toHaveLength(Object.keys(referralPosterCopy).length);
        expect(
            statements.every(sql => sql.startsWith('ALTER TABLE `referral_poster_template` ALTER COLUMN `')),
        ).toBe(true);
        expect(statements.every(sql => sql.includes(' SET DEFAULT '))).toBe(true);
        expect(statements.some(sql => /\bUPDATE\b|\bDELETE\b/iu.test(sql))).toBe(false);
    });

    it('rejects a missing copy column before altering any default', async () => {
        const statements: string[] = [];
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: () =>
                Promise.resolve({
                    findColumnByName: (name: string) =>
                        name === 'footerTextEn' ? undefined : { default: "'legacy'" },
                }),
            query: (sql: string) => {
                statements.push(sql);
                return Promise.resolve();
            },
        } as unknown as QueryRunner;

        await expect(new NeutralReferralPosterDefaults1790640000000().up(queryRunner)).rejects.toThrow(
            'referral_poster_template.footerTextEn is missing',
        );
        expect(statements).toEqual([]);
    });

    it('changes only defaults and preserves existing merchant poster copy', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.query('CREATE TABLE "channel" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
            await queryRunner.query('CREATE TABLE "asset" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)');
            await queryRunner.query('INSERT INTO "channel" ("id") VALUES (1)');
            await new AddReferralPosterTemplates1787785200000().up(queryRunner);
            await new AddMobileReferralPosterCopy1787806800000().up(queryRunner);
            await new RepairReferralPosterTemplateCopy1788274800000().up(queryRunner);
            await queryRunner.query(
                `INSERT INTO "referral_poster_template" ("channelId", "name", "titleZh", "qrTitleZh")
                 VALUES (1, '商家自定义', '我的海报标题', '我的二维码标题')`,
            );

            await new NeutralReferralPosterDefaults1790640000000().up(queryRunner);

            const rows = await queryRunner.query(
                `SELECT "titleZh", "qrTitleZh" FROM "referral_poster_template" WHERE "name" = '商家自定义'`,
            );
            expect(rows).toEqual([{ titleZh: '我的海报标题', qrTitleZh: '我的二维码标题' }]);
            const table = await queryRunner.getTable('referral_poster_template');
            expect(table?.findColumnByName('titleZh')?.default).toContain(referralPosterCopy.titleZh);
            expect(table?.findColumnByName('qrTitleZh')?.default).toContain(referralPosterCopy.qrTitleZh);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
