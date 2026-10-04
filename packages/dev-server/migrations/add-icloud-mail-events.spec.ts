import { DataSource, QueryRunner, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddIcloudMailEvents1791075600000 } from './1791075600000-add-icloud-mail-events';

describe('mail event additive migration', () => {
    it('applies twice to a real isolated SQLite database and retains existing rows', async () => {
        const db = await new DataSource({ type: 'sqljs', entities: [] }).initialize();
        const runner = db.createQueryRunner();
        try {
            await runner.query(
                'CREATE TABLE icloud_primary_account (id integer PRIMARY KEY, email varchar(255))',
            );
            await runner.query("INSERT INTO icloud_primary_account VALUES (1, 'fixture@example.test')");
            const migration = new AddIcloudMailEvents1791075600000();
            await migration.up(runner);
            await migration.up(runner);
            expect(await runner.query('SELECT id, email FROM icloud_primary_account')).toEqual([
                { id: 1, email: 'fixture@example.test' },
            ]);
            expect(
                (await runner.getTable('icloud_mail_outbox'))?.findColumnByName('deliveredAt')?.isNullable,
            ).toBe(true);
            await runner.query(
                "INSERT INTO icloud_mail_outbox (eventId, primaryAccountId) VALUES ('fixture-event', '1')",
            );
            await expect(
                runner.query(
                    "INSERT INTO icloud_mail_outbox (eventId, primaryAccountId) VALUES ('fixture-event', '1')",
                ),
            ).rejects.toThrow();
            expect((await runner.query('SELECT COUNT(*) AS total FROM icloud_mail_outbox'))[0].total).toBe(1);
        } finally {
            await runner.release();
            await db.destroy();
        }
    });
    it.each(['mysql', 'postgres'])(
        'creates only missing columns and uses compatible dates on %s',
        async type => {
            const addColumn = vi.fn();
            const createTable = vi.fn();
            const runner = {
                connection: { options: { type } },
                hasColumn: (_table: string, name: string) =>
                    Promise.resolve(name === 'lastSyncedUidValidity'),
                addColumn,
                hasTable: () => Promise.resolve(false),
                createTable,
            } as unknown as QueryRunner;
            await new AddIcloudMailEvents1791075600000().up(runner);
            expect(addColumn).toHaveBeenCalledTimes(2);
            const date = addColumn.mock.calls
                .map(call => call[1] as TableColumn)
                .find(column => column.name === 'mailWatchLeaseUntil');
            expect(date?.type).toBe(type === 'postgres' ? 'timestamp without time zone' : 'datetime');
            expect(createTable).toHaveBeenCalledTimes(1);
        },
    );
});
