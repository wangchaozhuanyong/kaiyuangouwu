import { describe, expect, it, vi } from 'vitest';

vi.mock('@vendure/storefront-content-plugin', async () => {
    const responsiveImage = await import('../../storefront-content-plugin/src/shared/responsive-image.js');
    return {
        ...responsiveImage,
        StorefrontContentService: class StorefrontContentService {},
    };
});

import { StorefrontLcpPreloadController } from './storefront-lcp-preload.controller';
import {
    renderHeroPreloadLink,
    storefrontContentCacheTag,
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

    it('caches one resolved fragment per Channel and language and supports tag invalidation', async () => {
        const cache = {
            get: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce('<link cached />'),
            set: vi.fn().mockResolvedValue(undefined),
            invalidateTags: vi.fn().mockResolvedValue(undefined),
        };
        const content = {
            findPublished: vi
                .fn()
                .mockResolvedValue([{ type: 'HERO', imageUrl: '/assets/preview/store-a.png' }]),
        };
        const service = new StorefrontLcpPreloadService(cache as never, content as never);
        const ctx = { channelId: 'store-a', languageCode: 'zh_Hans' } as never;

        const first = await service.render(ctx);
        const second = await service.render(ctx);
        await service.invalidate('store-a');

        expect(first).toContain('storefront-hero-fit-480');
        expect(second).toBe('<link cached />');
        expect(content.findPublished).toHaveBeenCalledTimes(1);
        expect(cache.set).toHaveBeenCalledWith(
            'StorefrontLcpPreload:store-a:zh_Hans',
            expect.stringContaining('storefront-hero-fit-1600'),
            expect.objectContaining({ tags: [storefrontContentCacheTag('store-a')] }),
        );
        expect(cache.invalidateTags).toHaveBeenCalledWith([storefrontContentCacheTag('store-a')]);
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
