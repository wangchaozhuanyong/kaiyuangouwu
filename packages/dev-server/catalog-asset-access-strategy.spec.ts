import { PresetOnlyStrategy } from '@vendure/asset-server-plugin';
import { ConfigService, SessionService } from '@vendure/core';
import {
    StorefrontPromotionAccessService,
    StorefrontPromotionService,
} from '@vendure/store-management-plugin';
import { StorefrontContentService } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

import {
    CatalogAssetAccessStrategy,
    createCatalogImageTransformStrategies,
} from './catalog-asset-access-strategy';

function harness(userId?: string) {
    const ctx = { channelId: 'shop-a', languageCode: 'en' };
    const findPublished = vi.fn().mockResolvedValue([]);
    const renderPublished = vi.fn().mockResolvedValue('<img src="/assets/preview/public-hero.jpg">');
    const getSessionFromToken = vi.fn().mockResolvedValue(userId ? { user: { id: userId } } : undefined);
    const instances = new Map<unknown, unknown>([
        [ConfigService, { authOptions: { tokenMethod: ['cookie', 'bearer'], apiKeyHeaderKey: 'x-api-key' } }],
        [SessionService, { getSessionFromToken }],
        [
            StorefrontPromotionAccessService,
            { resolveRequest: vi.fn().mockResolvedValue({ host: 'shop.example.com', ctx }) },
        ],
        [StorefrontContentService, { findPublished }],
        [StorefrontPromotionService, { renderPublished }],
    ]);
    const strategy = new CatalogAssetAccessStrategy();
    strategy.init({ get: (type: unknown) => instances.get(type) } as never);
    const read = (path: string) =>
        strategy.getImageTransformParameters({
            req: { path, session: { token: 'fixture-session' }, get: vi.fn(), res: { setHeader: vi.fn() } },
            input: { preset: 'thumbnail' },
            availablePresets: [],
        } as never);
    return { read, renderPublished, findPublished, ctx };
}

describe('catalog media boundary', () => {
    it('authorizes catalog media before applying the image preset', () => {
        const strategies = createCatalogImageTransformStrategies(false);
        expect(strategies).toHaveLength(2);
        expect(strategies[0]).toBeInstanceOf(CatalogAssetAccessStrategy);
        expect(strategies[1]).toBeInstanceOf(PresetOnlyStrategy);
    });
    it('does not depend on store plugins when bootstrapping the base schema', () => {
        const strategies = createCatalogImageTransformStrategies(true);
        expect(strategies).toHaveLength(1);
        expect(strategies[0]).toBeInstanceOf(PresetOnlyStrategy);
    });
    it.each([
        '/preview/private-product.jpg',
        '/source/private-product.jpg',
        '/cache/preview/private-product_hash.webp',
    ])('rejects unauthenticated originals, previews and direct cache paths: %s', async path => {
        await expect(harness().read(path)).rejects.toThrow('Asset access denied');
    });
    it('keeps the exact public promotion image readable', async () => {
        await expect(harness().read('/preview/public-hero.jpg')).resolves.toEqual({ preset: 'thumbnail' });
    });
    it.each(['/preview/login.jpg', '/assets/preview/login.jpg', '/source/register.svg'])(
        'allows an exact published account visual: %s',
        async path => {
            const test = harness();
            test.findPublished.mockResolvedValue([
                { imageUrl: '/assets/preview/login.jpg?preset=storefront-original-preview', items: [] },
                { imageUrl: '/assets/source/register.svg', items: [] },
            ]);
            await expect(test.read(path)).resolves.toEqual({ preset: 'thumbnail' });
            expect(test.findPublished).toHaveBeenCalledWith(test.ctx, true, 'zh_Hans');
            expect(test.renderPublished).not.toHaveBeenCalled();
        },
    );
    it('does not expose sibling originals, arbitrary cache paths, foreign origins or unpublished images', async () => {
        const test = harness();
        test.findPublished.mockResolvedValue([
            { imageUrl: '/assets/preview/login.jpg', items: [] },
            { imageUrl: 'https://other-shop.example.com/assets/preview/other-store.jpg', items: [] },
        ]);
        for (const path of [
            '/source/login.jpg',
            '/cache/preview/login_hash.webp',
            '/preview/other-store.jpg',
            '/preview/unpublished.jpg',
            '/preview/login.jpg.extra',
            '/%ZZ',
        ]) {
            await expect(test.read(path)).rejects.toThrow('Asset access denied');
        }
    });
    it('requires the published account content service to return the requested store image', async () => {
        const test = harness();
        test.findPublished.mockResolvedValue([{ imageUrl: '/assets/preview/shop-a.jpg', items: [] }]);
        await expect(test.read('/preview/shop-b.jpg')).rejects.toThrow('Asset access denied');
        test.findPublished.mockResolvedValue([]);
        await expect(test.read('/preview/shop-a.jpg')).rejects.toThrow('Asset access denied');
    });
    it('allows catalog media after authentication without loading public content', async () => {
        const test = harness('customer-a');
        await expect(test.read('/preview/private-product.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        expect(test.renderPublished).not.toHaveBeenCalled();
        expect(test.findPublished).not.toHaveBeenCalled();
    });
});
