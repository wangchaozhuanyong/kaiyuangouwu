import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { HardenImageGeneration1787817600000 } from './1787817600000-harden-image-generation';

describe('harden image generation migration', () => {
    it('does not add an incompatible MySQL timestamp default to nextAttemptAt', async () => {
        const createdTables: Table[] = [];
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn((table: string) =>
                Promise.resolve(
                    [
                        'channel',
                        'image_generation_job',
                        'image_generation_output',
                        'image_model_config',
                    ].includes(table),
                ),
            ),
            hasColumn: vi.fn(() => Promise.resolve(true)),
            createTable: vi.fn((table: Table) => {
                createdTables.push(table);
                return Promise.resolve();
            }),
            query: vi.fn(() => Promise.resolve([])),
        } as unknown as QueryRunner;

        await new HardenImageGeneration1787817600000().up(queryRunner);

        const dispatchTable = createdTables.find(table => table.name === 'image_generation_dispatch');
        const nextAttemptAt = dispatchTable?.findColumnByName('nextAttemptAt');
        expect(nextAttemptAt?.type).toBe('datetime');
        expect(nextAttemptAt?.isNullable).toBe(false);
        expect(nextAttemptAt?.default).toBeUndefined();
    });

    it('adds reliability and cost tables and backfills queued outputs on SQL.js', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'channel',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
            );
            await queryRunner.createTable(
                new Table({
                    name: 'image_model_config',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true, isGenerated: true }],
                }),
            );
            await queryRunner.createTable(
                new Table({
                    name: 'image_generation_job',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                        { name: 'protocolSnapshot', type: 'varchar', length: '32' },
                        { name: 'providerModelIdSnapshot', type: 'varchar', length: '160' },
                    ],
                }),
            );
            await queryRunner.createTable(
                new Table({
                    name: 'image_generation_output',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                        { name: 'state', type: 'varchar', length: '24' },
                    ],
                }),
            );
            await queryRunner.query(`INSERT INTO "image_generation_output" ("state") VALUES ('QUEUED')`);
            await queryRunner.query(`INSERT INTO "image_generation_output" ("state") VALUES ('SUCCEEDED')`);
            await queryRunner.query(
                `INSERT INTO "image_generation_job" ("protocolSnapshot", "providerModelIdSnapshot") VALUES ('GEMINI_NATIVE_STREAM', 'gemini-3.1-flash-image')`,
            );

            const migration = new HardenImageGeneration1787817600000();
            await migration.up(queryRunner);

            await expect(queryRunner.hasTable('image_generation_dispatch')).resolves.toBe(true);
            await expect(queryRunner.hasTable('image_generation_cost_event')).resolves.toBe(true);
            await expect(queryRunner.hasColumn('image_model_config', 'supportsIdempotency')).resolves.toBe(
                true,
            );
            await expect(queryRunner.hasColumn('image_model_config', 'consecutiveFailures')).resolves.toBe(
                true,
            );
            await expect(
                queryRunner.hasColumn('image_generation_job', 'providerCredentialFingerprint'),
            ).resolves.toBe(true);
            await expect(
                queryRunner.query(`SELECT "providerScopeSnapshot" FROM "image_generation_job"`),
            ).resolves.toEqual([{ providerScopeSnapshot: 'GEMINI' }]);
            const dispatches = (await queryRunner.query(
                `SELECT "outputId", "state" FROM "image_generation_dispatch"`,
            )) as Array<{ outputId: number; state: string }>;
            expect(dispatches).toEqual([{ outputId: 1, state: 'PENDING' }]);
            const dispatchTable = await queryRunner.getTable('image_generation_dispatch');
            const nextAttemptAt = dispatchTable?.findColumnByName('nextAttemptAt');
            expect(nextAttemptAt?.isNullable).toBe(false);
            expect(nextAttemptAt?.default).toBeUndefined();
            const costTable = await queryRunner.getTable('image_generation_cost_event');
            expect(costTable?.findColumnByName('saleUnitPriceSnapshot')?.type).toBe('int');
            expect(costTable?.findColumnByName('saleCurrencyCode')?.length).toBe('3');

            await migration.down(queryRunner);
            await expect(queryRunner.hasTable('image_generation_dispatch')).resolves.toBe(false);
            await expect(queryRunner.hasTable('image_generation_cost_event')).resolves.toBe(false);
            await expect(queryRunner.hasColumn('image_model_config', 'supportsIdempotency')).resolves.toBe(
                false,
            );
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
