import { Collection, Product, ProductVariant } from '@vendure/core';
import { StorefrontContentBlock } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

import { ReferralPosterTemplate } from '../entities/referral-poster-template.entity';
import { ReferralProgramConfig } from '../entities/referral-program-config.entity';
import { StoreProfile } from '../entities/store-profile.entity';

import { StorefrontMediaManifestService } from './storefront-media-manifest.service';
import { StorefrontPublicCacheService } from './storefront-public-cache.service';
vi.mock('@vendure/core', () => ({
    CacheService: class {},
    ConfigService: class {},
    RequestContextCacheService: class {},
    TransactionalConnection: class {},
    Product: class {},
    ProductVariant: class {},
    Collection: class {},
    LanguageCode: { zh_Hans: 'zh_Hans' },
}));
vi.mock('@vendure/storefront-content-plugin', () => ({
    StorefrontContentService: class {},
    StorefrontContentBlock: class {},
}));
vi.mock('../entities/referral-program-config.entity', () => ({ ReferralProgramConfig: class {} }));
vi.mock('../entities/referral-poster-template.entity', () => ({ ReferralPosterTemplate: class {} }));
vi.mock('../entities/store-profile.entity', () => ({ StoreProfile: class {} }));
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
    const profile = { findOne: vi.fn((_options?: unknown) => Promise.resolve(null as any)) };
    const referralConfig = { findOne: vi.fn(() => Promise.resolve(null as any)) };
    const posterTemplates = { find: vi.fn(() => Promise.resolve([] as any[])) };
    const posterBlocks = { find: vi.fn(() => Promise.resolve([] as any[])) };
    const connection = {
        getRepository: vi.fn((_ctx, entity) =>
            entity === StoreProfile
                ? profile
                : entity === ReferralProgramConfig
                  ? referralConfig
                  : entity === ReferralPosterTemplate
                    ? posterTemplates
                    : entity === StorefrontContentBlock
                      ? posterBlocks
                      : { createQueryBuilder: () => queries.get(entity) },
        ),
    };
    const service = new StorefrontMediaManifestService(
        cache,
        connection as any,
        content as any,
        promotion as any,
    );
    return {
        service,
        cache,
        queries,
        content,
        promotion,
        connection,
        profile,
        referralConfig,
        posterTemplates,
        posterBlocks,
    };
}
describe('public media manifest', () => {
    it('rejects another scope even when a caller supplies a shared phase read', async () => {
        const { service } = harness();
        const read = vi
            .fn()
            .mockResolvedValue({ channelId: 'b', host: 'a.test', paths: ['preview/hero.webp'], uses: [] });
        expect(await service.isPublic(ctx, 'a.test', 'preview/hero.webp', read)).toBe(false);
        read.mockResolvedValue({ channelId: 'a', host: 'b.test', paths: ['preview/hero.webp'], uses: [] });
        expect(await service.isPublic(ctx, 'a.test', 'preview/hero.webp', read)).toBe(false);
        read.mockClear();
        expect(await service.isPublic(ctx, 'a.test', '../private/hero.webp', read)).toBe(false);
        expect(read).not.toHaveBeenCalled();
    });
    it.each(['a', 'b'])(
        'uses the same poster authorization mechanism for store %s and revokes disabled programs',
        async channelId => {
            const test = harness();
            const scoped = { ...ctx, channelId };
            const image = {
                mimeType: 'image/webp',
                source: `source/${channelId}-poster.webp`,
                preview: `preview/${channelId}-poster.webp`,
                channels: [{ id: channelId }],
                tags: [],
            };
            test.referralConfig.findOne.mockResolvedValue({ channelId, enabled: true, posterTemplates: [] });
            test.posterTemplates.find.mockResolvedValue([
                { channelId, enabled: true, posterBackgroundAsset: image },
            ]);
            expect(await test.service.isPublic(scoped, `${channelId}.example`, image.source)).toBe(true);
            expect(await test.service.isPublic(scoped, `${channelId}.example`, image.preview)).toBe(true);
            expect(test.posterBlocks.find).not.toHaveBeenCalled();
            test.referralConfig.findOne.mockResolvedValue({ channelId, enabled: false });
            await test.cache.invalidate(channelId);
            expect(await test.service.isPublic(scoped, `${channelId}.example`, image.source)).toBe(false);
        },
    );

    it('authorizes only exact image bindings of enabled referral posters in the current store', async () => {
        const test = harness();
        const asset = (id: string, channelId = 'a', tags: any[] = []) => ({
            mimeType: 'image/webp',
            source: `source/${id}.webp`,
            preview: `preview/${id}.webp`,
            channels: [{ id: channelId }],
            tags,
        });
        test.referralConfig.findOne.mockResolvedValue({
            channelId: 'a',
            enabled: true,
            posterTemplates: ['BRAND_MINIMAL'],
        });
        test.posterTemplates.find.mockResolvedValue([
            {
                channelId: 'a',
                enabled: true,
                posterBackgroundAsset: asset('custom'),
                shareBackgroundAsset: asset('share'),
            },
            { channelId: 'b', enabled: true, posterBackgroundAsset: asset('other-store') },
            { channelId: 'a', enabled: false, posterBackgroundAsset: asset('disabled') },
            { channelId: 'a', enabled: true, posterBackgroundAsset: asset('foreign-asset', 'b') },
            {
                channelId: 'a',
                enabled: true,
                posterBackgroundAsset: asset('avatar', 'a', [{ value: 'customer-avatar' }]),
            },
        ]);
        test.posterBlocks.find.mockResolvedValue([
            {
                channelId: 'a',
                code: 'referral-poster-brand-minimal',
                settings: { purpose: 'referral-system-poster', templateId: 'BRAND_MINIMAL' },
                imageAsset: asset('blue'),
            },
            {
                channelId: 'a',
                code: 'referral-poster-product-story',
                settings: { purpose: 'referral-system-poster', templateId: 'PRODUCT_STORY' },
                imageAsset: asset('unselected'),
            },
            {
                channelId: 'b',
                code: 'referral-poster-brand-minimal',
                settings: { purpose: 'referral-system-poster', templateId: 'BRAND_MINIMAL' },
                imageAsset: asset('foreign-block'),
            },
            {
                channelId: 'a',
                code: 'not-a-poster',
                settings: { purpose: 'referral-system-poster', templateId: 'BRAND_MINIMAL' },
                imageAsset: asset('unbound'),
            },
        ]);
        for (const id of ['blue', 'custom', 'share']) {
            expect(await test.service.isPublic(ctx, 'shop.example', `source/${id}.webp`)).toBe(true);
            expect(await test.service.isPublic(ctx, 'shop.example', `preview/${id}.webp`)).toBe(true);
        }
        for (const id of [
            'other-store',
            'disabled',
            'foreign-asset',
            'avatar',
            'unselected',
            'foreign-block',
            'unbound',
        ]) {
            expect(await test.service.isPublic(ctx, 'shop.example', `source/${id}.webp`)).toBe(false);
        }
        expect(test.posterTemplates.find).toHaveBeenCalledWith(
            expect.objectContaining({ where: { channelId: 'a', enabled: true } }),
        );
    });

    it.each([false, undefined])(
        'does not expose poster assets when the referral program is inactive: %s',
        async enabled => {
            const test = harness();
            test.referralConfig.findOne.mockResolvedValue(
                enabled === false ? { channelId: 'a', enabled } : null,
            );
            expect(await test.service.isPublic(ctx, 'shop.example', 'source/blue.webp')).toBe(false);
            expect(test.posterTemplates.find).not.toHaveBeenCalled();
            expect(test.posterBlocks.find).not.toHaveBeenCalled();
        },
    );

    it('authorizes only the exact public branding variants bound to the current store', async () => {
        const test = harness();
        const logo = (id: string, mimeType = 'image/webp') => ({
            id,
            mimeType,
            source: `source/${id}.svg`,
            preview: `preview/${id}.webp`,
            channels: [{ id: 'a' }],
            tags: [],
        });
        test.profile.findOne.mockResolvedValue({
            channelId: 'a',
            logoAsset: logo('brand'),
            logoOnLightAsset: logo('light'),
            logoOnDarkAsset: logo('dark', 'image/svg+xml'),
        });
        for (const path of ['preview/brand.webp', 'preview/light.webp', 'source/dark.svg'])
            expect(await test.service.isPublic(ctx, 'shop.example', path)).toBe(true);
        for (const path of ['source/brand.svg', 'preview/dark.webp', 'preview/unbound.webp'])
            expect(await test.service.isPublic(ctx, 'shop.example', path)).toBe(false);
        expect(test.profile.findOne).toHaveBeenCalledOnce();
        expect(test.profile.findOne.mock.calls[0][0]).toMatchObject({ where: { channelId: 'a' } });
        expect((await test.service.get(ctx, 'shop.example')).uses).toContainEqual({
            path: 'preview/brand.webp',
            kind: 'thumbnail',
        });
    });

    it.each([
        'profile-channel',
        'asset-channel',
        'avatar',
        'missing-owner',
        'missing-tags',
        'traversal',
        'document',
    ])('does not publish unsafe branding references: %s', async scenario => {
        const test = harness();
        const asset: any = {
            id: 'brand',
            mimeType: 'image/webp',
            preview: 'preview/brand.webp',
            source: 'source/private.svg',
            channels: [{ id: scenario === 'asset-channel' ? 'b' : 'a' }],
            tags: scenario === 'avatar' ? [{ value: 'customer-avatar' }] : [],
        };
        if (scenario === 'missing-owner') delete asset.channels;
        if (scenario === 'missing-tags') delete asset.tags;
        if (scenario === 'traversal') asset.preview = 'preview/../private.webp';
        if (scenario === 'document') asset.mimeType = 'application/pdf';
        test.profile.findOne.mockResolvedValue({
            channelId: scenario === 'profile-channel' ? 'b' : 'a',
            logoAsset: asset,
        });
        expect(await test.service.isPublic(ctx, 'shop.example', asset.preview)).toBe(false);
        expect(await test.service.isPublic(ctx, 'shop.example', asset.source)).toBe(false);
    });

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
        expect(test.connection.getRepository).toHaveBeenCalledTimes(5);
        expect(test.referralConfig.findOne).toHaveBeenCalledExactlyOnceWith({
            where: { channelId: ctx.channelId, enabled: true },
        });
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
    it('authorizes only the current published phone HERO, then withdraws cleared or disabled bindings through existing invalidation', async () => {
        const test = harness();
        const block = {
            type: 'HERO',
            enabled: true,
            imageUrl: '/assets/preview/desktop.webp',
            items: [],
            settings: { mobileImageUrl: '/assets/preview/a-phone.webp' },
        };
        test.content.findPublished.mockImplementation((request: any) =>
            Promise.resolve(request.channelId === 'a' && block.enabled ? [block] : []),
        );
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/a-phone.webp')).toBe(true);
        expect((await test.service.get(ctx, 'shop.example')).uses).toContainEqual({
            path: 'preview/a-phone.webp',
            kind: 'hero',
        });
        expect(
            await test.service.isPublic({ ...ctx, channelId: 'b' }, 'shop.example', 'preview/a-phone.webp'),
        ).toBe(false);
        expect(test.content.findPublished).toHaveBeenCalledWith(ctx, false, 'zh_Hans');
        block.settings.mobileImageUrl = '';
        await test.cache.invalidate('a');
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/a-phone.webp')).toBe(false);
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/desktop.webp')).toBe(true);
        block.settings.mobileImageUrl = '/assets/preview/a-phone.webp';
        block.enabled = false;
        await test.cache.invalidate('a');
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/a-phone.webp')).toBe(false);
        expect(await test.service.isPublic(ctx, 'shop.example', 'preview/desktop.webp')).toBe(false);
    });
    it('authorizes published phone bindings for the services and device-poster layouts only', async () => {
        const test = harness();
        const blocks = [
            {
                type: 'CLIENT_PLUGINS',
                items: [],
                settings: { mobileImageUrl: '/assets/preview/service-phone.webp' },
            },
            {
                type: 'CLIENT_PLUGINS',
                items: [],
                settings: {
                    mobileImageUrl: '/assets/preview/ignored-banner.webp',
                    businessServicesHeroLayout: 'shared-banner',
                },
            },
            {
                type: 'CATEGORY_AD',
                items: [],
                settings: {
                    mobileImageUrl: '/assets/preview/category-phone.webp',
                    categoryArtworkLayout: 'device-poster',
                },
            },
            {
                type: 'CATEGORY_AD',
                items: [],
                settings: {
                    mobileImageUrl: '/assets/preview/ignored-scene.webp',
                    categoryArtworkLayout: 'scene-poster',
                },
            },
        ];
        test.content.findPublished.mockImplementation((request: any) =>
            Promise.resolve(request.channelId === 'a' ? blocks : []),
        );
        for (const path of ['preview/service-phone.webp', 'preview/category-phone.webp']) {
            expect(await test.service.isPublic(ctx, 'shop.example', path)).toBe(true);
            expect(await test.service.isPublic({ ...ctx, channelId: 'b' }, 'other.example', path)).toBe(
                false,
            );
        }
        for (const path of ['preview/ignored-banner.webp', 'preview/ignored-scene.webp'])
            expect(await test.service.isPublic(ctx, 'shop.example', path)).toBe(false);
    });
    it('never grants access from unused phone settings, another host, a cache or source traversal', async () => {
        const test = harness();
        test.content.findPublished.mockResolvedValue([
            {
                type: 'SUPPORT',
                settings: { mobileImageUrl: '/assets/preview/support-phone.webp' },
                items: [],
            },
            {
                type: 'HERO',
                settings: { mobileImageUrl: 'https://other.example/assets/preview/foreign-phone.webp' },
                items: [],
            },
            { type: 'HERO', settings: { mobileImageUrl: '/assets/cache/private.webp' }, items: [] },
            { type: 'HERO', settings: { mobileImageUrl: '/assets/source/%2e%2e/private.webp' }, items: [] },
        ]);
        for (const path of [
            'preview/support-phone.webp',
            'preview/foreign-phone.webp',
            'cache/private.webp',
            'private.webp',
        ])
            expect(await test.service.isPublic(ctx, 'shop.example', path)).toBe(false);
    });
});
