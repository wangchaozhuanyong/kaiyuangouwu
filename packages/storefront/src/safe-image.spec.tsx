import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SafeImage } from './storefront-ui/product-display';

describe('SafeImage', () => {
    it('renders an automatic placeholder and high-resolution responsive source for uploaded images', () => {
        const markup = renderToStaticMarkup(
            <SafeImage src="/assets/preview/product.jpg" alt="Product" imageKind="card" loading="lazy" />,
        );

        expect(markup).toContain('safe-image-frame');
        expect(markup).toContain('has-placeholder');
        expect(markup).toContain('storefront-placeholder-square-48');
        expect(markup).toContain('storefront-card-square-960');
        expect(markup).toContain('q=90');
        expect(markup).not.toContain('safe-image is-loaded');
    });

    it('keeps a stable frame for external images while they decode', () => {
        const markup = renderToStaticMarkup(
            <SafeImage src="https://images.example.com/product.jpg" alt="Product" loading="lazy" />,
        );

        expect(markup).toContain('<span class="responsive-picture safe-image-frame"');
        expect(markup).toContain('class="safe-image"');
    });

    it('allows compact components to select a smaller responsive image candidate', () => {
        const markup = renderToStaticMarkup(
            <SafeImage src="/assets/preview/icon.png" alt="" imageKind="thumbnail" sizes="48px" />,
        );

        expect(markup).toContain('sizes="48px"');
        expect(markup).toContain('storefront-thumbnail-160');
        expect(markup).toContain('storefront-thumbnail-320');
    });
});
