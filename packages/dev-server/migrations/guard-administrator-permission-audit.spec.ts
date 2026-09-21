import { DataSource, QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { GuardAdministratorPermissionAudit1789495200000 } from './1789495200000-guard-administrator-permission-audit';

describe('append-only administrator permission audit migration', () => {
    it('allows inserts but rejects updates and deletes in SQLite, including after a repeated up', async () => {
        const source = await new DataSource({ type: 'sqljs', entities: [], synchronize: false }).initialize();
        const runner = source.createQueryRunner();
        try {
            await runner.query(
                'CREATE TABLE administrator_permission_audit (id integer PRIMARY KEY, action text)',
            );
            const migration = new GuardAdministratorPermissionAudit1789495200000();
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
            await new GuardAdministratorPermissionAudit1789495200000().up(runner);
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
        await expect(new GuardAdministratorPermissionAudit1789495200000().up(runner)).rejects.toThrow(
            'must exist',
        );
        expect(query).not.toHaveBeenCalled();
    });
});
