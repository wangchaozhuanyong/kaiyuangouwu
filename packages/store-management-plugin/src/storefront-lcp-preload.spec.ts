import { describe, expect, it, vi } from 'vitest';

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
    };
});

import { StorefrontLcpPreloadController } from './storefront-lcp-preload.controller';
import {
    renderHeroPreloadLink,
    renderStorefrontIconLinks,
    StorefrontLcpPreloadService,
} from './storefront-lcp-preload.service';

function responseMock() {
    const response = {
        setHeader: vi.fn(),
        status: vi.fn(),
        type: vi.fn(),
        send: vi.fn(),
    };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    response.send.mockReturnValue(response);
    return response;
}

describe('storefront LCP preload', () => {
    it('renders the same responsive hero candidates consumed by the storefront', () => {
        const link = renderHeroPreloadLink('/assets/preview/hero.png');

        expect(link).toContain('rel="preload"');
        expect(link).toContain('as="image"');
        expect(link).toContain('fetchpriority="high"');
        expect(link).toContain('preset=storefront-hero-fit-480&amp;format=webp&amp;q=90 480w');
        expect(link).toContain('preset=storefront-hero-fit-1600&amp;format=webp&amp;q=90');
        expect(link).toContain('imagesizes="(min-width: 1024px) 850px, calc(100vw - 20px)"');
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
        expect(pages.peek).toHaveBeenCalledWith({ channelId: 'store-a' }, 'store-a.test');
        expect(fragment).toContain('storefront-public-page-data');
        expect(fragment).toContain('v=webp-readable-1');
        expect(fragment).not.toContain('<script>alert');
        expect(fragment).not.toContain('store-b');
        const serialized = fragment.match(/type="application\/json">([\s\S]*?)<\/script>/)?.[1];
        expect(JSON.parse(serialized ?? '').config.description).toBe('</script><script>alert(1)</script>');
    });

    it('does not preload support banners when there is no published home hero', async () => {
        const page = {
            config: {},
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
});
