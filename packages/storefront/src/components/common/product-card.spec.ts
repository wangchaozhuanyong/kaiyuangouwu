import { describe, expect, it } from 'vitest';

import { resolveProductSubtitle } from '../../storefront-ui/product-display';
import { readStorefrontStylesheet } from '../../test-stylesheet';
import { Product } from '../../types';

function product(overrides: Partial<Product>): Product {
    return {
        id: 'product-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        name: '333牡丹(软)',
        slug: '333-mudan',
        description: '',
        featuredAsset: null,
        assets: [],
        collections: [],
        variants: [],
        ...overrides,
    };
}

describe('product card subtitle', () => {
    it('uses the shared skin elevation instead of a dark mobile perimeter', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/product-card.css']);

        expect(stylesheet).toMatch(
            /\.product-card\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--product-card-surface, var\(--surface\)\);[^}]*box-shadow:\s*var\(--skin-card-shadow\);/u,
        );
        expect(stylesheet).toContain('aspect-ratio: var(--product-media-ratio);');
        expect(stylesheet).toContain('color: var(--availability-unavailable);');
    });

    it('prefers a meaningful product description', () => {
        expect(
            resolveProductSubtitle(
                product({
                    description: '<p>大马通专注华人生活服务</p>',
                    collections: [{ id: 'child', name: '牡丹', slug: 'mudan', parentId: 'parent' }],
                }),
            ),
        ).toBe('大马通专注华人生活服务');
    });

    it('uses an existing complete short clause for narrow product cards', () => {
        const item = product({
            description: '按照官方Api价格为基础计算，1人民币可以购买1元美金的Token额度。',
        });

        expect(resolveProductSubtitle(item, 26, true)).toBe('按照官方Api价格为基础计算');
        expect(resolveProductSubtitle(item, 48)).toContain('1人民币可以购买');
    });

    it('falls back to the most specific collection when the description is unavailable', () => {
        expect(
            resolveProductSubtitle(
                product({
                    collections: [
                        { id: 'parent', name: '正品烟草', slug: 'tobacco', parentId: 'root' },
                        { id: 'child', name: '牡丹', slug: 'mudan', parentId: 'parent' },
                    ],
                }),
            ),
        ).toBe('牡丹');
    });

    it('does not repeat the product name as the second line', () => {
        expect(
            resolveProductSubtitle(
                product({
                    description: '333牡丹(软)',
                    collections: [
                        { id: 'same', name: '333牡丹(软)', slug: 'same', parentId: 'root' },
                        { id: 'parent', name: '正品烟草', slug: 'tobacco', parentId: 'root' },
                    ],
                }),
            ),
        ).toBe('正品烟草');
    });
});
