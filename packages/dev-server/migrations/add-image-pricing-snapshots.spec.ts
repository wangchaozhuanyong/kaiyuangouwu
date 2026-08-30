import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddImagePricingSnapshots1787864400000 } from './1787864400000-add-image-pricing-snapshots';

describe('add image pricing snapshots migration', () => {
    it('adds and backfills immutable settlement pricing snapshots', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(legacyTable('image_generation_job', 'unitPriceSnapshot'));
            await queryRunner.createTable(legacyTable('image_prompt_optimization', 'chargedAmount'));
            await queryRunner.query(
                `INSERT INTO "image_generation_job" ("unitPriceSnapshot", "currencyCode") VALUES (125, 'CNY')`,
            );
            await queryRunner.query(
                `INSERT INTO "image_prompt_optimization" ("chargedAmount", "currencyCode") VALUES (75, 'MYR')`,
            );

            const migration = new AddImagePricingSnapshots1787864400000();
            await migration.up(queryRunner);

            const [job] = await queryRunner.query(`SELECT "pricingSnapshot" FROM "image_generation_job"`);
            const [prompt] = await queryRunner.query(
                `SELECT "pricingSnapshot" FROM "image_prompt_optimization"`,
            );
            expect(JSON.parse(job.pricingSnapshot)).toMatchObject({
                baseAmount: 125,
                baseCurrencyCode: 'CNY',
                settlementAmount: 125,
                settlementCurrencyCode: 'CNY',
            });
            expect(JSON.parse(prompt.pricingSnapshot)).toMatchObject({
                baseAmount: 75,
                baseCurrencyCode: 'MYR',
                settlementAmount: 75,
                settlementCurrencyCode: 'MYR',
            });

            await migration.up(queryRunner);
            await migration.down(queryRunner);
            await expect(queryRunner.hasColumn('image_generation_job', 'pricingSnapshot')).resolves.toBe(
                false,
            );
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});

function legacyTable(name: string, amountColumn: string): Table {
    return new Table({
        name,
        columns: [
            { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
            { name: amountColumn, type: 'int', default: 0 },
            { name: 'currencyCode', type: 'varchar', length: '3' },
        ],
    });
}
