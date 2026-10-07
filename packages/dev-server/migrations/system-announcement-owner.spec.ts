import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddSystemAnnouncementOwner1791331200000 } from './1791331200000-add-system-announcement-owner';

describe('announcement publication ownership migration', () => {
    it.runIf(Boolean(process.env.TEST_MYSQL_HOST || process.env.TEST_MYSQL_SOCKET))(
        'preserves contents and targets with idempotent ownership and restrictive deletion on real MySQL',
        async () => {
            const database = new DataSource({
                type: 'mysql',
                host: process.env.TEST_MYSQL_HOST,
                port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
                username: 'root',
                password: process.env.TEST_MYSQL_PASSWORD ?? '',
                database: 'codex_announcement_owner_migration_test',
                ...(process.env.TEST_MYSQL_SOCKET
                    ? { extra: { socketPath: process.env.TEST_MYSQL_SOCKET } }
                    : {}),
                entities: [],
                synchronize: false,
            });
            await database.initialize();
            const runner = database.createQueryRunner();
            try {
                await runner.createTable(
                    new Table({
                        name: 'channel',
                        columns: [{ name: 'id', type: 'int', unsigned: true, isPrimary: true }],
                    }),
                );
                await runner.createTable(
                    new Table({
                        name: 'system_announcement',
                        columns: [
                            { name: 'id', type: 'int', isPrimary: true },
                            { name: 'titleZh', type: 'varchar' },
                            { name: 'contentZh', type: 'text' },
                            { name: 'targetMode', type: 'varchar' },
                        ],
                    }),
                );
                await runner.createTable(
                    new Table({
                        name: 'system_announcement_channels_channel',
                        columns: [
                            { name: 'systemAnnouncementId', type: 'int', isPrimary: true },
                            { name: 'channelId', type: 'int', isPrimary: true },
                        ],
                    }),
                );
                await runner.query('INSERT INTO channel(id) VALUES (1),(2)');
                await runner.query(
                    "INSERT INTO system_announcement VALUES (1,'旧平台公告','原正文','ALL'),(2,'旧定向公告','原定向正文','SINGLE')",
                );
                await runner.query('INSERT INTO system_announcement_channels_channel VALUES (2,2)');
                const before = await runner.query('SELECT * FROM system_announcement ORDER BY id');
                const targets = await runner.query('SELECT * FROM system_announcement_channels_channel');
                const migration = new AddSystemAnnouncementOwner1791331200000();
                await migration.up(runner);
                await migration.up(runner);
                expect(
                    await runner.query(
                        'SELECT id,titleZh,contentZh,targetMode FROM system_announcement ORDER BY id',
                    ),
                ).toEqual(before);
                expect(
                    await runner.query('SELECT ownerChannelId FROM system_announcement ORDER BY id'),
                ).toEqual([{ ownerChannelId: null }, { ownerChannelId: null }]);
                expect(await runner.query('SELECT * FROM system_announcement_channels_channel')).toEqual(
                    targets,
                );
                const table = await runner.getTable('system_announcement');
                expect(table?.findColumnByName('ownerChannelId')).toMatchObject({
                    unsigned: true,
                    isNullable: true,
                });
                expect(table?.foreignKeys).toContainEqual(
                    expect.objectContaining({ name: 'FK_system_announcement_owner', onDelete: 'RESTRICT' }),
                );
                expect(
                    table?.indices.filter(index => index.name === 'IDX_system_announcement_owner'),
                ).toHaveLength(1);
                await runner.query(
                    "INSERT INTO system_announcement VALUES (3,'本店公告','本店正文','SINGLE',1)",
                );
                await expect(runner.query('DELETE FROM channel WHERE id = 1')).rejects.toThrow();
                await migration.down(runner);
                await migration.down(runner);
                expect(
                    await runner.query('SELECT * FROM system_announcement WHERE id < 3 ORDER BY id'),
                ).toEqual(before);
                expect(await runner.query('SELECT * FROM system_announcement_channels_channel')).toEqual(
                    targets,
                );
                expect(await runner.query('SELECT titleZh FROM system_announcement WHERE id = 3')).toEqual([
                    { titleZh: '本店公告' },
                ]);
            } finally {
                for (const name of [
                    'system_announcement_channels_channel',
                    'system_announcement',
                    'channel',
                ]) {
                    if (await runner.hasTable(name)) await runner.dropTable(name);
                }
                await runner.release();
                await database.destroy();
            }
        },
    );
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
