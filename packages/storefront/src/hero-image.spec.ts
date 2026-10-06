import { describe, expect, it } from 'vitest';

import { heroImageForViewport } from '../../storefront-content-plugin/src/shared/hero-image';

describe('managed hero artwork by viewport', () => {
    const content = {
        imageUrl: '/assets/preview/desktop.webp',
        imageAsset: { width: 1600, height: 667 },
        settings: {
            mobileImageUrl: '/assets/preview/mobile.webp',
            mobileImageAssetId: 'mobile-asset',
            mobileImageWidth: 1200,
            mobileImageHeight: 910,
        },
    };

    it('keeps the original desktop image and dimensions when mobile artwork is configured', () => {
        expect(heroImageForViewport(content, true)).toEqual({
            imageUrl: content.imageUrl,
            imageAsset: content.imageAsset,
        });
    });

    it('selects the mobile composition and its own intrinsic dimensions', () => {
        const original = structuredClone(content);
        expect(heroImageForViewport(content, false)).toEqual({
            imageUrl: content.settings.mobileImageUrl,
            imageAsset: { width: 1200, height: 910 },
        });
        expect(content).toEqual(original);
    });

    it.each([undefined, null, '', '   ', 42])(
        'falls back to the desktop image for an absent or invalid mobile image (%s)',
        mobileImageUrl => {
            expect(
                heroImageForViewport(
                    { ...content, settings: { ...content.settings, mobileImageUrl } },
                    false,
                ),
            ).toEqual({ imageUrl: content.imageUrl, imageAsset: content.imageAsset });
        },
    );

    it('does not attach desktop proportions to mobile artwork without valid dimensions', () => {
        expect(
            heroImageForViewport(
                {
                    ...content,
                    settings: {
                        mobileImageUrl: ' /mobile.webp ',
                        mobileImageWidth: -1,
                        mobileImageHeight: NaN,
                    },
                },
                false,
            ),
        ).toEqual({ imageUrl: '/mobile.webp' });
    });

    it('handles missing content without inventing branded artwork', () => {
        expect(heroImageForViewport(undefined, false)).toEqual({ imageUrl: '' });
        expect(heroImageForViewport({ imageUrl: null }, true)).toEqual({ imageUrl: '' });
    });
});
