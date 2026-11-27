import { describe, expect, it } from 'vitest';

import { slugUrlTarget } from './public-slug-url';

const snapshot = {
    product: { id: '6257', slug: 'codex-go-1month' },
    collections: [
        { id: '2', slug: 'codex-subscription', children: [{ id: '7', slug: 'codex-go' }] },
        { id: '8', slug: 'claude-subscription', children: [] },
    ],
} as never;

describe('slug url adoption', () => {
    it('adopts a rendered product slug onto the id route in the same language', () => {
        expect(slugUrlTarget('/zh/p/codex-go-1month', snapshot)).toBe('/zh/product?id=6257');
        expect(slugUrlTarget('/en/p/codex-go-1month/', snapshot)).toBe('/en/product?id=6257');
    });

    it('adopts collection slugs including nested children', () => {
        expect(slugUrlTarget('/zh/c/codex-subscription', snapshot)).toBe('/zh/category?collectionId=2');
        expect(slugUrlTarget('/en/c/codex-go', snapshot)).toBe('/en/category?collectionId=7');
    });

    it('decodes an encoded slug before comparing', () => {
        expect(slugUrlTarget('/zh/p/codex%2Dgo%2D1month', snapshot)).toBe('/zh/product?id=6257');
        expect(slugUrlTarget('/zh/p/codex-go-1month%20', snapshot)).toBeNull();
    });

    it('ignores a slug that is not the rendered page, so a wrong URL still reaches 404', () => {
        expect(slugUrlTarget('/zh/p/other-product', snapshot)).toBeNull();
        expect(slugUrlTarget('/zh/c/missing-collection', snapshot)).toBeNull();
    });

    it('ignores unrelated paths and an empty snapshot', () => {
        expect(slugUrlTarget('/zh/product', snapshot)).toBeNull();
        expect(slugUrlTarget('/p/codex-go-1month', snapshot)).toBeNull();
        expect(slugUrlTarget('/zh/p/codex-go-1month', null)).toBeNull();
    });
});
