import { afterEach, describe, expect, it, vi } from 'vitest';

import { readIpGuideReport } from './ip-guide-client';
afterEach(() => vi.unstubAllGlobals());
describe('fixed IP Guide location boundary', () => {
    it('accepts matching public data and uses a fixed HTTPS endpoint without credentials', async () => {
        const fetcher = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ip: '8.8.8.8',
                    location: { country: 'United States', latitude: 37.7, longitude: -97.8 },
                }),
            ),
        );
        vi.stubGlobal('fetch', fetcher);
        expect((await readIpGuideReport('8.8.8.8')).ip).toBe('8.8.8.8');
        expect(fetcher.mock.calls[0][0]).toBe('https://ip.guide/8.8.8.8');
        expect(fetcher.mock.calls[0][1]).toMatchObject({
            redirect: 'error',
            headers: { Accept: 'application/json' },
        });
    });
    it('rejects another address, malformed payloads and unavailable upstreams', async () => {
        for (const response of [
            new Response(JSON.stringify({ ip: '1.1.1.1', location: {} })),
            new Response('{}'),
            new Response('outage', { status: 503 }),
        ]) {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
            await expect(readIpGuideReport('8.8.8.8')).rejects.toThrow();
        }
    });
    it('compares canonical IPv6 rather than textual spellings', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({ ip: '2001:4860:4860::8888', location: { timezone: 'Etc/UTC' } }),
                    ),
                ),
        );
        expect((await readIpGuideReport('2001:4860:4860:0:0:0:0:8888')).ip).toBe('2001:4860:4860::8888');
        await expect(readIpGuideReport('not-an-ip')).rejects.toThrow('Invalid lookup address');
    });
});
