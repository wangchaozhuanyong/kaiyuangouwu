import { afterEach, describe, expect, it, vi } from 'vitest';

import { readIpWhoisReport } from './ipwhois-client';
afterEach(() => vi.unstubAllGlobals());
describe('IPWhois postal identity boundary', () => {
    it('accepts an exact-IP success with a postcode and preserves its leading zeros', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ success: true, ip: '8.8.8.8', postal: '00123' })),
            );
        vi.stubGlobal('fetch', fetcher);
        expect((await readIpWhoisReport('8.8.8.8')).postal).toBe('00123');
        expect(fetcher.mock.calls[0][0]).toBe('https://ipwho.is/8.8.8.8');
    });
    it('rejects HTTP failures, application errors and identity mismatches', async () => {
        for (const response of [
            new Response('unavailable', { status: 429 }),
            new Response(JSON.stringify({ success: false, ip: '8.8.8.8' })),
            new Response(JSON.stringify({ success: true, ip: '1.1.1.1', postal: '12345' })),
        ]) {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
            await expect(readIpWhoisReport('8.8.8.8')).rejects.toThrow();
        }
    });
});
