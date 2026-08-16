import { describe, expect, it } from 'vitest';

import { responsiveImageSources } from './responsive-image';

describe('responsiveImageSources', () => {
    it('builds card AVIF, WebP and JPEG variants without losing existing query parameters', () => {
        const sources = responsiveImageSources('/assets/preview/product.jpg?token=public', 'card');

        expect(sources).toMatchObject({
            width: 640,
            height: 560,
            sizes: '(min-width: 900px) 300px, calc(50vw - 14px)',
        });
        expect(sources?.avifSrcSet).toContain('preset=storefront-card-320');
        expect(sources?.avifSrcSet).toContain('format=avif');
        expect(sources?.webpSrcSet).toContain('format=webp');
        expect(sources?.fallbackSrcSet).toContain('format=jpg');
        expect(sources?.fallbackSrc).toContain('token=public');
        expect(sources?.fallbackSrc).toContain('preset=storefront-card-640');
    });

    it('keeps external non-Vendure images unchanged and serves the bundled hero in modern formats', () => {
        expect(responsiveImageSources('https://images.example.com/product.jpg', 'card')).toBeNull();
        expect(responsiveImageSources('/storefront/default-hero.jpg', 'hero')).toMatchObject({
            avifSrcSet: '/storefront/default-hero.avif 800w',
            webpSrcSet: '/storefront/default-hero.webp 800w',
            fallbackSrc: '/storefront/default-hero.jpg',
            width: 800,
            height: 496,
        });
    });
});
