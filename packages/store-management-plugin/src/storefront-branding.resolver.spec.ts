import { describe, expect, it, vi } from 'vitest';

import { StorefrontBrandingShopResolver } from './storefront-branding.resolver';

function createResolver(profile: Record<string, unknown> | null) {
    const repository = { findOne: vi.fn().mockResolvedValue(profile) };
    const connection = { getRepository: vi.fn().mockReturnValue(repository) };
    const configService = { assetOptions: { assetStorageStrategy: {} } };
    return new StorefrontBrandingShopResolver(connection as any, configService as any);
}

describe('StorefrontBrandingShopResolver', () => {
    it('returns the public description and name for the requested storefront language', async () => {
        const resolver = createResolver({
            descriptionZh: 'AI 软件商城',
            descriptionEn: 'AI software store',
            logoAsset: null,
        });
        const ctx = {
            channelId: 'channel-1',
            languageCode: 'zh_Hans',
            channel: {
                code: 'my-malaysia',
                customFields: { storefrontNameZh: '软件商城', storefrontNameEn: 'Software Store' },
            },
        } as any;

        await expect(resolver.storefrontBranding(ctx)).resolves.toMatchObject({
            name: '软件商城',
            description: 'AI 软件商城',
        });
    });

    it('does not leak untranslated Chinese content into an English response', async () => {
        const resolver = createResolver({
            descriptionZh: '唯一公开简介',
            descriptionEn: '仍然是中文简介',
            internalNote: '不得公开',
            logoAsset: null,
        });
        const result = await resolver.storefrontBranding({
            channelId: 'channel-1',
            languageCode: 'en',
            channel: {
                code: 'store',
                customFields: { storefrontNameZh: '商城', storefrontNameEn: '仍然是中文名称' },
            },
        } as any);

        expect(result).toMatchObject({ name: 'store', description: '' });
        expect(result).not.toHaveProperty('internalNote');
    });

    it('keeps an uploaded SVG logo as a vector asset', async () => {
        const resolver = createResolver({
            descriptionZh: '',
            descriptionEn: '',
            logoAsset: {
                mimeType: 'image/svg+xml',
                source: 'source/logo.svg',
                preview: 'preview/logo.png',
            },
        });

        await expect(
            resolver.storefrontBranding({
                channelId: 'channel-1',
                languageCode: 'zh_Hans',
                channel: { code: 'store', customFields: {} },
            } as any),
        ).resolves.toMatchObject({ logoUrl: '/assets/source/logo.svg' });
    });
});
