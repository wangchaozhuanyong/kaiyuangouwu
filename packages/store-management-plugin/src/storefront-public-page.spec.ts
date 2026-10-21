import { ServiceUnavailableException } from '@nestjs/common';
import { ForbiddenError, PUBLIC_PRODUCT_SUMMARY_READER } from '@vendure/core';
import {
    publicPageRequestKey,
    StorefrontAccountSettingsService,
    StorefrontVisualPresetService,
} from '@vendure/storefront-content-plugin';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontMediaManifestService } from './performance/storefront-media-manifest.service';
import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import { PUBLIC_CATALOG_READER as PUBLIC_CATALOG_ROUTE_READER } from './public-catalog-reader';
import { StorefrontActivationService, StorefrontClosedError } from './storefront-activation.service';
import { parsePublicPageRequest, StorefrontPublicPageController } from './storefront-public-page.controller';
import { publicSectionWithinBudget, StorefrontPublicPageService } from './storefront-public-page.service';

const response = () => {
    const res = { setHeader: vi.fn(), status: vi.fn(), end: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
};
const activation = (mode: 'LIVE' | 'PREVIEW' = 'PREVIEW') => ({
    getAccessMode: vi.fn().mockResolvedValue(mode),
});

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
    it.each([new ForbiddenError(), new StorefrontClosedError()])(
        'maps closed store resolution to structured no-store 403',
        async error => {
            const h = setup();
            h.access.resolveRequest.mockRejectedValue(error);
            const res = response();
            await h.controller.read({ query: {} } as never, res as never);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                errorCode: 'STOREFRONT_CLOSED',
                message: 'Storefront is closed',
            });
            expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
            expect(h.pages.read).not.toHaveBeenCalled();
        },
    );

    it('maps a late page access denial to 403 without treating infrastructure errors as closure', async () => {
        const h = setup();
        h.pages.read.mockRejectedValue(new StorefrontClosedError());
        const res = response();
        await h.controller.read({ query: {} } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            errorCode: 'STOREFRONT_CLOSED',
            message: 'Storefront is closed',
        });
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(res.status).not.toHaveBeenCalledWith(200);
        h.pages.read.mockRejectedValue(new Error('origin unavailable'));
        await expect(h.controller.read({ query: {} } as never, response() as never)).rejects.toThrow(
            'origin unavailable',
        );
    });
    it('shares canonical route identity with early requests and rejects malformed routes', () => {
        expect(
            parsePublicPageRequest({ kind: 'catalog', path: '/search', input: '{"term":" phone "}' }),
        ).toEqual({
            kind: 'catalog',
            path: '/search',
            input: {
                term: 'phone',
                sort: 'RECOMMENDED',
                inStockOnly: false,
                skip: 0,
                take: 12,
            },
        });
        expect(() => parsePublicPageRequest({ kind: 'catalog', path: '/account', input: '{}' })).toThrow();
    });
    it.each(['PREVIEW', 'LIVE', 'CLOSED'] as const)(
        'rechecks %s access even when the page is cached',
        async mode => {
            const h = accessHarness();
            h.config.mockResolvedValue({ code: 'a', name: 'Cached store' });
            const cached = (await h.service.read(h.ctx, 'a.test')) as { config: { accessMode: 'LIVE' } };
            h.activation.getAccessMode.mockClear();
            h.state.mode = mode;
            const result = h.service.read(h.ctx, 'a.test');
            if (mode === 'CLOSED') {
                await expect(result).rejects.toBeInstanceOf(StorefrontClosedError);
            } else {
                await expect(result).resolves.toMatchObject({
                    config: { accessMode: mode, name: 'Cached store' },
                });
            }
            expect(cached.config.accessMode).toBe('LIVE');
            // The common guard contract rechecks subsequent phases; it never memoizes authority.
            if (mode === 'LIVE') expect(h.activation.getAccessMode.mock.calls.length).toBeGreaterThan(1);
            else expect(h.activation.getAccessMode).toHaveBeenCalledTimes(mode === 'PREVIEW' ? 2 : 1);
            expect(h.config).toHaveBeenCalledTimes(mode === 'PREVIEW' ? 2 : 1);
        },
    );
    it('returns a typed closed-store response without assembling cached public content', async () => {
        const { controller, access, pages } = setup();
        access.resolveRequest.mockRejectedValue(new StorefrontClosedError());
        const res = response();
        await controller.read({ query: {} } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            errorCode: 'STOREFRONT_CLOSED',
            message: 'Storefront is closed',
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

function accessHarness(initial: 'LIVE' | 'PREVIEW' | 'CLOSED' = 'LIVE', worker = false, strategy = {}) {
    const state = { mode: initial };
    const entries = new Map<string, unknown>();
    const raw = {
        get: vi.fn((key: string) => Promise.resolve(entries.get(key))),
        set: vi.fn((key: string, value: unknown) => {
            entries.set(key, value);
            return Promise.resolve();
        }),
    };
    const cache = new StorefrontPublicCacheService(
        raw as never,
        { systemOptions: { cacheStrategy: strategy } } as never,
    );
    const invalidate = vi.spyOn(cache, 'invalidate');
    const accessActivation = { getAccessMode: vi.fn(() => Promise.resolve(state.mode)) };
    const sources = {
        content: { findPublished: vi.fn().mockResolvedValue([]), getSettings: vi.fn().mockResolvedValue({}) },
        auth: { get: vi.fn().mockResolvedValue({}) },
        account: {
            getPersonalDataExportEnabled: vi.fn().mockResolvedValue(true),
            getRecommendations: vi.fn().mockResolvedValue({ enabled: false }),
        },
        announcements: { findActive: vi.fn().mockResolvedValue([]) },
    };
    let version = 0;
    const modules = {
        get: vi.fn<(token: unknown) => unknown>(token => {
            if (token === StorefrontAccountSettingsService) return sources.account;
            if (token === PUBLIC_PRODUCT_SUMMARY_READER)
                return {
                    list: vi.fn().mockResolvedValue({ items: [] }),
                    detail: vi.fn().mockResolvedValue({ id: 'p' }),
                };
            return {
                get: vi.fn().mockResolvedValue({ presetId: 'default' }),
                find: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
                sales: vi.fn().mockResolvedValue({}),
            };
        }),
    };
    const service = new StorefrontPublicPageService(
        cache,
        modules as never,
        sources.content as never,
        sources.auth as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { findFlashSales: vi.fn().mockResolvedValue([]) } as never,
        sources.announcements as never,
        accessActivation as never,
        { isWorker: worker } as never,
    );
    const config = vi
        .spyOn(service as unknown as { loadConfig(): Promise<unknown> }, 'loadConfig')
        .mockImplementation(() => Promise.resolve({ code: 'a', sourceVersion: ++version }));
    const content = vi
        .spyOn(service as unknown as { loadContent(): Promise<unknown> }, 'loadContent')
        .mockImplementation(() =>
            cache.readThrough(setup().ctx as never, 'nested-content', 60_000, () =>
                Promise.resolve({ blocks: [] }),
            ),
        );
    vi.spyOn(
        service as unknown as { loadCollections(): Promise<unknown[]> },
        'loadCollections',
    ).mockResolvedValue([]);
    return {
        service,
        cache,
        invalidate,
        raw,
        entries,
        activation: accessActivation,
        state,
        config,
        content,
        sources,
        modules,
        ctx: setup().ctx as never,
    };
}

describe('public page inline artwork', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });
    function artworkHarness(worker = false, images = ['hero.webp'], strategy = {}) {
        const h = accessHarness('LIVE', worker, strategy);
        h.content.mockResolvedValue({
            blocks: images.map(image => ({ type: 'HERO', imageUrl: `/assets/preview/${image}` })),
        });
        const read = vi.fn().mockResolvedValue('data:image/webp;base64,AAAA');
        const authorize = vi.fn().mockResolvedValue(true);
        const original = h.modules.get.getMockImplementation();
        if (!original) throw new Error('Expected media provider fixture');
        h.modules.get.mockImplementation(token => {
            if (token === 'STOREFRONT_PUBLIC_IMAGE_PREVIEW') return { readPublicInlinePreview: read };
            if (token === StorefrontMediaManifestService) return { isPublic: authorize };
            return original(token);
        });
        return { ...h, read, authorize };
    }
    it('completes document artwork after joining the shorter API read without mutating its response', async () => {
        vi.useFakeTimers();
        const h = artworkHarness();
        let complete!: (value: string) => void;
        const derivative = new Promise<string>(resolve => {
            complete = resolve;
        });
        h.read.mockReturnValue(derivative);
        const api = h.service.read(h.ctx, 'a.test');
        const document = h.service.readForDocument(h.ctx, 'a.test');
        await vi.advanceTimersByTimeAsync(251);
        const partial = await api;
        const original = JSON.stringify(partial);
        expect(partial.media[0].placeholder).toBeUndefined();
        complete('data:image/webp;base64,AAAA');
        const ready = await document;
        expect(ready.media[0].placeholder?.inlineData).toBe('data:image/webp;base64,AAAA');
        expect(JSON.stringify(partial)).toBe(original);
        expect(ready).not.toBe(partial);
        expect(ready.version).not.toBe(partial.version);
        expect(h.content).toHaveBeenCalledOnce();
        expect(h.config).toHaveBeenCalledOnce();
    });
    it('does not prepare warm document artwork again when its eight asset slots are complete', async () => {
        const h = artworkHarness(
            false,
            Array.from({ length: 9 }, (_, index) => `hero-${index}.webp`),
        );
        const shared = await h.service.read(h.ctx, 'a.test');
        expect(shared.media.some(item => !item.placeholder)).toBe(true);
        expect(h.read).toHaveBeenCalledTimes(8);
        h.read.mockClear();
        h.authorize.mockClear();
        expect(await h.service.readForDocument(h.ctx, 'a.test')).toBe(shared);
        expect(h.read).not.toHaveBeenCalled();
        expect(h.authorize).not.toHaveBeenCalled();
        expect(h.content).toHaveBeenCalledOnce();
    });
    it('completes a missing configured header preview even when the original eight assets are warm', async () => {
        const h = artworkHarness(
            false,
            Array.from({ length: 9 }, (_, index) => `hero-${index}.webp`),
        );
        h.config.mockResolvedValue({
            code: 'a',
            logoUrl: '/assets/preview/header.webp?v=current',
            logoOnLightUrl: '/assets/preview/light.webp',
            logoOnDarkUrl: '/assets/preview/dark.webp',
        });
        h.read.mockImplementation(path =>
            Promise.resolve(path === 'preview/header.webp' ? undefined : 'data:image/webp;base64,AAAA'),
        );
        const shared = await h.service.read(h.ctx, 'a.test');
        expect(h.read).toHaveBeenCalledTimes(9);
        expect(shared.media.slice(0, 8).every(item => item.placeholder)).toBe(true);
        expect(shared.media.find(item => item.identity.includes('header.webp'))?.placeholder).toBeUndefined();
        const original = JSON.stringify(shared);
        h.read.mockClear().mockResolvedValue('data:image/webp;base64,BBBB');
        h.authorize.mockClear();
        const document = await h.service.readForDocument(h.ctx, 'a.test');
        expect(h.read.mock.calls.map(call => call[0])).toEqual(['preview/header.webp']);
        expect(h.authorize).toHaveBeenCalledTimes(9);
        expect(
            document.media
                .slice(0, 8)
                .every(item => item.placeholder?.inlineData === 'data:image/webp;base64,AAAA'),
        ).toBe(true);
        expect(document.media.find(item => item.identity.includes('header.webp'))).toMatchObject({
            version: 'current',
            placeholder: { inlineData: 'data:image/webp;base64,BBBB' },
        });
        expect(
            document.media
                .filter(item => /hero-8|light|dark/u.test(item.identity))
                .every(item => !item.placeholder),
        ).toBe(true);
        expect(JSON.stringify(shared)).toBe(original);
        expect(document).not.toBe(shared);
        expect(h.content).toHaveBeenCalledOnce();
    });
    it('keeps a complete header and eight body previews on the existing warm document shortcut', async () => {
        const h = artworkHarness(
            false,
            Array.from({ length: 9 }, (_, index) => `hero-${index}.webp`),
        );
        h.config.mockResolvedValue({ code: 'a', logoUrl: '/assets/preview/header.webp' });
        const shared = await h.service.read(h.ctx, 'a.test');
        expect(h.read).toHaveBeenCalledTimes(9);
        h.read.mockClear();
        h.authorize.mockClear();
        expect(await h.service.readForDocument(h.ctx, 'a.test')).toBe(shared);
        expect(h.read).not.toHaveBeenCalled();
        expect(h.authorize).not.toHaveBeenCalled();
    });
    it('does not borrow a preview across different versions of the same asset path', async () => {
        const h = artworkHarness(false, ['same.webp?v=old', 'same.webp?v=new']);
        h.read.mockResolvedValueOnce('data:image/webp;base64,AAAA').mockResolvedValueOnce(undefined);
        const shared = await h.service.read(h.ctx, 'a.test');
        expect(shared.media.some(item => item.placeholder)).toBe(true);
        expect(shared.media.some(item => !item.placeholder)).toBe(true);
        h.read.mockClear().mockResolvedValue('data:image/webp;base64,BBBB');
        const document = await h.service.readForDocument(h.ctx, 'a.test');
        expect(h.read).toHaveBeenCalledTimes(2);
        expect(
            document.media.every(item => item.placeholder?.inlineData === 'data:image/webp;base64,BBBB'),
        ).toBe(true);
        expect(shared.media.find(item => item.placeholder)?.placeholder?.inlineData).toBe(
            'data:image/webp;base64,AAAA',
        );
    });
    it('keeps preview documents on the existing uncached path without shared revision reads', async () => {
        const h = artworkHarness();
        h.state.mode = 'PREVIEW';
        const revision = vi.spyOn(h.cache, 'revision');
        const document = await h.service.readForDocument(h.ctx, 'a.test');
        expect(document.config).toMatchObject({ accessMode: 'PREVIEW' });
        expect(revision).not.toHaveBeenCalled();
        expect(h.content).toHaveBeenCalledOnce();
    });
    it('keeps the existing short public fallback when shared revisions are unavailable', async () => {
        vi.useFakeTimers();
        const h = artworkHarness();
        vi.spyOn(h.cache, 'revision').mockResolvedValue(undefined);
        h.read.mockReturnValue(new Promise(() => undefined));
        const pending = h.service.readForDocument(h.ctx, 'a.test');
        await vi.advanceTimersByTimeAsync(251);
        const document = await pending;
        expect(document.content).toBeDefined();
        expect(document.media.every(item => !item.placeholder)).toBe(true);
        expect(h.read).toHaveBeenCalledOnce();
    });
    it('ends document-only preparation after an additional 500ms and retains usable content', async () => {
        vi.useFakeTimers();
        const h = artworkHarness();
        h.read.mockReturnValue(new Promise(() => undefined));
        let settled = false;
        const pending = h.service.readForDocument(h.ctx, 'a.test').then(snapshot => {
            settled = true;
            return snapshot;
        });
        await vi.advanceTimersByTimeAsync(251);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(498);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        const page = await pending;
        expect(settled).toBe(true);
        expect(page.content).toBeDefined();
        expect(page.media[0].placeholder).toBeUndefined();
        expect(h.content).toHaveBeenCalledOnce();
    });
    it('removes newly denied retained pixels from only the document response', async () => {
        const h = artworkHarness(false, ['retained.webp', 'missing.webp']);
        h.read.mockImplementation(path =>
            Promise.resolve(path.includes('retained') ? 'data:image/webp;base64,AAAA' : undefined),
        );
        const shared = await h.service.read(h.ctx, 'a.test');
        expect(shared.media[0].placeholder).toBeDefined();
        h.authorize.mockImplementation(path => Promise.resolve(!path.includes('retained')));
        const document = await h.service.readForDocument(h.ctx, 'a.test');
        expect(document.media.every(item => !item.placeholder)).toBe(true);
        expect(shared.media[0].placeholder).toBeDefined();
        expect(document).not.toBe(shared);
    });
    it('shares additional document preparation through the existing in-flight owner', async () => {
        vi.useFakeTimers();
        const h = artworkHarness();
        h.read.mockResolvedValue(undefined);
        await h.service.read(h.ctx, 'a.test');
        let complete!: (value: string) => void;
        h.read.mockClear().mockReturnValue(new Promise(resolve => (complete = resolve)));
        const documents = Array.from({ length: 3 }, () => h.service.readForDocument(h.ctx, 'a.test'));
        await vi.advanceTimersByTimeAsync(1);
        expect(h.read).toHaveBeenCalledOnce();
        complete('data:image/webp;base64,AAAA');
        const pages = await Promise.all(documents);
        expect(
            pages.every(page => page.media[0].placeholder?.inlineData === 'data:image/webp;base64,AAAA'),
        ).toBe(true);
    });
    it('returns document content within its budget while saturated origin slots defer preparation', async () => {
        vi.useFakeTimers();
        const h = artworkHarness();
        h.read.mockResolvedValue(undefined);
        await h.service.read(h.ctx, 'a.test');
        h.read.mockClear();
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        const owners = Array.from({ length: 4 }, (_, index) =>
            h.cache.readThrough(h.ctx, `occupied-${index}`, 1, () => gate),
        );
        await vi.advanceTimersByTimeAsync(1);
        const pending = h.service.readForDocument(h.ctx, 'a.test');
        await vi.advanceTimersByTimeAsync(501);
        expect((await pending).content).toBeDefined();
        expect(h.read).not.toHaveBeenCalled();
        release();
        await Promise.all(owners);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.read).not.toHaveBeenCalled();
    });
    it('does not inherit retained pixels when their renewed authorization is still pending at the deadline', async () => {
        vi.useFakeTimers();
        const h = artworkHarness(false, ['retained.webp', 'missing.webp']);
        h.read.mockImplementation(path =>
            Promise.resolve(path.includes('retained') ? 'data:image/webp;base64,AAAA' : undefined),
        );
        const shared = await h.service.read(h.ctx, 'a.test');
        h.authorize.mockImplementation(path =>
            path.includes('retained') ? new Promise<boolean>(() => undefined) : Promise.resolve(true),
        );
        const pending = h.service.readForDocument(h.ctx, 'a.test');
        await vi.advanceTimersByTimeAsync(501);
        expect((await pending).media.every(item => !item.placeholder)).toBe(true);
        expect(shared.media[0].placeholder).toBeDefined();
    });
    it.each(['missing', 'storage-error'])(
        'keeps terminal %s document artwork local without waiting out its deadline',
        async outcome => {
            vi.useFakeTimers();
            const h = artworkHarness();
            if (outcome === 'missing') h.read.mockResolvedValue(undefined);
            else h.read.mockRejectedValue(new Error('storage unavailable'));
            const document = await h.service.readForDocument(h.ctx, 'a.test');
            expect(document.content).toBeDefined();
            expect(document.media.every(item => !item.placeholder)).toBe(true);
            expect(h.content).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        },
    );
    it.each(['revision', 'PREVIEW', 'CLOSED', 'currency'] as const)(
        'rejects a document when %s changes during its additional preparation',
        async change => {
            vi.useFakeTimers();
            const h = artworkHarness();
            h.read.mockResolvedValue(undefined);
            const shared = await h.service.read(h.ctx, 'a.test');
            let complete!: (value: string) => void;
            h.read.mockReturnValue(new Promise(resolve => (complete = resolve)));
            const pending = h.service.readForDocument(h.ctx, 'a.test');
            const rejected = expect(pending).rejects.toBeInstanceOf(
                change === 'CLOSED' ? StorefrontClosedError : ServiceUnavailableException,
            );
            await vi.advanceTimersByTimeAsync(1);
            if (change === 'revision') await h.cache.invalidate('a');
            else if (change === 'currency') (h.ctx as { currencyCode: string }).currencyCode = 'CNY';
            else h.state.mode = change;
            complete('data:image/webp;base64,AAAA');
            await rejected;
            expect(shared.media.every(item => !item.placeholder)).toBe(true);
            expect(h.content).toHaveBeenCalledOnce();
        },
    );
    it('keeps API and worker caches separate and never freezes unfinished cold metadata across consecutive TTL cycles', async () => {
        vi.useFakeTimers();
        const api = artworkHarness();
        const worker = artworkHarness(true);
        const latch = () => {
            let resolve!: () => void;
            const promise = new Promise<void>(yes => {
                resolve = yes;
            });
            return { promise, resolve };
        };
        let gate = latch();
        const attach = (h: ReturnType<typeof artworkHarness>, wait: () => Promise<void>) => {
            const manifest = new StorefrontMediaManifestService(
                h.cache,
                {} as never,
                {} as never,
                {} as never,
            );
            const build = vi
                .spyOn(
                    manifest as unknown as {
                        build(): Promise<{ channelId: string; host: string; paths: string[]; uses: [] }>;
                    },
                    'build',
                )
                .mockImplementation(async () => {
                    await wait();
                    return { channelId: 'a', host: 'a.test', paths: ['preview/hero.webp'], uses: [] };
                });
            const original = h.modules.get.getMockImplementation();
            if (!original) throw new Error('Expected media fixture');
            h.modules.get.mockImplementation(token =>
                token === StorefrontMediaManifestService ? manifest : original(token),
            );
            return { manifest, build };
        };
        const apiManifest = attach(api, () => gate.promise);
        const workerManifest = attach(worker, () => Promise.resolve());
        const workerPage = await worker.service.read(
            worker.ctx,
            'a.test',
            { kind: 'home' },
            { prepareMedia: true },
        );
        expect(workerPage.media[0].placeholder).toBeDefined();
        expect(await api.service.peek(api.ctx, 'a.test')).toBeUndefined();
        expect(api.entries).not.toBe(worker.entries);
        for (let cycle = 0; cycle < 3; cycle++) {
            const pending = api.service.read(api.ctx, 'a.test');
            await vi.advanceTimersByTimeAsync(251);
            const cold = await pending;
            expect(cold.media[0].placeholder).toBeUndefined();
            expect(await api.service.peek(api.ctx, 'a.test')).toBeUndefined();
            gate.resolve();
            await apiManifest.manifest.get(api.ctx, 'a.test');
            const warm = await api.service.read(api.ctx, 'a.test');
            expect(warm.media[0].placeholder?.inlineData).toBe('data:image/webp;base64,AAAA');
            expect(await api.service.peek(api.ctx, 'a.test')).toBe(warm);
            expect(await api.service.read(api.ctx, 'a.test')).toBe(warm);
            expect(cold.media[0].placeholder).toBeUndefined();
            if (cycle < 2) {
                gate = latch();
                await vi.advanceTimersByTimeAsync(31_000);
            }
        }
        expect(apiManifest.build).toHaveBeenCalledTimes(3);
        expect(workerManifest.build).toHaveBeenCalledOnce();
        expect(api.read).toHaveBeenCalledTimes(3);
    });
    it.each(['denied', 'authorization-error', 'missing', 'storage-error', 'invalid'])(
        'caches a completed %s result instead of retrying it on every public read',
        async outcome => {
            const h = artworkHarness();
            if (outcome === 'denied') h.authorize.mockResolvedValue(false);
            else if (outcome === 'authorization-error')
                h.authorize.mockRejectedValue(new Error('unavailable'));
            else if (outcome === 'storage-error') h.read.mockRejectedValue(new Error('unavailable'));
            else h.read.mockResolvedValue(outcome === 'invalid' ? 'invalid' : undefined);
            const first = await h.service.read(h.ctx, 'a.test');
            expect(first.media[0].placeholder).toBeUndefined();
            expect(await h.service.peek(h.ctx, 'a.test')).toBe(first);
            expect(await h.service.read(h.ctx, 'a.test')).toBe(first);
            expect(h.authorize).toHaveBeenCalledOnce();
            expect(h.read).toHaveBeenCalledTimes(
                outcome === 'denied' || outcome === 'authorization-error' ? 0 : 1,
            );
        },
    );
    it.each([false, true])(
        'reconciles a CAS winner only while its artwork stays authorized (%s)',
        async denied => {
            const versions = new Map<string, string>();
            let generation = 0;
            const strategy = {
                getOrCreateVersion: vi.fn((key: string) => {
                    if (!versions.has(key)) versions.set(key, String(++generation));
                    return Promise.resolve(versions.get(key));
                }),
                rotateVersion: vi.fn((key: string) => {
                    versions.set(key, String(++generation));
                    return Promise.resolve(versions.get(key));
                }),
                compareAndSet: vi.fn<(key: string, expected: unknown, entry: unknown) => Promise<boolean>>(),
            };
            const h = artworkHarness(false, ['hero.webp'], strategy);
            strategy.compareAndSet.mockImplementation((key, _, entry) => {
                h.entries.set(key, entry);
                return Promise.resolve(true);
            });
            const healthy = await h.service.read(h.ctx, 'a.test');
            const saved = [...h.entries.entries()].find(
                ([, entry]) => (entry as { value: unknown }).value === healthy,
            );
            if (!saved) throw new Error('Expected the healthy page entry');
            h.entries.clear();
            h.read.mockResolvedValue(undefined);
            h.authorize.mockResolvedValue(!denied);
            h.content.mockResolvedValue({
                blocks: [{ type: 'HERO', imageUrl: '/assets/preview/hero.webp', title: 'New content' }],
            });
            strategy.compareAndSet.mockClear().mockImplementationOnce((key: string) => {
                h.entries.set(key, saved[1]);
                return Promise.resolve(false);
            });
            const current = await h.service.read(h.ctx, 'a.test');
            expect(current.content).toMatchObject({ blocks: [{ title: 'New content' }] });
            expect(current.media[0].placeholder).toEqual(denied ? undefined : healthy.media[0].placeholder);
            expect(current.version).not.toBe(healthy.version);
            expect(h.raw.set.mock.calls.filter(([key]) => key === saved[0])).toHaveLength(0);
            if (denied) {
                expect(strategy.rotateVersion).toHaveBeenCalledOnce();
                expect((await h.service.read(h.ctx, 'a.test')).media[0].placeholder).toBeUndefined();
            } else {
                const { version, ...payload } = current;
                expect(version).toBe(
                    createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24),
                );
                expect(strategy.compareAndSet).toHaveBeenCalledOnce();
                expect(h.entries.get(saved[0])).toBe(saved[1]);
            }
        },
    );
    it('preserves healthy pixels on refresh only after current manifest authorization', async () => {
        const h = artworkHarness();
        const original = await h.service.read(h.ctx, 'a.test');
        expect(original.media[0].placeholder?.inlineData).toBe('data:image/webp;base64,AAAA');
        h.read.mockResolvedValue(undefined);
        const next = await h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
        expect(next.media[0].placeholder).toEqual(original.media[0].placeholder);
        expect(h.authorize).toHaveBeenCalledTimes(2);
        h.authorize.mockResolvedValue(false);
        const denied = await h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
        expect(denied.media[0].placeholder).toBeUndefined();
        expect((await h.service.read(h.ctx, 'a.test')).media[0].placeholder).toBeUndefined();
        expect(h.read).toHaveBeenCalledTimes(2);
    });
    it('returns newly authorized matching pixels from a healthy producer that won during this cold read', async () => {
        const h = artworkHarness();
        const healthy = await h.service.read(h.ctx, 'a.test');
        const saved = [...h.entries.entries()].find(
            ([, entry]) => (entry as { value: unknown }).value === healthy,
        );
        if (!saved) throw new Error('Expected the healthy page entry');
        h.entries.clear();
        h.read.mockResolvedValue(undefined);
        let pageReads = 0;
        h.raw.get.mockImplementation(key => {
            if (key === saved[0] && ++pageReads === 2) h.entries.set(saved[0], saved[1]);
            return Promise.resolve(h.entries.get(key));
        });
        const current = await h.service.read(h.ctx, 'a.test');
        expect(current.media[0].placeholder).toEqual(healthy.media[0].placeholder);
        expect(current.config).toMatchObject({ sourceVersion: 2 });
        expect(current.version).not.toBe(healthy.version);
        expect(h.authorize).toHaveBeenCalledTimes(2);
    });
    it('fails closed on authorization timeout without replacing or extending a healthy cache entry', async () => {
        vi.useFakeTimers();
        const h = artworkHarness();
        await h.service.read(h.ctx, 'a.test');
        const before = [...h.entries.entries()];
        h.authorize.mockImplementation(() => new Promise<boolean>(() => undefined));
        const pending = h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
        await vi.advanceTimersByTimeAsync(251);
        const result = await pending;
        expect(result.media.every(item => !item.placeholder)).toBe(true);
        expect([...h.entries.entries()]).toEqual(before);
        expect(h.read).toHaveBeenCalledOnce();
    });
    it('removes denied old pixels even when another asset authorization times out in the same refresh', async () => {
        vi.useFakeTimers();
        const h = artworkHarness(false, ['denied.webp', 'unknown.webp']);
        await h.service.read(h.ctx, 'a.test');
        h.authorize.mockImplementation((path: string) =>
            path.includes('denied') ? Promise.resolve(false) : new Promise<boolean>(() => undefined),
        );
        const pending = h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
        await vi.advanceTimersByTimeAsync(251);
        expect((await pending).media.every(item => !item.placeholder)).toBe(true);
        expect((await h.service.read(h.ctx, 'a.test')).media.every(item => !item.placeholder)).toBe(true);
        expect(h.read).toHaveBeenCalledTimes(2);
    });
    it('never inherits pixels across shared revision, currency, preview or closed access', async () => {
        const h = artworkHarness();
        await h.service.read(h.ctx, 'a.test');
        h.read.mockResolvedValue(undefined);
        const currency = { ...(h.ctx as object), currencyCode: 'CNY' } as never;
        const other = await h.service.read(currency, 'a.test', { kind: 'home' }, { refresh: true });
        expect(other.media.every(item => !item.placeholder)).toBe(true);
        await h.cache.invalidate('a');
        const revised = await h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
        expect(revised.media.every(item => !item.placeholder)).toBe(true);
        h.state.mode = 'PREVIEW';
        const preview = await h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
        expect(preview.media.every(item => !item.placeholder)).toBe(true);
        h.state.mode = 'CLOSED';
        await expect(
            h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true }),
        ).rejects.toBeInstanceOf(StorefrontClosedError);
    });
    it.each([false, true])(
        'only the existing worker may prepare a cold preview beyond the visitor budget (%s)',
        async worker => {
            vi.useFakeTimers();
            vi.stubEnv('STOREFRONT_MEDIA_PREGENERATE', 'false');
            const h = artworkHarness(worker);
            let prepared = false;
            h.read.mockImplementation(async () => {
                if (!prepared) {
                    await new Promise(resolve => setTimeout(resolve, 400));
                    prepared = true;
                }
                return 'data:image/webp;base64,AAAA';
            });
            const pending = h.service.read(
                h.ctx,
                'a.test',
                { kind: 'home' },
                { refresh: true, prepareMedia: true },
            );
            await vi.advanceTimersByTimeAsync(worker ? 401 : 251);
            const first = await pending;
            expect(Boolean(first.media[0].placeholder)).toBe(worker);
            if (worker) {
                const visitor = await h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
                expect(visitor.media[0].placeholder?.inlineData).toBe('data:image/webp;base64,AAAA');
                expect(h.read).toHaveBeenCalledTimes(2);
            }
        },
    );
    it('does not carry a captured old preview into a retried generation or revision outage', async () => {
        const h = artworkHarness();
        await h.service.read(h.ctx, 'a.test');
        h.read.mockResolvedValue(undefined);
        h.authorize.mockImplementationOnce(async () => {
            await h.cache.invalidate('a');
            return true;
        });
        const revised = await h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
        expect(revised.media.every(item => !item.placeholder)).toBe(true);
        expect(h.authorize.mock.calls.length).toBeGreaterThanOrEqual(3);
        vi.spyOn(h.cache, 'revision').mockResolvedValue(undefined);
        const unavailable = await h.service.read(h.ctx, 'a.test', { kind: 'home' }, { refresh: true });
        expect(unavailable.media.every(item => !item.placeholder)).toBe(true);
    });
    it('keeps an absolute cold authorization timeout within the visitor cap without inventing pixels', async () => {
        vi.useFakeTimers();
        const h = artworkHarness();
        h.authorize.mockImplementation(() => new Promise<boolean>(() => undefined));
        const pending = h.service.read(h.ctx, 'a.test');
        await vi.advanceTimersByTimeAsync(251);
        const result = await pending;
        expect(result.media.every(item => !item.placeholder)).toBe(true);
        expect(result.content).toBeDefined();
        expect(h.read).not.toHaveBeenCalled();
    });
    it('never expands preview-mode work to the worker preparation window', async () => {
        vi.useFakeTimers();
        const h = artworkHarness(true);
        h.state.mode = 'PREVIEW';
        h.read.mockImplementation(
            () => new Promise(resolve => setTimeout(() => resolve('data:image/webp;base64,AAAA'), 400)),
        );
        const pending = h.service.read(h.ctx, 'a.test', { kind: 'home' }, { prepareMedia: true });
        await vi.advanceTimersByTimeAsync(251);
        expect((await pending).media.every(item => !item.placeholder)).toBe(true);
        expect(h.entries.size).toBe(0);
    });
    it('reserves the bounded preview slots for the current page before navigation or unrelated content', async () => {
        const h = accessHarness();
        h.content.mockResolvedValue({
            blocks: [
                ...Array.from({ length: 12 }, (_, index) => ({
                    type: 'HERO',
                    imageUrl: `/assets/preview/home-${index}.webp`,
                })),
                {
                    type: 'NAVIGATION',
                    items: Array.from({ length: 12 }, (_, index) => ({
                        imageUrl: `/assets/preview/nav-${index}.webp`,
                    })),
                },
                {
                    type: 'CLIENT_PLUGINS',
                    code: 'storefront-client-plugins',
                    imageUrl: '/assets/preview/services.webp',
                    settings: { mobileImageUrl: '/assets/preview/services-phone.webp' },
                },
            ],
        });
        const read = vi.fn().mockResolvedValue('data:image/webp;base64,AAAA');
        const original = h.modules.get.getMockImplementation();
        if (!original) throw new Error('Expected the module harness implementation');
        h.modules.get.mockImplementation(token => {
            if (token === 'STOREFRONT_PUBLIC_IMAGE_PREVIEW') return { readPublicInlinePreview: read };
            if (token === StorefrontMediaManifestService)
                return { isPublic: vi.fn().mockResolvedValue(true) };
            return original(token);
        });
        const page = await h.service.read(h.ctx, 'a.test', { kind: 'page', id: 'services' });
        expect(read).toHaveBeenCalledTimes(8);
        expect(read.mock.calls.slice(0, 2).map(call => call[0])).toEqual([
            'preview/services.webp',
            'preview/services-phone.webp',
        ]);
        expect(read.mock.calls.every(call => !call[0].includes('home-'))).toBe(true);
        expect(
            page.media.filter(item => item.identity.includes('services')).every(item => item.placeholder),
        ).toBe(true);
        expect(page.media.some(item => item.identity.includes('home-11'))).toBe(true);
    });
    it('keeps published services, support and auth media on non-home pages and reuses the page cache', async () => {
        const h = accessHarness();
        const preview = 'data:image/webp;base64,AAAA';
        h.content.mockResolvedValue({
            blocks: [
                { type: 'HERO', imageUrl: '/assets/preview/home.webp' },
                {
                    type: 'CLIENT_PLUGINS',
                    code: 'storefront-client-plugins',
                    imageUrl: '/assets/preview/services.webp',
                    settings: { mobileImageUrl: '/assets/preview/services-phone.webp' },
                },
                { type: 'SUPPORT', imageUrl: '/assets/preview/support.webp' },
                { type: 'AUTH_LOGIN', imageUrl: '/assets/preview/login.webp' },
            ],
        });
        const authorize = vi.fn().mockResolvedValue(true);
        const read = vi.fn().mockResolvedValue(preview);
        const original = h.modules.get.getMockImplementation();
        if (!original) throw new Error('Expected the module harness implementation');
        h.modules.get.mockImplementation(token => {
            if (token === 'STOREFRONT_PUBLIC_IMAGE_PREVIEW') return { readPublicInlinePreview: read };
            if (token === StorefrontMediaManifestService) return { isPublic: authorize };
            return original(token);
        });
        const page = await h.service.read(h.ctx, 'a.test', { kind: 'page', id: 'services' });
        expect(page.media.map(item => item.identity)).toEqual(
            expect.arrayContaining([
                '/assets/preview/services.webp',
                '/assets/preview/services-phone.webp',
                '/assets/preview/support.webp',
                '/assets/preview/login.webp',
            ]),
        );
        expect(read.mock.calls[0][0]).toBe('preview/services.webp');
        expect(
            page.media
                .filter(item => item.identity.includes('services'))
                .every(item => item.placeholder?.inlineData === preview),
        ).toBe(true);
        expect(
            page.media.filter(item => !item.identity.includes('services')).every(item => !item.placeholder),
        ).toBe(true);
        const reads = read.mock.calls.length;
        const cached = await h.service.read(h.ctx, 'a.test', { kind: 'page', id: 'services' });
        expect(cached.version).toBe(page.version);
        expect(read).toHaveBeenCalledTimes(reads);
        expect(authorize).not.toHaveBeenCalledWith(h.ctx, 'a.test', 'preview/login.webp');
    });
});

describe('ranked home data in the public snapshot', () => {
    async function homeHarness(mode: 'LIVE' | 'PREVIEW' = 'LIVE') {
        const h = accessHarness(mode);
        const { PUBLIC_CATALOG_READER } = await import('./public-catalog-reader.js');
        const catalog = { items: [{ id: 'ranked-low' }, { id: 'ranked-high' }], totalItems: 2 };
        const find = vi.fn().mockResolvedValue(catalog);
        const sales = vi.fn().mockResolvedValue({ 'ranked-low': 2, 'ranked-high': 20 });
        const byId = vi.fn((_: unknown, id: string) => Promise.resolve(id === 'pinned' ? { id } : null));
        const list = vi.fn().mockResolvedValue({ items: [{ id: 'ordinary' }] });
        const original = h.modules.get.getMockImplementation();
        if (!original) throw new Error('Expected the default public provider fixture');
        h.modules.get.mockImplementation(token => {
            if (token === PUBLIC_CATALOG_READER) return { find, sales };
            if (token === PUBLIC_PRODUCT_SUMMARY_READER) return { list, byId };
            return original(token);
        });
        h.content.mockResolvedValue({
            blocks: [
                {
                    type: 'BEST_SELLERS',
                    settings: { displayCount: 3, pinnedProductIds: [' pinned ', 'missing'] },
                },
            ],
            settings: { configuredBlockTypes: ['BEST_SELLERS'] },
        });
        return { ...h, catalog, find, sales, byId, list };
    }
    it.each(['LIVE', 'PREVIEW'] as const)(
        'starts ranked data after published content without waiting for unrelated products in %s',
        async mode => {
            const h = await homeHarness(mode);
            const published = await h.content();
            let publish!: (value: unknown) => void;
            let products!: (value: { items: Array<{ id: string }> }) => void;
            h.content.mockReturnValue(new Promise(resolve => (publish = resolve)));
            h.list.mockReturnValue(new Promise(resolve => (products = resolve)));
            vi.useFakeTimers();
            const pending = h.service.read(h.ctx, 'a.test');
            try {
                await vi.advanceTimersByTimeAsync(0);
                expect(h.list).toHaveBeenCalledOnce();
                expect(h.find).not.toHaveBeenCalled();
                publish(published);
                await vi.advanceTimersByTimeAsync(0);
                expect(h.find).toHaveBeenCalledOnce();
                expect(h.sales).toHaveBeenCalledOnce();
            } finally {
                publish(published);
                products({ items: [{ id: 'ordinary' }] });
                await pending;
                vi.useRealTimers();
            }
            const page = await pending;
            expect(page.bestSellers).toMatchObject({ catalog: h.catalog });
            expect(page.products).toEqual([{ id: 'ordinary' }]);
        },
    );
    it('overlaps independent optional deadlines instead of adding a second ranked wait', async () => {
        const h = await homeHarness();
        let products!: (value: { items: Array<{ id: string }> }) => void;
        let ranked!: (value: typeof h.catalog) => void;
        h.list.mockReturnValue(new Promise(resolve => (products = resolve)));
        h.find.mockReturnValue(new Promise(resolve => (ranked = resolve)));
        let settled = false;
        const pending = h.service.read(h.ctx, 'a.test').then(page => {
            settled = true;
            return page;
        });
        try {
            await vi.waitFor(() => expect(h.list).toHaveBeenCalledOnce());
            // The service uses node:timers, which the global fake clock does not own.
            // Check after one real 600ms budget plus guard completion, before two can elapse.
            await new Promise(resolve => setTimeout(resolve, 650));
            expect(settled).toBe(true);
            const page = await pending;
            expect(page.content).toMatchObject({ blocks: [{ type: 'BEST_SELLERS' }] });
            expect(page.failures).toEqual(['products', 'bestSellers']);
            expect(page.products).toBeUndefined();
            expect(page.bestSellers).toBeUndefined();
        } finally {
            products({ items: [{ id: 'late-product' }] });
            ranked(h.catalog);
            await pending;
        }
    });
    it('uses the existing scoped sales catalog and pinned summaries rather than ordinary home products', async () => {
        const h = await homeHarness();
        const page = await h.service.read(h.ctx, 'a.test');
        expect(page.products).toEqual([{ id: 'ordinary' }]);
        expect(page.bestSellers).toEqual({
            catalog: h.catalog,
            candidateCount: 16,
            pinnedProducts: [{ id: 'pinned' }],
            salesByProductId: { 'ranked-low': 2, 'ranked-high': 20 },
        });
        expect(h.find).toHaveBeenCalledWith(h.ctx, { sort: 'SALES', skip: 0, take: 16 });
        expect(h.sales).toHaveBeenCalledWith(h.ctx, ['ranked-low', 'ranked-high']);
        expect(h.byId).toHaveBeenCalledWith(h.ctx, 'pinned');
        expect(page.failures).not.toContain('bestSellers');
    });
    it('leaves failed ranked data absent and records a local failure without failing the page', async () => {
        const h = await homeHarness();
        h.sales.mockRejectedValue(new Error('Sales unavailable'));
        const page = await h.service.read(h.ctx, 'a.test');
        expect(page.bestSellers).toBeUndefined();
        expect(page.failures).toContain('bestSellers');
        expect(page.products).toEqual([{ id: 'ordinary' }]);
    });
    it('does not issue ranked reads when that homepage section is configured off', async () => {
        const h = await homeHarness();
        h.content.mockResolvedValue({
            blocks: [],
            settings: { configuredBlockTypes: ['BEST_SELLERS'] },
        });
        const page = await h.service.read(h.ctx, 'a.test');
        expect(page.bestSellers).toBeUndefined();
        expect(h.sales).not.toHaveBeenCalled();
        expect(h.find).not.toHaveBeenCalled();
        expect(page.failures).not.toContain('bestSellers');
    });
    it('ends the optional ranked wait at the shared deadline without pretending it is an empty success', async () => {
        const h = await homeHarness();
        let complete: (value: Record<string, number>) => void = () => undefined;
        h.sales.mockReturnValue(
            new Promise<Record<string, number>>(resolve => {
                complete = resolve;
            }),
        );
        const page = await h.service.read(h.ctx, 'a.test');
        expect(page.bestSellers).toBeUndefined();
        expect(page.failures).toContain('bestSellers');
        expect(page.products).toEqual([{ id: 'ordinary' }]);
        complete({ 'ranked-low': 2, 'ranked-high': 20 });
        await vi.waitFor(async () => {
            expect(await h.cache.peek(h.ctx, 'home-best-sellers:a.test')).toMatchObject({
                candidateCount: 16,
            });
        });
        expect(page.bestSellers).toBeUndefined();
    });
    it('rejects closure during ranked assembly instead of returning late public data', async () => {
        const h = await homeHarness();
        let complete: (value: Record<string, number>) => void = () => undefined;
        h.sales.mockReturnValue(
            new Promise<Record<string, number>>(resolve => {
                complete = resolve;
            }),
        );
        const result = h.service.read(h.ctx, 'a.test').then(
            () => null,
            error => error,
        );
        await vi.waitFor(() => expect(h.sales).toHaveBeenCalledOnce());
        h.state.mode = 'CLOSED';
        complete({});
        expect(await result).toBeInstanceOf(StorefrontClosedError);
    });
});

describe('private-route public configuration bootstrap', () => {
    async function preparedMediaHarness() {
        const h = accessHarness();
        h.content.mockResolvedValue({
            blocks: [
                {
                    type: 'AUTH_LOGIN',
                    imageUrl: '/assets/preview/login.webp?v=2',
                    title: 'auth body excluded',
                },
                { type: 'AUTH_REGISTER', imageUrl: '/assets/preview/register.webp?v=3' },
            ],
        });
        const read = vi.fn().mockResolvedValue('data:image/webp;base64,AAAA');
        const authorize = vi.fn().mockResolvedValue(true);
        const original = h.modules.get.getMockImplementation();
        if (!original) throw new Error('Expected the module harness implementation');
        h.modules.get.mockImplementation(token => {
            if (token === 'STOREFRONT_PUBLIC_IMAGE_PREVIEW') return { readPublicInlinePreview: read };
            if (token === StorefrontMediaManifestService) return { isPublic: authorize };
            return original(token);
        });
        await h.service.read(h.ctx, 'a.test');
        return { ...h, read, authorize };
    }
    it('prepares published auth hints in the worker cache and peeks only the requested artwork', async () => {
        const h = await preparedMediaHarness();
        expect(h.read).not.toHaveBeenCalled();
        expect((await h.service.peekBoot(h.ctx, 'a.test', 'login'))?.media).toBeUndefined();
        expect(h.read).not.toHaveBeenCalled();
        await h.service.prepareBootMedia(h.ctx, 'a.test');
        expect(h.read).toHaveBeenCalledTimes(2);
        expect(h.authorize).toHaveBeenCalledWith(h.ctx, 'a.test', 'preview/login.webp');
        const login = await h.service.peekBoot(h.ctx, 'a.test', 'login');
        expect(login?.media).toHaveLength(1);
        expect(login?.media?.[0]).toMatchObject({
            kind: 'detail',
            version: '2',
            placeholder: { inlineData: 'data:image/webp;base64,AAAA' },
        });
        expect(login?.media?.[0].identity).toContain('preset=storefront-original-preview');
        if (!login) throw new Error('Expected the prepared login metadata');
        expect(login?.mediaUpdatedAt).toBeLessThanOrEqual(login.generatedAt);
        expect(JSON.stringify(login)).not.toMatch(/auth body excluded|"content"|"products"|"customer"/);
        const register = await h.service.peekBoot(h.ctx, 'a.test', 'register');
        expect(register?.media?.[0].identity).toContain('register.webp');
        expect((await h.service.peekBoot(h.ctx, 'a.test', 'forgot-password'))?.media).toEqual(login?.media);
        expect((await h.service.peekBoot(h.ctx, 'a.test'))?.media).toBeUndefined();
        await h.service.prepareBootMedia(h.ctx, 'a.test');
        expect(h.read).toHaveBeenCalledTimes(2);
        expect(
            await h.service.peekBoot(
                { ...(h.ctx as object), currencyCode: 'CNY' } as never,
                'a.test',
                'login',
            ),
        ).toBeUndefined();
    });
    it('withdraws prepared auth metadata on content invalidation and never transforms from SSI peeks', async () => {
        const h = await preparedMediaHarness();
        await h.service.prepareBootMedia(h.ctx, 'a.test');
        await h.cache.invalidate('a');
        expect(await h.service.peekBoot(h.ctx, 'a.test', 'login')).toBeUndefined();
        h.content.mockResolvedValue({ blocks: [] });
        await h.service.read(h.ctx, 'a.test');
        expect((await h.service.peekBoot(h.ctx, 'a.test', 'login'))?.media).toBeUndefined();
        expect(h.read).toHaveBeenCalledTimes(2);
    });
    it('rejects closure during worker preparation instead of publishing late auth previews', async () => {
        const h = await preparedMediaHarness();
        let release!: (value: string) => void;
        h.read.mockReturnValue(
            new Promise<string>(resolve => {
                release = resolve;
            }),
        );
        const prepared = h.service.prepareBootMedia(h.ctx, 'a.test').then(
            () => undefined,
            error => error,
        );
        await vi.waitFor(() => expect(h.read).toHaveBeenCalled());
        h.state.mode = 'CLOSED';
        release('data:image/webp;base64,AAAA');
        expect(await prepared).toBeInstanceOf(StorefrontClosedError);
        expect(await h.service.peekBoot(h.ctx, 'a.test', 'login')).toBeUndefined();
    });
    it('peeks only already warm config and retains its source age without catalog assembly', async () => {
        const h = accessHarness();
        const ctx = h.ctx as Parameters<typeof h.service.peekBoot>[0];
        const config = { code: 'a', customFields: {}, availableCountries: [] };
        await h.cache.readThrough(ctx, 'config:a.test', 60_000, () => Promise.resolve(config));
        const before = h.config.mock.calls.length;
        const value = await h.service.peekBoot(ctx, 'a.test');
        expect(value).toMatchObject({
            config: { ...config, accessMode: 'LIVE' },
            scope: { host: 'a.test', channelCode: 'a', priceContext: 'public' },
        });
        if (!value) throw new Error('Expected a warm public bootstrap');
        expect(value.configUpdatedAt).toBeLessThanOrEqual(value.generatedAt);
        expect(h.config.mock.calls).toHaveLength(before);
        expect(await h.service.peekBoot(ctx, 'missing.test')).toBeUndefined();
        expect(h.config.mock.calls).toHaveLength(before);
    });
    it('does not reuse customer/session, closed or preview configuration', async () => {
        for (const mode of ['PREVIEW', 'CLOSED'] as const) {
            const blocked = accessHarness(mode);
            expect(await blocked.service.peekBoot(blocked.ctx, 'a.test')).toBeUndefined();
        }
        const h = accessHarness();
        expect(
            await h.service.peekBoot({ ...(h.ctx as object), activeUserId: 'buyer' } as never, 'a.test'),
        ).toBeUndefined();
        expect(
            await h.service.peekBoot({ ...(h.ctx as object), session: {} } as never, 'a.test'),
        ).toBeUndefined();
        expect(h.raw.get).not.toHaveBeenCalled();
    });
    it('rejects channel mismatch and concurrent revision changes between config and visual reads', async () => {
        const h = accessHarness();
        const peek = vi.spyOn(h.cache, 'peekEntry');
        peek.mockResolvedValueOnce({
            value: { code: 'wrong' },
            expiresAt: Date.now() + 60_000,
            revision: 'one',
        }).mockResolvedValueOnce(undefined);
        expect(await h.service.peekBoot(h.ctx, 'a.test')).toBeUndefined();
        peek.mockResolvedValueOnce({
            value: { code: 'a' },
            expiresAt: Date.now() + 60_000,
            revision: 'one',
        }).mockResolvedValueOnce({
            value: { presetId: 'default' },
            expiresAt: Date.now() + 60_000,
            revision: 'two',
        });
        expect(await h.service.peekBoot(h.ctx, 'a.test')).toBeUndefined();
    });
});

describe('authoritative public access modes', () => {
    afterEach(() => vi.restoreAllMocks());

    it('coalesces only an in-flight section guard, then rechecks later phases and hot hits', async () => {
        const h = accessHarness();
        let release!: (mode: 'LIVE') => void;
        const authority = new Promise<'LIVE'>(resolve => {
            release = resolve;
        });
        h.activation.getAccessMode.mockResolvedValueOnce('LIVE').mockReturnValueOnce(authority);
        const result = h.service.read(h.ctx, 'a.test');
        // Every shared section has started while the first completion guard is awaiting authority.
        await vi.waitFor(() => expect(h.cache.metrics.misses).toBeGreaterThanOrEqual(8));
        expect(h.activation.getAccessMode).toHaveBeenCalledTimes(2);
        release('LIVE');
        await result;
        const cold = h.activation.getAccessMode.mock.calls.length;
        expect(cold).toBeGreaterThan(2);
        h.activation.getAccessMode.mockClear();
        await h.service.read(h.ctx, 'a.test');
        const hot = h.activation.getAccessMode.mock.calls.length;
        expect(hot).toBeGreaterThan(1);
        process.stdout.write(
            JSON.stringify({
                event: 'public-access-guard-call-counts',
                cold,
                hot,
                fixture: 'in-memory cache; gated concurrent sections; not SQL counts or production timings',
            }) + '\n',
        );
        h.state.mode = 'CLOSED';
        await expect(h.service.read(h.ctx, 'a.test')).rejects.toMatchObject({ code: 'STOREFRONT_CLOSED' });
    });

    it.each([
        ['ACTIVE', false, true, 'LIVE'],
        ['ACTIVE', false, false, 'CLOSED'],
        ['DRAFT', true, true, 'PREVIEW'],
        ['DRAFT', false, true, 'CLOSED'],
        ['DRAFT', true, false, 'CLOSED'],
        ['SUSPENDED', true, true, 'CLOSED'],
    ] as const)(
        'reads current mode for %s published=%s domain=%s',
        async (status, isPublished, verified, mode) => {
            const profile = { findOne: vi.fn().mockResolvedValue({ status, isPublished }) };
            const domain = { exists: vi.fn().mockResolvedValue(verified) };
            const connection = {
                getRepository: vi.fn().mockReturnValueOnce(profile).mockReturnValue(domain),
            };
            const channels = {
                findOne: vi.fn().mockResolvedValue({ id: 'a' }),
                getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default' }),
            };
            const service = new StorefrontActivationService(connection as never, channels as never);
            expect(await service.getAccessMode(setup().ctx as never)).toBe(mode);
            expect(profile.findOne).toHaveBeenCalledWith(
                expect.objectContaining({ where: { channelId: 'a' } }),
            );
        },
    );

    it('keeps a missing/default channel closed and exposes matching structured error code', async () => {
        const service = new StorefrontActivationService(
            { getRepository: () => ({ findOne: () => Promise.resolve({ status: 'ACTIVE' }) }) } as never,
            {
                findOne: () => Promise.resolve({ id: 'default' }),
                getDefaultChannel: () => Promise.resolve({ id: 'default' }),
            } as never,
        );
        expect(await service.getAccessMode(setup().ctx as never)).toBe('CLOSED');
        const error = new StorefrontClosedError();
        expect(error.code).toBe('STOREFRONT_CLOSED');
        expect(error.extensions.code).toBe('STOREFRONT_CLOSED');
    });

    it('uses all current preview sections without any shared reads/writes, including nested readers', async () => {
        const h = accessHarness('PREVIEW');
        const readThrough = vi.spyOn(h.cache, 'readThrough');
        const first = await h.service.read(h.ctx, 'a.test');
        const second = await h.service.read(h.ctx, 'a.test');
        expect(first.config).toMatchObject({ accessMode: 'PREVIEW', sourceVersion: 1 });
        expect(second.config).toMatchObject({ accessMode: 'PREVIEW', sourceVersion: 2 });
        expect(first.products).toEqual([]);
        expect(first.failures).toEqual([]);
        expect(h.raw.get).not.toHaveBeenCalled();
        expect(h.raw.set).not.toHaveBeenCalled();
        expect(readThrough.mock.calls.every(call => call[1] === 'nested-content')).toBe(true);
        expect(h.invalidate).toHaveBeenCalledTimes(1);
        expect(await h.service.peek(h.ctx, 'a.test')).toBeUndefined();
    });

    it.each(['PREVIEW', 'CLOSED'] as const)(
        'retains %s semantics when Redis invalidation is unavailable',
        async mode => {
            const h = accessHarness(mode);
            h.invalidate.mockRejectedValue(new ServiceUnavailableException('Public cache unavailable'));
            if (mode === 'CLOSED') {
                await expect(h.service.read(h.ctx, 'a.test')).rejects.toMatchObject({
                    code: 'STOREFRONT_CLOSED',
                });
                await expect(h.service.peek(h.ctx, 'a.test')).rejects.toMatchObject({
                    code: 'STOREFRONT_CLOSED',
                });
            } else {
                expect((await h.service.read(h.ctx, 'a.test')).config).toMatchObject({
                    accessMode: 'PREVIEW',
                });
                expect(await h.service.peek(h.ctx, 'a.test')).toBeUndefined();
            }
            expect(h.raw.get).not.toHaveBeenCalled();
            expect(h.raw.set).not.toHaveBeenCalled();
            expect(h.invalidate).toHaveBeenCalledTimes(1);
        },
    );

    it('does not reuse a LIVE snapshot after a downgrade or revive it on the same context after reopening', async () => {
        const h = accessHarness();
        await h.service.read(h.ctx, 'a.test');
        expect(await h.service.peek(h.ctx, 'a.test')).toBeDefined();
        h.state.mode = 'PREVIEW';
        expect(await h.service.peek(h.ctx, 'a.test')).toBeUndefined();
        const preview = await h.service.read(h.ctx, 'a.test');
        expect(preview.config).toMatchObject({ accessMode: 'PREVIEW', sourceVersion: 2 });
        h.state.mode = 'LIVE';
        const reopened = await h.service.read(h.ctx, 'a.test');
        expect(reopened.config).toMatchObject({ accessMode: 'LIVE', sourceVersion: 3 });
        h.state.mode = 'CLOSED';
        await expect(h.service.read(h.ctx, 'a.test')).rejects.toMatchObject({ code: 'STOREFRONT_CLOSED' });
        await expect(h.service.peek(h.ctx, 'a.test')).rejects.toMatchObject({ code: 'STOREFRONT_CLOSED' });
        expect(h.invalidate).toHaveBeenCalledTimes(2);
    });

    it.each(['read', 'peek'] as const)(
        'rechecks current state after a %s cache hit before returning',
        async operation => {
            const h = accessHarness();
            await h.service.read(h.ctx, 'a.test');
            const original = h.raw.get.getMockImplementation();
            if (!original) throw new Error('Missing cache fixture');
            h.raw.get.mockImplementationOnce(key => {
                h.state.mode = 'CLOSED';
                return original(key);
            });
            await expect(h.service[operation](h.ctx, 'a.test')).rejects.toMatchObject({
                code: 'STOREFRONT_CLOSED',
            });
        },
    );

    it.each(['read', 'peek'] as const)(
        'does not revive a prior generation when closure/reopening races with %s authorization',
        async operation => {
            const h = accessHarness();
            await h.service.read(h.ctx, 'a.test');
            h.activation.getAccessMode.mockResolvedValueOnce('LIVE').mockImplementationOnce(async () => {
                // Both status transitions are already committed before this authority lookup completes.
                await h.cache.invalidate('a');
                return 'LIVE';
            });
            const result = await h.service[operation](h.ctx, 'a.test');
            if (operation === 'peek') expect(result).toBeUndefined();
            else expect(result?.config).toMatchObject({ sourceVersion: 2, accessMode: 'LIVE' });
        },
    );

    it('keeps preview assembly bounded after real optional section budgets have returned responses', async () => {
        const h = accessHarness('PREVIEW');
        let release!: (value: unknown[]) => void;
        const optional = new Promise<unknown[]>(resolve => {
            release = resolve;
        });
        vi.spyOn(
            h.service as unknown as { loadCollections(): Promise<unknown[]> },
            'loadCollections',
        ).mockReturnValue(optional);
        const first = await Promise.all(Array.from({ length: 4 }, () => h.service.read(h.ctx, 'a.test')));
        expect(first.every(page => page.failures.includes('collections'))).toBe(true);
        expect(h.config).toHaveBeenCalledTimes(4);
        const next = h.service.read(h.ctx, 'a.test');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(h.config).toHaveBeenCalledTimes(4);
        release([]);
        expect((await next).failures).toEqual([]);
        expect(h.config).toHaveBeenCalledTimes(5);
        expect(h.raw.set).not.toHaveBeenCalled();
    });

    it('holds preview ownership for a pending content source after a sibling rejects immediately', async () => {
        const h = accessHarness('PREVIEW');
        h.content.mockRestore();
        let release!: (value: unknown[]) => void;
        const slow = new Promise<unknown[]>(resolve => {
            release = resolve;
        });
        h.sources.content.findPublished.mockReturnValue(slow);
        h.sources.auth.get.mockRejectedValue(new Error('auth settings unavailable'));
        const first = await Promise.all(Array.from({ length: 4 }, () => h.service.read(h.ctx, 'a.test')));
        expect(first.every(page => page.failures.includes('content'))).toBe(true);
        expect(h.sources.content.findPublished).toHaveBeenCalledTimes(4);
        const fifth = h.service.read(h.ctx, 'a.test');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(h.sources.content.findPublished).toHaveBeenCalledTimes(4);
        release([]);
        await fifth;
        expect(h.sources.content.findPublished).toHaveBeenCalledTimes(5);
        expect(h.raw.set).not.toHaveBeenCalled();
    });

    it('owns a pending route read after required config fails and releases only when that route settles', async () => {
        const h = accessHarness('PREVIEW');
        let release!: (value: { items: unknown[]; totalItems: number }) => void;
        const route = new Promise<{ items: unknown[]; totalItems: number }>(resolve => {
            release = resolve;
        });
        const find = vi.fn(() => route);
        const modules = h.modules.get.getMockImplementation();
        if (!modules) throw new Error('Missing module fixture');
        const { PUBLIC_CATALOG_READER } = await import('./public-catalog-reader.js');
        h.modules.get.mockImplementation(token =>
            token === PUBLIC_CATALOG_READER ? { find } : modules(token),
        );
        h.config.mockRejectedValue(new Error('required config unavailable'));
        // An explicit category starts in parallel; the default category must wait
        // for the published navigation before it can own a catalog read.
        const request = { kind: 'catalog', input: { collectionId: 'chosen-category' } } as const;
        const first = await Promise.allSettled(
            Array.from({ length: 4 }, () => h.service.read(h.ctx, 'a.test', request)),
        );
        expect(first.every(result => result.status === 'rejected')).toBe(true);
        expect(find).toHaveBeenCalledTimes(4);
        const fifth = h.service.read(h.ctx, 'a.test', request);
        const failed = expect(fifth).rejects.toThrow('required config unavailable');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(find).toHaveBeenCalledTimes(4);
        release({ items: [], totalItems: 0 });
        await failed;
        expect(find).toHaveBeenCalledTimes(5);
    });

    it('rejects in-flight LIVE fills after closure, including optional work finishing after the page budget', async () => {
        const h = accessHarness();
        let release!: (value: unknown[]) => void;
        const gate = new Promise<unknown[]>(resolve => {
            release = resolve;
        });
        vi.spyOn(
            h.service as unknown as { loadCollections(): Promise<unknown[]> },
            'loadCollections',
        ).mockReturnValue(gate);
        const page = await h.service.read(h.ctx, 'a.test');
        expect(page.failures).toContain('collections');
        h.state.mode = 'CLOSED';
        await expect(h.service.peek(h.ctx, 'a.test')).rejects.toMatchObject({ code: 'STOREFRONT_CLOSED' });
        const writes = h.raw.set.mock.calls.length;
        release([{ name: 'revoked collection' }]);
        await gate;
        await vi.waitFor(async () => {
            expect(await h.cache.peek(h.ctx, 'collections:a.test')).toBeUndefined();
            expect(h.raw.set).toHaveBeenCalledTimes(writes);
        });
        h.state.mode = 'LIVE';
        expect(await h.service.peek(h.ctx, 'a.test')).toBeUndefined();
    });

    it('reassembles a LIVE-to-PREVIEW in-flight response without filling the new cache generation', async () => {
        const h = accessHarness();
        let release!: (value: object) => void;
        const gate = new Promise<object>(resolve => {
            release = resolve;
        });
        h.config.mockReturnValueOnce(gate);
        const result = h.service.read(h.ctx, 'a.test');
        await vi.waitFor(() => expect(h.config).toHaveBeenCalled());
        h.state.mode = 'PREVIEW';
        await h.service.getAccessMode(h.ctx);
        release({ code: 'a', sourceVersion: 'old' });
        const page = await result;
        expect(page.config).toMatchObject({ accessMode: 'PREVIEW', sourceVersion: 1 });
        expect(await h.cache.peek(h.ctx, 'config:a.test')).toBeUndefined();
        expect(await h.service.peek(h.ctx, 'a.test')).toBeUndefined();
    });
});

describe('public page optional section budgets', () => {
    afterEach(() => vi.restoreAllMocks());

    it.each(['LIVE', 'PREVIEW'] as const)(
        'awaits required published content beyond the optional budget in %s',
        async mode => {
            const h = accessHarness(mode);
            let complete!: (value: unknown) => void;
            const content = new Promise(resolve => {
                complete = resolve;
            });
            h.content.mockReturnValue(content);
            let settled = false;
            const result = h.service.read(h.ctx, 'a.test').finally(() => {
                settled = true;
            });

            await new Promise(resolve => setTimeout(resolve, 700));
            expect(h.content).toHaveBeenCalledTimes(1);
            const completedBeforeContent = settled;
            complete({ blocks: [{ title: 'Published title', body: 'Published body' }] });
            const page = await result;

            expect(completedBeforeContent).toBe(false);
            expect(page.content).toMatchObject({
                blocks: [{ title: 'Published title', body: 'Published body' }],
            });
            expect(page.failures).not.toContain('content');
        },
    );

    it.each(['LIVE', 'PREVIEW'] as const)(
        'still rejects closure while required content is pending in %s',
        async mode => {
            const h = accessHarness(mode);
            let complete!: (value: unknown) => void;
            const content = new Promise(resolve => {
                complete = resolve;
            });
            h.content.mockReturnValue(content);
            const result = h.service.read(h.ctx, 'a.test').then(
                () => undefined,
                error => error,
            );

            await new Promise(resolve => setTimeout(resolve, 700));
            expect(h.content).toHaveBeenCalledTimes(1);
            h.state.mode = 'CLOSED';
            complete({ blocks: [{ title: 'Do not expose after closure' }] });
            expect(await result).toBeInstanceOf(StorefrontClosedError);
        },
    );

    it.each(['LIVE', 'PREVIEW'] as const)(
        'keeps an actual required content failure explicit in %s',
        async mode => {
            const h = accessHarness(mode);
            h.content.mockRejectedValue(new Error('published content unavailable'));
            const page = await h.service.read(h.ctx, 'a.test');
            expect(page.failures).toContain('content');
            expect(page).not.toHaveProperty('content');
        },
    );

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
                    if (token === Symbol.for('vendure.public-catalog-reader'))
                        return {
                            find: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
                            sales: vi.fn().mockResolvedValue({}),
                        };
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
                {
                    readThrough: vi.fn((_ctx, _key, _ttl, load: () => Promise<unknown>) => load()),
                    runGuarded: (_guard: unknown, load: () => Promise<unknown>) => load(),
                    trackSource: (load: () => Promise<unknown>) => load(),
                } as never,
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
                activation('LIVE') as never,
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
    it('does not reuse a previous runtime snapshot with the old unscoped default catalog', async () => {
        const h = accessHarness();
        const request = { kind: 'catalog', input: {} } as const;
        await h.cache.readThrough(h.ctx, `page:v2:a.test:${publicPageRequestKey(request)}`, 30_000, () =>
            Promise.resolve({ config: { accessMode: 'LIVE' }, catalog: { items: [], totalItems: 47 } }),
        );
        vi.spyOn(
            h.service as unknown as { loadCollections(): Promise<unknown[]> },
            'loadCollections',
        ).mockResolvedValue([{ id: 'actual-first', productVariantCount: 11 }]);
        const find = vi.fn(() =>
            Promise.resolve({ items: [{ id: 'actual-first-product' }], totalItems: 11 }),
        );
        const original = h.modules.get.getMockImplementation();
        if (!original) throw new Error('Missing module harness');
        h.modules.get.mockImplementation(token =>
            token === PUBLIC_CATALOG_ROUTE_READER ? { find } : original(token),
        );
        const page = await h.service.read(h.ctx, 'a.test', request);
        expect(find).toHaveBeenCalledOnce();
        expect(page.catalog).toEqual({ items: [{ id: 'actual-first-product' }], totalItems: 11 });
    });
    it('does not query an unscoped default catalog when required common data fails', async () => {
        const h = accessHarness();
        h.config.mockRejectedValue(new Error('required config unavailable'));
        const find = vi.fn(() => Promise.resolve({ items: [], totalItems: 0 }));
        const original = h.modules.get.getMockImplementation();
        if (!original) throw new Error('Missing module harness');
        h.modules.get.mockImplementation(token =>
            token === PUBLIC_CATALOG_ROUTE_READER ? { find } : original(token),
        );
        await expect(h.service.read(h.ctx, 'a.test', { kind: 'catalog', input: {} })).rejects.toThrow(
            'required config unavailable',
        );
        expect(find).not.toHaveBeenCalled();
    });
    it.each(['first-store', 'second-store'])(
        'queries the actual default category for %s without relabelling all-store results',
        async channel => {
            const h = accessHarness();
            const ctx = {
                ...(h.ctx as object),
                channelId: channel,
                channel: { ...setup().ctx.channel, id: channel, code: channel },
            };
            h.config.mockResolvedValue({ code: channel });
            vi.spyOn(
                h.service as unknown as { loadCollections(): Promise<unknown[]> },
                'loadCollections',
            ).mockResolvedValue([
                { id: 'empty', productVariantCount: 0 },
                { id: `${channel}-first`, productVariantCount: 11 },
                { id: `${channel}-second`, productVariantCount: 36 },
            ]);
            const find = vi.fn((_ctx: unknown, input: { collectionId?: string }) =>
                Promise.resolve({
                    items: [{ id: input.collectionId ?? 'all-store-result' }],
                    totalItems: input.collectionId ? 11 : 47,
                }),
            );
            const original = h.modules.get.getMockImplementation();
            if (!original) throw new Error('Missing module harness');
            h.modules.get.mockImplementation(token =>
                token === PUBLIC_CATALOG_ROUTE_READER ? { find } : original(token),
            );
            const page = await h.service.read(ctx as never, `${channel}.test`, {
                kind: 'catalog',
                input: { take: 12 },
            });
            expect(find).toHaveBeenCalledExactlyOnceWith(
                ctx,
                expect.objectContaining({ collectionId: `${channel}-first`, take: 12 }),
            );
            expect(page.catalog).toEqual({ items: [{ id: `${channel}-first` }], totalItems: 11 });
            expect(page.request?.kind).toBe('catalog');
            expect(page.requestKey).not.toContain('collectionId');
            expect(page.route).toBe('/category');
        },
    );
    it.each([
        { path: '/category', collectionId: 'chosen-child', expected: 'chosen-child' },
        { path: '/search', collectionId: undefined, expected: undefined },
        { path: '/search', collectionId: 'all', expected: undefined },
        { path: '/search', collectionId: 'chosen-search', expected: 'chosen-search' },
    ] as const)('preserves explicit category/search scope $path $collectionId', async scenario => {
        const h = accessHarness();
        vi.spyOn(
            h.service as unknown as { loadCollections(): Promise<unknown[]> },
            'loadCollections',
        ).mockResolvedValue([{ id: 'unselected-first', productVariantCount: 10 }]);
        const find = vi.fn((_ctx: unknown, _input: { collectionId?: string; term?: string }) =>
            Promise.resolve({ items: [], totalItems: 0 }),
        );
        const original = h.modules.get.getMockImplementation();
        if (!original) throw new Error('Missing module harness');
        h.modules.get.mockImplementation(token =>
            token === PUBLIC_CATALOG_ROUTE_READER ? { find } : original(token),
        );
        await h.service.read(h.ctx, 'a.test', {
            kind: 'catalog',
            path: scenario.path,
            input: {
                collectionId: scenario.collectionId,
                term: scenario.path === '/search' ? 'query' : undefined,
            },
        });
        expect(find).toHaveBeenCalledOnce();
        expect(find.mock.calls[0][0]).toBe(h.ctx);
        expect(find.mock.calls[0][1].collectionId).toBe(scenario.expected);
        expect(find.mock.calls[0][1].term).toBe(scenario.path === '/search' ? 'query' : undefined);
    });
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
                {
                    readThrough: vi.fn((_ctx, _key, _ttl, load: () => Promise<unknown>) => load()),
                    runGuarded: (_guard: unknown, load: () => Promise<unknown>) => load(),
                    trackSource: (load: () => Promise<unknown>) => load(),
                } as never,
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
                activation('LIVE') as never,
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
            expect(result.request?.kind).toBe(kind);
            expect(result.requestKey).toContain(`"kind":"${kind}"`);
            expect(result.route).toBe(kind === 'product' ? '/product?id=p' : '/category');
        },
    );
});

it('shares timed-out optional source reads across different public page assemblies and caches their later completion', async () => {
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
                return {
                    find: vi.fn(() => Promise.resolve({ items: [], totalItems: 0 })),
                    sales: vi.fn().mockResolvedValue({}),
                };
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
        activation('LIVE') as never,
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
