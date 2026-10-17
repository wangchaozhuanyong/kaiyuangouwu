import { Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { Brackets, In, IsNull, LessThan, LessThanOrEqual, MoreThan } from 'typeorm';

import { ShopAbuseBucket, ShopAbuseChallenge } from './entities';

const SIGNAL_CAP = 1_000_000;
const PRUNE_BATCH = 200;
const digestPattern = /^[a-f0-9]{64}$/;

function assertDigest(value: string): void {
    if (!digestPattern.test(value)) throw new Error('安全存储标识无效');
}

function assertPublicId(value: string): void {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(value)) throw new Error('安全验证标识无效');
}

function timestamp(value: Date): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('安全存储时间无效');
    return new Date(value.getTime());
}

function positiveInteger(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('安全存储预算无效');
}

/** Committed security state: a rejected GraphQL transaction must not undo its budget or spent challenge. */
@Injectable()
export class ShopAbuseStore {
    constructor(private readonly connection: TransactionalConnection) {}

    private get buckets() {
        return this.connection.rawConnection.getRepository(ShopAbuseBucket);
    }
    private get challenges() {
        return this.connection.rawConnection.getRepository(ShopAbuseChallenge);
    }

    private async prepareBucket(bucket: string, windowMs: number, now: Date): Promise<void> {
        assertDigest(bucket);
        positiveInteger(windowMs);
        const expiresAt = timestamp(new Date(now.getTime() + windowMs));
        await this.buckets
            .createQueryBuilder()
            .insert()
            .values({ bucket, attempts: 0, expiresAt, blockedUntil: null })
            .orIgnore()
            .updateEntity(false)
            .execute();
        // The conditional reset cannot overwrite a window opened by another process.
        // A count window expiring must never release a still-active cooldown.
        await this.buckets.update({ bucket, expiresAt: LessThanOrEqual(now) }, { attempts: 0, expiresAt });
    }

    async consume(
        bucket: string,
        limit: number,
        windowMs: number,
        now = new Date(),
    ): Promise<{ allowed: boolean; count: number; retryAfterMs: number }> {
        positiveInteger(limit);
        if (limit > 2_147_483_647) throw new Error('安全存储预算无效');
        const at = timestamp(now);
        await this.prepareBucket(bucket, windowMs, at);
        const updated = await this.buckets
            .createQueryBuilder()
            .update()
            .set({ attempts: () => 'attempts + 1' })
            .where({ bucket, expiresAt: MoreThan(at), attempts: LessThan(limit) })
            .andWhere(
                new Brackets(query =>
                    query.where({ blockedUntil: IsNull() }).orWhere({ blockedUntil: LessThanOrEqual(at) }),
                ),
            )
            .execute();
        const row = await this.buckets.findOneByOrFail({ bucket });
        const allowed = updated.affected === 1;
        const count = row.expiresAt > at ? row.attempts : 0;
        const cooldown = Math.max(0, (row.blockedUntil?.getTime() ?? 0) - at.getTime());
        const window = count >= limit ? Math.max(0, row.expiresAt.getTime() - at.getTime()) : 0;
        return { allowed, count, retryAfterMs: allowed ? 0 : Math.max(1, cooldown, window) };
    }

    async signal(bucket: string, windowMs: number, now = new Date()): Promise<number> {
        const at = timestamp(now);
        await this.prepareBucket(bucket, windowMs, at);
        await this.buckets
            .createQueryBuilder()
            .update()
            .set({ attempts: () => 'attempts + 1' })
            .where({ bucket, expiresAt: MoreThan(at), attempts: LessThan(SIGNAL_CAP) })
            .execute();
        const row = await this.buckets.findOneByOrFail({ bucket });
        return row.expiresAt > at ? Math.min(SIGNAL_CAP, row.attempts) : 0;
    }

    async count(bucket: string, now = new Date()): Promise<number> {
        assertDigest(bucket);
        const row = await this.buckets.findOneBy({ bucket, expiresAt: MoreThan(timestamp(now)) });
        return row?.attempts ?? 0;
    }

    async cooldown(bucket: string, until: Date, now = new Date()): Promise<void> {
        assertDigest(bucket);
        const at = timestamp(now);
        const blockedUntil = timestamp(until);
        if (blockedUntil <= at) return;
        await this.buckets
            .createQueryBuilder()
            .insert()
            .values({ bucket, attempts: 0, expiresAt: at, blockedUntil })
            .orIgnore()
            .updateEntity(false)
            .execute();
        await this.buckets
            .createQueryBuilder()
            .update()
            .set({ blockedUntil })
            .where({ bucket })
            .andWhere(
                new Brackets(query =>
                    query.where({ blockedUntil: IsNull() }).orWhere({ blockedUntil: LessThan(blockedUntil) }),
                ),
            )
            .execute();
    }

    async blockedFor(bucket: string, now = new Date()): Promise<number> {
        assertDigest(bucket);
        const at = timestamp(now);
        const row = await this.buckets.findOneBy({ bucket });
        return Math.max(0, (row?.blockedUntil?.getTime() ?? 0) - at.getTime());
    }

    async createChallenge(input: {
        publicId: string;
        bindingHash: string;
        answerDigest: string;
        expiresAt: Date;
    }): Promise<void> {
        assertPublicId(input.publicId);
        assertDigest(input.bindingHash);
        assertDigest(input.answerDigest);
        await this.challenges.insert({
            publicId: input.publicId,
            bindingHash: input.bindingHash,
            answerDigest: input.answerDigest,
            expiresAt: timestamp(input.expiresAt),
            consumedAt: null,
        });
    }

    async consumeChallenge(
        publicId: string,
        bindingHash: string,
        now = new Date(),
    ): Promise<{ answerDigest: string } | null> {
        assertPublicId(publicId);
        assertDigest(bindingHash);
        const at = timestamp(now);
        const consumed = await this.challenges.update(
            { publicId, bindingHash, expiresAt: MoreThan(at), consumedAt: IsNull() },
            { consumedAt: at },
        );
        if (consumed.affected !== 1) return null;
        // Claim before answer comparison: an incorrect guess must also spend this challenge.
        const row = await this.challenges.findOneByOrFail({ publicId, bindingHash });
        return { answerDigest: row.answerDigest };
    }

    async pruneExpired(now = new Date()): Promise<{ buckets: number; challenges: number }> {
        const at = timestamp(now);
        const expired = await this.buckets.find({
            where: [
                { expiresAt: LessThanOrEqual(at), blockedUntil: IsNull() },
                { expiresAt: LessThanOrEqual(at), blockedUntil: LessThanOrEqual(at) },
            ],
            select: ['id'],
            order: { expiresAt: 'ASC', id: 'ASC' },
            take: PRUNE_BATCH,
        });
        const buckets = expired.length
            ? await this.buckets
                  .createQueryBuilder()
                  .delete()
                  .where({ id: In(expired.map(row => row.id)), expiresAt: LessThanOrEqual(at) })
                  .andWhere(
                      new Brackets(query =>
                          query
                              .where({ blockedUntil: IsNull() })
                              .orWhere({ blockedUntil: LessThanOrEqual(at) }),
                      ),
                  )
                  .execute()
            : null;
        const expiredChallenges = await this.challenges.find({
            where: { expiresAt: LessThanOrEqual(at) },
            select: ['id'],
            order: { expiresAt: 'ASC', id: 'ASC' },
            take: PRUNE_BATCH,
        });
        const challenges = expiredChallenges.length
            ? await this.challenges.delete({
                  id: In(expiredChallenges.map(row => row.id)),
                  expiresAt: LessThanOrEqual(at),
              })
            : null;
        return { buckets: buckets?.affected ?? 0, challenges: challenges?.affected ?? 0 };
    }
}
