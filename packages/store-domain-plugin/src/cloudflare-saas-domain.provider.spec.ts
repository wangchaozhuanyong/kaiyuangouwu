import { describe, expect, it, vi } from 'vitest';

import { CloudflareSaasDomainProvider } from './cloudflare-saas-domain.provider';

function cloudflareResponse(result: unknown, status = 200) {
    return Response.json({ success: status < 400, result, errors: [] }, { status });
}

function requestUrl(input: string | URL | Request): string {
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    return input;
}

function provider(fetchImpl: typeof fetch, autoManageDns = true) {
    return new CloudflareSaasDomainProvider({
        apiToken: 'scoped-token',
        saasZoneId: 'saas-zone',
        fallbackOrigin: 'origin.platform.test',
        autoManageDns,
        apiBaseUrl: 'https://api.cloudflare.test/client/v4',
        fetch: fetchImpl,
    });
}

describe('CloudflareSaasDomainProvider', () => {
    it('creates an idempotent custom hostname, managed DNS records, and reports active SSL', async () => {
        const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
        const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = requestUrl(input);
            const method = init?.method ?? 'GET';
            const body =
                typeof init?.body === 'string'
                    ? (JSON.parse(init.body) as Record<string, unknown>)
                    : undefined;
            requests.push({ url, method, body });
            if (url.endsWith('/custom_hostnames/fallback_origin')) {
                return cloudflareResponse({ origin: 'origin.platform.test', status: 'active' });
            }
            if (url.includes('/custom_hostnames?')) return cloudflareResponse([]);
            if (url.endsWith('/custom_hostnames') && method === 'POST') {
                return cloudflareResponse({
                    id: 'hostname-1',
                    hostname: 'shop.example.com',
                    status: 'pending',
                    ssl: { status: 'pending_validation' },
                });
            }
            if (url.includes('/zones?name=shop.example.com')) return cloudflareResponse([]);
            if (url.includes('/zones?name=example.com')) {
                return cloudflareResponse([{ id: 'customer-zone', name: 'example.com', status: 'active' }]);
            }
            if (url.includes('/dns_records?')) return cloudflareResponse([]);
            if (url.endsWith('/dns_records') && method === 'POST') {
                return cloudflareResponse({ id: `record-${requests.length}`, ...body });
            }
            if (url.endsWith('/custom_hostnames/hostname-1')) {
                return cloudflareResponse({
                    id: 'hostname-1',
                    hostname: 'shop.example.com',
                    status: 'active',
                    ssl: { status: 'active' },
                });
            }
            throw new Error(`Unexpected request ${method} ${url}`);
        }) as unknown as typeof fetch;

        const result = await provider(fetchImpl).provision({
            domain: 'shop.example.com',
            cnameTarget: 'domains.platform.test',
            verificationRecordName: '_vendure.shop.example.com',
            verificationRecordValue: 'vendure-domain-verification=token',
        });

        expect(result).toMatchObject({
            externalId: 'hostname-1',
            dnsManaged: true,
            hostnameStatus: 'active',
            sslStatus: 'active',
            ready: true,
        });
        expect(
            requests.find(request => request.url.endsWith('/custom_hostnames') && request.method === 'POST')
                ?.body,
        ).toEqual({
            hostname: 'shop.example.com',
            ssl: { method: 'http', type: 'dv', wildcard: false },
        });
        expect(
            requests.filter(request => request.url.endsWith('/dns_records')).map(request => request.body),
        ).toEqual([
            {
                type: 'CNAME',
                name: 'shop.example.com',
                content: 'domains.platform.test',
                proxied: true,
                ttl: 1,
            },
            {
                type: 'TXT',
                name: '_vendure.shop.example.com',
                content: 'vendure-domain-verification=token',
                ttl: 1,
            },
        ]);
    });

    it('keeps external customer DNS manual while still provisioning edge SSL', async () => {
        const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = requestUrl(input);
            if (url.endsWith('/custom_hostnames/fallback_origin')) {
                return cloudflareResponse({ origin: 'origin.platform.test', status: 'active' });
            }
            if (url.includes('/custom_hostnames?')) return cloudflareResponse([]);
            if (url.endsWith('/custom_hostnames') && init?.method === 'POST') {
                return cloudflareResponse({ id: 'hostname-2', hostname: 'shop.external.test' });
            }
            if (url.includes('/zones?')) return cloudflareResponse([]);
            if (url.endsWith('/custom_hostnames/hostname-2')) {
                return cloudflareResponse({
                    id: 'hostname-2',
                    hostname: 'shop.external.test',
                    status: 'pending',
                    ssl: { status: 'pending_validation' },
                });
            }
            throw new Error(`Unexpected request ${url}`);
        }) as unknown as typeof fetch;

        const result = await provider(fetchImpl).provision({
            domain: 'shop.external.test',
            cnameTarget: 'domains.platform.test',
            verificationRecordName: '_vendure.shop.external.test',
            verificationRecordValue: 'vendure-domain-verification=token',
        });

        expect(result.dnsManaged).toBe(false);
        expect(result.ready).toBe(false);
        expect(result.message).toContain('不在当前 Cloudflare 账户');
    });

    it('never overwrites a conflicting traffic record', async () => {
        const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = requestUrl(input);
            if (url.endsWith('/custom_hostnames/fallback_origin')) {
                return cloudflareResponse({ origin: 'origin.platform.test', status: 'active' });
            }
            if (url.includes('/custom_hostnames?')) {
                return cloudflareResponse([{ id: 'hostname-3', hostname: 'shop.example.com' }]);
            }
            if (url.includes('/zones?name=shop.example.com')) return cloudflareResponse([]);
            if (url.includes('/zones?name=example.com')) {
                return cloudflareResponse([{ id: 'customer-zone', name: 'example.com', status: 'active' }]);
            }
            if (url.includes('/dns_records?')) {
                return cloudflareResponse([
                    {
                        id: 'existing-a',
                        type: 'A',
                        name: 'shop.example.com',
                        content: '192.0.2.10',
                    },
                ]);
            }
            if (init?.method === 'POST') throw new Error('must not overwrite DNS');
            throw new Error(`Unexpected request ${url}`);
        }) as unknown as typeof fetch;

        const result = await provider(fetchImpl).provision({
            domain: 'shop.example.com',
            cnameTarget: 'domains.platform.test',
            verificationRecordName: '_vendure.shop.example.com',
            verificationRecordValue: 'vendure-domain-verification=token',
        });

        expect(result).toMatchObject({
            externalId: 'hostname-3',
            dnsManaged: false,
            ready: false,
        });
        expect(result.message).toContain('未自动覆盖');
        expect(fetchImpl).not.toHaveBeenCalledWith(
            expect.stringContaining('/dns_records'),
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('deletes only the recorded Cloudflare custom hostname', async () => {
        const fetchImpl = vi.fn(() => cloudflareResponse(null)) as unknown as typeof fetch;

        await provider(fetchImpl).remove('hostname-4');

        expect(fetchImpl).toHaveBeenCalledWith(
            'https://api.cloudflare.test/client/v4/zones/saas-zone/custom_hostnames/hostname-4',
            expect.objectContaining({ method: 'DELETE' }),
        );
    });
});
