import { TransactionalConnection } from '@vendure/core';
import { createHash } from 'node:crypto';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddShopAbuseProtection1792180800000 } from '../../../dev-server/migrations/1792180800000-add-shop-abuse-protection';

import { ShopAbuseBucket, ShopAbuseChallenge } from './entities';
import { ShopAbuseStore } from './store';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const at = new Date('2026-10-17T04:00:00.000Z');
const later = (milliseconds: number) => new Date(at.getTime() + milliseconds);
const base = {
    id: { type: Number, primary: true, generated: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
} as const;
const schemas = [
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
const challenge = (publicId = 'synthetic-challenge-0001') => ({
    publicId,
    bindingHash: hash('synthetic-binding'),
    answerDigest: hash('synthetic-answer'),
    expiresAt: later(60_000),
});

describe('shop abuse committed storage through real SQL.js', () => {
    let db: DataSource;
    let connection: TransactionalConnection;
    let store: ShopAbuseStore;
    let peer: ShopAbuseStore;
    const scopedRepository = vi.fn(() => {
        throw new Error('Security state must not join the caller GraphQL transaction');
    });

    beforeEach(async () => {
        db = await new DataSource({ type: 'sqljs', entities: schemas, synchronize: false }).initialize();
        await new AddShopAbuseProtection1792180800000().up(db.createQueryRunner());
        connection = {
            rawConnection: db,
            getRepository: scopedRepository,
        } as unknown as TransactionalConnection;
        store = new ShopAbuseStore(connection);
        peer = new ShopAbuseStore(connection);
    });
    afterEach(async () => {
        expect(scopedRepository).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        if (db.isInitialized) await db.destroy();
    });

    it('shares the exact limit across service objects and concurrent requests without overspending', async () => {
        const bucket = hash('shared-budget');
        const results = await Promise.all(
            Array.from({ length: 40 }, (_, index) => (index % 2 ? store : peer).consume(bucket, 7, 5000, at)),
        );
        expect(results.filter(result => result.allowed)).toHaveLength(7);
        expect(results.filter(result => !result.allowed).every(result => result.retryAfterMs === 5000)).toBe(
            true,
        );
        expect(await peer.count(bucket, at)).toBe(7);
        expect(await db.getRepository(ShopAbuseBucket).count()).toBe(1);
        expect(await new ShopAbuseStore(connection).consume(bucket, 7, 5000, at)).toMatchObject({
            allowed: false,
            count: 7,
        });
    });

    it('resets at the exact expiry boundary and never one millisecond early', async () => {
        const bucket = hash('expiry');
        expect((await store.consume(bucket, 1, 1000, at)).allowed).toBe(true);
        expect(await peer.consume(bucket, 1, 1000, later(999))).toEqual({
            allowed: false,
            count: 1,
            retryAfterMs: 1,
        });
        expect(await store.count(bucket, later(1000))).toBe(0);
        const boundary = await Promise.all(
            Array.from({ length: 10 }, () => peer.consume(bucket, 1, 1000, later(1000))),
        );
        expect(boundary.filter(result => result.allowed)).toHaveLength(1);
        expect(await store.count(bucket, later(1000))).toBe(1);
    });

    it('persists atomic failure signals across service reconstruction and caps them', async () => {
        const bucket = hash('failure-signals');
        await Promise.all(
            Array.from({ length: 35 }, (_, i) => (i % 2 ? store : peer).signal(bucket, 1000, at)),
        );
        expect(await new ShopAbuseStore(connection).count(bucket, at)).toBe(35);
        await db.getRepository(ShopAbuseBucket).update({ bucket }, { attempts: 999_999 });
        const capped = await Promise.all(Array.from({ length: 12 }, () => peer.signal(bucket, 1000, at)));
        expect(capped.every(value => value === 1_000_000)).toBe(true);
        expect(await store.count(bucket, at)).toBe(1_000_000);
        expect(await peer.signal(bucket, 1000, later(1000))).toBe(1);
    });

    it('only extends cooldowns under concurrency and keeps them across count-window expiry', async () => {
        const bucket = hash('cooldown');
        await store.signal(bucket, 100, at);
        await Promise.all([1000, 4000, 2000, 3000].map(ms => peer.cooldown(bucket, later(ms), at)));
        await store.cooldown(bucket, later(500), at);
        expect(await new ShopAbuseStore(connection).blockedFor(bucket, at)).toBe(4000);
        expect(await peer.consume(bucket, 5, 100, later(100))).toEqual({
            allowed: false,
            count: 0,
            retryAfterMs: 3900,
        });
        expect(await store.signal(bucket, 100, later(100))).toBe(1);
        expect(await peer.blockedFor(bucket, later(4000))).toBe(0);
        expect((await store.consume(bucket, 5, 100, later(4000))).allowed).toBe(true);
    });

    it('creates cooldown-only buckets without forcing a later counter into the cooldown window', async () => {
        const bucket = hash('cooldown-before-budget');
        await peer.cooldown(bucket, later(5000), at);
        await store.signal(bucket, 100, at);
        expect(await store.count(bucket, later(100))).toBe(0);
        expect(await peer.blockedFor(bucket, later(100))).toBe(4900);
        await peer.cooldown(bucket, at, later(1));
        expect(await store.blockedFor(bucket, at)).toBe(5000);
    });

    it('claims a challenge exactly once across concurrent service objects', async () => {
        const input = challenge();
        await store.createChallenge(input);
        const results = await Promise.all(
            Array.from({ length: 30 }, (_, i) =>
                (i % 2 ? store : peer).consumeChallenge(input.publicId, input.bindingHash, at),
            ),
        );
        expect(results.filter(Boolean)).toEqual([{ answerDigest: input.answerDigest }]);
        expect(
            await new ShopAbuseStore(connection).consumeChallenge(input.publicId, input.bindingHash, at),
        ).toBeNull();
    });

    it('rejects a wrong binding without consuming and spends the challenge before any answer check', async () => {
        const input = challenge();
        await peer.createChallenge(input);
        expect(await store.consumeChallenge(input.publicId, hash('another-binding'), at)).toBeNull();
        const claimed = await peer.consumeChallenge(input.publicId, input.bindingHash, at);
        expect(claimed?.answerDigest).not.toBe(hash('wrong-submitted-answer'));
        expect(await store.consumeChallenge(input.publicId, input.bindingHash, at)).toBeNull();
    });

    it('rejects expiry at the boundary and cannot overwrite an existing challenge', async () => {
        const input = { ...challenge(), expiresAt: later(1000) };
        await store.createChallenge(input);
        await expect(peer.createChallenge({ ...input, answerDigest: hash('replacement') })).rejects.toThrow();
        expect(await peer.consumeChallenge(input.publicId, input.bindingHash, later(1000))).toBeNull();
        expect(
            (await db.getRepository(ShopAbuseChallenge).findOneByOrFail({ publicId: input.publicId }))
                .consumedAt,
        ).toBeNull();
    });

    it('persists only explicit digests and rejects raw identities as bucket keys', async () => {
        const raw = {
            email: 'synthetic@example.invalid',
            ip: '203.0.113.9',
            code: 'KC-SYNTHETIC-NOT-A-REAL-CODE',
            session: 'SYNTHETIC_SESSION_NOT_REAL',
            answer: 'synthetic answer plaintext',
        };
        for (const identity of Object.values(raw)) {
            await expect(store.signal(identity, 1000, at)).rejects.toThrow('安全存储标识无效');
        }
        await store.createChallenge({ ...challenge(), ...raw });
        const rows = await db.query('SELECT * FROM shop_abuse_challenge');
        for (const secret of Object.values(raw)) expect(JSON.stringify(rows)).not.toContain(secret);
        expect(Object.keys(rows[0]).sort()).toEqual(
            [
                'id',
                'createdAt',
                'updatedAt',
                'publicId',
                'bindingHash',
                'answerDigest',
                'expiresAt',
                'consumedAt',
            ].sort(),
        );
    });

    it('bounds cleanup and preserves live windows, active cooldowns, challenges and business rows', async () => {
        const expiredBuckets = Array.from({ length: 205 }, (_, i) => ({
            bucket: hash(`expired-${i}`),
            attempts: 1,
            expiresAt: later(-1),
            blockedUntil: null,
        }));
        await db.getRepository(ShopAbuseBucket).insert(expiredBuckets);
        await db.getRepository(ShopAbuseChallenge).insert(
            Array.from({ length: 205 }, (_, i) => ({
                ...challenge(`expired-challenge-${String(i).padStart(4, '0')}`),
                expiresAt: at,
            })),
        );
        const active = hash('active-window');
        const blocked = hash('active-cooldown');
        await store.consume(active, 1, 1000, at);
        await store.cooldown(blocked, later(1000), at);
        await store.createChallenge(challenge());
        await db.query('CREATE TABLE business_sentinel (value varchar(64))');
        await db.query("INSERT INTO business_sentinel VALUES ('preserve-existing-business-row')");
        expect(await store.pruneExpired(at)).toEqual({ buckets: 200, challenges: 200 });
        expect(await peer.pruneExpired(at)).toEqual({ buckets: 5, challenges: 5 });
        expect(await db.getRepository(ShopAbuseBucket).count()).toBe(2);
        expect(await db.getRepository(ShopAbuseChallenge).count()).toBe(1);
        expect(await store.blockedFor(blocked, at)).toBe(1000);
        expect(await db.query('SELECT * FROM business_sentinel')).toEqual([
            { value: 'preserve-existing-business-row' },
        ]);
    });

    it('rechecks active cooldowns when cleanup races with an extension', async () => {
        const bucket = hash('cleanup-race');
        const repository = db.getRepository(ShopAbuseBucket);
        await repository.insert({ bucket, attempts: 0, expiresAt: at, blockedUntil: null });
        const find = repository.find.bind(repository);
        vi.spyOn(repository, 'find').mockImplementationOnce(async options => {
            const expired = await find(options);
            await peer.cooldown(bucket, later(1000), at);
            return expired;
        });
        expect(await store.pruneExpired(at)).toEqual({ buckets: 0, challenges: 0 });
        expect(await peer.blockedFor(bucket, at)).toBe(1000);
    });

    it('propagates unavailable storage instead of allowing requests or switching to memory', async () => {
        await db.destroy();
        const input = challenge();
        const results = await Promise.allSettled([
            store.consume(hash('unavailable'), 1, 1000, at),
            peer.signal(hash('unavailable'), 1000, at),
            store.count(hash('unavailable'), at),
            peer.cooldown(hash('unavailable'), later(1000), at),
            store.blockedFor(hash('unavailable'), at),
            peer.createChallenge(input),
            store.consumeChallenge(input.publicId, input.bindingHash, at),
            peer.pruneExpired(at),
        ]);
        expect(results.every(result => result.status === 'rejected')).toBe(true);
    });
});
