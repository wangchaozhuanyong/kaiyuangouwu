import { describe, expect, it } from 'vitest';

import { contentBlockHasImage, contentBlockImagePreview } from './storefront-content-images';

type ContentBlock = Parameters<typeof contentBlockHasImage>[0];

function block(overrides: Partial<ContentBlock> = {}): ContentBlock {
    return {
        code: 'home-hero',
        internalName: '首页轮播',
        type: 'HERO',
        layoutVariant: 'HERO_OVERLAY',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [],
        items: [],
        ...overrides,
    };
}

describe('storefront content images', () => {
    it('prefers the current Asset preview over a legacy image URL', () => {
        const hero = block({
            imageAsset: { id: 'asset-1', preview: '/assets/preview/hero.webp' } as never,
            imageUrl: '/assets/preview/legacy.jpg',
        });

        expect(contentBlockImagePreview(hero)).toBe('/assets/preview/hero.webp');
        expect(contentBlockHasImage(hero)).toBe(true);
    });

    it('reports a missing image when neither an Asset nor an image URL is configured', () => {
        expect(contentBlockImagePreview(block())).toBeNull();
        expect(contentBlockHasImage(block())).toBe(false);
    });
});
