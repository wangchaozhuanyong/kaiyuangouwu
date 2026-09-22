import { DataSource, QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { GuardAdministratorPermissionAudit1789700400000 } from './1789700400000-guard-administrator-permission-audit';

describe('append-only administrator permission audit migration', () => {
    it('allows inserts but rejects updates and deletes in SQLite, including after a repeated up', async () => {
        const source = await new DataSource({ type: 'sqljs', entities: [], synchronize: false }).initialize();
        const runner = source.createQueryRunner();
        try {
            await runner.query(
                'CREATE TABLE administrator_permission_audit (id integer PRIMARY KEY, action text)',
            );
            const migration = new GuardAdministratorPermissionAudit1789700400000();
            await migration.up(runner);
            await migration.up(runner);
            await runner.query(
                "INSERT INTO administrator_permission_audit (id, action) VALUES (1, 'CREATED')",
            );
            await expect(
                runner.query("UPDATE administrator_permission_audit SET action = 'CHANGED' WHERE id = 1"),
            ).rejects.toThrow('append-only');
            await expect(
                runner.query('DELETE FROM administrator_permission_audit WHERE id = 1'),
            ).rejects.toThrow('append-only');
            expect(
                await runner.query('SELECT action FROM administrator_permission_audit WHERE id = 1'),
            ).toEqual([{ action: 'CREATED' }]);
        } finally {
            await runner.release();
            await source.destroy();
        }
    });

    it.each(['mysql', 'mariadb', 'postgres'] as const)(
        'uses guarded append-only triggers for %s',
        async type => {
            const query = vi.fn((sql: string) => (sql.trim().startsWith('SELECT') ? [] : undefined));
            const runner = {
                connection: { options: { type } },
                hasTable: vi.fn().mockResolvedValue(true),
                query,
            } as unknown as QueryRunner;
            await new GuardAdministratorPermissionAudit1789700400000().up(runner);
            const statements = query.mock.calls.map(([sql]) => sql);
            expect(statements.filter(sql => sql.includes('CREATE TRIGGER'))).toHaveLength(2);
            expect(statements.join('\n')).toContain('BEFORE UPDATE');
            expect(statements.join('\n')).toContain('BEFORE DELETE');
            expect(statements.join('\n')).toContain('append-only');
        },
    );

    it('refuses to pretend the guard exists when the audit table is missing', async () => {
        const query = vi.fn();
        const runner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn().mockResolvedValue(false),
            query,
        } as unknown as QueryRunner;
        await expect(new GuardAdministratorPermissionAudit1789700400000().up(runner)).rejects.toThrow(
            'must exist',
        );
        expect(query).not.toHaveBeenCalled();
    });

    it.skipIf(process.env.VENDURE_AUDIT_MYSQL_SMOKE !== '1')(
        'enforces append-only audit rows in an isolated local MySQL database',
        async () => {
            const { createConnection } = await import('mysql2/promise');
            const databaseName = `codex_audit_guard_${process.pid}`;
            const connection = await createConnection({
                host: '127.0.0.1',
                port: 3306,
                user: process.env.VENDURE_TEST_MYSQL_USER,
                password: process.env.VENDURE_TEST_MYSQL_PASSWORD,
            });
            let databaseCreated = false;
            let source: DataSource | undefined;
            try {
                const [existing] = await connection.query(
                    'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
                    [databaseName],
                );
                if ((existing as unknown[]).length > 0) {
                    throw new Error(`Refusing to reuse existing database ${databaseName}`);
                }
                await connection.query(`CREATE DATABASE \`${databaseName}\``);
                databaseCreated = true;
                source = await new DataSource({
                    type: 'mysql',
                    host: '127.0.0.1',
                    port: 3306,
                    username: process.env.VENDURE_TEST_MYSQL_USER,
                    password: process.env.VENDURE_TEST_MYSQL_PASSWORD,
                    database: databaseName,
                    entities: [],
                    synchronize: false,
                }).initialize();
                const runner = source.createQueryRunner();
                try {
                    await runner.query(
                        'CREATE TABLE administrator_permission_audit (id INT PRIMARY KEY, action VARCHAR(50))',
                    );
                    const migration = new GuardAdministratorPermissionAudit1789700400000();
                    await migration.up(runner);
                    await migration.up(runner);
                    await runner.query(
                        "INSERT INTO administrator_permission_audit (id, action) VALUES (1, 'CREATED')",
                    );
                    await expect(
                        runner.query(
                            "UPDATE administrator_permission_audit SET action = 'CHANGED' WHERE id = 1",
                        ),
                    ).rejects.toThrow('append-only');
                    await expect(
                        runner.query('DELETE FROM administrator_permission_audit WHERE id = 1'),
                    ).rejects.toThrow('append-only');
                } finally {
                    await runner.release();
                }
            } finally {
                await source?.destroy();
                if (databaseCreated) await connection.query(`DROP DATABASE \`${databaseName}\``);
                await connection.end();
            }
        },
    );
});
