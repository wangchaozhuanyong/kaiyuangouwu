import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CatalogApi } from './api/catalog';
import {
    DesktopCategoryNavigation,
    DesktopSubcategoryNavigation,
} from './components/common/desktop-category-navigation';
import { DesktopCatalogPage } from './pages/desktop-catalog-page';
import { RouteState } from './storefront-router';
import { StorefrontContext, type StorefrontContextValue } from './StorefrontContext';
import { readStorefrontStylesheet } from './test-stylesheet';
import { CollectionSummary } from './types';

const child: CollectionSummary = {
    id: 'child',
    name: '后台子分类',
    slug: 'child',
    description: '',
    position: 0,
    parentId: 'parent',
    featuredAsset: null,
};
const collections: CollectionSummary[] = [
    {
        ...child,
        id: 'parent',
        name: '后台商品分类',
        slug: 'parent',
        parentId: 'root',
        children: [child],
    },
];

function renderCategories(route: RouteState, overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
        <StorefrontContext.Provider
            value={
                {
                    route,
                    collections,
                    language: 'zh',
                    loading: false,
                    error: null,
                    navigate: vi.fn(),
                    refetchStorefront: vi.fn(),
                    ...overrides,
                } as unknown as StorefrontContextValue
            }
        >
            <DesktopCategoryNavigation />
        </StorefrontContext.Provider>,
    );
}

function renderSubcategories(route: RouteState) {
    return renderToStaticMarkup(
        <StorefrontContext.Provider
            value={
                {
                    route,
                    collections,
                    language: 'zh',
                    navigate: vi.fn(),
                } as unknown as StorefrontContextValue
            }
        >
            <DesktopSubcategoryNavigation />
        </StorefrontContext.Provider>,
    );
}

describe('desktop catalog category navigation', () => {
    it.each(['home', 'category', 'search'] as const)('renders managed categories on %s', name => {
        const html = renderCategories({ name });
        expect(html).toContain('aria-label="商品分类"');
        expect(html).toContain('后台商品分类');
    });

    it('uses the same managed category image on desktop as mobile, ahead of a product fallback', () => {
        const managedCollection: CollectionSummary = {
            ...collections[0],
            featuredAsset: { id: 'managed-category', preview: 'https://example.test/category.png' },
        };
        const product = {
            id: 'product',
            collections: [{ id: managedCollection.id, parentId: managedCollection.parentId }],
            featuredAsset: { id: 'product-image', preview: 'https://example.test/product.png' },
            assets: [],
        };
        const html = renderCategories(
            { name: 'category', collectionId: managedCollection.id },
            { collections: [managedCollection], products: [product] },
        );
        expect(html).toContain('https://example.test/category.png');
        expect(html).not.toContain('https://example.test/product.png');
        expect(html).toContain('desktop-category-icon');
    });
    it.each(['services', 'cart', 'account', 'orders', 'product'] as const)(
        'does not reserve catalog navigation on %s',
        name => {
            expect(renderCategories({ name })).toBe('');
        },
    );

    it('selects all products on home and the selected parent and child on category pages', () => {
        expect(renderCategories({ name: 'home' }).match(/aria-pressed="true"/g)).toHaveLength(1);
        const category = renderCategories({ name: 'category', collectionId: 'parent', childId: 'child' });
        const subcategories = renderSubcategories({
            name: 'category',
            collectionId: 'parent',
            childId: 'child',
        });
        expect(category.match(/aria-pressed="true"/g)).toHaveLength(1);
        expect(category).not.toContain('一级分类');
        expect(category).not.toContain('二级分类');
        expect(subcategories).toContain('后台商品分类');
        expect(subcategories).toContain('后台子分类');
        expect(subcategories.match(/aria-pressed="true"/g)).toHaveLength(1);
    });

    it('keeps the primary navigation visible in the actual desktop product listing', () => {
        const markup = renderToStaticMarkup(
            <QueryClientProvider client={new QueryClient()}>
                <StorefrontContext.Provider
                    value={
                        {
                            route: { name: 'category', collectionId: 'parent', childId: 'all' },
                            collections,
                            language: 'zh',
                            market: { code: 'MY', currencyCode: 'MYR', locale: 'zh-CN' },
                            locale: 'zh-CN',
                            contentBlocks: [],
                            storefrontName: '店铺',
                            storefrontTagline: '',
                            api: { catalog: vi.fn() },
                            navigate: vi.fn(),
                        } as unknown as StorefrontContextValue
                    }
                >
                    <DesktopCatalogPage />
                </StorefrontContext.Provider>
            </QueryClientProvider>,
        );
        expect(markup).toContain('后台商品分类');
        expect(markup).not.toContain('一级分类');
        expect(markup).not.toContain('二级分类');
        expect(markup).toContain('desktop-subcategory-sidebar');
        expect(markup).not.toContain('load-more-button');
        expect(markup).toContain('aria-label="店铺政策"');
        expect(markup).not.toContain('desktop-services-link');
        expect(markup).not.toContain('查看店铺提供的服务与工具');
    });

    it('keeps the subcategory list scrollable without showing a native scrollbar', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/desktop-commerce.css']);

        expect(stylesheet).toMatch(
            // eslint-disable-next-line max-len -- The full hidden-scrollbar contract belongs to one rule.
            /\.desktop-subcategory-sidebar nav\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*scrollbar-width:\s*none;[^}]*-ms-overflow-style:\s*none;/,
        );
        expect(stylesheet).toMatch(
            /\.desktop-subcategory-sidebar nav::\-webkit-scrollbar\s*\{[^}]*display:\s*none;/,
        );
    });

    it('keeps one standalone legal footer without duplicating the services navigation', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/desktop-commerce.css']);

        expect(stylesheet).toMatch(
            /\.desktop-catalog-footer\s*\{[^}]*margin-top:\s*36px;[^}]*border-radius:\s*var\(--skin-card-radius\);[^}]*background:\s*var\(--surface\);/,
        );
        expect(stylesheet).not.toContain('.desktop-services-link');
    });

    it('does not imply a category selection on a service page even when old filters remain', () => {
        const html = renderCategories({ name: 'services', collectionId: 'parent', childId: 'child' });
        expect(html).not.toContain('aria-pressed="true"');
        expect(html).not.toContain('后台子分类');
    });

    it('keeps navigation available while categories load or need a retry', () => {
        const loading = renderCategories({ name: 'category' }, { loading: true, collections: [] });
        expect(loading).toContain('正在加载分类');
        expect(loading).toContain('全部商品');
        expect(renderCategories({ name: 'category' }, { error: 'offline' })).toContain('重新加载分类');
    });

    it('renders categories in strict ascending order of position', () => {
        const orderedCollections: CollectionSummary[] = [
            { ...child, id: 'cat-a', name: '首位分类', position: 0, children: [] },
            { ...child, id: 'cat-b', name: '次位分类', position: 1, children: [] },
            { ...child, id: 'cat-c', name: '末位分类', position: 2, children: [] },
        ];
        const html = renderCategories({ name: 'category' }, { collections: orderedCollections });
        const idxA = html.indexOf('首位分类');
        const idxB = html.indexOf('次位分类');
        const idxC = html.indexOf('末位分类');
        expect(idxA).toBeGreaterThan(-1);
        expect(idxB).toBeGreaterThan(idxA);
        expect(idxC).toBeGreaterThan(idxB);
    });

    it('CatalogApi.collections sorts both top-level and children collections by position: ASC', async () => {
        const mockRequest = vi.fn().mockResolvedValue({
            collections: {
                items: [
                    {
                        id: 'cat-2',
                        name: '分类2',
                        slug: 'cat-2',
                        description: '',
                        position: 5,
                        parentId: 'root',
                        featuredAsset: null,
                        children: [
                            {
                                id: 'child-2b',
                                name: '子2B',
                                slug: 'c2b',
                                description: '',
                                position: 2,
                                parentId: 'cat-2',
                                featuredAsset: null,
                            },
                            {
                                id: 'child-2a',
                                name: '子2A',
                                slug: 'c2a',
                                description: '',
                                position: 1,
                                parentId: 'cat-2',
                                featuredAsset: null,
                            },
                        ],
                    },
                    {
                        id: 'cat-1',
                        name: '分类1',
                        slug: 'cat-1',
                        description: '',
                        position: 1,
                        parentId: 'root',
                        featuredAsset: null,
                        children: [],
                    },
                ],
            },
        });

        const api = new CatalogApi({
            market: { code: 'MY', locale: 'zh-CN', currencyCode: 'MYR' } as any,
            request: mockRequest,
        } as any);

        const result = await api.collections();
        expect(result.map(c => c.id)).toEqual(['cat-1', 'cat-2']);
        expect(result[1].children?.map(c => c.id)).toEqual(['child-2a', 'child-2b']);
    });

    it('keeps nested categories out of primary navigation when an import created a suffixed root duplicate', async () => {
        const mockRequest = vi.fn().mockResolvedValue({
            collections: {
                items: [
                    {
                        ...child,
                        id: 'tobacco',
                        name: '正品烟草',
                        slug: 'tobacco',
                        parentId: 'root',
                        children: [
                            {
                                ...child,
                                id: 'peony-child',
                                name: '牡丹',
                                slug: '牡丹',
                                parentId: 'tobacco',
                            },
                        ],
                    },
                    {
                        ...child,
                        id: 'peony-root-duplicate',
                        name: '牡丹',
                        slug: '牡丹-2',
                        parentId: 'root',
                        children: [],
                    },
                    {
                        ...child,
                        id: 'legitimate-root',
                        name: '牡丹',
                        slug: 'seasonal-peony',
                        parentId: 'root',
                        children: [],
                    },
                    {
                        ...child,
                        id: 'ai-subscription',
                        name: 'AI 订阅',
                        slug: 'ai-subscription',
                        parentId: 'root',
                        children: [],
                    },
                ],
            },
        });
        const api = new CatalogApi({
            market: { code: 'MY', locale: 'zh-CN', currencyCode: 'MYR' } as any,
            request: mockRequest,
        } as any);

        const result = await api.collections();

        expect(result.map(collection => collection.id)).toEqual([
            'tobacco',
            'legitimate-root',
            'ai-subscription',
        ]);
        expect(result[0].children?.map(collection => collection.id)).toEqual(['peony-child']);
    });
});
