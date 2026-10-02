import { describe, expect, it, vi } from 'vitest';

import { CollectionSummary } from '../types';

import { CatalogApi, storefrontNavigationCollections } from './catalog';
import { ShopApiContext } from './client-context';

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
    it('loads categories beyond the first page and preserves configured root and child order', async () => {
        const items = Array.from({ length: 103 }, (_, index) =>
            category(String(index), {
                position: index,
                productVariantCount: 1,
                children: [
                    category(`${index}-second`, { position: 2, productVariantCount: 1 }),
                    category(`${index}-first`, { position: 1, productVariantCount: 1 }),
                ],
            }),
        );
        const request = vi.fn((_query: string, variables: { skip: number }) =>
            Promise.resolve({
                collections: {
                    totalItems: items.length,
                    items: items.slice(variables.skip, variables.skip + 100),
                },
            }),
        );
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        const result = await api.collections();
        expect(result).toHaveLength(103);
        expect(request.mock.calls.map(call => call[1].skip)).toEqual([0, 100]);
        expect(result[102].children?.map(child => child.id)).toEqual(['102-first', '102-second']);
    });

    it('propagates recommendation failures instead of treating them as zero sales', async () => {
        const request = vi.fn().mockRejectedValue(new Error('Sales unavailable'));
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        await expect(api.dailyRecommendations()).rejects.toThrow('Sales unavailable');
        expect(request).toHaveBeenCalledTimes(1);
    });

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
