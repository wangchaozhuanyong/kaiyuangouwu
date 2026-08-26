import { describe, expect, it } from 'vitest';

import { responsiveImageSources, storefrontWebpUrl } from './responsive-image';

describe('responsiveImageSources', () => {
    it('builds WebP-only card variants without losing existing query parameters', () => {
        const sources = responsiveImageSources('/assets/preview/product.jpg?token=public', 'card');

        expect(sources).toMatchObject({
            width: 960,
            height: 960,
            sizes: '(min-width: 900px) 300px, calc(50vw - 14px)',
        });
        expect(sources?.webpSrcSet).toContain('preset=storefront-card-square-320');
        expect(sources?.webpSrcSet).toContain('preset=storefront-card-square-960');
        expect(sources?.webpSrcSet).toContain('format=webp');
        expect(sources?.webpSrcSet).toContain('q=90');
        expect(sources?.fallbackSrcSet).toBe(sources?.webpSrcSet);
        expect(sources?.fallbackSrc).toContain('token=public');
        expect(sources?.fallbackSrc).toContain('preset=storefront-card-square-960');
        expect(sources?.placeholderSrc).toContain('preset=storefront-placeholder-square-48');
        expect(sources?.placeholderSrc).toContain('q=75');
        expect(JSON.stringify(sources)).not.toContain('format=avif');
        expect(JSON.stringify(sources)).not.toContain('format=jpg');
    });

    it('keeps external non-Vendure images unchanged and serves the bundled hero as WebP', () => {
        expect(responsiveImageSources('https://images.example.com/product.jpg', 'card')).toBeNull();
        const bundledHero = responsiveImageSources('/storefront/default-hero.jpg', 'hero');
        expect(bundledHero).toMatchObject({ width: 1376, height: 768 });
        expect(bundledHero?.webpSrcSet).toContain('default-hero-480.webp');
        expect(bundledHero?.webpSrcSet).toContain('default-hero-1376.webp');
        expect(bundledHero?.placeholderSrc).toContain('default-hero-32.webp');
    });

    it('returns a directly renderable WebP URL for uploaded assets', () => {
        expect(storefrontWebpUrl('/assets/preview/logo.png', 'thumbnail')).toContain(
            'preset=storefront-thumbnail-320&format=webp&q=90',
        );
        expect(storefrontWebpUrl('https://images.example.com/logo.png', 'thumbnail')).toBe(
            'https://images.example.com/logo.png',
        );
    });

    it('normalizes raw Vendure asset identifiers returned by custom API fields', () => {
        const sources = responsiveImageSources('preview/2b/product__preview.png', 'card');

        expect(sources?.fallbackSrc).toContain('/assets/preview/2b/product__preview.png');
        expect(sources?.fallbackSrc).toContain('preset=storefront-card-square-960');
        expect(storefrontWebpUrl('source/2b/product.png', 'thumbnail')).toContain(
            '/assets/source/2b/product.png',
        );
    });

    it('keeps SVG assets as vectors instead of rasterizing them', () => {
        expect(responsiveImageSources('/assets/source/icon.svg', 'thumbnail')).toBeNull();
        expect(storefrontWebpUrl('/assets/source/icon.svg', 'thumbnail')).toBe('/assets/source/icon.svg');
    });

    it('does not mistake Vite content-hashed files for Vendure transformable assets', () => {
        expect(responsiveImageSources('/assets/auth-hero.B5q2.webp', 'hero')).toBeNull();
    });
});
