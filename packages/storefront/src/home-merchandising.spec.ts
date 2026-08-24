import { describe, expect, it } from 'vitest';

import {
    buildBestSellerProducts,
    buildRecommendationProducts,
    selectManagedProducts,
} from './home-merchandising';
import { Product } from './types';

describe('home merchandising', () => {
    it('keeps pinned products first and then orders by real sales', () => {
        const products = [product('a', 'one'), product('b', 'one'), product('c', 'two')];
        expect(
            buildBestSellerProducts({
                pinnedProducts: [products[2]],
                candidates: products,
                salesByProductId: { a: 3, b: 12, c: 1 },
                count: 3,
                seed: 'store:day',
            }).map(item => item.id),
        ).toEqual(['c', 'b', 'a']);
    });

    it('uses a stable random fallback when every product has zero sales', () => {
        const products = [product('a', 'one'), product('b', 'one'), product('c', 'two')];
        const first = buildBestSellerProducts({
            pinnedProducts: [],
            candidates: products,
            salesByProductId: {},
            count: 3,
            seed: 'store:day',
        });
        const second = buildBestSellerProducts({
            pinnedProducts: [],
            candidates: products,
            salesByProductId: {},
            count: 3,
            seed: 'store:day',
        });
        expect(second.map(item => item.id)).toEqual(first.map(item => item.id));
        expect(new Set(first.map(item => item.id))).toEqual(new Set(['a', 'b', 'c']));
    });

    it('prioritizes purchased categories, then browsing categories, then fallback products', () => {
        const purchased = product('purchased', 'ai');
        const viewed = product('viewed', 'design');
        const candidates = [
            product('random', 'other'),
            product('from-view', 'design'),
            product('from-order', 'ai'),
        ];
        expect(
            buildRecommendationProducts({
                candidates,
                sourceProducts: [purchased, viewed],
                purchaseSourceIds: ['purchased'],
                recentProductIds: ['viewed'],
                count: 3,
                seed: 'store:day',
            }).map(item => item.id),
        ).toEqual(['from-order', 'from-view', 'random']);
    });

    it('keeps the configured product order for custom content and ignores unavailable products', () => {
        const products = [product('a', 'one'), product('b', 'one'), product('c', 'two')];
        expect(
            selectManagedProducts({
                productIds: ['c', 'missing', 'a', 'c', 'b'],
                products,
                count: 2,
            }).map(item => item.id),
        ).toEqual(['c', 'a']);
    });
});

function product(id: string, collectionId: string): Product {
    return {
        id,
        createdAt: '2026-08-23T00:00:00.000Z',
        name: id,
        slug: id,
        description: '',
        featuredAsset: null,
        assets: [],
        collections: [{ id: collectionId, name: collectionId, slug: collectionId, parentId: '' }],
        variants: [],
    };
}
