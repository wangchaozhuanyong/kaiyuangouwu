import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeIpDbReport } from './environment-monitor.service';
import { readIpDbReport } from './ipdb-client';

afterEach(() => vi.unstubAllGlobals());
function requestBody(options: RequestInit) {
    if (typeof options.body !== 'string') throw new Error('Expected a JSON request body');
    return JSON.parse(options.body);
}
function transport(report: Record<string, unknown>) {
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
        const body = requestBody(options);
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
                        structuredContent: report,
                        content: [{ type: 'text', text: 'Untrusted tool text is ignored' }],
                    },
                }),
            ),
        );
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
describe('keyless IP-DB read-only transport', () => {
    it('negotiates the protocol and only calls check_ip with the exact address', async () => {
        const report = {
            ip: '8.8.8.8',
            score: 0,
            country_code: 'US',
            organization: 'Synthetic owner',
            asn: 15169,
            network_type: 'datacenter',
        };
        const fetcher = transport(report);
        await expect(readIpDbReport('8.8.8.8')).resolves.toEqual(report);
        expect(fetcher.mock.calls.map(([, options]) => requestBody(options).method)).toEqual([
            'initialize',
            'notifications/initialized',
            'tools/call',
        ]);
        expect(requestBody(fetcher.mock.calls[2][1]).params).toEqual({
            name: 'check_ip',
            arguments: { ip: '8.8.8.8' },
        });
        expect(fetcher.mock.calls.every(([url]) => url === 'https://ip-db.com/mcp')).toBe(true);
        expect(new Headers(fetcher.mock.calls[2][1].headers).has('IPQS-KEY')).toBe(false);
        expect(normalizeIpDbReport(report, '8.8.8.8')).toMatchObject({
            provider: 'IPDB',
            fraudScore: 0,
            country: 'US',
            vpn: null,
            proxy: null,
            tor: null,
        });
    });
    it('does not infer negative VPN/proxy findings from a missing flag', () => {
        expect(normalizeIpDbReport({ network_type: 'vpn' }, '8.8.8.8')).toMatchObject({
            vpn: true,
            proxy: null,
            tor: null,
            fraudScore: null,
        });
        expect(normalizeIpDbReport({ vpn: false, score: 110 }, '8.8.8.8')).toMatchObject({
            vpn: false,
            fraudScore: null,
        });
    });
    it('rejects a response for another address rather than caching it for the visitor', async () => {
        transport({ ip: '1.1.1.1', score: 0 });
        await expect(readIpDbReport('8.8.8.8')).rejects.toThrow('identity mismatch');
    });
    it('accepts equivalent canonical IPv6 addresses', async () => {
        transport({ ip: '2001:4860:4860:0:0:0:0:8888', score: 0 });
        await expect(readIpDbReport('2001:4860:4860::8888')).resolves.toHaveProperty('score', 0);
    });
    it('rejects hostnames and remote tool errors', async () => {
        const fetcher = transport({ ip: '8.8.8.8' });
        await expect(readIpDbReport('internal.invalid')).rejects.toThrow('Invalid lookup address');
        expect(fetcher).not.toHaveBeenCalled();
        fetcher.mockResolvedValueOnce(
            new Response(JSON.stringify({ error: { message: 'Untrusted instructions' } })),
        );
        await expect(readIpDbReport('8.8.8.8')).rejects.toThrow('Invalid IP data response');
    });
});
