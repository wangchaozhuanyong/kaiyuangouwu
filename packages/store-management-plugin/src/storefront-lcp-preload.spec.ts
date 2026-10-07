import { ForbiddenError } from '@vendure/core';
import { mediaDescriptor, STOREFRONT_IMAGE_SIZES } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontClosedError } from './storefront-activation.service';
import { StorefrontLcpPreloadController } from './storefront-lcp-preload.controller';
import {
    renderHeroPreloadLink,
    renderStorefrontIconLinks,
    StorefrontLcpPreloadService,
} from './storefront-lcp-preload.service';

vi.mock('@vendure/storefront-content-plugin', async () => {
    const responsiveImage = await import('../../storefront-content-plugin/src/shared/responsive-image.js');
    const icons = await import('../../storefront-content-plugin/src/shared/storefront-icons.js');
    const pageData = await import('../../storefront-content-plugin/src/shared/public-page-data.js');
    const { storefrontContentPermission } = await import('../../storefront-content-plugin/src/constants.js');
    return {
        ...responsiveImage,
        ...icons,
        ...pageData,
        storefrontContentPermission,
        StorefrontContentService: class StorefrontContentService {},
        StorefrontAuthSettingsService: class StorefrontAuthSettingsService {},
    };
});

function responseMock() {
    const response = {
        setHeader: vi.fn(),
        status: vi.fn(),
        type: vi.fn(),
        send: vi.fn(),
        json: vi.fn(),
    };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    response.send.mockReturnValue(response);
    return response;
}

describe('storefront LCP preload', () => {
    it.each(['PREVIEW', undefined])('refuses SSI reuse for access metadata %s', async accessMode => {
        const pages = { peek: vi.fn().mockResolvedValue({ config: { accessMode }, media: [] }) };
        const service = new StorefrontLcpPreloadService(pages as never, {} as never);
        expect(await service.render({ channelId: 'a' } as never, 'a.test')).toBe('');
    });

    it.each([new ForbiddenError(), new StorefrontClosedError()])(
        'returns structured no-store 403 on closed SSI',
        async error => {
            const access = { resolveRequest: vi.fn().mockRejectedValue(error) };
            const preload = { render: vi.fn() };
            const controller = new StorefrontLcpPreloadController(access as never, preload as never);
            const res = responseMock();
            await controller.preload({ headers: {} } as never, res as never);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                errorCode: 'STOREFRONT_CLOSED',
                message: 'Storefront is closed',
            });
            expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
            expect(preload.render).not.toHaveBeenCalled();
        },
    );

    it('maps a late authoritative SSI denial without swallowing origin faults', async () => {
        const access = { resolveRequest: vi.fn().mockResolvedValue({ ctx: {}, host: 'a.test' }) };
        const preload = { render: vi.fn().mockRejectedValue(new StorefrontClosedError()) };
        const controller = new StorefrontLcpPreloadController(access as never, preload as never);
        const res = responseMock();
        await controller.preload({ headers: {} } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            errorCode: 'STOREFRONT_CLOSED',
            message: 'Storefront is closed',
        });
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
        expect(res.status).not.toHaveBeenCalledWith(200);
        preload.render.mockRejectedValue(new Error('origin unavailable'));
        await expect(controller.preload({ headers: {} } as never, responseMock() as never)).rejects.toThrow(
            'origin unavailable',
        );
    });
    it('renders the same responsive hero candidates consumed by the storefront', () => {
        const link = renderHeroPreloadLink('/assets/preview/hero.png');

        expect(link).toContain('rel="preload"');
        expect(link).toContain('as="image"');
        expect(link).toContain('fetchpriority="high"');
        expect(link).toContain('preset=storefront-hero-fit-480&amp;format=webp&amp;q=90 480w');
        expect(link).toContain('preset=storefront-hero-fit-1600&amp;format=webp&amp;q=90');
        expect(link).toContain('imagesizes="(min-width: 1024px) 850px, calc(100vw - 20px)"');
    });

    it('preloads the published phone and desktop HERO only at their respective viewport widths', async () => {
        const desktop = '/assets/preview/desktop.webp?v=desktop-2';
        const phone = '/assets/preview/phone.webp?v=phone-3';
        const page = {
            config: { accessMode: 'LIVE' },
            content: {
                blocks: [
                    { type: 'HERO', enabled: false, imageUrl: '/assets/preview/disabled.webp' },
                    {
                        type: 'HERO',
                        imageUrl: '',
                        settings: { mobileImageUrl: '/assets/preview/empty.webp' },
                    },
                    { type: 'HERO', imageUrl: desktop, settings: { mobileImageUrl: phone } },
                    {
                        type: 'HERO',
                        imageUrl: '/assets/preview/later.webp',
                        settings: { mobileImageUrl: '/assets/preview/later-phone.webp' },
                    },
                ],
            },
            media: [
                mediaDescriptor(desktop, 'hero'),
                mediaDescriptor(phone, 'hero'),
                ...['disabled', 'empty', 'later', 'later-phone'].map(name =>
                    mediaDescriptor(`/assets/preview/${name}.webp`, 'hero'),
                ),
            ],
        };
        const pages = { peek: vi.fn().mockResolvedValue(page), read: vi.fn() };
        const service = new StorefrontLcpPreloadService(pages as never, {} as never);
        const fragment = await service.render({ channelId: 'a' } as never, 'shop.example');
        const links = fragment.split('\n').filter(line => line.includes('rel="preload"'));
        expect(links).toHaveLength(2);
        expect(links.find(line => line.includes('phone.webp'))).toContain('media="(max-width: 767px)"');
        expect(links.find(line => line.includes('desktop.webp'))).toContain('media="(min-width: 768px)"');
        expect(links.join('\n')).toContain('v=phone-3&amp;preset=storefront-hero-fit-480');
        expect(links.join('\n')).toContain('v=desktop-2&amp;preset=storefront-hero-fit-1600');
        expect(links.join('\n')).not.toMatch(/disabled\.webp|empty\.webp|later(?:-phone)?\.webp/);
        expect(pages.read).not.toHaveBeenCalled();
    });

    it.each([
        '/assets/preview/not-published.webp',
        'https://other.example/assets/preview/phone.webp',
        '/assets/cache/private.webp',
        '/assets/source/%2e%2e/private.webp',
        'https://user:password@shop.example/assets/preview/phone.webp',
        '/storefront/phone.webp',
    ])('does not preload an unauthorized phone binding %s', async mobileImageUrl => {
        const desktop = '/assets/preview/desktop.webp';
        const page = {
            config: { accessMode: 'LIVE' },
            content: { blocks: [{ type: 'HERO', imageUrl: desktop, settings: { mobileImageUrl } }] },
            media: [mediaDescriptor(desktop, 'hero')],
        };
        const service = new StorefrontLcpPreloadService(
            { peek: vi.fn().mockResolvedValue(page) } as never,
            {} as never,
        );
        const links = (await service.render({ channelId: 'a' } as never, 'shop.example'))
            .split('\n')
            .filter(line => line.includes('rel="preload"'));
        expect(links).toEqual([renderHeroPreloadLink(desktop)]);
    });

    it.each([undefined, '', '/assets/preview/desktop.webp'])(
        'keeps a single unconditional hint without a distinct phone image %s',
        async mobileImageUrl => {
            const desktop = '/assets/preview/desktop.webp';
            const page = {
                config: { accessMode: 'LIVE' },
                content: { blocks: [{ type: 'HERO', imageUrl: desktop, settings: { mobileImageUrl } }] },
                media: [mediaDescriptor(desktop, 'hero')],
            };
            const service = new StorefrontLcpPreloadService(
                { peek: vi.fn().mockResolvedValue(page) } as never,
                {} as never,
            );
            const links = (await service.render({ channelId: 'a' } as never, 'shop.example'))
                .split('\n')
                .filter(line => line.includes('rel="preload"'));
            expect(links).toEqual([renderHeroPreloadLink(desktop)]);
        },
    );

    it('keeps the legacy desktop alias unguessed while preloading an authorized phone candidate', async () => {
        const desktop = '/storefront/hero-legacy.png';
        const phone = '/assets/preview/phone.webp';
        const page = {
            config: { accessMode: 'LIVE' },
            content: { blocks: [{ type: 'HERO', imageUrl: desktop, settings: { mobileImageUrl: phone } }] },
            media: [mediaDescriptor(desktop, 'hero'), mediaDescriptor(phone, 'hero')],
        };
        const service = new StorefrontLcpPreloadService(
            { peek: vi.fn().mockResolvedValue(page) } as never,
            {} as never,
        );
        const links = (await service.render({ channelId: 'a' } as never, 'shop.example'))
            .split('\n')
            .filter(line => line.includes('rel="preload"'));
        expect(links).toHaveLength(1);
        expect(links[0]).toContain('phone.webp');
        expect(links[0]).toContain('media="(max-width: 767px)"');
        expect(links[0]).not.toContain('/storefront/');
    });

    it('escapes external managed image URLs before emitting HTML', () => {
        const link = renderHeroPreloadLink('https://cdn.example/hero.jpg?a=1&b=&quot;unsafe');

        expect(link).toContain('href="https://cdn.example/hero.jpg?a=1&amp;b=&amp;quot;unsafe"');
        expect(link).not.toContain('imagesrcset=');
    });

    it('only reads a fast snapshot and never starts assembly on an SSI miss', async () => {
        const pages = { peek: vi.fn().mockResolvedValue(undefined), read: vi.fn() };
        const cache = { invalidate: vi.fn().mockResolvedValue(undefined) };
        const service = new StorefrontLcpPreloadService(pages as never, cache as never);
        expect(await service.render({ channelId: 'store-a' } as never, 'store-a.test')).toBe('');
        expect(pages.read).not.toHaveBeenCalled();
        await service.invalidate('store-a');
        expect(cache.invalidate).toHaveBeenCalledWith('store-a');
    });

    it('renders only the host-scoped snapshot and inert escaped JSON', async () => {
        const pages = {
            peek: vi.fn((ctx: { channelId: string }, host: string) =>
                Promise.resolve({
                    schemaVersion: 1,
                    version: 'v1',
                    generatedAt: 1,
                    scope: {
                        host,
                        channelCode: ctx.channelId,
                        languageCode: 'en',
                        currencyCode: 'MYR',
                        priceContext: 'public',
                    },
                    route: '/',
                    config: {
                        accessMode: 'LIVE',
                        logoUrl: `/assets/preview/${ctx.channelId}.webp`,
                        description: '</script><script>alert(1)</script>',
                    },
                    content: {
                        blocks: [
                            {
                                type: 'HERO',
                                enabled: true,
                                imageUrl: '/assets/preview/hero__webp_migrated_1.webp',
                            },
                        ],
                    },
                    media: [
                        {
                            kind: 'hero',
                            identity: '/assets/preview/hero__webp_migrated_1.webp?v=webp-readable-1',
                        },
                    ],
                    failures: [],
                }),
            ),
        };
        const service = new StorefrontLcpPreloadService(pages as never, {} as never);
        const fragment = await service.render({ channelId: 'store-a' } as never, 'store-a.test');
        expect(pages.peek).toHaveBeenCalledWith({ channelId: 'store-a' }, 'store-a.test', { kind: 'home' });
        expect(fragment).toContain('storefront-public-page-data');
        expect(fragment).toContain('v=webp-readable-1');
        expect(fragment).not.toContain('<script>alert');
        expect(fragment).not.toContain('store-b');
        const serialized = fragment.match(/type="application\/json">([\s\S]*?)<\/script>/)?.[1];
        expect(JSON.parse(serialized ?? '').config.description).toBe('</script><script>alert(1)</script>');
    });

    it('does not preload support banners when there is no published home hero', async () => {
        const page = {
            config: { accessMode: 'LIVE' },
            content: { blocks: [{ type: 'SUPPORT', imageUrl: '/assets/preview/support.webp' }] },
            media: [{ kind: 'hero', identity: '/assets/preview/support.webp' }],
        };
        const service = new StorefrontLcpPreloadService(
            { peek: vi.fn().mockResolvedValue(page) } as never,
            {} as never,
        );
        expect(await service.render({ channelId: 'store-a' } as never, 'store-a.test')).not.toContain(
            'rel="preload"',
        );
    });

    it('uses a neutral icon for an unconfigured store and escapes URL attributes', () => {
        expect(renderStorefrontIconLinks(null)).toContain('/storefront/neutral-store.png?storefront-icon=2');
        const html = renderStorefrontIconLinks('https://cdn.example/logo.png?label=\"<image>&a=1');
        expect(html).toContain('&amp;');
        expect(html).not.toContain('"<image>');
        expect(html).toContain('data-storefront-icon="server"');
    });

    it('fails closed with an empty fragment when the host has no active store', async () => {
        const controller = new StorefrontLcpPreloadController(
            { resolveRequest: vi.fn().mockResolvedValue(null) } as never,
            { render: vi.fn() } as never,
        );
        const response = responseMock();

        await controller.preload({} as never, response as never);

        expect(response.status).toHaveBeenCalledWith(204);
        expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
    });

    it('returns only the resolved preload fragment for an active store', async () => {
        const ctx = { channelId: 'store-a' };
        const controller = new StorefrontLcpPreloadController(
            { resolveRequest: vi.fn().mockResolvedValue({ ctx }) } as never,
            { render: vi.fn().mockResolvedValue('<link preload />') } as never,
        );
        const response = responseMock();

        await controller.preload({} as never, response as never);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.type).toHaveBeenCalledWith('text/html');
        expect(response.send).toHaveBeenCalledWith('<link preload />');
    });

    it('forwards only a trusted public route and validated preferences to its snapshot', async () => {
        const scoped = { channelId: 'a', languageCode: 'zh_Hans', currencyCode: 'CNY' };
        const ctx = {
            channel: { availableCurrencyCodes: ['CNY', 'MYR'] },
            languageCode: 'en',
            currencyCode: 'MYR',
            copy: vi.fn(() => scoped),
        };
        const render = vi.fn().mockResolvedValue('<link />');
        const controller = new StorefrontLcpPreloadController(
            { resolveRequest: vi.fn().mockResolvedValue({ ctx, host: 'a.test' }) } as never,
            { render } as never,
        );
        const request = {
            socket: { remoteAddress: '127.0.0.1' },
            headers: {
                'x-storefront-original-uri': '/category?collectionId=parent&childId=child&sort=newest',
                'x-storefront-language': 'zh_Hans',
                'x-storefront-currency': 'CNY',
                cookie: 'private-cookie',
                authorization: 'private-token',
            },
        };
        await controller.preload(request as never, responseMock() as never);
        expect(ctx.copy).toHaveBeenCalledWith({ languageCode: 'zh_Hans', currencyCode: 'CNY' });
        expect(render).toHaveBeenCalledWith(
            scoped,
            'a.test',
            {
                kind: 'catalog',
                path: '/category',
                input: {
                    collectionId: 'child',
                    sort: 'NEWEST',
                    inStockOnly: false,
                    skip: 0,
                    take: 12,
                },
            },
            { primaryCollectionId: 'parent' },
        );
        render.mockClear();
        await controller.preload(
            { ...request, socket: { remoteAddress: '203.0.113.1' } } as never,
            responseMock() as never,
        );
        expect(render).not.toHaveBeenCalled();
        await controller.preload(
            {
                ...request,
                headers: { ...request.headers, 'x-storefront-original-uri': '/checkout' },
            } as never,
            responseMock() as never,
        );
        expect(render).not.toHaveBeenCalled();
        await controller.preload(
            { ...request, headers: { ...request.headers, 'x-storefront-currency': 'USD' } } as never,
            responseMock() as never,
        );
        expect(render).not.toHaveBeenCalled();
    });

    it.each([
        ['parent', '/category', true],
        ['child', '/category', false],
        ['empty-parent', '/category', false],
        ['leaf', '/category', false],
        ['all', '/category', false],
        ['parent', '/search', false],
    ] as const)(
        'matches actual mobile sidebar geometry for %s at %s',
        async (primaryCollectionId, path, sidebar) => {
            const source = '/assets/preview/product.png';
            const page = {
                config: { accessMode: 'LIVE' },
                media: [],
                catalog: { items: [{ featuredAsset: { preview: source } }] },
                collections: [
                    {
                        id: 'parent',
                        productVariantCount: 1,
                        children: [{ id: 'child', productVariantCount: 1 }],
                    },
                    {
                        id: 'empty-parent',
                        productVariantCount: 1,
                        children: [{ id: 'hidden-child', productVariantCount: 0 }],
                    },
                    { id: 'leaf', productVariantCount: 1 },
                ],
            };
            const service = new StorefrontLcpPreloadService(
                { peek: vi.fn().mockResolvedValue(page) } as never,
                {} as never,
            );
            const fragment = await service.render(
                { channelId: 'a' } as never,
                'a.test',
                { kind: 'catalog', path, input: { collectionId: 'child' } },
                { primaryCollectionId },
            );
            const mobile = fragment.split('\n').find(line => line.includes('media="(max-width: 1023px)"'));
            const sizes = sidebar
                ? STOREFRONT_IMAGE_SIZES.categorySidebarRow
                : STOREFRONT_IMAGE_SIZES.productRow;
            const descriptor = mediaDescriptor(source, 'card', { sizes });
            expect(mobile).toContain(`imagesizes="${descriptor.sizes}"`);
            expect(mobile).toContain(`imagesrcset="${descriptor.srcSet?.replace(/&/gu, '&amp;')}"`);
            const desktop = fragment.split('\n').find(line => line.includes('media="(min-width: 1024px)"'));
            expect(desktop).toContain(
                `imagesizes="${mediaDescriptor(source, 'card', { sizes: STOREFRONT_IMAGE_SIZES.desktopCatalogCard }).sizes}"`,
            );
        },
    );

    it.each(['catalog', 'product'] as const)(
        'preloads the %s image rather than the home hero',
        async kind => {
            const product = { featuredAsset: { preview: '/assets/preview/product.png' } };
            const page = {
                config: { accessMode: 'LIVE' },
                product,
                catalog: { items: [product] },
                content: { blocks: [{ type: 'HERO', imageUrl: '/assets/preview/home.png' }] },
                media: [{ kind: 'hero', identity: '/assets/preview/home.png' }],
            };
            const warmer = { observe: vi.fn().mockResolvedValue(undefined) };
            const service = new StorefrontLcpPreloadService(
                { peek: vi.fn().mockResolvedValue(page) } as never,
                {} as never,
                warmer as never,
            );
            const request = kind === 'catalog' ? { kind, input: {} } : { kind, id: 'p1' };
            const fragment = await service.render({ channelId: 'a' } as never, 'a.test', request);
            const links = fragment
                .split('\n')
                .filter(line => line.includes('rel="preload"'))
                .join('\n');
            expect(links).toContain('/assets/preview/product.png');
            expect(links).not.toContain('/assets/preview/home.png');
            if (kind === 'catalog') {
                expect(links).toContain('media="(max-width: 1023px)"');
                expect(links).toContain('media="(min-width: 1024px)"');
                expect(links).toContain('104px');
            }
            expect(warmer.observe).toHaveBeenCalledWith({ channelId: 'a' }, 'a.test', request);
        },
    );
});
