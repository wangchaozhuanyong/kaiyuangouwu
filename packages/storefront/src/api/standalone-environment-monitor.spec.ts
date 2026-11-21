import { afterEach, describe, expect, it, vi } from 'vitest';

import { environmentNetworkReportOperation } from './environment-monitor';
import { standaloneEnvironmentMonitorApi } from './standalone-environment-monitor';

afterEach(() => vi.unstubAllGlobals());

describe('standalone environment monitor transport', () => {
    it('sends only the observed addresses to the fixed anonymous endpoint', async () => {
        const data = { environmentNetworkReport: { ip: '192.0.2.24' } };
        const fetch = vi.fn().mockResolvedValue(Response.json({ data }));
        vi.stubGlobal('fetch', fetch);
        await expect(
            standaloneEnvironmentMonitorApi.request(environmentNetworkReportOperation, {
                observedIpv4: '192.0.2.24',
                observedIpv6: '2001:db8::24',
                ignored: 'fixture',
            }),
        ).resolves.toEqual(data);
        expect(fetch).toHaveBeenCalledOnce();
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe('/api/environment/network');
        expect(init).toMatchObject({
            method: 'POST',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
        });
        expect(init.body).toBeUndefined();
        expect([...init.headers]).toEqual([
            ['x-environment-observed-ipv4', '192.0.2.24'],
            ['x-environment-observed-ipv6', '2001:db8::24'],
        ]);
        await expect(standaloneEnvironmentMonitorApi.request('mutation Fixture { denied }')).rejects.toThrow(
            'ENVIRONMENT_NETWORK_UNAVAILABLE',
        );
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('retains rate limit and query errors for the existing retry guidance', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 429 }))
            .mockResolvedValueOnce(Response.json({ errors: [{ message: 'ENVIRONMENT_DAILY_LIMIT' }] }));
        vi.stubGlobal('fetch', fetch);
        await expect(
            standaloneEnvironmentMonitorApi.request(environmentNetworkReportOperation),
        ).rejects.toThrow('ENVIRONMENT_RATE_LIMIT');
        await expect(
            standaloneEnvironmentMonitorApi.request(environmentNetworkReportOperation),
        ).rejects.toThrow('ENVIRONMENT_DAILY_LIMIT');
    });
});
