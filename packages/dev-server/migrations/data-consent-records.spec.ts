import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddDataConsentRecords1789495200000 } from './1789495200000-add-data-consent-records';

describe('data consent record migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates portable append-only consent evidence on %s',
        async databaseType => {
            const idType = databaseType === 'mysql' ? 'int' : 'integer';
            const tables = new Map([
                ['channel', idTable('channel', idType)],
                ['customer', idTable('customer', idType)],
            ]);
            const createTable = vi.fn();
            await new AddDataConsentRecords1789495200000().up({
                connection: { options: { type: databaseType } },
                getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
                createTable,
            } as unknown as QueryRunner);

            const table = createTable.mock.calls[0][0] as Table;
            expect(table.findColumnByName('channelId')?.type).toBe(idType);
            expect(table.findColumnByName('customerId')).toMatchObject({
                type: idType,
                isNullable: true,
            });
            expect(table.findColumnByName('policyDigest')).toMatchObject({
                type: 'varchar',
                length: '64',
            });
            expect(table.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'IDX_data_consent_subject_created' }),
                    expect.objectContaining({ name: 'IDX_data_consent_purpose_created' }),
                ]),
            );
        },
    );

    it('applies twice on SQL.js and refuses to delete consent evidence on rollback', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.createTable(idTable('channel', 'integer'));
            await runner.createTable(idTable('customer', 'integer'));
            const migration = new AddDataConsentRecords1789495200000();
            await migration.up(runner);
            await migration.up(runner);
            await runner.query('INSERT INTO channel DEFAULT VALUES');
            await runner.query(
                `INSERT INTO data_consent_record
                    (channelId, subjectKeyHash, purpose, action, policyVersion, policyDigest, locale, source, recordedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    1,
                    'a'.repeat(64),
                    'ANALYTICS',
                    'WITHDRAWN',
                    'storefront-analytics-v1',
                    'b'.repeat(64),
                    'zh',
                    'COOKIE_PREFERENCE',
                    '2026-09-20 00:00:00',
                ],
            );
            await expect(migration.down()).rejects.toThrow('Retain consent evidence');
            await expect(runner.hasTable('data_consent_record')).resolves.toBe(true);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});

function idTable(name: string, type: string): Table {
    return new Table({
        name,
        columns: [
            {
                name: 'id',
                type,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment',
            },
        ],
    });
}
