import { describe, expect, it } from 'vitest';

import { CollectionSummary } from '../types';

import { storefrontNavigationCollections } from './catalog';

const category = (id: string, overrides: Partial<CollectionSummary> = {}): CollectionSummary => ({
    id,
    name: id,
    slug: id,
    description: '',
    position: 0,
    parentId: 'root',
    featuredAsset: null,
    children: [],
    productVariantCount: 0,
    ...overrides,
});

describe('configured category navigation', () => {
    it('keeps a published illustrated category while its first products are pending', () => {
        const claude = category('claude', {
            featuredAsset: { id: 'icon-claude', preview: '/assets/claude.webp' },
        });

        expect(storefrontNavigationCollections([claude])).toEqual([claude]);
    });

    it('does not create navigation entries for unillustrated empty categories', () => {
        expect(
            storefrontNavigationCollections([
                category('unfinished'),
                category('blank-image', { featuredAsset: { id: 'blank', preview: '  ' } }),
            ]),
        ).toEqual([]);
    });

    it('keeps an illustrated child reachable through its empty parent', () => {
        const child = category('apple-id', {
            featuredAsset: { id: 'icon-apple', preview: '/assets/apple.webp' },
        });
        const parent = category('accounts', { children: [child, category('unfinished-child')] });

        expect(storefrontNavigationCollections([parent])).toEqual([{ ...parent, children: [child] }]);
    });

    it('preserves populated categories and legacy counts without images', () => {
        const populated = category('codex', { productVariantCount: 3 });
        const legacy = category('legacy', { productVariantCount: undefined });

        expect(storefrontNavigationCollections([populated, legacy])).toEqual([populated, legacy]);
    });

    it('still suppresses imported duplicate roots when an illustrated child exists', () => {
        const child = category('child', {
            name: 'Claude',
            slug: 'claude',
            featuredAsset: { id: 'claude', preview: '/assets/claude.webp' },
        });
        const root = category('parent', { children: [child] });
        const duplicate = category('duplicate', {
            name: 'Claude',
            slug: 'claude-2',
            featuredAsset: child.featuredAsset,
        });

        expect(storefrontNavigationCollections([root, duplicate])).toEqual([root]);
    });
});
