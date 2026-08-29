import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddImageResolutionPricing1787846400000 } from './1787846400000-add-image-resolution-pricing';

describe('add image resolution pricing migration', () => {
    it('adds per-resolution prices and backfills existing jobs to 1K', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'image_model_config',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                        { name: 'unitPrice', type: 'int', default: 0 },
                    ],
                }),
            );
            await queryRunner.createTable(
                new Table({
                    name: 'image_generation_job',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
            );
            await queryRunner.query(`INSERT INTO "image_model_config" ("unitPrice") VALUES (125)`);
            await queryRunner.query(`INSERT INTO "image_generation_job" DEFAULT VALUES`);

            const migration = new AddImageResolutionPricing1787846400000();
            await migration.up(queryRunner);

            await expect(
                queryRunner.query(
                    `SELECT "unitPrice", "unitPrice2K", "unitPrice4K" FROM "image_model_config"`,
                ),
            ).resolves.toEqual([{ unitPrice: 125, unitPrice2K: 0, unitPrice4K: 0 }]);
            await expect(
                queryRunner.query(`SELECT "resolution" FROM "image_generation_job"`),
            ).resolves.toEqual([{ resolution: '1K' }]);

            await migration.up(queryRunner);
            await migration.down(queryRunner);
            await expect(queryRunner.hasColumn('image_generation_job', 'resolution')).resolves.toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
