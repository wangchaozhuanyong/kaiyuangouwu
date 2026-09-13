import { randomUUID } from 'node:crypto';
import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddImageProviderAttemptLedger1789272000000 } from './1789272000000-add-image-provider-attempt-ledger';

describe('image provider attempt ledger migration', () => {
    it.each(process.env.DB === 'mysql' ? ['sqljs', 'mysql'] : ['sqljs'])(
        'upgrades legacy rows without inventing evidence and is repeatable (%s)',
        async databaseType => {
            const fixture = await migrationFixture(databaseType);
            const source = fixture.source;
            const runner = source.createQueryRunner();
            try {
                for (const name of ['channel', 'image_generation_cost_event', 'image_prompt_optimization']) {
                    await runner.createTable(
                        new Table({ name, columns: [{ name: 'id', type: 'integer', isPrimary: true }] }),
                    );
                    await runner.query(`INSERT INTO ${name} (id) VALUES (1)`);
                }
                const migration = new AddImageProviderAttemptLedger1789272000000();
                await migration.up(runner);
                await migration.up(runner);
                expect(
                    await runner.query(
                        'SELECT callId, modelResponseId, reportedCostEvidence FROM image_generation_cost_event',
                    ),
                ).toEqual([{ callId: null, modelResponseId: null, reportedCostEvidence: null }]);
                expect(
                    await runner.query('SELECT attemptLedgerVersion FROM image_prompt_optimization'),
                ).toEqual([{ attemptLedgerVersion: null }]);
                const row = {
                    channelId: 1,
                    optimizationIdSnapshot: '1',
                    attemptNumber: 1,
                    stage: 'INITIAL',
                    outcome: 'UNKNOWN',
                    modelId: 'fixture',
                    providerScope: 'OPENAI',
                    credentialCodeSnapshot: 'test',
                    credentialNameSnapshot: 'Test',
                    credentialLast4Snapshot: '0000',
                    callId: 'fixture-call',
                };
                await runner.manager
                    .createQueryBuilder()
                    .insert()
                    .into('image_prompt_optimization_attempt')
                    .values(row)
                    .execute();
                await expect(
                    runner.manager
                        .createQueryBuilder()
                        .insert()
                        .into('image_prompt_optimization_attempt')
                        .values({ ...row, callId: 'different-call' })
                        .execute(),
                ).rejects.toThrow();
                await expect(
                    runner.manager
                        .createQueryBuilder()
                        .insert()
                        .into('image_prompt_optimization_attempt')
                        .values({ ...row, attemptNumber: 2 })
                        .execute(),
                ).rejects.toThrow();
                await expect(migration.down()).rejects.toThrow('禁止自动删除');
                expect(await runner.hasTable('image_prompt_optimization_attempt')).toBe(true);
            } finally {
                await runner.release();
                await fixture.close();
            }
        },
    );
});

async function migrationFixture(databaseType: string) {
    if (databaseType !== 'mysql') {
        const sqliteSource = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        return { source: sqliteSource, close: () => sqliteSource.destroy() };
    }
    // Same local-only credentials as e2e-common/test-config.ts. Never targets a remote database.
    const options = {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: Number(process.env.E2E_MYSQL_PORT ?? 13370),
        username: 'root',
        password: 'password',
        entities: [],
        synchronize: false,
    };
    const database = `image_ledger_test_${randomUUID().replaceAll('-', '')}`;
    const admin = await new DataSource({ ...options, database: 'mysql' }).initialize();
    await admin.query(`CREATE DATABASE ${database}`);
    const source = await new DataSource({ ...options, database }).initialize();
    return {
        source,
        close: async () => {
            await source.destroy();
            // Only the fresh UUID-named fixture created by this test is removed.
            await admin.query(`DROP DATABASE ${database}`);
            await admin.destroy();
        },
    };
}
