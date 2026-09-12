import { PresetOnlyStrategy } from '@vendure/asset-server-plugin';
import { ConfigService, SessionService } from '@vendure/core';
import {
    StorefrontPromotionAccessService,
    StorefrontPromotionService,
} from '@vendure/store-management-plugin';
import { describe, expect, it, vi } from 'vitest';

import {
    CatalogAssetAccessStrategy,
    createCatalogImageTransformStrategies,
} from './catalog-asset-access-strategy';

function harness(userId?: string) {
    const renderPublished = vi.fn().mockResolvedValue('<img src="/assets/preview/public-hero.jpg">');
    const getSessionFromToken = vi.fn().mockResolvedValue(userId ? { user: { id: userId } } : undefined);
    const instances = new Map<unknown, unknown>([
        [ConfigService, { authOptions: { tokenMethod: ['cookie', 'bearer'], apiKeyHeaderKey: 'x-api-key' } }],
        [SessionService, { getSessionFromToken }],
        [
            StorefrontPromotionAccessService,
            { resolveRequest: vi.fn().mockResolvedValue({ host: 'shop.example.com', ctx: {} }) },
        ],
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
    return { read, renderPublished };
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
    it('allows catalog media after authentication without loading public content', async () => {
        const test = harness('customer-a');
        await expect(test.read('/preview/private-product.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        expect(test.renderPublished).not.toHaveBeenCalled();
    });
});
