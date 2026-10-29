import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    mergePublicHotRoutes,
    StorefrontPublicPageWarmService,
    type PublicHotRoute,
} from './storefront-public-page-warm.service';

const route = (id: string, host = 'a.test'): PublicHotRoute => ({
    host,
    languageCode: 'en',
    currencyCode: 'MYR',
    request: { kind: 'product', id },
    seenAt: Date.now(),
});

function harness(isWorker = false, sharedVersions = true, prepareHtml = false) {
    let process: (job: { data: { channelId: string } }) => Promise<unknown> = () => Promise.resolve();
    const add = vi.fn().mockResolvedValue({});
    const jobs = {
        createQueue: vi.fn(options => {
            process = options.process;
            return Promise.resolve({ add });
        }),
    };
    const records = new Map<string, unknown>();
    const cache = {
        get: vi.fn((key: string) => Promise.resolve(records.get(key))),
        set: vi.fn((key: string, value: unknown) => {
            records.set(key, value);
            return Promise.resolve();
        }),
        delete: vi.fn((key: string) => {
            records.delete(key);
            return Promise.resolve();
        }),
    };
    const query = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([{ host: 'a.test', channelId: 'a' }]),
    };
    const ctx = {
        apiType: 'shop',
        channelId: 'a',
        languageCode: 'en',
        currencyCode: 'MYR',
        channel: {
            availableCurrencyCodes: ['MYR'],
            defaultCurrencyCode: 'MYR',
            defaultLanguageCode: 'zh_Hans',
        },
        copy: vi.fn(function (this: object, scope: object) {
            return { ...this, ...scope };
        }),
    };
    const access = { resolveRequest: vi.fn().mockResolvedValue({ ctx }) };
    const revision = { value: 'r1' };
    const publicCache = {
        sharedVersions,
        revision: vi.fn(() => Promise.resolve(revision.value)),
        runGuarded: vi.fn(async (guard, run) => {
            await guard();
            return run();
        }),
    };
    const pages = {
        getAccessMode: vi.fn().mockResolvedValue('LIVE'),
        peek: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue({}),
        prepareBootMedia: vi.fn().mockResolvedValue(undefined),
        readForDocument: vi.fn().mockResolvedValue({ failures: [] }),
    };
    const publicSeo = {
        enrich: vi.fn((_ctx, _host, page) => Promise.resolve(page)),
        assertOutput: vi.fn().mockResolvedValue(undefined),
    };
    const html = { render: vi.fn().mockResolvedValue('<html>Prepared public document</html>') };
    const service = new StorefrontPublicPageWarmService(
        jobs as never,
        { isWorker } as never,
        cache as never,
        { rawConnection: { getRepository: () => ({ createQueryBuilder: () => query }) } } as never,
        access as never,
        pages as never,
        publicCache as never,
        prepareHtml ? (publicSeo as never) : undefined,
        prepareHtml ? (html as never) : undefined,
    );
    return {
        service,
        ctx,
        pages,
        revision,
        publicCache,
        publicSeo,
        html,
        access,
        add,
        records,
        cache,
        run: (channelId = 'a') => process({ data: { channelId } }),
    };
}

describe('bounded public page preparation', () => {
    afterEach(() => vi.useRealTimers());
    it('prepares both public audiences beside a local API cache without adding database jobs', async () => {
        const h = harness(false, false, true);
        h.pages.read.mockResolvedValue({ failures: [] });
        await h.service.onApplicationBootstrap();
        await vi.waitFor(() => expect(h.html.render).toHaveBeenCalledTimes(4));
        expect(h.html.render.mock.calls.map(call => call[0].couponAudience)).toEqual([
            'anonymous',
            'unknown',
            'anonymous',
            'unknown',
        ]);
        expect(h.add).not.toHaveBeenCalled();
        h.service.onApplicationShutdown();
    });
    it('keeps local worker HTML private to its cache and treats preparation failure as optional', async () => {
        const worker = harness(true, false, true);
        await worker.service.onApplicationBootstrap();
        await worker.run();
        expect(worker.html.render).not.toHaveBeenCalled();
        worker.service.onApplicationShutdown();
        const shared = harness(true, true, true);
        shared.pages.read.mockResolvedValue({ failures: [] });
        shared.publicSeo.assertOutput.mockRejectedValue(new Error('Publication changed'));
        await shared.service.onApplicationBootstrap();
        await expect(shared.run()).resolves.toMatchObject({ warmed: 4 });
        expect(shared.html.render).not.toHaveBeenCalled();
        shared.service.onApplicationShutdown();
    });
    it('warms the serving API cache when the worker cannot share its cache generations', async () => {
        vi.useFakeTimers();
        const api = harness(false, false);
        const worker = harness(true, false);
        await worker.service.onApplicationBootstrap();
        await worker.run('*');
        await worker.run();
        expect(api.pages.read).not.toHaveBeenCalled();
        await api.service.onApplicationBootstrap();
        await vi.waitFor(() => expect(api.pages.read).toHaveBeenCalledTimes(4));
        expect(api.pages.read.mock.calls.filter(call => call[2].kind === 'home')).toHaveLength(2);
        expect(api.add).not.toHaveBeenCalled();
        expect(api.records.has('storefront-public-hot-routes:v2:a:r1')).toBe(true);
        expect(api.records).not.toBe(worker.records);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(api.pages.read).toHaveBeenCalledTimes(8);
        api.service.onApplicationShutdown();
        worker.service.onApplicationShutdown();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(api.pages.read).toHaveBeenCalledTimes(8);
    });

    it('coalesces local API warming and stops at revoked access without publishing another generation', async () => {
        vi.useFakeTimers();
        const h = harness(false, false);
        let release!: (value: object) => void;
        h.pages.read.mockReturnValueOnce(new Promise(resolve => (release = resolve)));
        await h.service.onApplicationBootstrap();
        await vi.waitFor(() => expect(h.pages.read).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.pages.read).toHaveBeenCalledTimes(1);
        h.pages.getAccessMode.mockResolvedValue('CLOSED');
        h.revision.value = 'r2';
        release({ collections: [] });
        await vi.advanceTimersByTimeAsync(0);
        expect(h.cache.set).not.toHaveBeenCalled();
        expect(h.pages.read).toHaveBeenCalledTimes(1);
        expect(h.add).not.toHaveBeenCalled();
        h.service.onApplicationShutdown();
    });

    it.each(['PREVIEW', 'CLOSED'])(
        'never observes, queues, or reads shared hot routes for %s',
        async mode => {
            const h = harness(true);
            h.pages.getAccessMode.mockResolvedValue(mode);
            await h.service.onApplicationBootstrap();
            await h.service.observe(h.ctx as never, 'a.test', { kind: 'home' });
            await h.run('*');
            await h.run();
            expect(h.add.mock.calls.filter(call => call[0].channelId === 'a')).toHaveLength(0);
            expect(h.cache.get).not.toHaveBeenCalled();
            expect(h.cache.set).not.toHaveBeenCalled();
            expect(h.pages.peek).not.toHaveBeenCalled();
            expect(h.pages.read).not.toHaveBeenCalled();
            h.service.onApplicationShutdown();
        },
    );

    it('does not revive old LIVE hot routes in a reopened store generation', async () => {
        const h = harness();
        h.records.set('storefront-public-hot-routes:v2:a:r1', [route('old')]);
        h.revision.value = 'r2';
        await h.service.onApplicationBootstrap();
        await h.run();
        expect(h.pages.read.mock.calls.some(call => call[2].kind === 'product' && call[2].id === 'old')).toBe(
            false,
        );
        expect(h.records.has('storefront-public-hot-routes:v2:a:r2')).toBe(true);
        h.service.onApplicationShutdown();
    });

    it('stops a running warm-up after closure without filling the new generation', async () => {
        const h = harness();
        let release!: (value: object) => void;
        const gate = new Promise<object>(resolve => {
            release = resolve;
        });
        h.pages.read.mockReturnValueOnce(gate);
        await h.service.onApplicationBootstrap();
        const work = h.run();
        await vi.waitFor(() => expect(h.pages.read).toHaveBeenCalledTimes(1));
        h.pages.getAccessMode.mockResolvedValue('CLOSED');
        h.revision.value = 'r2';
        release({ collections: [] });
        await work;
        expect(h.pages.read).toHaveBeenCalledTimes(1);
        expect(h.cache.set).not.toHaveBeenCalled();
        expect(h.records.has('storefront-public-hot-routes:v2:a:r2')).toBe(false);
        h.service.onApplicationShutdown();
    });

    it('leaves a late registry write in its obsolete generation and never promotes it to the current key', async () => {
        const h = harness();
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        h.cache.set.mockImplementationOnce(async (key, value) => {
            await gate;
            h.records.set(key, value);
        });
        await h.service.onApplicationBootstrap();
        const observed = h.service.observe(h.ctx as never, 'a.test', { kind: 'home' });
        await vi.waitFor(() => expect(h.cache.set).toHaveBeenCalled());
        h.pages.getAccessMode.mockResolvedValue('CLOSED');
        h.revision.value = 'r2';
        release();
        await observed;
        expect(h.records.has('storefront-public-hot-routes:v2:a:r1')).toBe(false);
        expect(h.records.has('storefront-public-hot-routes:v2:a:r2')).toBe(false);
        h.service.onApplicationShutdown();
    });
    it('deduplicates and bounds each store to twenty routes while excluding arbitrary search/filter work', () => {
        const recent = Array.from({ length: 35 }, (_, index) => ({
            ...route(String(index)),
            seenAt: Date.now() + index,
        }));
        const result = mergePublicHotRoutes(
            [],
            [
                ...recent,
                recent[34],
                {
                    ...route('search'),
                    request: { kind: 'catalog', input: { term: 'unbounded' } },
                },
            ],
        );
        expect(result).toHaveLength(20);
        expect(new Set(result.map(item => JSON.stringify(item.request))).size).toBe(20);
        expect(result[0].request).toEqual({ kind: 'product', id: '34' });
    });

    it('records visitor misses without enqueuing from any API process', async () => {
        const h = harness();
        await h.service.onApplicationBootstrap();
        for (let i = 0; i < 25; i++)
            void h.service.observe(h.ctx as never, 'a.test', { kind: 'product', id: 'one' });
        await vi.waitFor(() => expect(h.cache.set).toHaveBeenCalled());
        expect(h.add).not.toHaveBeenCalled();
        expect(h.pages.read).not.toHaveBeenCalled();
        expect([...h.records.values()][0]).toHaveLength(1);
        await Promise.all([h.run(), h.run()]);
        expect(h.pages.read.mock.calls.filter(call => call[2].kind === 'product')).toHaveLength(1);
        h.service.onApplicationShutdown();
    });

    it('schedules only from the worker and coalesces queued channels until completion', async () => {
        vi.useFakeTimers();
        const h = harness(true);
        await h.service.onApplicationBootstrap();
        expect(h.add).toHaveBeenCalledExactlyOnceWith({ channelId: '*' }, { retries: 0 });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.add).toHaveBeenCalledTimes(1);
        await h.run('*');
        expect(h.add).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(20_000);
        await h.run('*');
        // The existing channel job is still waiting; the second scan cannot enqueue it again.
        expect(h.add.mock.calls.filter(call => call[0].channelId === 'a')).toHaveLength(1);
        await h.run();
        await vi.advanceTimersByTimeAsync(20_000);
        await h.run('*');
        expect(h.add.mock.calls.filter(call => call[0].channelId === 'a')).toHaveLength(2);
        h.service.onApplicationShutdown();
    });

    it('warms published services and support artwork before their first visit in both languages', async () => {
        const h = harness();
        await h.service.onApplicationBootstrap();
        h.pages.read.mockResolvedValue({
            content: {
                blocks: [
                    {
                        type: 'CLIENT_PLUGINS',
                        code: 'storefront-client-plugins',
                        imageUrl: '/assets/preview/services.webp',
                        settings: { businessServicesHeroLayout: 'shared-banner' },
                    },
                    { type: 'SUPPORT', imageUrl: '/assets/preview/support.webp' },
                ],
            },
        });
        await h.run();
        const contentReads = h.pages.read.mock.calls.filter(call => call[2].kind === 'page');
        // Recency can reorder the two language batches; their exact coverage stays fixed.
        expect(contentReads.map(call => `${call[0].languageCode}:${call[2].id}`).sort()).toEqual([
            'en:services',
            'en:support',
            'zh_Hans:services',
            'zh_Hans:support',
        ]);
        const retained = h.records.get('storefront-public-hot-routes:v2:a:r1') as PublicHotRoute[];
        expect(retained).toHaveLength(8);
        expect(retained.every(item => item.primary)).toBe(true);
        h.pages.read.mockClear().mockResolvedValue({
            content: { blocks: [{ type: 'SUPPORT', imageUrl: null }] },
        });
        h.records.delete('storefront-public-hot-routes:v2:a:r1');
        await h.run();
        expect(h.pages.read.mock.calls.some(call => call[2].kind === 'page')).toBe(false);
        h.service.onApplicationShutdown();
    });

    it('reserves the homepage, default catalog and published primary categories within twenty routes', async () => {
        const h = harness();
        await h.service.onApplicationBootstrap();
        h.records.set(
            'storefront-public-hot-routes:v2:a:r1',
            Array.from({ length: 30 }, (_, i) => route(String(i))),
        );
        h.pages.read.mockResolvedValue({
            collections: [
                ...Array.from({ length: 4 }, (_, i) => ({ id: `empty-${i}`, productVariantCount: 0 })),
                ...Array.from({ length: 6 }, (_, i) => ({ id: `category-${i}`, productVariantCount: 2 })),
            ],
        });
        await h.run();
        const retained = h.records.get('storefront-public-hot-routes:v2:a:r1') as PublicHotRoute[];
        expect(retained).toHaveLength(20);
        expect(retained.filter(item => item.primary)).toHaveLength(12);
        expect(h.pages.read.mock.calls[0][0].languageCode).toBe('zh_Hans');
        expect(new Set(retained.filter(item => item.primary).map(item => item.languageCode))).toEqual(
            new Set(['en', 'zh_Hans']),
        );
        expect(retained.some(item => item.request.kind === 'home')).toBe(true);
        expect(h.pages.read).toHaveBeenCalledTimes(20);
        expect(
            retained.some(
                item =>
                    item.request.kind === 'catalog' && item.request.input.collectionId?.startsWith('empty-'),
            ),
        ).toBe(false);
        expect(
            retained.filter(
                item => item.primary && item.request.kind === 'catalog' && item.request.input.collectionId,
            ),
        ).toHaveLength(8);
        h.service.onApplicationShutdown();
    });

    it('rejects stale host ownership and unavailable currency before queued assembly', async () => {
        const h = harness();
        await h.service.onApplicationBootstrap();
        h.records.set('storefront-public-hot-routes:v2:a:r1', [
            route('one'),
            { ...route('two'), currencyCode: 'USD' },
        ]);
        h.access.resolveRequest.mockResolvedValue({ ctx: { ...h.ctx, channelId: 'another-store' } });
        await h.run();
        expect(h.pages.read).not.toHaveBeenCalled();
        h.access.resolveRequest.mockResolvedValue({ ctx: h.ctx });
        await h.run();
        const products = h.pages.read.mock.calls.filter(call => call[2].kind === 'product');
        expect(products).toHaveLength(1);
        expect(products[0][2]).toEqual({ kind: 'product', id: 'one' });
    });

    it('refreshes aging snapshots before the thirty-second TTL without store-wide invalidation', async () => {
        const h = harness();
        await h.service.onApplicationBootstrap();
        h.records.set('storefront-public-hot-routes:v2:a:r1', [route('one')]);
        h.pages.peek.mockResolvedValue({ version: 'aging', generatedAt: Date.now() - 16_000 });
        await h.run();
        expect(h.pages.read).toHaveBeenCalled();
        expect(h.pages.read.mock.calls.every(call => call[3]?.refresh === true)).toBe(true);
        expect(h.pages.read.mock.calls.every(call => call[3]?.prepareMedia === true)).toBe(true);
        h.service.onApplicationShutdown();
    });

    it('uses a cached snapshot to skip duplicate work from another queued request', async () => {
        const h = harness();
        await h.service.onApplicationBootstrap();
        h.records.set('storefront-public-hot-routes:v2:a:r1', [route('one')]);
        h.pages.peek.mockResolvedValue({ version: 'current', generatedAt: Date.now() });
        await h.run();
        expect(h.pages.read).not.toHaveBeenCalled();
        expect(h.pages.prepareBootMedia).toHaveBeenCalledTimes(2);
    });
    it('prepares boot hints for an observed non-default currency even when its homepage is already cached', async () => {
        const h = harness();
        h.ctx.channel.availableCurrencyCodes.push('CNY');
        await h.service.onApplicationBootstrap();
        h.records.set('storefront-public-hot-routes:v2:a:r1', [
            { ...route('currency'), currencyCode: 'CNY', request: { kind: 'home' } },
        ]);
        h.pages.peek.mockResolvedValue({ generatedAt: Date.now(), collections: [] });
        await h.run();
        expect(h.pages.read).not.toHaveBeenCalled();
        expect(
            h.pages.prepareBootMedia.mock.calls.some(
                call => call[0].currencyCode === 'CNY' && call[1] === 'a.test',
            ),
        ).toBe(true);
        h.service.onApplicationShutdown();
    });
});
