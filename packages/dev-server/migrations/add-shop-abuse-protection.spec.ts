import { readFileSync } from 'node:fs';
import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddShopAbuseProtection1792180800000 } from './1792180800000-add-shop-abuse-protection';

const columns = {
    shop_abuse_bucket: ['id', 'createdAt', 'updatedAt', 'bucket', 'attempts', 'expiresAt', 'blockedUntil'],
    shop_abuse_challenge: [
        'id',
        'createdAt',
        'updatedAt',
        'publicId',
        'bindingHash',
        'answerDigest',
        'expiresAt',
        'consumedAt',
    ],
};

describe('shop abuse protection migration', () => {
    it.each(['mysql', 'mariadb', 'postgres', 'sqlite', 'better-sqlite3', 'sqljs'] as const)(
        'defines isolated non-sensitive security state with compatible %s types',
        async driver => {
            const tables: Table[] = [];
            const businessQuery = vi.fn(() => {
                throw new Error('Migration must not run business-table SQL');
            });
            const runner = {
                connection: { options: { type: driver } },
                hasTable: vi.fn().mockResolvedValue(false),
                createTable: vi.fn((table: Table) => {
                    tables.push(table);
                    return Promise.resolve();
                }),
                query: businessQuery,
            } as unknown as QueryRunner;
            await new AddShopAbuseProtection1792180800000().up(runner);
            expect(tables.map(table => table.name)).toEqual(Object.keys(columns));
            expect(businessQuery).not.toHaveBeenCalled();
            const mysql = driver === 'mysql' || driver === 'mariadb';
            for (const table of tables) {
                expect(table.columns.map(column => column.name)).toEqual(
                    columns[table.name as keyof typeof columns],
                );
                expect(table.foreignKeys).toEqual([]);
                const id = table.findColumnByName('id');
                expect(id?.type).toBe(mysql ? 'int' : 'integer');
                expect(id?.isGenerated).toBe(true);
                expect(id?.generationStrategy).toBe('increment');
                for (const name of ['createdAt', 'updatedAt', 'expiresAt']) {
                    const column = table.findColumnByName(name);
                    expect(column?.type).toBe(
                        driver === 'postgres' ? 'timestamp without time zone' : 'datetime',
                    );
                    if (mysql) expect(column?.precision).toBe(6);
                    expect(column?.isNullable).toBe(false);
                }
                expect(table.findColumnByName('updatedAt')?.onUpdate).toBe(
                    mysql ? 'CURRENT_TIMESTAMP(6)' : undefined,
                );
                expect(
                    table.indices.some(index => !index.isUnique && index.columnNames.join() === 'expiresAt'),
                ).toBe(true);
                const identity = table.name === 'shop_abuse_bucket' ? 'bucket' : 'publicId';
                expect(table.findColumnByName(identity)?.length).toBe('64');
                expect(
                    table.indices.some(index => index.isUnique && index.columnNames.join() === identity),
                ).toBe(true);
            }
            const bucket = tables[0];
            expect(bucket.findColumnByName('attempts')?.default).toBe(0);
            expect(bucket.findColumnByName('attempts')?.type).toBe(mysql ? 'int' : 'integer');
            expect(bucket.findColumnByName('blockedUntil')?.isNullable).toBe(true);
            const challenge = tables[1];
            for (const name of ['bindingHash', 'answerDigest']) {
                expect(challenge.findColumnByName(name)?.type).toBe('varchar');
                expect(challenge.findColumnByName(name)?.length).toBe('64');
            }
            expect(challenge.findColumnByName('consumedAt')?.isNullable).toBe(true);
        },
    );

    it('applies twice on real SQL.js, enforces unique identities and preserves security and business rows', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.query(
                'CREATE TABLE accepted_order_sentinel (id INTEGER PRIMARY KEY, state VARCHAR(32))',
            );
            await runner.query("INSERT INTO accepted_order_sentinel (id, state) VALUES (1, 'paid-preserve')");
            const migration = new AddShopAbuseProtection1792180800000();
            await migration.up(runner);
            await runner.query('INSERT INTO shop_abuse_bucket (bucket, expiresAt) VALUES (?, ?)', [
                'a'.repeat(64),
                '2099-01-01 00:00:00',
            ]);
            await runner.query(
                'INSERT INTO shop_abuse_challenge (publicId, bindingHash, answerDigest, expiresAt) VALUES (?, ?, ?, ?)',
                ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), '2099-01-01 00:00:00'],
            );
            const beforeBuckets = await runner.query('SELECT * FROM shop_abuse_bucket');
            const beforeChallenges = await runner.query('SELECT * FROM shop_abuse_challenge');
            await migration.up(runner);
            expect(await runner.query('SELECT * FROM shop_abuse_bucket')).toEqual(beforeBuckets);
            expect(await runner.query('SELECT * FROM shop_abuse_challenge')).toEqual(beforeChallenges);
            expect(beforeBuckets[0]).toMatchObject({ attempts: 0, blockedUntil: null });
            expect(beforeChallenges[0]).toMatchObject({ consumedAt: null });
            for (const name of Object.keys(columns)) {
                const table = await runner.getTable(name);
                expect(table?.columns.map(column => column.name)).toEqual(
                    columns[name as keyof typeof columns],
                );
                expect(table?.indices.some(index => index.columnNames.join() === 'expiresAt')).toBe(true);
            }
            await expect(
                runner.query('INSERT INTO shop_abuse_bucket (bucket, expiresAt) VALUES (?, ?)', [
                    'a'.repeat(64),
                    '2099-01-01 00:00:00',
                ]),
            ).rejects.toThrow();
            await expect(
                runner.query(
                    'INSERT INTO shop_abuse_challenge (publicId, bindingHash, answerDigest, expiresAt) VALUES (?, ?, ?, ?)',
                    ['b'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), '2099-01-01 00:00:00'],
                ),
            ).rejects.toThrow();
            await expect(migration.down()).rejects.toThrow('separate reviewed migration');
            expect(await runner.query('SELECT * FROM shop_abuse_bucket')).toEqual(beforeBuckets);
            expect(await runner.query('SELECT * FROM shop_abuse_challenge')).toEqual(beforeChallenges);
            expect(await runner.query('SELECT * FROM accepted_order_sentinel')).toEqual([
                { id: 1, state: 'paid-preserve' },
            ]);
        } finally {
            await runner.release();
            await database.destroy();
        }
    });

    it('registers the additive migration after the existing GPT recharge migration', () => {
        const registry = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
        expect(registry).toContain(
            "import { AddShopAbuseProtection1792180800000 } from './1792180800000-add-shop-abuse-protection';",
        );
        const registrations = registry.match(/export const devServerMigrations = \[([\s\S]*?)\];/)?.[1] ?? '';
        expect(registrations).toMatch(/AddGptRecharge1792152000000,\s+AddShopAbuseProtection1792180800000,/);
        expect(registrations.match(/\bAddShopAbuseProtection1792180800000\b/g)).toHaveLength(1);
    });
});
