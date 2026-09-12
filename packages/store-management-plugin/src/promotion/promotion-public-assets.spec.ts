import { describe, expect, it } from 'vitest';

import { promotionAssetPaths } from './promotion-public-assets';

describe('public promotion media', () => {
    it('allows only exact same-origin assets referenced by the rendered public page', () => {
        const paths = promotionAssetPaths(
            `
            <img src="/assets/preview/hero.jpg?preset=wide">
            <img srcset="/assets/preview/small.jpg 480w, /assets/preview/large.jpg 960w">
            <div style="background:url('/assets/source/paper.png')"></div>
            <img src="https://other.example/assets/preview/private.jpg">
            <a href="/assets/source/catalog.csv">Catalog</a>
        `,
            'https://shop.example.com',
        );
        expect([...paths].sort()).toEqual([
            'preview/hero.jpg',
            'preview/large.jpg',
            'preview/small.jpg',
            'source/paper.png',
        ]);
        expect(paths.has('cache/preview/hero_transformed.jpg')).toBe(false);
        expect(paths.has('source/catalog.csv')).toBe(false);
        expect(paths.has('preview/private.jpg')).toBe(false);
    });
});
