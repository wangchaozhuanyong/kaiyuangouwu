import type { RequestContext } from '@vendure/core';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    EnvironmentMonitorService,
    isPublicAddress,
    normalizeNetworkReport,
} from './environment-monitor.service';

const completeVendorReport = {
    success: true,
    country_code: 'MY',
    zip_code: '58200',
    fraud_score: 0,
    proxy: false,
    vpn: false,
    connection_type: 'residential',
    timezone: 'Asia/Kuala_Lumpur',
};

function fixture() {
    const access = { assertEnabled: vi.fn().mockResolvedValue(undefined) };
    const activation = { assertActive: vi.fn().mockResolvedValue(undefined) };
    const budgets = { consume: vi.fn().mockResolvedValue({ allowed: true }) };
    const service = new EnvironmentMonitorService(access as never, activation as never, budgets as never);
    const ctx = { channelId: 1 } as RequestContext;
    const request = { ip: '8.8.8.8', headers: { 'x-forwarded-for': '1.2.3.4' } } as unknown as Request;
    const fetcher = vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(completeVendorReport))));
    vi.stubGlobal('fetch', fetcher);
    vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', 'synthetic-test-placeholder');
    return { access, activation, budgets, service, ctx, request, fetcher };
}
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
describe('network lookup boundary', () => {
    it('keeps omitted flags and scores unknown, preserving legitimate false and zero', () => {
        const report = normalizeNetworkReport({ vpn: false, proxy: 'false', fraud_score: 0 }, '198.51.100.8');
        expect(report).toMatchObject({
            vpn: false,
            proxy: null,
            tor: null,
            fraudScore: 0,
            maskedIp: '198.51.*.*',
        });
        expect(normalizeNetworkReport({}, '2001:db8::8').fraudScore).toBeNull();
        expect(normalizeNetworkReport({ fraud_score: 101 }, '198.51.100.8').fraudScore).toBeNull();
    });
    it('checks store activation and published plugin before any paid request', async () => {
        const f = fixture();
        f.access.assertEnabled.mockRejectedValue(new Error('disabled'));
        await expect(f.service.lookup(f.ctx, f.request)).rejects.toThrow('disabled');
        expect(f.fetcher).not.toHaveBeenCalled();
    });
    it('preserves connection IP if the keyless service is unavailable', async () => {
        const f = fixture();
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', '');
        f.fetcher.mockRejectedValueOnce(new Error('synthetic keyless outage'));
        await expect(f.service.lookup(f.ctx, f.request)).resolves.toMatchObject({
            provider: 'REQUEST',
            ip: '8.8.8.8',
            maskedIp: '8.8.*.*',
            country: null,
            fraudScore: null,
            vpn: null,
        });
        expect(String(f.fetcher.mock.calls[0][0])).toBe('https://ip-db.com/mcp');
        expect(f.budgets.consume).toHaveBeenCalledTimes(4);
    });
    it('retains independent location and ownership when only reputation is unavailable', async () => {
        const f = fixture();
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', '');
        f.fetcher.mockImplementation(input => {
            if (String(input).startsWith('https://ip.guide/'))
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            ip: '8.8.8.8',
                            location: {
                                country: 'United States',
                                timezone: 'America/Chicago',
                                latitude: 37.7,
                                longitude: -97.8,
                            },
                            network: { autonomous_system: { asn: 15169, organization: 'Google LLC' } },
                        }),
                    ),
                );
            return Promise.reject(new Error('synthetic reputation outage'));
        });
        await expect(f.service.lookup(f.ctx, f.request)).resolves.toMatchObject({
            provider: 'REQUEST',
            ip: '8.8.8.8',
            lookupIssue: 'UNAVAILABLE',
            fraudScore: null,
            geoProvider: 'IPGUIDE',
            latitude: 37.7,
            asn: '15169',
            isp: 'Google LLC',
        });
    });
    it('uses only the normalized request address, masks output, caches per Channel, and uses header authentication', async () => {
        const f = fixture();
        await f.service.lookup(f.ctx, f.request);
        await f.service.lookup(f.ctx, f.request);
        expect(f.fetcher).toHaveBeenCalledTimes(1);
        const [url, options] = f.fetcher.mock.calls[0];
        expect(url.searchParams.get('ip')).toBe('8.8.8.8');
        expect(url.href).not.toContain('synthetic-test-placeholder');
        expect(options.headers['IPQS-KEY']).toBe('synthetic-test-placeholder');
        await f.service.lookup({ channelId: 2 } as RequestContext, f.request);
        expect(f.fetcher).toHaveBeenCalledTimes(2);
    });
    it('deduplicates concurrent same-scope vendor requests', async () => {
        const f = fixture();
        await Promise.all([f.service.lookup(f.ctx, f.request), f.service.lookup(f.ctx, f.request)]);
        expect(f.fetcher).toHaveBeenCalledTimes(1);
    });
    it.each([
        { proxy: null },
        { fraud_score: null },
        { connection_type: 'unknown' },
        { timezone: null },
        { timezone: 'Invalid/Timezone' },
    ])('requeries incomplete network data after its source recovers: %j', async missing => {
        const f = fixture();
        f.fetcher.mockResolvedValueOnce(
            new Response(JSON.stringify({ ...completeVendorReport, ...missing })),
        );
        const first = await f.service.lookup(f.ctx, f.request);
        expect(first.cached).toBe(false);
        const recovered = await f.service.lookup(f.ctx, f.request);
        expect(recovered).toMatchObject({
            cached: false,
            proxy: false,
            fraudScore: 0,
            connectionType: 'residential',
            timezone: 'Asia/Kuala_Lumpur',
        });
        expect(f.fetcher).toHaveBeenCalledTimes(2);
        expect((await f.service.lookup(f.ctx, f.request)).cached).toBe(true);
        expect(f.fetcher).toHaveBeenCalledTimes(2);
    });
    it('caches a known VPN result even if the independent proxy flag is unavailable', async () => {
        const f = fixture();
        f.fetcher.mockImplementation(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        ...completeVendorReport,
                        connection_type: 'vpn',
                        proxy: null,
                        vpn: true,
                    }),
                ),
            ),
        );
        await f.service.lookup(f.ctx, f.request);
        expect((await f.service.lookup(f.ctx, f.request)).cached).toBe(true);
        expect(f.fetcher).toHaveBeenCalledTimes(1);
    });
    it('prefers browser IPv4, keeps IPv6 distinct and never changes the trusted rate-limit identity', async () => {
        const f = fixture();
        const first = await f.service.lookup(f.ctx, f.request, '1.1.1.1', '2001:4860:4860::8888');
        expect(first).toMatchObject({
            ip: '1.1.1.1',
            ipv4: '1.1.1.1',
            ipv6: '2001:4860:4860::8888',
            addressSource: 'BROWSER',
        });
        const admission = f.budgets.consume.mock.calls[0][0];
        const next = await f.service.lookup(f.ctx, f.request, '1.1.1.1', '2606:4700:4700::1111');
        expect(next).toMatchObject({ cached: true, ipv6: '2606:4700:4700::1111' });
        expect(f.budgets.consume.mock.calls.at(-1)?.[0]).toBe(admission);
        expect(f.fetcher).toHaveBeenCalledTimes(1);
        expect(f.fetcher.mock.calls[0][0].searchParams.get('ip')).toBe('1.1.1.1');
    });
    it('rejects private, wrong-family and URL targets before any data-provider call', async () => {
        const f = fixture();
        for (const [v4, v6] of [
            ['127.0.0.1', undefined],
            ['https://example.com', undefined],
            ['2001:4860:4860::8888', undefined],
            [undefined, '8.8.8.8'],
            [undefined, 'fe80::1'],
        ] as const)
            await expect(f.service.lookup(f.ctx, f.request, v4, v6)).rejects.toThrow('ADDRESS_UNAVAILABLE');
        expect(f.fetcher).not.toHaveBeenCalled();
    });
    it('adds a real postcode record without mixing its city and coordinates with another location source', async () => {
        const f = fixture();
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', '');
        f.fetcher.mockImplementation((input, options) => {
            const url = String(input);
            if (url.startsWith('https://free.freeipapi.com/'))
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            ipAddress: '8.8.8.8',
                            ipVersion: 4,
                            zipCode: '00123',
                            countryName: 'United States',
                            countryCode: 'US',
                            cityName: 'Postal city',
                            regionName: 'Postal region',
                            latitude: 40.1,
                            longitude: -74.2,
                            isProxy: false,
                            timeZones: ['Wrong/First', 'Wrong/Second'],
                        }),
                    ),
                );
            if (url.startsWith('https://ip.guide/'))
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            ip: '8.8.8.8',
                            location: {
                                country: 'United States',
                                city: 'Different city',
                                timezone: 'America/New_York',
                                latitude: 1,
                                longitude: 2,
                            },
                        }),
                    ),
                );
            const body = JSON.parse(options.body);
            if (body.method === 'initialize')
                return Promise.resolve(
                    new Response(JSON.stringify({ result: { protocolVersion: '2025-03-26' } })),
                );
            if (body.method === 'notifications/initialized')
                return Promise.resolve(new Response(null, { status: 202 }));
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        result: {
                            structuredContent: {
                                ip: '8.8.8.8',
                                country_code: 'US',
                                score: 0,
                                network_type: 'residential',
                            },
                        },
                    }),
                ),
            );
        });
        const report = await f.service.lookup(f.ctx, f.request);
        expect(report).toMatchObject({
            postalCode: '00123',
            city: 'Postal city',
            region: 'Postal region',
            latitude: 40.1,
            longitude: -74.2,
            timezone: 'America/New_York',
            geoProvider: 'FREEIPAPI',
            proxy: false,
            fraudScore: 0,
        });
        expect((await f.service.lookup(f.ctx, f.request)).cached).toBe(true);
    });
    it('does not cache a missing postcode as a complete report', async () => {
        const f = fixture();
        f.fetcher.mockImplementation(() =>
            Promise.resolve(
                new Response(JSON.stringify({ success: true, zip_code: null, country_code: 'MY' })),
            ),
        );
        const first = await f.service.lookup(f.ctx, f.request);
        expect(first.postalCode).toBeNull();
        await f.service.lookup(f.ctx, f.request);
        expect(
            f.fetcher.mock.calls.filter(call => String(call[0]).includes('ipqualityscore.com')),
        ).toHaveLength(2);
    });
    it('honors admission and daily provider budgets', async () => {
        const f = fixture();
        f.budgets.consume.mockResolvedValueOnce({ allowed: false });
        await expect(f.service.lookup(f.ctx, f.request)).rejects.toThrow('RATE_LIMIT');
        expect(f.fetcher).not.toHaveBeenCalled();
        f.budgets.consume.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
        await expect(f.service.lookup(f.ctx, f.request)).resolves.toHaveProperty(
            'lookupIssue',
            'DAILY_LIMIT',
        );
        expect(f.fetcher).not.toHaveBeenCalled();
        expect(f.budgets.consume.mock.calls.at(-1)?.slice(1)).toEqual([100, 86_400_000]);
    });
    it.each([
        ['', 900],
        ['1', 1],
        ['250', 250],
        ['900', 900],
        ['901', 900],
        ['0', 900],
        ['-1', 900],
        ['1.5', 900],
        ['invalid', 900],
    ])('bounds the free daily budget for configuration %j to %i', async (configured, limit) => {
        const f = fixture();
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', '');
        vi.stubEnv('ENVIRONMENT_MONITOR_FREE_DAILY_LIMIT', configured);
        f.budgets.consume.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
        const report = await f.service.lookup(f.ctx, f.request);
        expect(report).toMatchObject({ lookupIssue: 'DAILY_LIMIT', fraudScore: null });
        expect(f.budgets.consume.mock.calls[1].slice(1)).toEqual([limit, 86_400_000]);
        expect(f.fetcher).not.toHaveBeenCalled();
    });
    it('protects the free endpoint from bursts while preserving an independent postcode lookup', async () => {
        const f = fixture();
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', '');
        f.budgets.consume
            .mockResolvedValueOnce({ allowed: true })
            .mockResolvedValueOnce({ allowed: true })
            .mockResolvedValueOnce({ allowed: true })
            .mockResolvedValueOnce({ allowed: false });
        f.fetcher.mockImplementation(input => {
            if (!String(input).startsWith('https://ipwho.is/'))
                return Promise.reject(new Error('synthetic other outage'));
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        success: true,
                        ip: '8.8.8.8',
                        postal: '00123',
                        city: 'Synthetic city',
                        country: 'United States',
                        country_code: 'US',
                        timezone: { id: 'America/New_York' },
                    }),
                ),
            );
        });
        expect(await f.service.lookup(f.ctx, f.request)).toMatchObject({
            postalCode: '00123',
            geoProvider: 'IPWHOIS',
            proxy: null,
        });
        expect(f.budgets.consume.mock.calls[2].slice(1)).toEqual([50, 60_000]);
        expect(f.budgets.consume.mock.calls[3].slice(1)).toEqual([8, 10_000]);
        expect(f.fetcher.mock.calls.some(call => String(call[0]).includes('free.freeipapi.com'))).toBe(false);
    });
    it('does not open a second free daily budget at UTC midnight', async () => {
        const f = fixture();
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', '');
        f.budgets.consume.mockImplementation((_bucket, _limit, window) =>
            Promise.resolve({
                allowed: window !== 86_400_000,
            }),
        );
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-11-03T23:59:00Z'));
            await f.service.lookup(f.ctx, f.request);
            vi.setSystemTime(new Date('2026-11-04T00:01:00Z'));
            await f.service.lookup(f.ctx, f.request);
            const dailyCalls = f.budgets.consume.mock.calls.filter(call => call[2] === 86_400_000);
            expect(dailyCalls).toHaveLength(2);
            expect(dailyCalls[0][0]).toBe(dailyCalls[1][0]);
            expect(f.fetcher).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
    it('sanitizes upstream failures and does not cache failed responses', async () => {
        const f = fixture();
        f.fetcher.mockRejectedValueOnce(new Error('secret vendor details'));
        await expect(f.service.lookup(f.ctx, f.request)).resolves.toMatchObject({
            ip: '8.8.8.8',
            lookupIssue: 'UNAVAILABLE',
            fraudScore: null,
        });
        await expect(f.service.lookup(f.ctx, f.request)).resolves.toHaveProperty('country', 'MY');
        expect(f.fetcher).toHaveBeenCalledTimes(2);
    });
    it('rejects private and malformed addresses before a paid call', async () => {
        const f = fixture();
        await expect(f.service.lookup(f.ctx, { ip: '127.0.0.1' } as Request)).rejects.toThrow(
            'ADDRESS_UNAVAILABLE',
        );
        expect(f.fetcher).not.toHaveBeenCalled();
        for (const ip of [
            '::1',
            'fc00::1',
            'fe80::1',
            '10.0.0.1',
            '192.168.1.1',
            '198.51.100.8',
            '203.0.113.1',
            '192.0.2.1',
            '198.18.0.1',
            '2001:db8::1',
            '2001:0db8::1',
            'bad',
        ])
            expect(isPublicAddress(ip)).toBe(false);
    });
});
