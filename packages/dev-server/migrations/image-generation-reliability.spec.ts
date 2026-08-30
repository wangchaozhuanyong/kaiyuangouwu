import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { HardenImageGenerationReliability1787896800000 } from './1787896800000-harden-image-generation-reliability';

describe('image generation reliability migration', () => {
    it('adds nullable recovery fields and worker runtime state without rewriting existing outputs', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const runner = dataSource.createQueryRunner();
        try {
            for (const table of [
                new Table({
                    name: 'image_private_asset',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
                new Table({
                    name: 'image_generation_dispatch',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                        { name: 'outputId', type: 'integer' },
                    ],
                }),
                new Table({
                    name: 'image_generation_output',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                        { name: 'state', type: 'varchar', length: '24' },
                    ],
                }),
                new Table({
                    name: 'image_generation_cost_event',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
            ]) {
                await runner.createTable(table);
            }
            await runner.query(`INSERT INTO "image_generation_output" ("state") VALUES ('QUEUED')`);

            const migration = new HardenImageGenerationReliability1787896800000();
            await migration.up(runner);
            await migration.up(runner);

            await expect(runner.hasTable('image_generation_runtime_status')).resolves.toBe(true);
            for (const column of ['queueTaskId', 'processingStage', 'heartbeatAt', 'stagedAssetId']) {
                await expect(runner.hasColumn('image_generation_dispatch', column)).resolves.toBe(true);
            }
            await expect(runner.hasColumn('image_generation_output', 'failureCode')).resolves.toBe(true);
            await expect(runner.hasColumn('image_generation_cost_event', 'failureCode')).resolves.toBe(true);
            await expect(runner.hasColumn('image_generation_cost_event', 'providerStage')).resolves.toBe(
                true,
            );
            await expect(
                runner.query(`SELECT "state", "failureCode" FROM "image_generation_output"`),
            ).resolves.toEqual([{ state: 'QUEUED', failureCode: null }]);
            await expect(
                runner.query(`SELECT COUNT(*) AS "count" FROM "image_generation_runtime_status"`),
            ).resolves.toEqual([{ count: 0 }]);
        } finally {
            await runner.release();
            await dataSource.destroy();
        }
    });
});
