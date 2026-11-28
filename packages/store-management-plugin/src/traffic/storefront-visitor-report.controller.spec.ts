import { Test } from '@nestjs/testing';
import { ChannelNotFoundError, ChannelService } from '@vendure/core';
import { StoreDomainService } from '@vendure/store-domain-plugin';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorefrontTrafficService } from './storefront-traffic.service';
import { StorefrontVisitorReportController } from './storefront-visitor-report.controller';

const now = new Date('2026-11-28T12:00:00.700Z');
const token = randomBytes(32).toString('hex');
const complete = { site: 'moyaoai.com', from: '2026-11-28', to: '2026-11-28' };
const channels = [
    ['damatong.net', '美宜佳', 14],
    ['moyaoai.com', 'moyao-ai', 15],
    ['shop.flashcast.com.my', 'flashcast-mall', 16],
] as const;
const siteConfiguration = Object.fromEntries(channels.map(([site, code]) => [site, code]));

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    vi.stubEnv('ID_STOREFRONT_VISITOR_REPORT_TOKEN', token);
    vi.stubEnv('ID_STOREFRONT_VISITOR_REPORT_SITES', JSON.stringify(siteConfiguration));
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

function fixture(code = 'moyao-ai', id = 15) {
    const resolveRoute = vi.fn(() => Promise.resolve({ status: 'ACTIVE', channelToken: 'route-token' }));
    const getChannelFromToken = vi.fn(() => Promise.resolve({ code, id, token: 'route-token' }));
    const reportVisitors = vi.fn(() =>
        Promise.resolve({
            visitors: 2,
            daily: [{ date: '2026-11-28', visitors: 2 }],
            hasUnidentifiedViews: false,
        }),
    );
    const controller = new StorefrontVisitorReportController(
        { resolveRoute } as unknown as StoreDomainService,
        { getChannelFromToken } as unknown as ChannelService,
        { reportVisitors } as unknown as StorefrontTrafficService,
    );
    const reply = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const request = (query: object, authorization: string | null = 'Bearer ' + token, method = 'GET') =>
        controller.report(
            {
                method,
                query,
                headers: { host: 'console.moyaoai.com', 'x-forwarded-host': 'different.example' },
                get: (header: string) => header === 'X-ID-Storefront-Authorization' && authorization,
            } as unknown as Request,
            reply as unknown as Response,
        );
    return { request, reply, resolveRoute, getChannelFromToken, reportVisitors };
}

it('only accepts a configured dedicated bearer on GET', async () => {
    const { request, reply, resolveRoute } = fixture();
    await request(complete, null);
    expect(reply.status).toHaveBeenLastCalledWith(401);
    expect(reply.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    await request(complete, 'Bearer ' + randomBytes(32).toString('hex'));
    expect(reply.status).toHaveBeenLastCalledWith(401);
    await request(complete, undefined, 'HEAD');
    expect(reply.status).toHaveBeenLastCalledWith(405);
    vi.stubEnv('ID_STOREFRONT_VISITOR_REPORT_TOKEN', '');
    await request(complete);
    expect(reply.status).toHaveBeenLastCalledWith(404);
    expect(reply.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(resolveRoute).not.toHaveBeenCalled();
});

it('keeps the report closed when the production site map is missing or invalid', async () => {
    const { request, reply, resolveRoute } = fixture();
    for (const configuration of [
        undefined,
        '',
        '{',
        'null',
        '[]',
        '{}',
        JSON.stringify({ ...siteConfiguration, 'extra.example': 'extra-channel' }),
        JSON.stringify({ 'MOYAOAI.COM': 'moyao-ai' }),
        JSON.stringify({ 'moyaoai.com.': 'moyao-ai' }),
        JSON.stringify({ 'moyaoai.com:443': 'moyao-ai' }),
        JSON.stringify({ 'https://moyaoai.com': 'moyao-ai' }),
        JSON.stringify({ '192.0.2.1': 'moyao-ai' }),
        JSON.stringify({ 'moyaoai.com': 2 }),
        JSON.stringify({ 'moyaoai.com': ' ' }),
        JSON.stringify({ 'moyaoai.com': 'moyao-ai\n' }),
        JSON.stringify({ 'moyaoai.com': 'moyao-ai', 'damatong.net': 'moyao-ai' }),
    ]) {
        vi.stubEnv('ID_STOREFRONT_VISITOR_REPORT_SITES', configuration);
        await request(complete);
        expect(reply.status).toHaveBeenLastCalledWith(404);
        expect(reply.json).toHaveBeenLastCalledWith({ error: 'not_found' });
    }
    expect(resolveRoute).not.toHaveBeenCalled();
});

it('permits only the domains explicitly configured for this integration', async () => {
    const { request, reply, resolveRoute } = fixture();
    vi.stubEnv('ID_STOREFRONT_VISITOR_REPORT_SITES', JSON.stringify({ 'moyaoai.com': 'moyao-ai' }));
    await request({ ...complete, site: 'damatong.net' });
    expect(reply.status).toHaveBeenLastCalledWith(400);
    expect(resolveRoute).not.toHaveBeenCalled();
    await request(complete);
    expect(reply.status).toHaveBeenLastCalledWith(200);
});

it.each(channels)('reads only the verified channel of %s', async (site, code, id) => {
    const { request, reply, resolveRoute, getChannelFromToken, reportVisitors } = fixture(code, id);
    await request({ ...complete, site });
    expect(resolveRoute).toHaveBeenCalledWith(site);
    expect(getChannelFromToken).toHaveBeenCalledWith('route-token');
    expect(reportVisitors).toHaveBeenCalledWith(id, {
        start: Date.parse('2026-11-28T00:00:00Z'),
        days: 1,
        cutoff: now.getTime(),
    });
    expect(reply.status).toHaveBeenLastCalledWith(200);
    expect(reply.json).toHaveBeenCalledWith({
        ...complete,
        site,
        timeZone: 'UTC',
        visitors: 2,
        daily: [{ date: '2026-11-28', visitors: 2 }],
        hasUnidentifiedViews: false,
    });
});

it('rejects malformed dates and duplicate, extra, future and unsupported filters', async () => {
    const { request, reply, resolveRoute } = fixture();
    for (const query of [
        { ...complete, site: 'flashcast.com.my' },
        { ...complete, site: 'www.moyaoai.com' },
        { ...complete, from: '2026-02-30' },
        { ...complete, from: '2026-11-29' },
        { ...complete, to: '2026-11-29' },
        { ...complete, from: '2026-10-29' },
        { ...complete, to: ['2026-11-28', '2026-11-28'] },
        { ...complete, channelId: '15' },
    ]) {
        await request(query);
        expect(reply.status).toHaveBeenLastCalledWith(400);
    }
    expect(resolveRoute).not.toHaveBeenCalled();
});

it('accepts a historical interval and ends it at the next UTC midnight', async () => {
    const { request, reply, reportVisitors } = fixture();
    await request({ ...complete, from: '2026-09-05', to: '2026-10-04' });
    expect(reply.status).toHaveBeenLastCalledWith(200);
    expect(reportVisitors).toHaveBeenCalledWith(15, {
        start: Date.parse('2026-09-05T00:00:00Z'),
        days: 30,
        cutoff: Date.parse('2026-10-05T00:00:00Z'),
    });
});

it('rejects missing, outdated and misassigned channel mappings', async () => {
    const { request, reply, resolveRoute, getChannelFromToken, reportVisitors } = fixture('flashcast-mall');
    resolveRoute.mockResolvedValueOnce({ status: 'PENDING', channelToken: 'route-token' });
    await request(complete);
    expect(reply.status).toHaveBeenLastCalledWith(404);
    expect(getChannelFromToken).not.toHaveBeenCalled();
    getChannelFromToken.mockRejectedValueOnce(new ChannelNotFoundError('route-token'));
    await request(complete);
    expect(reply.status).toHaveBeenLastCalledWith(404);
    await request(complete);
    expect(reply.status).toHaveBeenLastCalledWith(404);
    expect(reportVisitors).not.toHaveBeenCalled();
});

it('keeps infrastructure error details out of the response', async () => {
    const { request, reply, reportVisitors } = fixture();
    reportVisitors.mockRejectedValueOnce(new Error('fixture private database message'));
    await request(complete);
    expect(reply.status).toHaveBeenLastCalledWith(503);
    expect(reply.json).toHaveBeenLastCalledWith({ error: 'report_unavailable' });
});

it('serves the registered Nest GET route with the forwarded integration credential', async () => {
    const { resolveRoute, getChannelFromToken, reportVisitors } = fixture();
    const module = await Test.createTestingModule({
        controllers: [StorefrontVisitorReportController],
        providers: [
            { provide: StoreDomainService, useValue: { resolveRoute } },
            { provide: ChannelService, useValue: { getChannelFromToken } },
            { provide: StorefrontTrafficService, useValue: { reportVisitors } },
        ],
    }).compile();
    const app = module.createNestApplication({ logger: false });
    try {
        await app.listen(0, '127.0.0.1');
        const origin = await app.getUrl();
        const endpoint = origin + '/api/storefront/visitors?' + new URLSearchParams(complete).toString();
        const denied = await fetch(endpoint);
        expect(denied.status).toBe(401);
        expect(denied.headers.get('cache-control')).toBe('private, no-store');
        const sessionBearer = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + token } });
        expect(sessionBearer.status).toBe(401);
        const headers = { 'X-ID-Storefront-Authorization': 'Bearer ' + token };
        const result = await fetch(endpoint, { headers });
        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('private, no-store');
        expect(await result.json()).toMatchObject({ ...complete, timeZone: 'UTC', visitors: 2 });
        const duplicate = await fetch(endpoint + '&site=damatong.net', { headers });
        expect(duplicate.status).toBe(400);
        expect(reportVisitors).toHaveBeenCalledTimes(1);
    } finally {
        await app.close();
    }
});
