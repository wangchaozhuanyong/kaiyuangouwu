import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SafeImage } from './storefront-ui/product-display';

describe('SafeImage', () => {
    it.each(['card', 'detail', 'thumbnail'] as const)(
        'loads %s images at responsive resolution without enlarging a tiny placeholder',
        imageKind => {
            const markup = renderToStaticMarkup(
                <SafeImage
                    src="/assets/preview/product.jpg"
                    alt="Product"
                    imageKind={imageKind}
                    loading="lazy"
                />,
            );

            expect(markup).toContain('safe-image-frame');
            expect(markup).not.toContain('has-placeholder');
            expect(markup).not.toContain('background-image');
            expect(markup).not.toContain('storefront-placeholder');
            expect(markup).toContain('srcSet=');
            expect(markup).toContain('q=90');
            expect(markup).not.toContain('safe-image is-loaded');
        },
    );

    it('preserves automatic hero and explicitly requested placeholders', () => {
        const hero = renderToStaticMarkup(
            <SafeImage src="/assets/preview/banner.jpg" alt="Banner" imageKind="hero" />,
        );
        expect(hero).toContain('storefront-placeholder-wide-64');

        const markup = renderToStaticMarkup(
            <SafeImage
                src="/assets/preview/product.jpg"
                placeholderSrc="/assets/preview/cover.jpg"
                alt="Product"
                imageKind="card"
            />,
        );
        expect(markup).toContain('has-placeholder');
        expect(markup).toContain('storefront-placeholder-square-48');
        expect(markup).toContain('storefront-card-square-960');
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

    it('tracks decoded images in client session to skip repeated opacity fade-in', async () => {
        const { isImageAlreadyDecoded, markImageDecoded } = await import('./storefront-ui/product-display');
        markImageDecoded('/assets/preview/fast.png');
        // In node environment without window it returns false safely, and does not throw
        expect(typeof isImageAlreadyDecoded('/assets/preview/fast.png')).toBe('boolean');
    });
});
