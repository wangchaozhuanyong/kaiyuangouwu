import { describe, expect, it, vi } from 'vitest';

vi.mock('@vendure/storefront-content-plugin', async () => {
    const responsiveImage = await import('../../storefront-content-plugin/src/shared/responsive-image.js');
    const icons = await import('../../storefront-content-plugin/src/shared/storefront-icons.js');
    const { storefrontContentPermission } = await import('../../storefront-content-plugin/src/constants.js');
    return {
        ...responsiveImage,
        ...icons,
        storefrontContentPermission,
        StorefrontContentService: class StorefrontContentService {},
    };
});

import { StorefrontLcpPreloadController } from './storefront-lcp-preload.controller';
import {
    renderHeroPreloadLink,
    renderStorefrontIconLinks,
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
        const profile = { logoAsset: { preview: 'preview/store-a.webp' } };
        const findOne = vi.fn().mockResolvedValue(profile);
        const connection = { getRepository: vi.fn().mockReturnValue({ findOne }) };
        const config = { assetOptions: { assetStorageStrategy: {} } };
        const service = new StorefrontLcpPreloadService(
            cache as never,
            content as never,
            connection as never,
            config as never,
        );
        const ctx = { channelId: 'store-a', languageCode: 'zh_Hans', channel: { customFields: {} } } as never;

        const first = await service.render(ctx);
        profile.logoAsset.preview = 'preview/store-a-new.webp';
        const second = await service.render(ctx);
        await service.invalidate('store-a');

        expect(first).toContain('storefront-hero-fit-480');
        expect(first).toContain('/assets/preview/store-a.webp?');
        expect(second).toContain('/assets/preview/store-a-new.webp?');
        expect(second).not.toContain('/assets/preview/store-a.webp?');
        expect(second).toContain('<link cached />');
        expect(findOne).toHaveBeenCalledTimes(2);
        expect(findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { channelId: 'store-a' } }));
        expect(content.findPublished).toHaveBeenCalledTimes(1);
        expect(cache.set).toHaveBeenCalledWith(
            'StorefrontLcpPreload:store-a:zh_Hans',
            expect.stringContaining('storefront-hero-fit-1600'),
            expect.objectContaining({ tags: [storefrontContentCacheTag('store-a')] }),
        );
        expect(cache.invalidateTags).toHaveBeenCalledWith([storefrontContentCacheTag('store-a')]);
    });

    it('renders separate Channel logos even when there is no published hero', async () => {
        const service = new StorefrontLcpPreloadService(
            { get: vi.fn(), set: vi.fn() } as never,
            { findPublished: vi.fn().mockResolvedValue([]) } as never,
            {
                getRepository: (ctx: { channelId: string }) => ({
                    findOne: () =>
                        Promise.resolve({ logoAsset: { preview: `preview/${ctx.channelId}.webp` } }),
                }),
            } as never,
            { assetOptions: { assetStorageStrategy: {} } } as never,
        );
        for (const channelId of ['store-a', 'store-b']) {
            const fragment = await service.render({
                channelId,
                channel: { customFields: {} },
                languageCode: 'en',
            } as never);
            expect(fragment).toContain(`/assets/preview/${channelId}.webp?`);
            expect(fragment).toContain('format=png');
            expect(fragment).not.toContain('rel="preload"');
            expect(fragment).not.toContain(channelId === 'store-a' ? 'store-b' : 'store-a');
        }
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
