import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddStorefrontPageViews1788678000000 } from './1788678000000-add-storefront-page-views';

describe('storefront page view migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates privacy-preserving event columns on %s',
        async type => {
            const createTable = vi.fn();
            await new AddStorefrontPageViews1788678000000().up({
                connection: { options: { type } },
                hasTable: vi.fn().mockResolvedValue(false),
                createTable,
            } as unknown as QueryRunner);
            const table = createTable.mock.calls[0][0] as Table;
            expect(table.indices.find(index => index.isUnique)?.columnNames).toEqual([
                'channelId',
                'eventId',
            ]);
            for (const column of ['ip', 'userAgent', 'url', 'visitorId'])
                expect(table.findColumnByName(column)).toBeUndefined();
            expect(table.findColumnByName('ipHash')?.isNullable).toBe(true);
        },
    );

    it.each(process.env.DB === 'mysql' ? (['sqljs', 'mysql'] as const) : (['sqljs'] as const))(
        'applies twice on real %s, enforces event uniqueness, and preserves records on code rollback',
        async type => {
            // Disposable local database only; never load deployment credentials or remote hosts.
            const database = `traffic_migration_${randomUUID().replaceAll('-', '')}`;
            const mysqlOptions = {
                host: '127.0.0.1',
                port: Number(process.env.E2E_MYSQL_PORT || 3306),
                username: 'root',
                password: 'password',
            };
            const manager =
                type === 'mysql'
                    ? await new DataSource({ type: 'mysql', ...mysqlOptions }).initialize()
                    : undefined;
            if (manager) await manager.query(`CREATE DATABASE \`${database}\``);
            const db = await new DataSource(
                type === 'mysql'
                    ? { type: 'mysql', ...mysqlOptions, database, entities: [], synchronize: false }
                    : { type: 'sqljs', entities: [], synchronize: false },
            ).initialize();
            const runner = db.createQueryRunner();
            try {
                await runner.query('CREATE TABLE channel (id INTEGER PRIMARY KEY)');
                await runner.query(
                    'CREATE TABLE storefront_daily_visitor (id INTEGER PRIMARY KEY, visitCount INTEGER)',
                );
                await runner.query('INSERT INTO storefront_daily_visitor VALUES (1, 25)');
                await runner.query('INSERT INTO channel VALUES (1), (2)');
                const migration = new AddStorefrontPageViews1788678000000();
                await migration.up(runner);
                await migration.up(runner);
                const insert =
                    'INSERT INTO storefront_page_view (channelId, businessDate, eventId, visitorKeyHash) VALUES (?, ?, ?, ?)';
                await runner.query(insert, [1, '2026-09-05', 'event-1', 'digest-1']);
                await expect(
                    runner.query(insert, [1, '2026-09-06', 'event-1', 'digest-1']),
                ).rejects.toThrow();
                await runner.query(insert, [2, '2026-09-05', 'event-1', 'digest-1']);
                await migration.down();
                expect(await runner.query('SELECT visitCount FROM storefront_daily_visitor')).toEqual([
                    { visitCount: 25 },
                ]);
                expect(await runner.query('SELECT COUNT(*) AS total FROM storefront_page_view')).toEqual([
                    { total: type === 'mysql' ? '2' : 2 },
                ]);
            } finally {
                await runner.release();
                await db.destroy();
                if (manager) {
                    await manager.query(`DROP DATABASE \`${database}\``);
                    await manager.destroy();
                }
            }
        },
    );
});
