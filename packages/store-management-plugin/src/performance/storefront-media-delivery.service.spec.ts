import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontMediaDeliveryService } from './storefront-media-delivery.service';
vi.mock('@vendure/core', () => ({ ConfigService: class {} }));
beforeEach(() => vi.stubEnv('STOREFRONT_CLOUDFLARE_ZONES', ''));
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
function harness() {
    const strategy = {
        addToBoundedSet: vi.fn(() => Promise.resolve(true)),
        boundedSetMembers: vi.fn(() => Promise.resolve([])),
    };
    return {
        service: new StorefrontMediaDeliveryService({ systemOptions: { cacheStrategy: strategy } } as any),
        strategy,
    };
}

function purgeHarness(zones?: Record<string, string>) {
    vi.stubEnv('STOREFRONT_CDN_PURGE_ENABLED', 'true');
    vi.stubEnv('STOREFRONT_CLOUDFLARE_ZONE_ID', 'a'.repeat(32));
    vi.stubEnv('STOREFRONT_CLOUDFLARE_PURGE_TOKEN', 'fixture-placeholder');
    if (zones) vi.stubEnv('STOREFRONT_CLOUDFLARE_ZONES', JSON.stringify(zones));
    const fetcher = vi.fn((_url: string, _options: RequestInit) =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }),
    );
    vi.stubGlobal('fetch', fetcher);
    return { ...harness(), fetcher };
}

describe('exact public media delivery', () => {
    it('stays disabled without opt-in and makes no network call', async () => {
        vi.stubEnv('STOREFRONT_CDN_PURGE_ENABLED', 'false');
        const { service, strategy } = harness();
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        expect(await service.record('a', 'shop.example', '/assets/preview/public.jpg')).toBe(true);
        expect(await service.purge([])).toEqual({ status: 'disabled', count: 0 });
        expect(strategy.addToBoundedSet).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('records the complete authorized URL including derivative and version under its channel only', async () => {
        vi.stubEnv('STOREFRONT_CDN_PURGE_ENABLED', 'true');
        const { service, strategy } = harness();
        expect(
            await service.record(
                'a',
                'shop.example',
                '/assets/preview/public.jpg?preset=storefront-card-square-320&q=90&v=2',
            ),
        ).toBe(true);
        expect(strategy.addToBoundedSet).toHaveBeenLastCalledWith(
            'storefront-public:v1:delivered:a',
            'https://shop.example/assets/preview/public.jpg?preset=storefront-card-square-320&q=90&v=2',
            8192,
            600,
        );
        for (const url of [
            '/assets/cache/private.webp',
            '/assets/avatars/v2/private.webp',
            'https://foreign.example/assets/preview/a.jpg',
            '/assets/preview/a.jpg?token=private',
        ])
            expect(await service.record('a', 'shop.example', url)).toBe(false);
        strategy.addToBoundedSet.mockRejectedValue(new Error('offline'));
        expect(await service.record('a', 'shop.example', '/assets/preview/public.jpg')).toBe(false);
    });
    it('purges exact bounded batches, never wildcard, and rejects API failures', async () => {
        vi.stubEnv('STOREFRONT_CDN_PURGE_ENABLED', 'true');
        vi.stubEnv('STOREFRONT_CLOUDFLARE_ZONE_ID', 'a'.repeat(32));
        vi.stubEnv('STOREFRONT_CLOUDFLARE_PURGE_TOKEN', 'fixture-placeholder');
        const fetcher = vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }),
        );
        vi.stubGlobal('fetch', fetcher);
        const { service } = harness();
        const urls = Array.from(
            { length: 31 },
            (_, i) => `https://shop.example/assets/preview/${i}.jpg?preset=storefront-icon-96`,
        );
        expect(await service.purge(urls)).toEqual({ status: 'purged', count: 31 });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(JSON.parse((fetcher.mock.calls[0] as any)[1].body)).toEqual({ files: urls.slice(0, 30) });
        await expect(service.purge(['https://shop.example/*'])).rejects.toThrow('Invalid');
        fetcher.mockResolvedValue({ ok: false, json: () => Promise.resolve({ success: false }) });
        await expect(service.purge(urls.slice(0, 1))).rejects.toThrow('purge failed');
    });
});

describe('exact hostname Cloudflare zone routing', () => {
    it('routes three zones independently in 30-URL batches without changing query versions or duplicates', async () => {
        const zones = {
            'alpha.invalid': 'a'.repeat(32),
            'beta.invalid': 'b'.repeat(32),
            'gamma.invalid': 'c'.repeat(32),
        };
        const { service, fetcher } = purgeHarness(zones);
        // The map is the routing authority; it needs no legacy zone fallback.
        vi.stubEnv('STOREFRONT_CLOUDFLARE_ZONE_ID', '');
        const first = Array.from(
            { length: 31 },
            (_, index) =>
                `https://alpha.invalid/assets/preview/${index}.jpg?preset=storefront-icon-96&q=90&v=${index}`,
        );
        const second = first.map(url => url.replace('alpha.invalid', 'beta.invalid'));
        const third = ['https://gamma.invalid/assets/source/original.jpg?v=3&format=webp'];
        const urls = first.flatMap((url, index) => [url, second[index]]);
        urls.splice(2, 0, third[0]);
        urls.push(first[0], second[0], third[0]);
        expect(await service.purge(urls)).toEqual({ status: 'purged', count: 63 });
        const expected = [
            [zones['alpha.invalid'], first.slice(0, 30)],
            [zones['alpha.invalid'], first.slice(30)],
            [zones['beta.invalid'], second.slice(0, 30)],
            [zones['beta.invalid'], second.slice(30)],
            [zones['gamma.invalid'], third],
        ] as const;
        expect(fetcher).toHaveBeenCalledTimes(5);
        expected.forEach(([zone, files], index) => {
            const [endpoint, options] = fetcher.mock.calls[index];
            expect(endpoint).toBe(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`);
            expect(JSON.parse(options.body as string)).toEqual({ files });
            expect(options.headers).toEqual({
                Authorization: 'Bearer fixture-placeholder',
                'Content-Type': 'application/json',
            });
        });
    });

    it('groups multiple explicit hostnames by their shared zone rather than by hostname', async () => {
        const zone = 'a'.repeat(32);
        const { service, fetcher } = purgeHarness({ 'example.invalid': zone, 'shop.example.invalid': zone });
        const urls = Array.from(
            { length: 31 },
            (_, index) =>
                `https://${index % 2 ? 'shop.example.invalid' : 'example.invalid'}/assets/preview/${index}.jpg?v=2`,
        );
        expect(await service.purge(urls)).toEqual({ status: 'purged', count: 31 });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({ files: urls.slice(0, 30) });
        expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toEqual({ files: urls.slice(30) });
    });

    it.each(['other.invalid', 'shop.example.invalid'])(
        'preflights the entire batch and never guesses a zone for %s',
        async unknown => {
            const { service, fetcher } = purgeHarness({ 'example.invalid': 'a'.repeat(32) });
            const mapped = Array.from(
                { length: 31 },
                (_, index) => `https://example.invalid/assets/preview/${index}.jpg?v=2`,
            );
            await expect(
                service.purge([...mapped, `https://${unknown}/assets/preview/a.jpg`]),
            ).rejects.toThrow('hostname is not configured');
            expect(fetcher).not.toHaveBeenCalled();
        },
    );

    it.each([
        'not-json',
        'null',
        '[]',
        '{}',
        '"example.invalid"',
        JSON.stringify({ 'example.invalid': 1 }),
        JSON.stringify({ 'example.invalid': 'not-a-zone' }),
        JSON.stringify({ 'Example.invalid': 'a'.repeat(32) }),
        JSON.stringify({ '*.example.invalid': 'a'.repeat(32) }),
        JSON.stringify({ 'example.invalid:443': 'a'.repeat(32) }),
        JSON.stringify({ 'example.invalid/': 'a'.repeat(32) }),
        JSON.stringify({ 'example.invalid.': 'a'.repeat(32) }),
        JSON.stringify({ '999.1.2.3': 'a'.repeat(32) }),
        JSON.stringify({ 'example.invalid': 'a'.repeat(32), 'other.invalid': 'not-a-zone' }),
    ])('rejects an invalid complete map before any request: %s', async raw => {
        const { service, fetcher } = purgeHarness();
        vi.stubEnv('STOREFRONT_CLOUDFLARE_ZONES', raw);
        await expect(service.purge(['https://example.invalid/assets/preview/a.jpg'])).rejects.toThrow(
            'hostname map is invalid',
        );
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('rejects mixed legacy hostnames before requesting any part of the batch', async () => {
        const { service, fetcher } = purgeHarness();
        await expect(
            service.purge([
                'https://example.invalid/assets/preview/a.jpg?v=1',
                'https://shop.example.invalid/assets/preview/a.jpg?v=1',
            ]),
        ).rejects.toThrow('hostname map for mixed hosts');
        expect(fetcher).not.toHaveBeenCalled();
        expect(await service.purge(['https://example.invalid/assets/preview/a.jpg?v=1'])).toEqual({
            status: 'purged',
            count: 1,
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it.each(['*.example.invalid', 'shop*.example.invalid'])(
        'rejects a wildcard legacy hostname before any request: %s',
        async hostname => {
            const { service, fetcher } = purgeHarness();
            await expect(service.purge([`https://${hostname}/assets/preview/a.jpg`])).rejects.toThrow(
                'Invalid public media purge batch',
            );
            expect(fetcher).not.toHaveBeenCalled();
        },
    );

    it.each([
        'https://example.invalid/assets/preview/*',
        'https://example.invalid/assets/preview/%2A.jpg',
        'https://example.invalid/assets/preview/a.jpg?v=*',
        'https://example.invalid/assets/avatars/a.jpg',
        'https://example.invalid/assets/preview/a.jpg?token=private',
        'https://example.invalid/assets/preview/a.jpg#fragment',
        'https://private@example.invalid/assets/preview/a.jpg',
    ])('rejects a late invalid or wildcard URL before any request: %s', async invalid => {
        const { service, fetcher } = purgeHarness({ 'example.invalid': 'a'.repeat(32) });
        await expect(
            service.purge(['https://example.invalid/assets/preview/valid.jpg?v=2', invalid]),
        ).rejects.toThrow('Invalid public media purge batch');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('keeps the 8192 unique-URL bound across all zones and deduplicates before that bound', async () => {
        const { service, fetcher } = purgeHarness({
            'example.invalid': 'a'.repeat(32),
            'other.invalid': 'b'.repeat(32),
        });
        const urls = Array.from(
            { length: 8193 },
            (_, index) =>
                `https://${index % 2 ? 'example.invalid' : 'other.invalid'}/assets/preview/${index}.jpg`,
        );
        await expect(service.purge(urls)).rejects.toThrow('Invalid public media purge batch');
        expect(fetcher).not.toHaveBeenCalled();
        const repeated = Array.from({ length: 8193 }, () => urls[0]);
        expect(await service.purge(repeated)).toEqual({ status: 'purged', count: 1 });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('preserves empty-batch configuration validation and ignores malformed routing while disabled', async () => {
        const { service, fetcher } = purgeHarness();
        expect(await service.purge([])).toEqual({ status: 'purged', count: 0 });
        expect(fetcher).not.toHaveBeenCalled();
        vi.stubEnv('STOREFRONT_CLOUDFLARE_PURGE_TOKEN', '');
        await expect(service.purge([])).rejects.toThrow('configuration is incomplete');
        expect(fetcher).not.toHaveBeenCalled();
        vi.stubEnv('STOREFRONT_CDN_PURGE_ENABLED', 'false');
        vi.stubEnv('STOREFRONT_CLOUDFLARE_ZONES', 'not-json');
        expect(await service.purge([])).toEqual({ status: 'disabled', count: 0 });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(['http-error', 'api-false', 'invalid-json', 'network-error'])(
        'stops on %s without an internal retry and allows a caller to retry the full exact batch',
        async failure => {
            const zones = {
                'alpha.invalid': 'a'.repeat(32),
                'beta.invalid': 'b'.repeat(32),
                'gamma.invalid': 'c'.repeat(32),
            };
            const { service, fetcher } = purgeHarness(zones);
            const urls = Object.keys(zones).map(host => `https://${host}/assets/preview/a.jpg?v=2`);
            fetcher.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
            if (failure === 'network-error') fetcher.mockRejectedValueOnce(new Error('offline'));
            else
                fetcher.mockResolvedValueOnce({
                    ok: failure !== 'http-error',
                    json: () =>
                        failure === 'invalid-json'
                            ? Promise.reject(new Error('invalid response'))
                            : Promise.resolve({ success: failure === 'http-error' }),
                });
            await expect(service.purge(urls)).rejects.toThrow(
                failure === 'network-error' ? 'offline' : 'purge failed',
            );
            expect(fetcher).toHaveBeenCalledTimes(2);
            fetcher.mockClear();
            expect(await service.purge(urls)).toEqual({ status: 'purged', count: 3 });
            expect(fetcher).toHaveBeenCalledTimes(3);
            Object.values(zones).forEach((zone, index) => {
                expect(fetcher.mock.calls[index][0]).toBe(
                    `https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,
                );
                expect(JSON.parse(fetcher.mock.calls[index][1].body as string)).toEqual({
                    files: [urls[index]],
                });
            });
        },
    );
});
