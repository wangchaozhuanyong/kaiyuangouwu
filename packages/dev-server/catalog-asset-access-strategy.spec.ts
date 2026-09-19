import { PresetOnlyStrategy } from '@vendure/asset-server-plugin';
import {
    Collection,
    ConfigService,
    Product,
    ProductVariant,
    SessionService,
    TransactionalConnection,
} from '@vendure/core';
import {
    StorefrontPromotionAccessService,
    StorefrontPromotionService,
} from '@vendure/store-management-plugin';
import { StorefrontContentService } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@vendure/store-management-plugin', async () => ({
    ...(await import('../store-management-plugin/src/promotion/promotion-public-assets')),
    StorefrontPromotionAccessService: class {},
    StorefrontPromotionService: class {},
}));

import {
    CatalogAssetAccessStrategy,
    createCatalogImageTransformStrategies,
    PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
} from './catalog-asset-access-strategy';

function harness(userId?: string) {
    const ctx = { channelId: 'shop-a', languageCode: 'en' };
    const findPublished = vi.fn().mockResolvedValue([]);
    const renderPublished = vi.fn().mockResolvedValue('<img src="/assets/preview/public-hero.jpg">');
    const getSessionFromToken = vi.fn().mockResolvedValue(userId ? { user: { id: userId } } : undefined);
    const resolveRequest = vi.fn().mockResolvedValue({ host: 'shop.example.com', ctx });
    const instances = new Map<unknown, unknown>([
        [ConfigService, { authOptions: { tokenMethod: ['cookie', 'bearer'], apiKeyHeaderKey: 'x-api-key' } }],
        [SessionService, { getSessionFromToken }],
        [StorefrontPromotionAccessService, { resolveRequest }],
        [StorefrontContentService, { findPublished }],
        [StorefrontPromotionService, { renderPublished }],
    ]);
    const repositories = new Map(
        [Product, ProductVariant, Collection].map(entity => [
            entity,
            { findOne: vi.fn().mockResolvedValue(null) },
        ]),
    );
    instances.set(TransactionalConnection, {
        getRepository: (_ctx: unknown, entity: unknown) => repositories.get(entity as typeof Product),
    });
    const headers = { setHeader: vi.fn() };
    const strategy = new CatalogAssetAccessStrategy();
    strategy.init({ get: (type: unknown) => instances.get(type) } as never);
    const read = (path: string) =>
        strategy.getImageTransformParameters({
            req: { path, session: { token: 'fixture-session' }, get: vi.fn(), res: headers },
            input: { preset: 'thumbnail' },
            availablePresets: [],
        } as never);
    return {
        read,
        renderPublished,
        findPublished,
        resolveRequest,
        getSessionFromToken,
        ctx,
        repositories,
        headers,
    };
}

describe('catalog media boundary', () => {
    it.each([Product, ProductVariant, Collection])(
        'allows images used by visible catalog entities',
        async entity => {
            const test = harness();
            const repository = test.repositories.get(entity);
            if (!repository) throw new Error('Missing fixture repository');
            repository.findOne.mockResolvedValue({ id: 'visible-entity' });
            await expect(test.read('/preview/published.jpg')).resolves.toEqual({ preset: 'thumbnail' });
            expect(test.headers.setHeader).toHaveBeenCalledWith(
                'Cache-Control',
                PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
            );
            const where = repository.findOne.mock.calls[0][0].where;
            expect(where).toHaveLength(4);
            for (const filter of where) {
                expect(filter.channels).toEqual({ id: 'shop-a' });
                if (entity === Collection) expect(filter.isPrivate).toBe(false);
                else {
                    expect(filter.enabled).toBe(true);
                    expect(filter.deletedAt.type).toBe('isNull');
                }
                if (entity === ProductVariant) {
                    expect(filter.product).toMatchObject({ enabled: true, channels: { id: 'shop-a' } });
                }
            }
        },
    );
    it('only enables browser caching after a published image has been matched', async () => {
        const test = harness();
        await expect(test.read('/preview/unpublished.jpg')).rejects.toThrow('Asset access denied');
        expect(test.headers.setHeader).not.toHaveBeenCalledWith(
            'Cache-Control',
            PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
        );
    });
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
        const test = harness();
        await expect(test.read('/preview/public-hero.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        await expect(test.read('/preview/public-hero.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        expect(test.findPublished).toHaveBeenCalledOnce();
        expect(test.renderPublished).toHaveBeenCalledOnce();
        expect(test.getSessionFromToken).not.toHaveBeenCalled();
    });
    it('never reuses a public authorization across store channels', async () => {
        const test = harness();
        await expect(test.read('/preview/public-hero.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        test.findPublished.mockResolvedValue([]);
        test.renderPublished.mockResolvedValue('');
        test.resolveRequest.mockResolvedValue({
            host: 'other-shop.example.com',
            ctx: { channelId: 'shop-b', languageCode: 'en' },
        });
        await expect(test.read('/preview/public-hero.jpg')).rejects.toThrow('Asset access denied');
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
            expect(test.findPublished).toHaveBeenCalledWith(test.ctx, false, 'zh_Hans');
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
    it('preserves authenticated access to non-public media without making it cacheable', async () => {
        const test = harness('customer-a');
        await expect(test.read('/preview/private-product.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        expect(test.headers.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(test.headers.setHeader).not.toHaveBeenCalledWith(
            'Cache-Control',
            PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
        );
    });
    it('keeps authenticated media available on a public lookup failure while rejecting guests', async () => {
        for (const customerId of [undefined, 'customer-a']) {
            const test = harness(customerId);
            test.findPublished.mockRejectedValue(new Error('Publication lookup unavailable'));
            if (customerId) {
                await expect(test.read('/preview/private.jpg')).resolves.toEqual({ preset: 'thumbnail' });
            } else {
                await expect(test.read('/preview/private.jpg')).rejects.toThrow(
                    'Publication lookup unavailable',
                );
            }
            expect(test.headers.setHeader).not.toHaveBeenCalledWith(
                'Cache-Control',
                PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
            );
        }
    });
});
