import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminImage, getAdminThumbnailUrl } from './admin-image';

describe('getAdminThumbnailUrl', () => {
    it('returns empty string for null or empty input', () => {
        expect(getAdminThumbnailUrl('')).toBe('');
        expect(getAdminThumbnailUrl(null)).toBe('');
        expect(getAdminThumbnailUrl(undefined)).toBe('');
    });

    it('transforms Vendure preview asset URL into WebP thumbnail URL', () => {
        const url = 'https://damatong.net/assets/preview/85/test-product__preview.png';
        const transformed = getAdminThumbnailUrl(url);
        expect(transformed).toContain('format=webp');
        expect(transformed).toContain('preset=storefront-thumbnail-160');
        expect(transformed).toContain('w=160');
        expect(transformed).toContain('h=160');
        expect(transformed).toContain('q=80');
    });

    it('transforms relative asset path', () => {
        const url = '/assets/preview/17/cover__preview.jpg';
        const transformed = getAdminThumbnailUrl(url, { width: 100, height: 100, quality: 75 });
        expect(transformed).toContain('/assets/preview/17/cover__preview.jpg?');
        expect(transformed).toContain('format=webp');
        expect(transformed).toContain('w=100');
        expect(transformed).toContain('h=100');
        expect(transformed).toContain('q=75');
    });

    it('leaves non-asset URLs untouched', () => {
        expect(getAdminThumbnailUrl('https://example.com/external.png')).toBe('https://example.com/external.png');
        expect(getAdminThumbnailUrl('data:image/svg+xml;base64,...')).toBe('data:image/svg+xml;base64,...');
    });
});

describe('AdminImage', () => {
    it('renders img with webp thumbnail src and lazy loading by default', () => {
        const markup = renderToStaticMarkup(
            <AdminImage
                src="/assets/preview/10/img.png"
                alt="Test"
                className="test-class"
            />,
        );
        expect(markup).toContain('src="/assets/preview/10/img.png?preset=storefront-thumbnail-160&amp;format=webp&amp;w=160&amp;h=160&amp;q=80"');
        expect(markup).toContain('loading="lazy"');
        expect(markup).toContain('decoding="async"');
        expect(markup).toContain('alt="Test"');
        expect(markup).toContain('class="test-class"');
    });

    it('renders fallbackIcon when src is missing', () => {
        const markup = renderToStaticMarkup(
            <AdminImage
                src={null}
                alt="Test"
                fallbackIcon={<span data-testid="fallback">No Image</span>}
            />,
        );
        expect(markup).toContain('No Image');
        expect(markup).not.toContain('<img');
    });
});
