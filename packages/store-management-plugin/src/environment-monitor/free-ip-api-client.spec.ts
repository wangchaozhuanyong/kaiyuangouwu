import { afterEach, describe, expect, it, vi } from 'vitest';

import { readFreeIpApiReport } from './free-ip-api-client';
afterEach(() => vi.unstubAllGlobals());
describe('FreeIPAPI identity and postal boundary', () => {
    it('queries one fixed HTTPS vendor and preserves postcode leading zeros', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ ipAddress: '8.8.8.8', ipVersion: 4, zipCode: '00123' })),
            );
        vi.stubGlobal('fetch', fetcher);
        expect((await readFreeIpApiReport('8.8.8.8')).zipCode).toBe('00123');
        expect(fetcher.mock.calls[0][0]).toBe('https://free.freeipapi.com/api/v1/json/8.8.8.8');
        expect(fetcher.mock.calls[0][1]).toMatchObject({
            redirect: 'error',
            headers: { Accept: 'application/json' },
        });
    });
    it('rejects other IPs, family mismatch, failures and malformed data', async () => {
        for (const body of [
            { ipAddress: '1.1.1.1', ipVersion: 4 },
            { ipAddress: '8.8.8.8', ipVersion: 6 },
            { zipCode: '12345' },
        ]) {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
            await expect(readFreeIpApiReport('8.8.8.8')).rejects.toThrow();
        }
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(readFreeIpApiReport('8.8.8.8')).rejects.toThrow();
        await expect(readFreeIpApiReport('example.com')).rejects.toThrow();
    });
    it('accepts equivalent canonical IPv6 spellings without converting to IPv4', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({ ipAddress: '2001:4860:4860::8888', ipVersion: 6, zipCode: null }),
                    ),
                ),
        );
        expect((await readFreeIpApiReport('2001:4860:4860:0:0:0:0:8888')).ipVersion).toBe(6);
    });
});
