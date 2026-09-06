import { describe, expect, it, vi } from 'vitest';

import { StorefrontPromotionService } from './storefront-promotion.service';

function fixture(logo: string | null, share: string | null = null) {
    const findOne = vi.fn((entity: string, options: { where: { channelId: string } }) => {
        expect(options.where.channelId).toBe('store-b');
        if (entity === 'StoreProfile') {
            return { logoAsset: logo ? { source: logo, mimeType: 'image/svg+xml' } : null };
        }
        if (entity === 'ReferralPosterTemplate' && share) {
            return {
                shareBackgroundAsset: { source: share },
                headlineZh: '',
                headlineEn: '',
                siteIntroZh: '',
                siteIntroEn: '',
                rewardTextZh: '',
                rewardTextEn: '',
            };
        }
        return null;
    });
    const find = vi.fn((options: { where: { channelId: string } }) => {
        expect(options.where.channelId).toBe('store-b');
        return [{ imageUrl: '/assets/preview/current-store-hero.jpg' }];
    });
    const render = vi.fn(({ bindings }) => JSON.stringify(bindings));
    const service = new StorefrontPromotionService(
        {
            getRepository: (_ctx: unknown, entity: { name: string }) => ({
                findOne: (options: { where: { channelId: string } }) => findOne(entity.name, options),
                find,
            }),
        } as never,
        { assetOptions: { assetStorageStrategy: {} } } as never,
        { validateSource: () => '<html></html>', render } as never,
    );
    return async () => {
        const result = await service.preview(
            {
                channelId: 'store-b',
                channel: { customFields: { storefrontNameZh: '大马通' } },
                languageCode: 'zh_Hans',
                apiType: 'admin',
            } as never,
            { contentType: 'HTML', source: '<html></html>' },
        );
        expect(find).toHaveBeenCalledOnce();
        return JSON.parse(result) as Record<string, string>;
    };
}

describe('StorefrontPromotionService brand bindings', () => {
    it('uses the resolved store logo for sharing while preserving its hero image', async () => {
        const bindings = await fixture('/assets/source/store-b-logo.svg')();
        expect(bindings['store.name']).toBe('大马通');
        expect(bindings['store.shareImageUrl']).toBe('/assets/source/store-b-logo.svg');
        expect(bindings['store.heroImageUrl']).toContain('/assets/preview/current-store-hero.jpg');
    });

    it('uses a neutral share image when a store has no logo even if it has a hero', async () => {
        const bindings = await fixture(null)();
        expect(bindings['store.shareImageUrl']).toBe('/storefront/neutral-store.png');
        expect(bindings['store.heroImageUrl']).toContain('/assets/preview/current-store-hero.jpg');
    });

    it('preserves an explicitly configured share asset from the resolved store', async () => {
        const bindings = await fixture(
            '/assets/source/store-b-logo.svg',
            '/assets/source/store-b-share.png',
        )();
        expect(bindings['store.shareImageUrl']).toBe('/assets/source/store-b-share.png');
    });
});
