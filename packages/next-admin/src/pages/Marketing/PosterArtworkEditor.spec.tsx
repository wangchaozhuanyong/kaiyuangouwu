import { describe, expect, it } from 'vitest';
import {
    DEFAULT_ARTWORK_POSTER_DESIGN,
    validateArtworkPosterDesign,
} from '../../../../common/src/referral-poster-design';
import { artworkAssetRatioError, posterPreviewUrl, resizeArtworkCanvas } from './poster-artwork-helpers';

describe('poster canvas sizing', () => {
    it.each([
        [1080, 1440],
        [1080, 1080],
        [721, 1281],
    ])('keeps the complete circular area inside a %s×%s canvas', (width, height) => {
        const design = resizeArtworkCanvas(DEFAULT_ARTWORK_POSTER_DESIGN, width, height);
        expect(design.canvas).toEqual({ width, height });
        expect(validateArtworkPosterDesign(design)).toBe('');
        expect(design.qr.style).toBe('minimal');
    });
    it('accepts proportional uploads, rejects mismatched artwork without applying a crop', () => {
        expect(artworkAssetRatioError(DEFAULT_ARTWORK_POSTER_DESIGN, 2160, 3840)).toBe('');
        expect(artworkAssetRatioError(DEFAULT_ARTWORK_POSTER_DESIGN, 1080, 1080)).toContain('不会裁切');
    });
    it('uses only a safe current storefront origin and labels its synthetic referral', () => {
        expect(posterPreviewUrl('https://shop.example/path')).toBe(
            'https://shop.example/register?ref=PREVIEW&source=POSTER',
        );
        expect(posterPreviewUrl('javascript:alert(1)')).toContain('https://store.example/');
    });
});
