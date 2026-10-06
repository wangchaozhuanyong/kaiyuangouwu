import { Collection, Product, ProductVariant } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontMediaManifestService } from './storefront-media-manifest.service';
import { StorefrontPublicCacheService } from './storefront-public-cache.service';
vi.mock('@vendure/core', () => ({
    CacheService: class {},
    ConfigService: class {},
    TransactionalConnection: class {},
    Product: class {},
    ProductVariant: class {},
    Collection: class {},
    LanguageCode: { zh_Hans: 'zh_Hans' },
}));
vi.mock('@vendure/storefront-content-plugin', () => ({ StorefrontContentService: class {} }));
vi.mock('../promotion/storefront-promotion.service', () => ({ StorefrontPromotionService: class {} }));
const ctx = { channelId: 'a', languageCode: 'en', currencyCode: 'MYR' } as any;
function harness() {
    const entries = new Map<string, unknown>();
    const cache = new StorefrontPublicCacheService(
        {
            get: (key: string) => Promise.resolve(entries.get(key)),
            set: (key: string, value: unknown) => Promise.resolve(entries.set(key, value)),
        } as any,
        { systemOptions: { cacheStrategy: {} } } as any,
    );
    const queries = new Map(
        [Product, ProductVariant, Collection].map(entity => {
            const query: any = { getRawMany: vi.fn(() => Promise.resolve([])) };
            for (const name of [
                'innerJoin',
                'leftJoin',
                'select',
                'addSelect',
                'distinct',
                'limit',
                'andWhere',
            ])
                query[name] = vi.fn(() => query);
            return [entity, query];
        }),
    );
    const content = { findPublished: vi.fn((_ctx?: any) => Promise.resolve([] as any[])) };
    const promotion = { renderPublished: vi.fn(() => Promise.resolve('')) };
    const connection = {
        getRepository: vi.fn((_ctx, entity) => ({ createQueryBuilder: () => queries.get(entity) })),
    };
    const service = new StorefrontMediaManifestService(
        cache,
        connection as any,
        content as any,
        promotion as any,
    );
    return { service, cache, queries, content, promotion, connection };
}
describe('public media manifest', () => {
    it('loads public content, promotion and three catalog path projections once per store snapshot, not per image', async () => {
        const test = harness();
        test.content.findPublished.mockResolvedValue([
            {
                type: 'HERO',
                imageUrl: '/assets/preview/hero.jpg',
                items: [{ imageUrl: '/assets/source/icon.svg' }],
            },
        ]);
        test.promotion.renderPublished.mockResolvedValue('<img src="/assets/preview/promotion.jpg">');
        test.queries
            .get(Product)
            .getRawMany.mockResolvedValue([
                { featuredSource: 'source/product.jpg', featuredPreview: 'preview/product.jpg' },
            ]);
        const paths = [
            'preview/hero.jpg',
            'source/icon.svg',
            'preview/promotion.jpg',
            'source/product.jpg',
            'preview/product.jpg',
        ];
        expect(
            await Promise.all(paths.map(path => test.service.isPublic(ctx, 'shop.example', path))),
        ).toEqual(Array(5).fill(true));
        expect(test.content.findPublished).toHaveBeenCalledTimes(1);
        expect(test.promotion.renderPublished).toHaveBeenCalledTimes(1);
        expect(test.connection.getRepository).toHaveBeenCalledTimes(3);
        expect((await test.service.get(ctx, 'shop.example')).uses).toContainEqual({
            path: 'preview/product.jpg',
            kind: 'card',
        });
    });
    it('retains channel, parent product, enabled/deleted and private collection predicates in bounded projections', async () => {
        const test = harness();
        await test.service.get(ctx, 'shop.example');
        for (const [entity, query] of test.queries) {
            expect(query.innerJoin).toHaveBeenCalledWith(
                'item.channels',
                'channel',
                'channel.id = :channelId',
                { channelId: 'a' },
            );
            expect(query.limit).toHaveBeenCalledWith(20001);
            expect(query.select).toHaveBeenCalledWith('featured.preview', 'featuredPreview');
            if (entity === Collection)
                expect(query.andWhere).toHaveBeenCalledWith('item.isPrivate = :isPrivate', {
                    isPrivate: false,
                });
            else
                expect(query.andWhere).toHaveBeenCalledWith(
                    'item.enabled = :enabled AND item.deletedAt IS NULL',
                    { enabled: true },
                );
        }
        expect(test.queries.get(ProductVariant).innerJoin).toHaveBeenCalledWith(
            'product.channels',
            'productChannel',
            'productChannel.id = :channelId',
            { channelId: 'a' },
        );
        expect(test.queries.get(ProductVariant).innerJoin).toHaveBeenCalledWith(
            'item.product',
            'product',
            'product.enabled = :enabled AND product.deletedAt IS NULL',
            { enabled: true },
        );
    });
    it('keeps exact published account visuals without exposing originals, private caches, other domains or similar names', async () => {
        const test = harness();
        test.content.findPublished.mockResolvedValue([
            {
                type: 'ACCOUNT_VISUAL',
                imageUrl: '/assets/preview/login.jpg?preset=storefront-original-preview',
                items: [{ imageUrl: 'https://other.example/assets/preview/foreign.jpg' }],
            },
        ]);
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/login.jpg')).toBe(true);
        for (const path of [
            'source/login.jpg',
            'cache/preview/login_hash.webp',
            'preview/foreign.jpg',
            'preview/login.jpg.extra',
            'preview/../private.jpg',
        ])
            expect(await test.service.isPublic(ctx, 'shop.example', path)).toBe(false);
        expect(await test.service.isPublic(ctx, 'other.example', 'preview/login.jpg')).toBe(true);
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/foreign.jpg')).toBe(false);
    });
    it('withdraws an image after invalidation and does not reuse another store manifest', async () => {
        const test = harness();
        test.content.findPublished.mockImplementation((request: any) =>
            Promise.resolve(
                request.channelId === 'a'
                    ? [{ type: 'HERO', imageUrl: '/assets/preview/a.jpg', items: [] }]
                    : [],
            ),
        );
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/a.jpg')).toBe(true);
        expect(
            await test.service.isPublic({ ...ctx, channelId: 'b' }, 'shop-b.example', 'preview/a.jpg'),
        ).toBe(false);
        test.content.findPublished.mockResolvedValue([]);
        await test.cache.invalidate('a');
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/a.jpg')).toBe(false);
    });
    it('rejects oversized manifests instead of silently authorizing a truncated set', async () => {
        const test = harness();
        test.queries
            .get(Product)
            .getRawMany.mockResolvedValue(Array(20001).fill({ preview: 'preview/image.jpg' }));
        await expect(test.service.get(ctx, 'shop.example')).rejects.toThrow('bounded catalog size');
    });
});
