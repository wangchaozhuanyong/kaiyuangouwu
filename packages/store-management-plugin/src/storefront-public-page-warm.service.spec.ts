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

function harness(isWorker = false) {
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
    const publicCache = { revision: vi.fn(() => Promise.resolve(revision.value)) };
    const pages = {
        getAccessMode: vi.fn().mockResolvedValue('LIVE'),
        peek: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue({}),
    };
    const service = new StorefrontPublicPageWarmService(
        jobs as never,
        { isWorker } as never,
        cache as never,
        { rawConnection: { getRepository: () => ({ createQueryBuilder: () => query }) } } as never,
        access as never,
        pages as never,
        publicCache as never,
    );
    return {
        service,
        ctx,
        pages,
        revision,
        publicCache,
        access,
        add,
        records,
        cache,
        run: (channelId = 'a') => process({ data: { channelId } }),
    };
}

describe('bounded public page preparation', () => {
    afterEach(() => vi.useRealTimers());
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
        h.service.onApplicationShutdown();
    });

    it('uses a cached snapshot to skip duplicate work from another queued request', async () => {
        const h = harness();
        await h.service.onApplicationBootstrap();
        h.records.set('storefront-public-hot-routes:v2:a:r1', [route('one')]);
        h.pages.peek.mockResolvedValue({ version: 'current', generatedAt: Date.now() });
        await h.run();
        expect(h.pages.read).not.toHaveBeenCalled();
    });
});
