import { Inject, Injectable } from '@nestjs/common';
import { CustomerService, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { IsNull } from 'typeorm';

import { STOREFRONT_PROMOTION_OPTIONS } from '../constants';
import { StorefrontPageView } from '../entities/storefront-page-view.entity';
import {
    normalizeStorefrontVisitorId,
    resolveStorefrontVisitorIdentity,
} from '../referral/storefront-visitor-identity';
import { StorefrontPromotionPluginOptions } from '../types';

import {
    summarizeTraffic,
    TRAFFIC_TIMEZONE,
    trafficBusinessDate,
    trafficDateRange,
    TrafficIpGroup,
    TrafficVisitorGroup,
} from './traffic-metrics';

export interface StorefrontPageViewInput {
    eventId: string;
    visitorId?: string | null;
    pageView: boolean;
}

@Injectable()
export class StorefrontTrafficService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        @Inject(STOREFRONT_PROMOTION_OPTIONS)
        private readonly options: Required<StorefrontPromotionPluginOptions>,
    ) {}

    async record(ctx: RequestContext, input: StorefrontPageViewInput) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.eventId)) {
            throw new UserInputError('Invalid page view event ID');
        }
        if (input.visitorId != null && !normalizeStorefrontVisitorId(input.visitorId)) {
            throw new UserInputError('Invalid visitor ID');
        }
        const cookie = ctx.req?.headers.cookie ?? '';
        if (cookie.split(';').some(part => part.trim() === 'storefront_analytics_opt_out=1')) {
            return { recorded: false, setCookie: null };
        }
        const identity = resolveStorefrontVisitorIdentity({
            req: ctx.req,
            channelId: String(ctx.channelId),
            visitorId: input.visitorId,
            signingSecret: this.options.signingSecret,
        });
        if (!identity) return { recorded: false, setCookie: null };
        const customer = ctx.activeUserId
            ? await this.customerService.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        // An administrator session is not a customer storefront visit.
        if (ctx.activeUserId && !customer) return { recorded: false, setCookie: null };

        const businessDate = trafficBusinessDate();
        const digest = (purpose: string, value: string) =>
            createHmac('sha256', this.options.signingSecret)
                .update(
                    JSON.stringify([
                        'storefront-traffic-v1',
                        String(ctx.channelId),
                        businessDate,
                        purpose,
                        value,
                    ]),
                )
                .digest('hex');
        const visitorKeyHash = digest('visitor', identity.keyMaterial);
        const customerKeyHash = customer ? digest('customer', String(customer.id)) : null;
        const clientIp = trafficPublicIp(identity.clientIp);
        const repository = this.connection.getRepository(ctx, StorefrontPageView);
        const eventWhere = { channelId: ctx.channelId, eventId: input.eventId.toLowerCase() };
        if (input.pageView) {
            await repository
                .createQueryBuilder()
                .insert()
                .into(StorefrontPageView)
                .values({
                    ...eventWhere,
                    businessDate,
                    visitorKeyHash,
                    customerKeyHash,
                    ipHash: clientIp ? digest('ip', clientIp) : null,
                })
                .orIgnore()
                // MySQL INSERT IGNORE returns no generated ID for an existing event.
                // Hydrating that skipped insert makes TypeORM throw before the idempotent read below.
                .updateEntity(false)
                .execute();
        }
        const event = await repository.findOneBy(eventWhere);
        // Event IDs cannot be reused to alter another browser or another day's traffic.
        if (!event || event.visitorKeyHash !== visitorKeyHash || event.businessDate !== businessDate) {
            return { recorded: false, setCookie: identity.setCookie };
        }
        if (customerKeyHash && !event.customerKeyHash) {
            await repository.update(
                { ...eventWhere, visitorKeyHash, customerKeyHash: IsNull() },
                { customerKeyHash },
            );
        }
        return { recorded: true, setCookie: identity.setCookie };
    }

    async report(ctx: RequestContext, days = 7) {
        if (![1, 7, 30].includes(days)) throw new UserInputError('Traffic range must be 1, 7 or 30 days');
        const businessDate = trafficBusinessDate();
        const dates = trafficDateRange(days, businessDate);
        const repository = this.connection.getRepository(ctx, StorefrontPageView);
        const scoped = () =>
            repository
                .createQueryBuilder('view')
                .where('view.channelId = :channelId', { channelId: ctx.channelId });
        const ranged = () =>
            scoped().andWhere('view.businessDate >= :start AND view.businessDate <= :end', {
                start: dates[0],
                end: businessDate,
            });
        const [visitors, ips, bounds] = await Promise.all([
            ranged()
                .select('view.businessDate', 'businessDate')
                .addSelect('view.visitorKeyHash', 'visitorKeyHash')
                .addSelect('view.customerKeyHash', 'customerKeyHash')
                .addSelect('COUNT(*)', 'pageViewCount')
                .groupBy('view.businessDate')
                .addGroupBy('view.visitorKeyHash')
                .addGroupBy('view.customerKeyHash')
                .getRawMany<TrafficVisitorGroup>(),
            ranged()
                .select('view.businessDate', 'businessDate')
                .addSelect('COUNT(DISTINCT view.ipHash)', 'ipCount')
                .addSelect('SUM(CASE WHEN view.ipHash IS NULL THEN 1 ELSE 0 END)', 'missingIpCount')
                .groupBy('view.businessDate')
                .getRawMany<TrafficIpGroup>(),
            scoped()
                .select('MIN(view.createdAt)', 'firstRecordedAt')
                .addSelect('MAX(view.createdAt)', 'lastRecordedAt')
                .getRawOne<{ firstRecordedAt: string | Date | null; lastRecordedAt: string | Date | null }>(),
        ]);
        return {
            businessDate,
            timezone: TRAFFIC_TIMEZONE,
            firstRecordedAt: utcDatabaseDate(bounds?.firstRecordedAt),
            lastRecordedAt: utcDatabaseDate(bounds?.lastRecordedAt),
            days: summarizeTraffic(dates, visitors, ips),
        };
    }
}

/** req.ip is resolved by Express's configured trusted proxies; never read client-supplied IP headers here. */
export function trafficPublicIp(value: string | null): string | null {
    if (!value) return null;
    const ip = value.toLowerCase().replace(/^::ffff:/u, '');
    if (isIP(ip) === 4) {
        const [first, second] = ip.split('.').map(Number);
        if (
            first === 0 ||
            first === 10 ||
            first === 127 ||
            first >= 224 ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            (first === 100 && second >= 64 && second <= 127)
        )
            return null;
        return ip;
    }
    if (isIP(ip) === 6) {
        const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
        if (/^(::|::1|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|ff)/u.test(normalized)) return null;
        return normalized;
    }
    return null;
}

function utcDatabaseDate(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const normalized = value.replace(' ', 'T');
    return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/u.test(normalized) ? normalized : `${normalized}Z`).toISOString();
}
