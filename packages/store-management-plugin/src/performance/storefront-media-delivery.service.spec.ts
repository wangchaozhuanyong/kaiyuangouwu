import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontMediaDeliveryService } from './storefront-media-delivery.service';
vi.mock('@vendure/core', () => ({ ConfigService: class {} }));
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
