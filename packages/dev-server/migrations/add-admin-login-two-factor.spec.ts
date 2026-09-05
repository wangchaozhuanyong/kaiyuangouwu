import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddAdminLoginTwoFactor1788609600000 } from './1788609600000-add-admin-login-two-factor';

describe('administrator login 2FA migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'defines isolated security tables for %s',
        async type => {
            const tables: Table[] = [];
            const runner = {
                connection: { options: { type } },
                hasTable: vi.fn(() => Promise.resolve(false)),
                createTable: vi.fn((table: Table) => {
                    tables.push(table);
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;
            await new AddAdminLoginTwoFactor1788609600000().up(runner);
            expect(tables).toHaveLength(4);
            const credentials = tables.find(table => table.name === 'admin_two_factor_credential');
            if (!credentials) throw new Error('Credential table was not created');
            expect(credentials.findColumnByName('secret')).toBeUndefined();
            expect(credentials.findColumnByName('encryptedSecret')?.type).toBe('text');
            expect(
                credentials.indices.some(index => index.isUnique && index.columnNames.includes('userId')),
            ).toBe(true);
            expect(
                tables.find(table => table.name === 'admin_two_factor_challenge')?.findColumnByName('token'),
            ).toBeUndefined();
        },
    );

    it('applies twice on real SQLite and cascades session proofs when a session is revoked', async () => {
        const database = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await database.initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.query('CREATE TABLE "user" (id INTEGER PRIMARY KEY)');
            await runner.query('CREATE TABLE "session" (id INTEGER PRIMARY KEY)');
            const migration = new AddAdminLoginTwoFactor1788609600000();
            await migration.up(runner);
            await migration.up(runner);
            await runner.query('INSERT INTO "user" (id) VALUES (1)');
            await runner.query('INSERT INTO "session" (id) VALUES (1)');
            await runner.query(
                'INSERT INTO admin_two_factor_session (userId, sessionId, authVersion, passwordFingerprint) VALUES (1, 1, ?, ?)',
                ['test-version', 'test-fingerprint'],
            );
            await runner.query('DELETE FROM "session" WHERE id = 1');
            expect(await runner.query('SELECT * FROM admin_two_factor_session')).toEqual([]);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
