import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ChannelNotFoundError, ChannelService } from '@vendure/core';
import { StoreDomainService } from '@vendure/store-domain-plugin';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { StorefrontTrafficService } from './storefront-traffic.service';

const channelsBySite = new Map([
    ['damatong.net', '美宜佳'],
    ['moyaoai.com', 'moyao-ai'],
    ['shop.flashcast.com.my', 'flashcast-mall'],
]);
const tokenPattern = /^[a-f0-9]{64}$/u;
const dayMs = 86_400_000;

@Controller('api/storefront/visitors')
export class StorefrontVisitorReportController {
    constructor(
        @Inject(StoreDomainService) private readonly domains: StoreDomainService,
        @Inject(ChannelService) private readonly channels: ChannelService,
        @Inject(StorefrontTrafficService) private readonly traffic: StorefrontTrafficService,
    ) {}

    @Get()
    async report(@Req() req: Request, @Res() res: Response): Promise<void> {
        res.setHeader('Cache-Control', 'private, no-store');
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            res.status(405).json({ error: 'method_not_allowed' });
            return;
        }
        const configuredToken = process.env.ID_STOREFRONT_VISITOR_REPORT_TOKEN;
        if (!configuredToken || !tokenPattern.test(configuredToken)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const suppliedToken = req
            .get('X-ID-Storefront-Authorization')
            ?.match(/^Bearer ([a-f0-9]{64})$/u)?.[1];
        if (
            !suppliedToken ||
            !timingSafeEqual(Buffer.from(suppliedToken, 'hex'), Buffer.from(configuredToken, 'hex'))
        ) {
            res.setHeader('WWW-Authenticate', 'Bearer');
            res.status(401).json({ error: 'unauthorized' });
            return;
        }

        const now = Date.now();
        const { site, from, to } = req.query;
        const start = utcDate(from);
        const last = utcDate(to);
        const expectedChannel = typeof site === 'string' ? channelsBySite.get(site) : undefined;
        const days = (last - start) / dayMs + 1;
        if (
            Object.keys(req.query).length !== 3 ||
            typeof site !== 'string' ||
            typeof from !== 'string' ||
            typeof to !== 'string' ||
            !expectedChannel ||
            !Number.isInteger(days) ||
            days < 1 ||
            days > 30 ||
            last > now
        ) {
            res.status(400).json({ error: 'invalid_request' });
            return;
        }
        try {
            const route = await this.domains.resolveRoute(site);
            if (route?.status !== 'ACTIVE' || !route.channelToken) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            const channel = await this.channels.getChannelFromToken(route.channelToken);
            // Reject an unexpected domain reassignment or the ChannelService default-channel fallback.
            if (channel.code !== expectedChannel || channel.token !== route.channelToken) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            const cutoff = Math.min(now, last + dayMs);
            const traffic = await this.traffic.reportVisitors(channel.id, { start, days, cutoff });
            res.status(200).json({ site, from, to, timeZone: 'UTC', ...traffic });
        } catch (error) {
            if (error instanceof ChannelNotFoundError) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            res.status(503).json({ error: 'report_unavailable' });
        }
    }
}

function utcDate(value: unknown): number {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return NaN;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}
