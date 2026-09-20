import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddDataSubjectRequests1789491600000 } from './1789491600000-add-data-subject-requests';

describe('data subject request migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates a portable request and account-closure queue on %s',
        async databaseType => {
            const idType = databaseType === 'mysql' ? 'int' : 'integer';
            const tables = new Map([
                ['channel', idTable('channel', idType)],
                ['customer', idTable('customer', idType)],
            ]);
            const createTable = vi.fn();
            await new AddDataSubjectRequests1789491600000().up({
                connection: { options: { type: databaseType } },
                getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
                createTable,
            } as unknown as QueryRunner);

            const table = createTable.mock.calls[0][0] as Table;
            expect(table.findColumnByName('channelId')?.type).toBe(idType);
            expect(table.findColumnByName('customerId')?.type).toBe(idType);
            expect(table.findColumnByName('blockersJson')?.type).toBe('text');
            expect(table.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_data_subject_request_due',
                        columnNames: ['requestType', 'status', 'nextAttemptAt'],
                    }),
                ]),
            );
        },
    );

    it('applies twice on SQL.js and preserves request history on rollback', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.createTable(idTable('channel', 'integer'));
            await runner.createTable(idTable('customer', 'integer'));
            const migration = new AddDataSubjectRequests1789491600000();
            await migration.up(runner);
            await migration.up(runner);
            await runner.query('INSERT INTO channel DEFAULT VALUES');
            await runner.query('INSERT INTO customer DEFAULT VALUES');
            await runner.query(
                `INSERT INTO data_subject_request
                    (channelId, customerId, subjectKeyHash, requestType, requestedAt)
                 VALUES (?, ?, ?, ?, ?)`,
                [1, 1, 'a'.repeat(64), 'ACCOUNT_CLOSURE', '2026-09-20 00:00:00'],
            );
            await expect(migration.down()).rejects.toThrow('Retain data-subject request audit history');
            await expect(runner.hasTable('data_subject_request')).resolves.toBe(true);
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
