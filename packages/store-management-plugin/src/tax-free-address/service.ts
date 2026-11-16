import { Injectable } from '@nestjs/common';
import { ConfigService, TransactionalConnection, UserInputError, type RequestContext } from '@vendure/core';
import type { Request } from 'express';
import { EntityManager, In, IsNull, Not } from 'typeorm';

import { ShopAbuseStore } from '../abuse-protection/store';
import { storefrontClientIp } from '../referral/storefront-client-ip';

import {
    TaxFreeAddressEntity as Address,
    TaxFreeAddressFingerprint as Fingerprint,
    TaxFreeAddressPool as Pool,
} from './entities';
import {
    ADDRESS_BATCH,
    ADDRESS_CAPACITY,
    ADDRESS_COOLDOWN_MS,
    ADDRESS_LIMIT,
    addressAt,
    digest,
} from './generator';
import { AddressToolError, browserIdentity, validRequestId } from './identity';

const fail = (code: string): never => {
    throw new AddressToolError(code);
};
// Admin GraphQL presents the same safe business codes as the standalone HTTP API.
export async function adminAddressOperation<T>(work: Promise<T>): Promise<T> {
    try {
        return await work;
    } catch (error) {
        if (error instanceof AddressToolError) throw new UserInputError(error.message);
        throw error;
    }
}
export const addressDto = (row: Address) => ({
    id: String(row.id),
    country: row.country,
    line1: row.line1,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
});

@Injectable()
export class TaxFreeAddressService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly config: ConfigService,
        private readonly budgets: ShopAbuseStore,
    ) {}

    private browserHash(req: Request, create: boolean) {
        const secret = this.config.authOptions.cookieOptions?.secret;
        if (typeof secret !== 'string') return fail('UNAVAILABLE');
        return digest(browserIdentity(req, secret, create));
    }

    /** The singleton row is the database-level serialization point across all server processes. */
    private async locked<T>(work: (manager: EntityManager, pool: Pool) => Promise<T>): Promise<T> {
        return this.connection.rawConnection.transaction(async manager => {
            const repository = manager.getRepository(Pool);
            const result = await repository
                .createQueryBuilder()
                .update()
                .set({ revision: () => 'revision + 1' })
                .where({ id: 1 })
                .execute();
            if (result.affected !== 1) return fail('UNAVAILABLE');
            const pool = await repository.findOneByOrFail({ id: 1 });
            return work(manager, pool);
        });
    }

    private async lastClaim(manager: EntityManager, browserHash: string) {
        return manager.getRepository(Fingerprint).findOne({
            where: { browserHash, claimedAt: Not(IsNull()) },
            order: { claimedAt: 'DESC', id: 'DESC' },
        });
    }

    async status(req: Request) {
        const browserHash = this.browserHash(req, true);
        const last = await this.lastClaim(this.connection.rawConnection.manager, browserHash);
        const now = Date.now();
        return {
            serverNow: new Date(now).toISOString(),
            nextAllowedAt:
                last?.claimedAt && last.claimedAt.getTime() + ADDRESS_COOLDOWN_MS > now
                    ? new Date(last.claimedAt.getTime() + ADDRESS_COOLDOWN_MS).toISOString()
                    : null,
        };
    }

    private async generate(manager: EntityManager, pool: Pool, count: number) {
        if (!Number.isInteger(count) || count < 1 || count > 100) return fail('INVALID_COUNT');
        const repository = manager.getRepository(Address);
        const total = await repository.count();
        const remove = Math.max(0, total + count - ADDRESS_LIMIT);
        if (remove) {
            const oldest = await repository.find({
                where: { status: 'used' },
                order: { usedAt: 'ASC', id: 'ASC' },
                take: remove,
            });
            if (oldest.length < remove) return fail('CAPACITY');
            await repository.delete({ id: In(oldest.map(row => row.id)) });
        }
        const fingerprints = manager.getRepository(Fingerprint);
        let generated = 0;
        while (generated < count && pool.cursor < ADDRESS_CAPACITY) {
            const candidate = addressAt(pool.cursor++);
            if (await fingerprints.existsBy({ fingerprint: candidate.fingerprint })) continue;
            await fingerprints.insert({
                fingerprint: candidate.fingerprint,
                requestKey: null,
                browserHash: null,
                channelId: null,
                claimedAt: null,
            });
            await repository.insert({ ...candidate, status: 'unused', usedAt: null });
            generated++;
        }
        // Entire transaction rolls back (including pruning) if there are fewer than count combinations.
        if (generated !== count) return fail('EXHAUSTED');
        await manager.getRepository(Pool).update({ id: 1 }, { cursor: pool.cursor });
        return generated;
    }

    async claimPublic(req: Request, requestId: unknown) {
        if (!validRequestId(requestId)) return fail('INVALID_REQUEST');
        const ip = storefrontClientIp(req);
        if (!ip) return fail('UNAVAILABLE');
        const budget = await this.budgets.consume(digest('tax-address:ip:' + ip), 30, 60_000);
        if (!budget.allowed) return fail('RATE_LIMIT');
        const browserHash = this.browserHash(req, false);
        return this.claim(requestId, 'browser:' + browserHash, browserHash, null);
    }

    async claimAdmin(ctx: RequestContext, requestId: string, selectedId: string) {
        if (!validRequestId(requestId) || !ctx.activeUserId || !/^[1-9]\d{0,19}$/.test(selectedId))
            return fail('INVALID_REQUEST');
        return this.claim(requestId, 'admin:' + ctx.activeUserId, null, String(ctx.channelId), selectedId);
    }

    private async claim(
        requestId: string,
        owner: string,
        browserHash: string | null,
        channelId: string | null,
        selectedId?: string,
    ) {
        const requestKey = digest(owner + ':' + requestId.toLowerCase());
        return this.locked(async (manager, pool) => {
            const fingerprints = manager.getRepository(Fingerprint);
            const prior = await fingerprints.findOneBy({ requestKey });
            const now = new Date();
            if (prior) {
                if (prior.channelId !== channelId) return fail('REQUEST_SCOPE');
                const address = await manager
                    .getRepository(Address)
                    .findOneBy({ fingerprint: prior.fingerprint });
                if (!address || !prior.claimedAt) return fail('RESULT_EXPIRED');
                if (selectedId && String(address.id) !== selectedId) return fail('REQUEST_SCOPE');
                return {
                    requestId,
                    address: addressDto(address),
                    serverNow: now.toISOString(),
                    nextAllowedAt: browserHash
                        ? new Date(prior.claimedAt.getTime() + ADDRESS_COOLDOWN_MS).toISOString()
                        : null,
                };
            }
            if (browserHash) {
                const last = await this.lastClaim(manager, browserHash);
                if (last?.claimedAt && last.claimedAt.getTime() + ADDRESS_COOLDOWN_MS > now.getTime())
                    return fail('COOLDOWN');
            }
            const addresses = manager.getRepository(Address);
            if (!selectedId && !(await addresses.existsBy({ status: 'unused' })))
                await this.generate(manager, pool, ADDRESS_BATCH);
            const row = selectedId
                ? await addresses.findOneBy({ id: selectedId, status: 'unused' })
                : await addresses.findOne({ where: { status: 'unused' }, order: { id: 'ASC' } });
            if (!row) return fail('ALREADY_USED');
            row.status = 'used';
            row.usedAt = now;
            await addresses.save(row);
            await fingerprints.update(
                { fingerprint: row.fingerprint },
                { requestKey, browserHash, channelId, claimedAt: now },
            );
            return {
                requestId,
                address: addressDto(row),
                serverNow: now.toISOString(),
                nextAllowedAt: browserHash
                    ? new Date(now.getTime() + ADDRESS_COOLDOWN_MS).toISOString()
                    : null,
            };
        });
    }

    async list(input: { status?: string; keyword?: string; skip?: number; take?: number } = {}) {
        const status = input.status ?? 'unused';
        const keyword = (input.keyword ?? '').trim();
        const skip = input.skip ?? 0;
        const take = input.take ?? 20;
        if (
            !['unused', 'used'].includes(status) ||
            keyword.length > 80 ||
            !Number.isInteger(skip) ||
            skip < 0 ||
            skip > 1000 ||
            ![10, 20, 50, 100].includes(take)
        )
            return fail('INVALID_QUERY');
        return this.connection.rawConnection.transaction(async manager => {
            const repository = manager.getRepository(Address);
            const pool = await manager.getRepository(Pool).findOneBy({ id: 1 });
            if (!pool) return fail('UNAVAILABLE');
            const rows = await repository.find({
                where: { status: status as 'unused' | 'used' },
                order: status === 'used' ? { usedAt: 'DESC', id: 'DESC' } : { createdAt: 'DESC', id: 'DESC' },
            });
            const filtered = rows.filter(row => row.line1.toLowerCase().includes(keyword.toLowerCase()));
            const unused = await repository.countBy({ status: 'unused' });
            const used = await repository.countBy({ status: 'used' });
            return {
                items: filtered.slice(skip, skip + take).map(addressDto),
                totalItems: filtered.length,
                unused,
                used,
                retained: unused + used,
                generated: await manager.getRepository(Fingerprint).count(),
                revision: pool.revision,
                capacity: ADDRESS_CAPACITY,
                limit: ADDRESS_LIMIT,
            };
        });
    }

    async generateAdmin(count: number) {
        return this.locked(async (manager, pool) => ({ count: await this.generate(manager, pool, count) }));
    }

    async clearUsed(expectedRevision: number) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return fail('INVALID_REQUEST');
        return this.locked(async (manager, pool) => {
            if (pool.revision !== expectedRevision + 1) return fail('CONFLICT');
            const result = await manager.getRepository(Address).delete({ status: 'used' });
            return { count: result.affected ?? 0 };
        });
    }
}
