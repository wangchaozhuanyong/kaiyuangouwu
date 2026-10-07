import { ServiceUnavailableException } from '@nestjs/common';
import { ForbiddenError, PUBLIC_PRODUCT_SUMMARY_READER } from '@vendure/core';
import {
    StorefrontAccountSettingsService,
    StorefrontVisualPresetService,
} from '@vendure/storefront-content-plugin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontPublicCacheService } from './performance/storefront-public-cache.service';
import { StorefrontActivationService, StorefrontClosedError } from './storefront-activation.service';
import { parsePublicPageRequest, StorefrontPublicPageController } from './storefront-public-page.controller';
import { publicSectionWithinBudget, StorefrontPublicPageService } from './storefront-public-page.service';

const response = () => {
    const res = { setHeader: vi.fn(), status: vi.fn(), end: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
};

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
            { getAccessMode: vi.fn().mockResolvedValue('LIVE') } as never,
        );
        expect(() => service.read({ apiType: 'shop', activeUserId: 'customer' } as never, 'a.test')).toThrow(
            'anonymous',
        );
    });
});

function accessHarness(initial: 'LIVE' | 'PREVIEW' | 'CLOSED' = 'LIVE') {
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
        { systemOptions: { cacheStrategy: {} } } as never,
    );
    const invalidate = vi.spyOn(cache, 'invalidate');
    const activation = { getAccessMode: vi.fn(() => Promise.resolve(state.mode)) };
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
        get: vi.fn(token => {
            if (token === StorefrontAccountSettingsService) return sources.account;
            if (token === PUBLIC_PRODUCT_SUMMARY_READER)
                return {
                    list: vi.fn().mockResolvedValue({ items: [] }),
                    detail: vi.fn().mockResolvedValue({ id: 'p' }),
                };
            return {
                get: vi.fn().mockResolvedValue({ presetId: 'default' }),
                find: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
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
        activation as never,
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
        activation,
        state,
        config,
        content,
        sources,
        modules,
        ctx: setup().ctx as never,
    };
}

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
        let release!: (value: object) => void;
        const optional = new Promise<object>(resolve => {
            release = resolve;
        });
        h.content.mockReturnValue(optional);
        const first = await Promise.all(Array.from({ length: 4 }, () => h.service.read(h.ctx, 'a.test')));
        expect(first.every(page => page.failures.includes('content'))).toBe(true);
        expect(h.config).toHaveBeenCalledTimes(4);
        const next = h.service.read(h.ctx, 'a.test');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(h.config).toHaveBeenCalledTimes(4);
        release({ blocks: [] });
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
        const { PUBLIC_CATALOG_READER } = await import('./public-catalog-reader');
        h.modules.get.mockImplementation(token =>
            token === PUBLIC_CATALOG_READER ? ({ find } as never) : modules(token),
        );
        h.config.mockRejectedValue(new Error('required config unavailable'));
        const request = { kind: 'catalog', input: {} } as const;
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
        let release!: (value: object) => void;
        const gate = new Promise<object>(resolve => {
            release = resolve;
        });
        h.content.mockReturnValue(gate);
        const page = await h.service.read(h.ctx, 'a.test');
        expect(page.failures).toContain('content');
        h.state.mode = 'CLOSED';
        await expect(h.service.peek(h.ctx, 'a.test')).rejects.toMatchObject({ code: 'STOREFRONT_CLOSED' });
        const writes = h.raw.set.mock.calls.length;
        release({ blocks: [{ title: 'revoked content' }] });
        await gate;
        await vi.waitFor(async () => {
            expect(await h.cache.peek(h.ctx, 'content:a.test')).toBeUndefined();
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
                { getAccessMode: vi.fn().mockResolvedValue('LIVE') } as never,
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
                { getAccessMode: vi.fn().mockResolvedValue('LIVE') } as never,
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
    const { PUBLIC_CATALOG_READER } = await import('./public-catalog-reader');
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
        { getAccessMode: vi.fn().mockResolvedValue('LIVE') } as never,
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
