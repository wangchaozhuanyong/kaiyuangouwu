import { TransactionalConnection } from '@vendure/core';
import { createHash, randomBytes } from 'node:crypto';
import 'reflect-metadata';
import { DataSource, EntitySchema, type DataSourceOptions } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
    ShopAbuseBucket,
    ShopAbuseChallenge,
} from '../../store-management-plugin/src/abuse-protection/entities';
import { ShopAbuseStore } from '../../store-management-plugin/src/abuse-protection/store';

import { AddShopAbuseProtection1792180800000 } from './1792180800000-add-shop-abuse-protection';

const enabled = process.env.DB === 'mysql' || process.env.PLATFORM_GOVERNANCE_CI_MYSQL === '1';
const port = Number(process.env.SHOP_ABUSE_TEST_MYSQL_PORT ?? (enabled ? process.env.E2E_MYSQL_PORT : 0));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const at = new Date('2026-10-17T04:00:00.000Z');
const later = (milliseconds: number) => new Date(at.getTime() + milliseconds);
const base = {
    id: { type: Number, primary: true, generated: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
} as const;
const entities = [
    new EntitySchema({
        name: 'ShopAbuseBucket',
        target: ShopAbuseBucket,
        tableName: 'shop_abuse_bucket',
        columns: {
            ...base,
            bucket: { type: String },
            attempts: { type: Number, default: 0 },
            expiresAt: { type: Date },
            blockedUntil: { type: Date, nullable: true },
        },
    }),
    new EntitySchema({
        name: 'ShopAbuseChallenge',
        target: ShopAbuseChallenge,
        tableName: 'shop_abuse_challenge',
        columns: {
            ...base,
            publicId: { type: String },
            bindingHash: { type: String },
            answerDigest: { type: String },
            expiresAt: { type: Date },
            consumedAt: { type: Date, nullable: true },
        },
    }),
];
const challenge = () => ({
    publicId: randomBytes(24).toString('hex'),
    bindingHash: hash('synthetic-binding'),
    answerDigest: hash('synthetic-answer'),
    expiresAt: later(1000),
});

describe.runIf(Number.isInteger(port) && port > 1024 && port <= 65535)(
    'shop abuse atomic security state on disposable real MySQL',
    () => {
        const database = `shop_abuse_test_${randomBytes(8).toString('hex')}`;
        let admin: DataSource | undefined;
        let db: DataSource;
        let peerDb: DataSource;
        let store: ShopAbuseStore;
        let peer: ShopAbuseStore;
        const connect = () => ({ rawConnection: db }) as TransactionalConnection;
        beforeAll(async () => {
            // Explicit opt-in, loopback and synthetic CI credentials only. Never import runtime env or dev-config.
            const options: DataSourceOptions = {
                type: 'mysql',
                connectorPackage: 'mysql2',
                host: '127.0.0.1',
                port,
                username: 'root',
                password: 'password',
                entities,
                synchronize: false,
                logging: false,
                extra: { connectionLimit: 10 },
            };
            admin = await new DataSource({ ...options, database: 'mysql', entities: [] }).initialize();
            await admin.query(`CREATE DATABASE \`${database}\``);
            db = await new DataSource({ ...options, database }).initialize();
            await new AddShopAbuseProtection1792180800000().up(db.createQueryRunner());
            peerDb = await new DataSource({ ...options, database }).initialize();
            store = new ShopAbuseStore(connect());
            peer = new ShopAbuseStore({ rawConnection: peerDb } as TransactionalConnection);
            await db.query(
                'CREATE TABLE business_sentinel (id int PRIMARY KEY, marker varchar(64)) ENGINE=InnoDB',
            );
            await db.query("INSERT INTO business_sentinel VALUES (1, 'keep-original-business-row')");
        });
        beforeEach(async () => {
            await db.getRepository(ShopAbuseChallenge).clear();
            await db.getRepository(ShopAbuseBucket).clear();
        });
        afterAll(async () => {
            if (peerDb?.isInitialized) await peerDb.destroy();
            if (db?.isInitialized) await db.destroy();
            if (admin?.isInitialized) {
                // Drop only this test's fresh randomly-named database, never an existing fixture or business database.
                await admin.query(`DROP DATABASE \`${database}\``);
                await admin.destroy();
            }
        });

        it('applies the formal migration twice with unique keys, expiry indexes and an untouched business sentinel', async () => {
            await store.consume(hash('existing-state'), 2, 1000, at);
            const runner = db.createQueryRunner();
            try {
                await new AddShopAbuseProtection1792180800000().up(runner);
                await new AddShopAbuseProtection1792180800000().up(runner);
                const bucket = await runner.getTable('shop_abuse_bucket');
                const proof = await runner.getTable('shop_abuse_challenge');
                expect(bucket?.indices.map(index => index.name).sort()).toEqual([
                    'IDX_shop_abuse_bucket_expires',
                    'UQ_shop_abuse_bucket_bucket',
                ]);
                expect(proof?.indices.map(index => index.name).sort()).toEqual([
                    'IDX_shop_abuse_challenge_expires',
                    'UQ_shop_abuse_challenge_public',
                ]);
                expect(await peer.count(hash('existing-state'), at)).toBe(1);
                expect(await db.query('SELECT * FROM business_sentinel')).toEqual([
                    { id: 1, marker: 'keep-original-business-row' },
                ]);
            } finally {
                await runner.release();
            }
        });
        it('does not overspend a shared budget across independent connection pools', async () => {
            const bucket = hash('independent-pools');
            const results = await Promise.all(
                Array.from({ length: 80 }, (_, n) => (n % 2 ? store : peer).consume(bucket, 9, 1000, at)),
            );
            expect(results.filter(result => result.allowed)).toHaveLength(9);
            expect(await new ShopAbuseStore(connect()).count(bucket, at)).toBe(9);
            expect(
                results.filter(result => !result.allowed).every(result => result.retryAfterMs === 1000),
            ).toBe(true);
        });
        it('resets exactly at expiry without two pools reopening the same window', async () => {
            const bucket = hash('boundary');
            await store.consume(bucket, 3, 1000, at);
            await peer.consume(bucket, 3, 1000, at);
            await store.consume(bucket, 3, 1000, at);
            expect(await peer.consume(bucket, 3, 1000, later(999))).toEqual({
                allowed: false,
                count: 3,
                retryAfterMs: 1,
            });
            const reopened = await Promise.all(
                Array.from({ length: 20 }, (_, n) =>
                    (n % 2 ? store : peer).consume(bucket, 3, 1000, later(1000)),
                ),
            );
            expect(reopened.filter(result => result.allowed)).toHaveLength(3);
        });
        it('caps concurrent failure signals and extends cooldowns monotonically across pools', async () => {
            const bucket = hash('signals');
            await store.signal(bucket, 1000, at);
            await db.getRepository(ShopAbuseBucket).update({ bucket }, { attempts: 999_999 });
            await Promise.all(
                Array.from({ length: 20 }, (_, n) => (n % 2 ? store : peer).signal(bucket, 1000, at)),
            );
            expect(await peer.count(bucket, at)).toBe(1_000_000);
            await Promise.all([2000, 5000, 3000, 4000].map(ms => peer.cooldown(bucket, later(ms), at)));
            await store.cooldown(bucket, later(1000), at);
            expect(await peer.blockedFor(bucket, at)).toBe(5000);
            expect(await store.consume(bucket, 3, 1000, later(1000))).toEqual({
                allowed: false,
                count: 0,
                retryAfterMs: 4000,
            });
        });
        it('claims a bound challenge once under real MySQL contention and rejects replay, wrong binding and expiry', async () => {
            const input = challenge();
            await store.createChallenge(input);
            expect(await peer.consumeChallenge(input.publicId, hash('wrong-binding'), at)).toBeNull();
            const claims = await Promise.all(
                Array.from({ length: 30 }, (_, n) =>
                    (n % 2 ? store : peer).consumeChallenge(input.publicId, input.bindingHash, at),
                ),
            );
            expect(claims.filter(Boolean)).toEqual([{ answerDigest: input.answerDigest }]);
            expect(await peer.consumeChallenge(input.publicId, input.bindingHash, at)).toBeNull();
            const expired = challenge();
            await peer.createChallenge(expired);
            expect(
                await store.consumeChallenge(expired.publicId, expired.bindingHash, later(1000)),
            ).toBeNull();
        });
        it('does not roll back security admission or spent proof when the independent business transaction rejects', async () => {
            const input = challenge();
            await store.createChallenge(input);
            const transaction = peerDb.createQueryRunner();
            await transaction.connect();
            await transaction.startTransaction();
            try {
                await transaction.query(
                    "INSERT INTO business_sentinel VALUES (2, 'rolled-back-business-write')",
                );
                await store.consume(hash('committed-admission'), 1, 1000, at);
                expect(await store.consumeChallenge(input.publicId, input.bindingHash, at)).toEqual({
                    answerDigest: input.answerDigest,
                });
                await transaction.rollbackTransaction();
            } finally {
                await transaction.release();
            }
            expect(await db.query('SELECT * FROM business_sentinel')).toEqual([
                { id: 1, marker: 'keep-original-business-row' },
            ]);
            expect(await peer.count(hash('committed-admission'), at)).toBe(1);
            expect(await peer.consumeChallenge(input.publicId, input.bindingHash, at)).toBeNull();
        });
        it('only cleans expired security state and never stores raw identities or answers', async () => {
            const raw = 'SYNTHETIC_EMAIL_IP_SESSION_ANSWER_NOT_REAL';
            await expect(store.signal(raw, 1000, at)).rejects.toThrow('安全存储标识无效');
            const input = { ...challenge(), plaintext: raw };
            await store.createChallenge(input);
            const blocked = hash('active-cooldown');
            await store.cooldown(blocked, later(2000), at);
            expect(await store.pruneExpired(later(1000))).toEqual({ buckets: 0, challenges: 1 });
            expect(await peer.blockedFor(blocked, later(1000))).toBe(1000);
            expect(JSON.stringify(await db.query('SELECT * FROM shop_abuse_bucket'))).not.toContain(raw);
            expect(await db.query('SELECT COUNT(*) AS total FROM business_sentinel')).toEqual([
                { total: '1' },
            ]);
        });
    },
);
