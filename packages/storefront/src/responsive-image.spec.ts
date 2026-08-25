import { describe, expect, it } from 'vitest';

import { responsiveImageSources, storefrontWebpUrl } from './responsive-image';

describe('responsiveImageSources', () => {
    it('builds WebP-only card variants without losing existing query parameters', () => {
        const sources = responsiveImageSources('/assets/preview/product.jpg?token=public', 'card');

        expect(sources).toMatchObject({
            width: 640,
            height: 560,
            sizes: '(min-width: 900px) 300px, calc(50vw - 14px)',
        });
        expect(sources?.webpSrcSet).toContain('preset=storefront-card-320');
        expect(sources?.webpSrcSet).toContain('format=webp');
        expect(sources?.fallbackSrcSet).toBe(sources?.webpSrcSet);
        expect(sources?.fallbackSrc).toContain('token=public');
        expect(sources?.fallbackSrc).toContain('preset=storefront-card-640');
        expect(JSON.stringify(sources)).not.toContain('format=avif');
        expect(JSON.stringify(sources)).not.toContain('format=jpg');
    });

    it('keeps external non-Vendure images unchanged and serves the bundled hero as WebP', () => {
        expect(responsiveImageSources('https://images.example.com/product.jpg', 'card')).toBeNull();
        expect(responsiveImageSources('/storefront/default-hero.jpg', 'hero')).toMatchObject({
            webpSrcSet: '/storefront/default-hero.webp 800w',
            fallbackSrc: '/storefront/default-hero.webp',
            fallbackSrcSet: '/storefront/default-hero.webp 800w',
            width: 800,
            height: 496,
        });
    });

    it('returns a directly renderable WebP URL for uploaded assets', () => {
        expect(storefrontWebpUrl('/assets/preview/logo.png', 'thumbnail')).toContain(
            'preset=storefront-thumbnail-320&format=webp&q=75',
        );
        expect(storefrontWebpUrl('https://images.example.com/logo.png', 'thumbnail')).toBe(
            'https://images.example.com/logo.png',
        );
    });

    it('keeps SVG assets as vectors instead of rasterizing them', () => {
        expect(responsiveImageSources('/assets/source/icon.svg', 'thumbnail')).toBeNull();
        expect(storefrontWebpUrl('/assets/source/icon.svg', 'thumbnail')).toBe('/assets/source/icon.svg');
    });
});
