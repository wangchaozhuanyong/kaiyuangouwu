import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddSystemAnnouncementOwner1791331200000 } from './1791331200000-add-system-announcement-owner';

describe('announcement publication ownership migration', () => {
    it('preserves old platform notices, stores owners and prevents deleting their Channels', async () => {
        const database = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await database.initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.query('PRAGMA foreign_keys = ON');
            await runner.createTable(
                new Table({ name: 'channel', columns: [{ name: 'id', type: 'integer', isPrimary: true }] }),
            );
            await runner.createTable(
                new Table({
                    name: 'system_announcement',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'titleZh', type: 'varchar' },
                    ],
                }),
            );
            await runner.query('INSERT INTO channel(id) VALUES (1)');
            await runner.query("INSERT INTO system_announcement(id,titleZh) VALUES (1,'旧公告')");
            const migration = new AddSystemAnnouncementOwner1791331200000();
            await migration.up(runner);
            await migration.up(runner);
            expect(await runner.query('SELECT titleZh,ownerChannelId FROM system_announcement')).toEqual([
                { titleZh: '旧公告', ownerChannelId: null },
            ]);
            await runner.query(
                "INSERT INTO system_announcement(id,titleZh,ownerChannelId) VALUES (2,'本店公告',1)",
            );
            await expect(runner.query('DELETE FROM channel WHERE id = 1')).rejects.toThrow();
            const table = await runner.getTable('system_announcement');
            expect(table?.foreignKeys).toContainEqual(
                expect.objectContaining({ name: 'FK_system_announcement_owner', onDelete: 'RESTRICT' }),
            );
            await migration.down(runner);
            expect(await runner.query('SELECT titleZh FROM system_announcement ORDER BY id')).toEqual([
                { titleZh: '旧公告' },
                { titleZh: '本店公告' },
            ]);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
