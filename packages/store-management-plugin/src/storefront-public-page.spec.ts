import { PUBLIC_PRODUCT_SUMMARY_READER } from '@vendure/core';
import {
    StorefrontAccountSettingsService,
    StorefrontVisualPresetService,
} from '@vendure/storefront-content-plugin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontClosedError } from './storefront-activation.service';
import { StorefrontPublicPageController } from './storefront-public-page.controller';
import { publicSectionWithinBudget, StorefrontPublicPageService } from './storefront-public-page.service';

const response = () => {
    const res = { setHeader: vi.fn(), status: vi.fn(), end: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
};
const activation = () => ({ getAccessMode: vi.fn().mockResolvedValue('PREVIEW') });

function setup() {
    const ctx = {
        channelId: 'a',
        apiType: 'shop',
        languageCode: 'en',
        currencyCode: 'MYR',
        channel: {
            id: 'a',
            code: 'a',
            token: 'private-channel-token',
            availableCurrencyCodes: ['MYR', 'CNY'],
            defaultLanguageCode: 'en',
            defaultCurrencyCode: 'MYR',
            customFields: {},
        },
    };
    const page = { scope: { host: 'a.test' } };
    const access = { resolveRequest: vi.fn().mockResolvedValue({ ctx, channelId: 'a', host: 'a.test' }) };
    const contexts = { create: vi.fn().mockResolvedValue(ctx) };
    const pages = { read: vi.fn().mockResolvedValue(page) };
    return {
        ctx,
        page,
        access,
        contexts,
        pages,
        controller: new StorefrontPublicPageController(access as never, contexts as never, pages as never),
    };
}

describe('public page boundary', () => {
    it.each(['PREVIEW', 'LIVE', 'CLOSED'])('rechecks %s access even when the page is cached', async mode => {
        const cached = { config: { accessMode: 'LIVE', name: 'Cached store' }, version: 'cached' };
        const policy = activation();
        policy.getAccessMode.mockResolvedValue(mode);
        const service = new StorefrontPublicPageService(
            { readThrough: vi.fn().mockResolvedValue(cached) } as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            policy as never,
        );
        const result = service.read(setup().ctx as never, 'a.test');
        if (mode === 'CLOSED') {
            await expect(result).rejects.toBeInstanceOf(StorefrontClosedError);
        } else {
            await expect(result).resolves.toMatchObject({
                config: { accessMode: mode, name: 'Cached store' },
            });
        }
        expect(cached.config.accessMode).toBe('LIVE');
        expect(policy.getAccessMode).toHaveBeenCalledTimes(1);
    });
    it('returns a typed closed-store response without assembling cached public content', async () => {
        const { controller, access, pages } = setup();
        access.resolveRequest.mockRejectedValue(new StorefrontClosedError());
        const res = response();
        await controller.read({ query: {} } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            errorCode: 'STOREFRONT_CLOSED',
            message: 'Store not open yet',
        });
        expect(pages.read).not.toHaveBeenCalled();
    });
    it('does not disguise unrelated access failures as a closed store', async () => {
        const { controller, access } = setup();
        access.resolveRequest.mockRejectedValue(new Error('Domain lookup unavailable'));
        await expect(controller.read({ query: {} } as never, response() as never)).rejects.toThrow(
            'Domain lookup unavailable',
        );
    });
    it('returns the same closed error when access changes during page assembly', async () => {
        const { controller, pages } = setup();
        pages.read.mockRejectedValue(new StorefrontClosedError());
        const res = response();
        await controller.read({ query: {} } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'STOREFRONT_CLOSED' }));
    });
    it('requires a verified active store and never takes a caller channel parameter', async () => {
        const { controller, access, pages } = setup();
        access.resolveRequest.mockResolvedValue(null);
        const res = response();
        await controller.read({ query: { channelId: 'b' } } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(pages.read).not.toHaveBeenCalled();
    });

    it('reconstructs anonymous context with only verified routing, discarding customer credentials', async () => {
        const { controller, contexts, ctx, pages } = setup();
        const res = response();
        await controller.read(
            {
                query: { channelId: 'b', languageCode: 'zh_Hans', currencyCode: 'CNY' },
                protocol: 'https',
                headers: { cookie: 'private-cookie', authorization: 'private-token' },
            } as never,
            res as never,
        );
        const options = contexts.create.mock.calls[0][0];
        expect(options.channelOrToken).toBe(ctx.channel);
        expect(options.req.headers).toEqual({ host: 'a.test', 'x-forwarded-host': 'a.test' });
        expect(options).not.toHaveProperty('user');
        expect(options.languageCode).toBe('zh_Hans');
        expect(options.currencyCode).toBe('CNY');
        expect(pages.read).toHaveBeenCalledWith(ctx, 'a.test', { kind: 'home' });
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it.each([{ currencyCode: 'USD' }, { languageCode: 'xx' }])(
        'rejects unsupported scope %j before assembly',
        async query => {
            const { controller, pages } = setup();
            const res = response();
            await controller.read({ query } as never, res as never);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(pages.read).not.toHaveBeenCalled();
        },
    );

    it('does not cache authenticated data', () => {
        const service = new StorefrontPublicPageService(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            activation() as never,
        );
        expect(() => service.read({ apiType: 'shop', activeUserId: 'customer' } as never, 'a.test')).toThrow(
            'anonymous',
        );
    });
});

describe('public page optional section budgets', () => {
    afterEach(() => vi.restoreAllMocks());

    it('keeps a timed-out section rejected even if it completes later', async () => {
        let complete!: (value: string[]) => void;
        const section = new Promise<string[]>(resolve => {
            complete = resolve;
        });
        const result = publicSectionWithinBudget(section, 10);

        await expect(result).rejects.toThrow('Public section deferred');
        complete(['late recommendation']);
        await section;
        await expect(result).rejects.toThrow('Public section deferred');
    });

    it.each(['pending', 'rejected'] as const)(
        'returns published content when flash sales are %s without seeding an empty success',
        async state => {
            let complete!: (value: unknown[]) => void;
            const pending = new Promise<unknown[]>(resolve => {
                complete = resolve;
            });
            const campaigns = {
                findFlashSales: vi.fn(() =>
                    state === 'pending'
                        ? pending
                        : Promise.reject(new Error('recommendation database unavailable')),
                ),
            };
            const account = {
                getPersonalDataExportEnabled: vi.fn().mockResolvedValue(true),
                getRecommendations: vi.fn().mockResolvedValue({ enabled: false }),
            };
            const modules = {
                get: vi.fn(token => {
                    if (token === PUBLIC_PRODUCT_SUMMARY_READER)
                        return { list: vi.fn().mockResolvedValue({ items: [] }) };
                    if (token === StorefrontAccountSettingsService) return account;
                    if (token === StorefrontVisualPresetService)
                        return { get: vi.fn().mockResolvedValue({ presetId: 'default' }) };
                    throw new Error(`Unexpected section token ${String(token)}`);
                }),
            };
            const content = {
                findPublished: vi.fn().mockResolvedValue([
                    {
                        id: 'hero',
                        code: 'hero',
                        type: 'HERO',
                        enabled: true,
                        title: 'Published title',
                        body: 'Published body',
                        items: [],
                    },
                ]),
                getSettings: vi.fn().mockResolvedValue({ heroAutoplayIntervalSeconds: 5 }),
            };
            const service = new StorefrontPublicPageService(
                { readThrough: vi.fn((_ctx, _key, _ttl, load: () => Promise<unknown>) => load()) } as never,
                modules as never,
                content as never,
                { get: vi.fn().mockResolvedValue({ emailPasswordEnabled: true }) } as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                campaigns as never,
                { findActive: vi.fn().mockResolvedValue([]) } as never,
                activation() as never,
            );
            vi.spyOn(
                service as unknown as { loadConfig(): Promise<unknown> },
                'loadConfig',
            ).mockResolvedValue({ code: 'a' });
            vi.spyOn(
                service as unknown as { loadCollections(): Promise<unknown[]> },
                'loadCollections',
            ).mockResolvedValue([]);

            // The pending campaign never resolves before the public response. The real
            // 600 ms budget must release published content rather than await it forever.
            const page = await service.read(setup().ctx as never, 'a.test');
            expect(page.content).toMatchObject({
                blocks: [{ title: 'Published title', body: 'Published body' }],
                flashSalesDeferred: true,
            });
            expect(page.failures).toEqual(['flashSales']);
            expect(page).not.toHaveProperty('flashSales');
            expect(page.products).toEqual([]);
            expect(content.findPublished).toHaveBeenCalledTimes(1);

            complete([{ id: 'late-sale', items: [] }]);
            await pending;
            expect(page).not.toHaveProperty('flashSales');
            expect(page.failures).toEqual(['flashSales']);
        },
    );
});

describe('public page media assembly', () => {
    it.each(['catalog', 'product'] as const)(
        'projects %s route media only after route data joins the common page',
        async kind => {
            const routeProduct = {
                id: 'p',
                featuredAsset: { id: 'cover', preview: '/assets/preview/route-cover.png' },
                assets: [{ id: 'gallery', preview: '/assets/preview/route-gallery.png' }],
                variants: [],
            };
            const find = vi.fn(() => Promise.resolve({ items: [routeProduct], totalItems: 1 }));
            const detail = vi.fn(() => Promise.resolve(routeProduct));
            const service = new StorefrontPublicPageService(
                { readThrough: vi.fn((_ctx, _key, _ttl, load: () => Promise<unknown>) => load()) } as never,
                { get: vi.fn(() => ({ find, detail })) } as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                activation() as never,
            );
            vi.spyOn(service as unknown as { assemble(): Promise<unknown> }, 'assemble').mockResolvedValue({
                schemaVersion: 1,
                version: 'before-route',
                generatedAt: 1,
                scope: {
                    host: 'a.test',
                    channelCode: 'a',
                    languageCode: 'en',
                    currencyCode: 'MYR',
                    priceContext: 'public',
                },
                route: '/',
                config: { logoUrl: '/assets/preview/logo.png' },
                content: {
                    blocks: [{ type: 'QUICK_LINKS', items: [{ imageUrl: '/assets/preview/quick.png' }] }],
                },
                media: [],
                failures: [],
            });
            const result = await service.read(
                setup().ctx as never,
                'a.test',
                kind === 'catalog' ? { kind, input: { take: 12 } } : { kind, id: 'p' },
            );
            expect(result.media).toContainEqual(
                expect.objectContaining({ identity: '/assets/preview/logo.png', kind: 'thumbnail' }),
            );
            expect(result.media).toContainEqual(
                expect.objectContaining({ identity: '/assets/preview/quick.png', kind: 'icon' }),
            );
            expect(result.media).toContainEqual(
                expect.objectContaining({
                    identity: '/assets/preview/route-cover.png',
                    kind: kind === 'catalog' ? 'card' : 'detail',
                }),
            );
            if (kind === 'product') {
                expect(result.media).toContainEqual(
                    expect.objectContaining({
                        identity: '/assets/preview/route-gallery.png',
                        kind: 'detail',
                    }),
                );
                expect(detail).toHaveBeenCalledTimes(1);
                expect(find).not.toHaveBeenCalled();
            } else {
                expect(find).toHaveBeenCalledTimes(1);
                expect(detail).not.toHaveBeenCalled();
                expect(result.media.some(item => item.identity === '/assets/preview/route-gallery.png')).toBe(
                    false,
                );
            }
            expect(result.version).not.toBe('before-route');
        },
    );
});

it('shares timed-out optional source reads across different public page assemblies and caches their later completion', async () => {
    const { StorefrontPublicCacheService } = await import('./performance/storefront-public-cache.service.js');
    const { PUBLIC_CATALOG_READER } = await import('./public-catalog-reader.js');
    const entries = new Map<string, unknown>();
    const cache = new StorefrontPublicCacheService(
        {
            get: (key: string) => Promise.resolve(entries.get(key)),
            set: (key: string, value: unknown) => {
                entries.set(key, value);
                return Promise.resolve();
            },
        } as unknown as ConstructorParameters<typeof StorefrontPublicCacheService>[0],
        { systemOptions: { cacheStrategy: {} } } as ConstructorParameters<
            typeof StorefrontPublicCacheService
        >[1],
    );
    let productsReady!: (value: { items: unknown[] }) => void;
    let visualReady!: (value: { presetId: string }) => void;
    let salesReady!: (value: unknown[]) => void;
    const products = new Promise<{ items: unknown[] }>(resolve => {
        productsReady = resolve;
    });
    const visual = new Promise<{ presetId: string }>(resolve => {
        visualReady = resolve;
    });
    const sales = new Promise<unknown[]>(resolve => {
        salesReady = resolve;
    });
    const list = vi.fn(() => products);
    const getVisual = vi.fn(() => visual);
    const findFlashSales = vi.fn(() => sales);
    const modules = {
        get: vi.fn(token => {
            if (token === PUBLIC_PRODUCT_SUMMARY_READER) return { list };
            if (token === StorefrontVisualPresetService) return { get: getVisual };
            if (token === PUBLIC_CATALOG_READER)
                return { find: vi.fn(() => Promise.resolve({ items: [], totalItems: 0 })) };
            throw new Error('Unexpected public data provider');
        }),
    };
    const service = new StorefrontPublicPageService(
        cache,
        modules as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { findFlashSales } as never,
        {} as never,
        activation() as never,
    );
    vi.spyOn(service as unknown as { loadConfig(): Promise<unknown> }, 'loadConfig').mockResolvedValue({
        code: 'a',
    });
    vi.spyOn(service as unknown as { loadContent(): Promise<unknown> }, 'loadContent').mockResolvedValue({
        blocks: [],
    });
    vi.spyOn(
        service as unknown as { loadCollections(): Promise<unknown[]> },
        'loadCollections',
    ).mockResolvedValue([]);
    const ctx = setup().ctx as never;
    const [home, catalog] = await Promise.all([
        service.read(ctx, 'a.test'),
        service.read(ctx, 'a.test', { kind: 'catalog', input: { skip: 20 } }),
    ]);
    expect(home.failures).toEqual(expect.arrayContaining(['products', 'visualPreset', 'flashSales']));
    expect(catalog.failures).toEqual(expect.arrayContaining(['visualPreset', 'flashSales']));
    expect(list).toHaveBeenCalledTimes(1);
    expect(getVisual).toHaveBeenCalledTimes(1);
    expect(findFlashSales).toHaveBeenCalledTimes(1);
    productsReady({ items: [] });
    visualReady({ presetId: 'default' });
    salesReady([]);
    await vi.waitFor(async () => {
        expect(await cache.peek(ctx, 'home-products:a.test')).toEqual([]);
        expect(await cache.peek(ctx, 'visual-preset:a.test')).toEqual({ presetId: 'default' });
        expect(await cache.peek(ctx, 'flash-sales:a.test')).toEqual([]);
    });
    const next = await service.read(ctx, 'a.test', { kind: 'catalog', input: { skip: 40 } });
    expect(next.failures).toEqual([]);
    expect(getVisual).toHaveBeenCalledTimes(1);
    expect(findFlashSales).toHaveBeenCalledTimes(1);
});
