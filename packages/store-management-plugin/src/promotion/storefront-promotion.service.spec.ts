import { describe, expect, it, vi } from 'vitest';

import { StorefrontPromotionService } from './storefront-promotion.service';

describe('promotion defaults across channels', () => {
    it('uses shared neutral content until a channel publishes its own page', async () => {
        const render = vi.fn(() => '<html></html>');
        const service = new StorefrontPromotionService({} as never, {} as never, { render } as never);
        const findPage = vi.spyOn(service as any, 'findPage');
        vi.spyOn(service as any, 'getBindings').mockResolvedValue({ 'store.name': '店铺' });
        vi.spyOn(service as any, 'getPublicUrl').mockResolvedValue('/promotion');

        findPage.mockResolvedValueOnce(null);
        await service.renderPublished({} as never, 'ticket');
        expect(render).toHaveBeenLastCalledWith(
            expect.objectContaining({
                contentType: 'MARKDOWN',
                source: '# {{store.name}}\n\n{{store.description}}',
            }),
        );

        findPage.mockResolvedValueOnce({
            isCustomized: true,
            publishedContentType: 'HTML',
            publishedSource: '<h1>Managed page</h1>',
        });
        await service.renderPublished({} as never, 'ticket');
        expect(render).toHaveBeenLastCalledWith(
            expect.objectContaining({
                contentType: 'HTML',
                source: '<h1>Managed page</h1>',
            }),
        );
    });
});

describe('promotion image replacement review', () => {
    function guardedFixture() {
        const page = {
            contentType: 'HTML',
            draftSource: '<img src="/merchant.png">',
            publishedSource: '<img src="/merchant.png">',
            publishedVersion: 1,
        };
        const save = vi.fn(value => value);
        const service = new StorefrontPromotionService(
            { getRepository: () => ({ save }) } as never,
            {} as never,
            { validateSource: (_type: string, source: string) => source } as never,
        );
        vi.spyOn(service as any, 'findPage').mockResolvedValue(page);
        vi.spyOn(service as any, 'toView').mockImplementation((_ctx: unknown, value: unknown) => value);
        return { page, service, save };
    }
    it('blocks unreviewed source replacement in both draft saving and publishing', async () => {
        const { page, service, save } = guardedFixture();
        await expect(
            service.saveDraft({ channelId: 'store' } as never, {
                contentType: 'HTML',
                source: '<img src="/preset.png">',
            }),
        ).rejects.toThrow('IMAGE_REPLACEMENT_REQUIRES_REVIEW');
        page.draftSource = '<img src="/preset.png">';
        await expect(service.publish({ channelId: 'store' } as never)).rejects.toThrow(
            'IMAGE_REPLACEMENT_REQUIRES_REVIEW',
        );
        expect(page.publishedSource).toBe('<img src="/merchant.png">');
        expect(save).not.toHaveBeenCalled();
    });
    it('allows copy changes and separately reviewed replacements', async () => {
        const { service, save } = guardedFixture();
        await service.saveDraft({} as never, {
            contentType: 'HTML',
            source: '<h1>new copy</h1><img src="/merchant.png">',
        });
        await service.saveDraft({} as never, {
            contentType: 'HTML',
            source: '<img src="/reviewed.png">',
            allowImageReplacement: true,
        });
        await service.publish({} as never, true);
        expect(save).toHaveBeenCalledTimes(3);
    });
});

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
