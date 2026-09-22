import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddDataRetentionRecords1789488000000 } from './1789488000000-add-data-retention-records';

describe('data retention record migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates a portable, auditable retention queue on %s',
        async databaseType => {
            const idType = databaseType === 'mysql' ? 'int' : 'integer';
            const channel = idTable('channel', idType);
            const createTable = vi.fn();
            await new AddDataRetentionRecords1789488000000().up({
                connection: { options: { type: databaseType } },
                getTable: vi.fn((name: string) => Promise.resolve(name === 'channel' ? channel : undefined)),
                createTable,
            } as unknown as QueryRunner);

            const table = createTable.mock.calls[0][0] as Table;
            expect(table.findColumnByName('channelId')?.type).toBe(idType);
            expect(table.findColumnByName('subjectKeyHash')).toMatchObject({
                type: 'varchar',
                length: '64',
            });
            expect(table.findColumnByName('legalHold')?.default).toBe(false);
            expect(table.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'UQ_data_retention_resource',
                        isUnique: true,
                        columnNames: ['resourceType', 'resourceKey'],
                    }),
                    expect.objectContaining({
                        name: 'IDX_data_retention_due',
                        columnNames: ['status', 'legalHold', 'nextAttemptAt'],
                    }),
                ]),
            );
        },
    );

    it('applies twice on SQL.js, enforces one audit record per resource and preserves history on rollback', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.createTable(idTable('channel', 'integer'));
            const migration = new AddDataRetentionRecords1789488000000();
            await migration.up(runner);
            await migration.up(runner);
            await runner.query('INSERT INTO channel DEFAULT VALUES');
            const values = [
                1,
                'CUSTOMER_AVATAR',
                'asset-1',
                'a'.repeat(64),
                'CUSTOMER_AVATAR_REPLACED_30D',
                'REPLACED',
                '2026-09-20 00:00:00',
                '2026-10-20 00:00:00',
                '2026-10-20 00:00:00',
            ];
            const insert = () =>
                runner.query(
                    `INSERT INTO data_retention_record
                        (channelId, resourceType, resourceKey, subjectKeyHash, policyCode, reason,
                         quarantinedAt, purgeAfter, nextAttemptAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    values,
                );
            await insert();
            await expect(insert()).rejects.toThrow();
            await expect(migration.down()).rejects.toThrow('Retain deletion audit history');
            await expect(runner.hasTable('data_retention_record')).resolves.toBe(true);
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
