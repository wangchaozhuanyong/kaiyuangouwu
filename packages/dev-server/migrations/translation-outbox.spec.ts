import 'reflect-metadata';
import { DataSource, Table } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { AddTranslationOutbox1788739200000 } from './1788739200000-add-translation-outbox';

let database: DataSource | undefined;
afterEach(async () => {
    await database?.destroy();
});
describe('translation outbox additive migration', () => {
    it('is repeatable and preserves legacy work and content on code rollback', async () => {
        database = await new DataSource({
            ...(process.env.TRANSLATION_TEST_POSTGRES === '1'
                ? {
                      type: 'postgres' as const,
                      host: '127.0.0.1',
                      port: 15492,
                      username: 'postgres',
                      database: 'translation_outbox_e2e',
                      schema: 'outbox_migration_test',
                  }
                : { type: 'sqljs' as const }),
            entities: [],
        }).initialize();
        const runner = database.createQueryRunner();
        if (process.env.TRANSLATION_TEST_POSTGRES === '1') {
            await runner.query('DROP SCHEMA IF EXISTS outbox_migration_test CASCADE');
            await runner.query('CREATE SCHEMA outbox_migration_test');
            await runner.query('SET search_path TO outbox_migration_test');
        }
        await runner.createTable(
            new Table({
                name: 'content_translation_state',
                columns: [
                    { name: 'id', type: 'int', isPrimary: true },
                    { name: 'status', type: 'varchar' },
                    { name: 'translatedHash', type: 'varchar', isNullable: true },
                ],
            }),
        );
        await runner.query(
            `INSERT INTO content_translation_state (id, status, "translatedHash") VALUES (1, 'TRANSLATING', 'preserve-me')`,
        );
        const migration = new AddTranslationOutbox1788739200000();
        await migration.up(runner);
        await migration.up(runner);
        const [row] = await runner.query('SELECT * FROM content_translation_state');
        expect(row).toMatchObject({
            id: 1,
            status: 'NOTIFY_PENDING',
            translatedHash: 'preserve-me',
            revision: 1,
            attempts: 0,
        });
        expect(await runner.hasTable('content_translation_provider_state')).toBe(true);
        expect(
            (await runner.getTable('content_translation_state'))?.indices.filter(
                index => index.name === 'IDX_content_translation_state_due',
            ),
        ).toHaveLength(1);
        await migration.down();
        expect((await runner.query('SELECT * FROM content_translation_state'))[0]).toEqual(row);
    });
});
