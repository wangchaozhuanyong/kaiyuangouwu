import { randomUUID } from 'node:crypto';
import { DataSource, DataSourceOptions, QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddStorefrontContentSettings1787335200000 } from './1787335200000-add-storefront-content-settings';
import { SeedFlashcastContentSettings1793952000000 } from './1793952000000-seed-flashcast-content-settings';

const ciMysql = process.env.CI === 'true' && process.env.PLATFORM_GOVERNANCE_CI_MYSQL === '1';
const databaseType =
    ciMysql || process.env.DB === 'mysql' ? 'mysql' : process.env.DB === 'postgres' ? 'postgres' : 'sqljs';

describe('seed reviewed Flashcast content settings', () => {
    let admin: DataSource | undefined;
    let source: DataSource;
    let runner: QueryRunner;
    let databaseName: string;
    const migration = new SeedFlashcastContentSettings1793952000000();

    beforeEach(async () => {
        let options: DataSourceOptions = { type: 'sqljs' };
        if (databaseType !== 'sqljs') {
            const mysql = databaseType === 'mysql';
            const fixture = ciMysql
                ? (await import('../scripts/platform-governance-ci-fixture.mjs')).ciFixtureOptions()
                : undefined;
            const port =
                fixture?.port ?? Number(mysql ? process.env.E2E_MYSQL_PORT : process.env.E2E_POSTGRES_PORT);
            const password =
                fixture?.password ??
                (mysql ? process.env.E2E_MYSQL_PASSWORD : process.env.E2E_POSTGRES_PASSWORD);
            if (!Number.isInteger(port) || port <= 0 || !password) {
                throw new Error('Set the local disposable migration database port and password');
            }
            databaseName = `flashcast_settings_test_${randomUUID().replaceAll('-', '')}`;
            const endpoint = { host: '127.0.0.1', port, password };
            const connection = mysql
                ? {
                      ...endpoint,
                      type: 'mysql' as const,
                      connectorPackage: 'mysql2' as const,
                      username: 'root',
                  }
                : { ...endpoint, type: 'postgres' as const, username: 'postgres' };
            options = { ...connection, database: databaseName };
            admin = await new DataSource({
                ...connection,
                database: mysql ? 'mysql' : 'postgres',
            }).initialize();
            await admin.query(`CREATE DATABASE ${admin.driver.escape(databaseName)}`);
        }
        source = await new DataSource(options).initialize();
        runner = source.createQueryRunner();
        const column = (name: string) => source.driver.escape(name);
        await runner.query('CREATE TABLE channel (id INTEGER PRIMARY KEY, code VARCHAR(50) NOT NULL UNIQUE)');
        await runner.query(
            `CREATE TABLE store_profile (${column('channelId')} INTEGER NOT NULL, status VARCHAR(20))`,
        );
        await runner.query(
            `CREATE TABLE store_domain (${column('channelId')} INTEGER NOT NULL,
                ${column('primaryChannelId')} INTEGER, domain VARCHAR(253) NOT NULL UNIQUE,
                status VARCHAR(20), ${column('isPrimary')} BOOLEAN, ${column('verifiedAt')} VARCHAR(30))`,
        );
        if (databaseType === 'sqljs') {
            // Mirror the persisted SQLite schema without replaying the historical initial migration.
            await runner.query(`CREATE TABLE storefront_content_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                heroAutoplayIntervalSeconds INTEGER NOT NULL DEFAULT 5,
                channelId INTEGER NOT NULL UNIQUE REFERENCES channel(id) ON DELETE CASCADE
            )`);
        } else {
            await new AddStorefrontContentSettings1787335200000().up(runner);
        }
        await runner.query(
            "INSERT INTO channel VALUES (1, '__default_channel__'), (2, 'flashcast-mall'), (3, 'other-store')",
        );
        await runner.query("INSERT INTO store_profile VALUES (2, 'ACTIVE'), (3, 'ACTIVE')");
        await runner.query(
            "INSERT INTO store_domain VALUES (2, 2, 'shop.flashcast.com.my', 'ACTIVE', TRUE, '2026-11-06')",
        );
        await runner.query(
            `INSERT INTO storefront_content_settings (${column('channelId')}, ${column('heroAutoplayIntervalSeconds')}) VALUES (3, 9)`,
        );
    });

    afterEach(async () => {
        if (runner) await runner.release();
        if (source?.isInitialized) await source.destroy();
        if (admin?.isInitialized) {
            await admin.query(`DROP DATABASE ${admin.driver.escape(databaseName)}`);
            await admin.destroy();
        }
        admin = undefined;
    });

    const readSettings = () =>
        runner.query(
            `SELECT * FROM storefront_content_settings ORDER BY ${source.driver.escape('channelId')}`,
        );

    it('only creates the reviewed channel row and preserves every value after rerun and rollback', async () => {
        const [otherStore] = await readSettings();
        await migration.up(runner);
        const seeded = await readSettings();
        expect(seeded).toEqual([
            expect.objectContaining({ channelId: 2, heroAutoplayIntervalSeconds: 5 }),
            otherStore,
        ]);
        await runner.query(
            `UPDATE storefront_content_settings SET ${source.driver.escape('heroAutoplayIntervalSeconds')} = 12
             WHERE ${source.driver.escape('channelId')} = 2`,
        );
        const reviewed = await readSettings();
        await migration.up(runner);
        await migration.down();
        expect(await readSettings()).toEqual(reviewed);
        expect(reviewed[0].heroAutoplayIntervalSeconds).toBe(12);
    });

    it.each([
        "UPDATE store_domain SET domain = 'other.example.test'",
        "UPDATE store_domain SET status = 'PENDING'",
        'UPDATE store_domain SET :primaryChannelId = 3',
        'UPDATE store_domain SET :channelId = 3, :primaryChannelId = 3',
        'UPDATE store_domain SET :isPrimary = FALSE',
        'UPDATE store_domain SET :verifiedAt = NULL',
        "UPDATE store_profile SET status = 'DRAFT' WHERE :channelId = 2",
        "UPDATE channel SET code = 'FLASHCAST-MALL' WHERE id = 2",
    ])('makes no changes when the approved operational binding differs (%s)', async change => {
        const before = await readSettings();
        await runner.query(change.replace(/:(\w+)/gu, (_, name: string) => source.driver.escape(name)));
        await migration.up(runner);
        expect(await readSettings()).toEqual(before);
    });

    it.runIf(databaseType !== 'sqljs')(
        'preserves a concurrent operator insert from another connection',
        async () => {
            const operator = source.createQueryRunner();
            let running: Promise<void> | undefined;
            try {
                await runner.startTransaction();
                await operator.startTransaction();
                await operator.query(
                    `INSERT INTO storefront_content_settings
                 (${source.driver.escape('channelId')}, ${source.driver.escape('heroAutoplayIntervalSeconds')}) VALUES (2, 11)`,
                );
                const mysql = databaseType === 'mysql';
                const [connection] = await runner.query(
                    mysql ? 'SELECT CONNECTION_ID() AS id' : 'SELECT pg_backend_pid() AS id',
                );
                const lockQuery = mysql
                    ? `SELECT COUNT(*) AS waiting
                       FROM performance_schema.data_lock_waits AS waits
                       JOIN performance_schema.threads AS threads
                         ON threads.THREAD_ID = waits.REQUESTING_THREAD_ID
                       WHERE threads.PROCESSLIST_ID = ?`
                    : `SELECT COUNT(*) AS waiting FROM pg_stat_activity
                       WHERE pid = $1 AND wait_event_type = 'Lock'`;
                running = migration.up(runner);
                // Keep the operator transaction open until the database confirms that the insert is waiting.
                void running.catch(() => undefined);
                await vi.waitFor(
                    async () => {
                        const [result] = await source.query(lockQuery, [connection.id]);
                        expect(Number(result.waiting)).toBeGreaterThan(0);
                    },
                    { timeout: 3_000 },
                );
                await operator.commitTransaction();
                await running;
                await runner.commitTransaction();
                expect(await readSettings()).toMatchObject([
                    { channelId: 2, heroAutoplayIntervalSeconds: 11 },
                    { channelId: 3, heroAutoplayIntervalSeconds: 9 },
                ]);
            } finally {
                if (operator.isTransactionActive) await operator.rollbackTransaction();
                await running?.catch(() => undefined);
                if (runner.isTransactionActive) await runner.rollbackTransaction();
                await operator.release();
            }
        },
    );
});
