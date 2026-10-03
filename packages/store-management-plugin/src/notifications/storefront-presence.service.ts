import { Inject, Injectable } from '@nestjs/common';
import { CustomerService, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHmac } from 'node:crypto';
import { LessThan, MoreThan } from 'typeorm';

import { STOREFRONT_PROMOTION_OPTIONS } from '../constants';
import { StorefrontPresence, StorefrontPresenceStatus } from '../entities/storefront-presence.entity';
import {
    normalizeStorefrontVisitorId,
    resolveStorefrontVisitorIdentity,
} from '../referral/storefront-visitor-identity';
import { StorefrontPromotionPluginOptions } from '../types';

export const ONLINE_WINDOW_MS = 5 * 60_000;
export function summarizeOnline(rows: Array<{ visitorKeyHash: string; customerKeyHash: string | null }>) {
    const customers = new Set(rows.flatMap(row => (row.customerKeyHash ? [row.customerKeyHash] : [])));
    const identified = new Set(rows.filter(row => row.customerKeyHash).map(row => row.visitorKeyHash));
    const guests = new Set(
        rows
            .filter(row => !row.customerKeyHash && !identified.has(row.visitorKeyHash))
            .map(row => row.visitorKeyHash),
    );
    return { customers: customers.size, guests: guests.size, total: customers.size + guests.size };
}

@Injectable()
export class StorefrontPresenceService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customers: CustomerService,
        @Inject(STOREFRONT_PROMOTION_OPTIONS)
        private readonly options: Required<StorefrontPromotionPluginOptions>,
    ) {}

    async heartbeat(ctx: RequestContext, visitorId: string) {
        if (!normalizeStorefrontVisitorId(visitorId)) throw new UserInputError('访客标识无效');
        const identity = resolveStorefrontVisitorIdentity({
            req: ctx.req,
            channelId: String(ctx.channelId),
            visitorId,
            signingSecret: this.options.signingSecret,
        });
        if (!identity) return { recorded: false, setCookie: null };
        const digest = (value: string) =>
            createHmac('sha256', this.options.signingSecret)
                .update(JSON.stringify(['presence-v1', String(ctx.channelId), value]))
                .digest('hex');
        const where = { channelId: ctx.channelId, visitorKeyHash: digest(identity.keyMaterial) };
        const repository = this.connection.getRepository(ctx, StorefrontPresence);
        if (
            ctx.req?.headers.cookie?.split(';').some(part => part.trim() === 'storefront_analytics_opt_out=1')
        ) {
            await repository.delete(where);
            return { recorded: false, setCookie: null };
        }
        const customer = ctx.activeUserId
            ? await this.customers.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        if (ctx.activeUserId && !customer) return { recorded: false, setCookie: null };
        const now = new Date();
        const customerKeyHash = customer ? digest(`customer:${customer.id}`) : null;
        await repository
            .createQueryBuilder()
            .insert()
            .values({ ...where, customerKeyHash, lastSeenAt: now })
            .orIgnore()
            .updateEntity(false)
            .execute();
        await repository
            .createQueryBuilder()
            .update()
            .set({ customerKeyHash, lastSeenAt: now })
            .where(where)
            .andWhere(
                '(lastSeenAt < :cutoff OR customerKeyHash IS NULL AND :customer IS NOT NULL ' +
                    'OR customerKeyHash IS NOT NULL AND (:customer IS NULL OR customerKeyHash <> :customer))',
                { cutoff: new Date(now.getTime() - 45_000), customer: customerKeyHash },
            )
            .execute();
        await this.connection
            .getRepository(ctx, StorefrontPresenceStatus)
            .createQueryBuilder()
            .insert()
            .values({ channelId: ctx.channelId, firstSeenAt: now })
            .orIgnore()
            .updateEntity(false)
            .execute();
        return { recorded: true, setCookie: identity.setCookie };
    }

    async purge(now = new Date()) {
        await this.connection.rawConnection
            .getRepository(StorefrontPresence)
            .delete({ lastSeenAt: LessThan(new Date(now.getTime() - 86400000)) });
    }

    async snapshot(ctx: RequestContext, now = new Date()) {
        const status = await this.connection
            .getRepository(ctx, StorefrontPresenceStatus)
            .findOneBy({ channelId: ctx.channelId });
        if (!status) return { available: false, customers: null, guests: null, total: null };
        const rows = await this.connection.getRepository(ctx, StorefrontPresence).find({
            where: {
                channelId: ctx.channelId,
                lastSeenAt: MoreThan(new Date(now.getTime() - ONLINE_WINDOW_MS)),
            },
        });
        return { available: true, ...summarizeOnline(rows) };
    }
}
