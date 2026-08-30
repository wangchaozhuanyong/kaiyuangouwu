import { DataSource, QueryRunner, Table, TableColumn } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AddImagePricingSnapshots1787871600000 } from './1787871600000-add-image-pricing-snapshots';

describe('image pricing snapshot migration', () => {
    let dataSource: DataSource;
    let queryRunner: QueryRunner;

    beforeEach(async () => {
        dataSource = new DataSource({ type: 'sqljs' });
        await dataSource.initialize();
        queryRunner = dataSource.createQueryRunner();
        for (const tableName of ['image_generation_job', 'image_prompt_optimization']) {
            await queryRunner.createTable(
                new Table({
                    name: tableName,
                    columns: [
                        new TableColumn({ name: 'id', type: 'integer', isPrimary: true }),
                        new TableColumn({
                            name:
                                tableName === 'image_generation_job' ? 'unitPriceSnapshot' : 'chargedAmount',
                            type: 'integer',
                        }),
                        new TableColumn({ name: 'currencyCode', type: 'varchar', length: '3' }),
                    ],
                }),
            );
        }
        await queryRunner.query(
            'INSERT INTO "image_generation_job" ("id", "unitPriceSnapshot", "currencyCode") VALUES (1, 120, \'CNY\')',
        );
        await queryRunner.query(
            'INSERT INTO "image_prompt_optimization" ("id", "chargedAmount", "currencyCode") VALUES (1, 60, \'MYR\')',
        );
    });

    afterEach(async () => {
        await queryRunner.release();
        await dataSource.destroy();
    });

    it('adds, backfills, reruns, and reverts pricing snapshot columns', async () => {
        const migration = new AddImagePricingSnapshots1787871600000();

        await migration.up(queryRunner);
        await migration.up(queryRunner);

        const jobRows = (await queryRunner.query(
            'SELECT "pricingSnapshot" FROM "image_generation_job" WHERE "id" = 1',
        )) as Array<{ pricingSnapshot: string }>;
        const promptRows = (await queryRunner.query(
            'SELECT "pricingSnapshot" FROM "image_prompt_optimization" WHERE "id" = 1',
        )) as Array<{ pricingSnapshot: string }>;
        expect(JSON.parse(jobRows[0].pricingSnapshot)).toMatchObject({
            baseAmount: 120,
            baseCurrencyCode: 'CNY',
            settlementAmount: 120,
            settlementCurrencyCode: 'CNY',
        });
        expect(JSON.parse(promptRows[0].pricingSnapshot)).toMatchObject({
            baseAmount: 60,
            baseCurrencyCode: 'MYR',
            settlementAmount: 60,
            settlementCurrencyCode: 'MYR',
        });

        await migration.down(queryRunner);
        expect(await queryRunner.hasColumn('image_generation_job', 'pricingSnapshot')).toBe(false);
        expect(await queryRunner.hasColumn('image_prompt_optimization', 'pricingSnapshot')).toBe(false);
    });
});
