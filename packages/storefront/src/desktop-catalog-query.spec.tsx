import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { catalogInputFromRoute, catalogRouteWithChanges } from './catalog-route-query';
import { ProductRow } from './components/common/product-row';
import { readStorefrontStylesheet } from './test-stylesheet';
import { MarketConfig, Product } from './types';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
}));

describe('desktop catalog navigation', () => {
    it('baseline-aligns shared heading metadata instead of vertically centering smaller copy', () => {
        const sharedStylesheet = readStorefrontStylesheet(['./styles/home-showcase.css']);
        const desktopStylesheet = readStorefrontStylesheet([
            './styles/desktop-commerce.css',
            './styles/desktop-home.css',
        ]);

        expect(sharedStylesheet).toMatch(/\.section-heading-inline\s*\{[^}]*align-items:\s*baseline;/u);
        expect(sharedStylesheet).toMatch(
            /\.section-header\.has-end-subtitle\s*\{[^}]*align-items:\s*flex-end;/u,
        );
        expect(desktopStylesheet).toMatch(/\.proto-product-heading\s*\{[^}]*align-items:\s*baseline;/u);
    });

    it('groups catalog heading and controls into one balanced desktop toolbar module', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/desktop-commerce.css']);

        expect(stylesheet).toMatch(
            // eslint-disable-next-line max-len -- This expression guards the complete desktop toolbar module.
            /\.desktop-catalog-toolbar\s*\{[^}]*align-items:\s*center;[^}]*min-height:\s*0;[^}]*padding:\s*10px 12px;[^}]*border-radius:\s*var\(--skin-card-radius\);[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*var\(--skin-card-shadow\);/u,
        );
        expect(stylesheet).toMatch(
            /\.desktop-catalog-heading\s*\{[^}]*min-height:\s*0;[^}]*align-self:\s*center;/u,
        );
        expect(stylesheet).toMatch(
            /\.desktop-catalog-actions\s*\{[^}]*margin-left:\s*auto;[^}]*background:\s*var\(--soft\);/u,
        );
    });

    it('clears remembered category filters and starts home controls from the visible all-products state', () => {
        const remembered = {
            collectionId: 'old-category',
            childId: 'old-child',
            minPrice: '100',
            maxPrice: '200',
            fulfillment: 'digital' as const,
            inStockOnly: true,
        };
        const reset = { ...remembered, ...catalogRouteWithChanges({ name: 'home' }) };
        expect(reset).toMatchObject({
            collectionId: 'all',
            childId: 'all',
            minPrice: undefined,
            maxPrice: undefined,
            fulfillment: 'all',
            inStockOnly: false,
        });
        const stock = {
            ...remembered,
            ...catalogRouteWithChanges({ name: 'home' }, { inStockOnly: true }),
        };
        expect(catalogInputFromRoute(stock)).toMatchObject({
            collectionId: undefined,
            minPriceWithTax: undefined,
            maxPriceWithTax: undefined,
            inStockOnly: true,
        });
    });
    it('preserves category, child, search and filters when the visible sort changes', () => {
        const route = {
            name: 'category' as const,
            collectionId: 'parent',
            childId: 'child',
            fulfillment: 'digital' as const,
            inStockOnly: true,
            minPrice: '10',
            maxPrice: '100',
            sort: 'recommended' as const,
        };
        expect(catalogRouteWithChanges(route, { sort: 'newest' })).toMatchObject({
            ...route,
            sort: 'newest',
        });
        expect(
            catalogRouteWithChanges(
                { name: 'search', term: 'Token', inStockOnly: true },
                { sort: 'price-asc' },
            ),
        ).toMatchObject({ name: 'search', term: 'Token', inStockOnly: true, sort: 'price-asc' });
    });
    it('loads the complete catalog on the home page without selecting the first category', () => {
        expect(catalogInputFromRoute({ name: 'home' })).toMatchObject({
            collectionId: undefined,
            term: undefined,
            sort: 'recommended',
            inStockOnly: false,
        });
        expect(
            catalogInputFromRoute({ name: 'category', collectionId: 'all', childId: 'all' }).collectionId,
        ).toBeUndefined();
    });

    it('keeps the parent scope for All and uses the child scope when selected', () => {
        expect(
            catalogInputFromRoute({ name: 'category', collectionId: 'parent', childId: 'all' }).collectionId,
        ).toBe('parent');
        expect(
            catalogInputFromRoute({ name: 'category', collectionId: 'parent', childId: 'child' })
                .collectionId,
        ).toBe('child');
    });

    it('sends search, stock, fulfillment, and minor-unit prices to the existing catalog API', () => {
        expect(
            catalogInputFromRoute({
                name: 'search',
                term: ' Token ',
                sort: 'price-desc',
                inStockOnly: true,
                fulfillment: 'digital',
                minPrice: '1.25',
                maxPrice: '100.99',
            }),
        ).toEqual({
            collectionId: undefined,
            term: 'Token',
            sort: 'price-desc',
            inStockOnly: true,
            fulfillmentType: 'digital',
            minPriceWithTax: 125,
            maxPriceWithTax: 10099,
        });
    });
});

describe('desktop catalog card', () => {
    const market: MarketConfig = {
        code: '__default_channel__',
        defaultLanguageCode: 'zh_Hans',
        currencyCode: 'CNY',
        countryCode: 'CN',
        locale: 'zh-CN',
        label: 'China',
    };
    const product: Product = {
        id: 'product-1',
        name: '后台商品名称',
        slug: 'managed-product',
        createdAt: '2026-09-05',
        description: '后台交付说明',
        assets: [],
        collections: [],
        featuredAsset: null,
        variants: [
            {
                id: 'v1',
                name: '后台规格',
                sku: 'managed-sku',
                priceWithTax: 12345,
                currencyCode: 'CNY',
                stockLevel: 'OUT_OF_STOCK',
                saleableStockLevel: 0,
                featuredAsset: null,
                product: { id: 'product-1', name: '后台商品名称', featuredAsset: null },
                customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'manual_service' },
            },
        ],
    };
    it('keeps real copy, amount and sold-out state while retaining an accessible details action', () => {
        const html = renderToStaticMarkup(
            <ProductRow
                product={product}
                market={market}
                locale="zh-CN"
                language="zh"
                layout="catalog"
                onOpen={() => undefined}
            />,
        );
        expect(html).toContain('后台商品名称');
        expect(html).toContain('后台交付说明');
        expect(html.replace(/<[^>]*>/g, '')).toContain('123.45');
        expect(html).toContain('已售罄');
        expect(html).toContain('aria-label="查看 后台商品名称"');
        expect(html).toContain('查看详情');
        expect(html).not.toContain('立即购买');
    });
    it('preserves the existing mobile row presentation by default', () => {
        const html = renderToStaticMarkup(
            <ProductRow
                product={product}
                market={market}
                locale="zh-CN"
                language="zh"
                onOpen={() => undefined}
            />,
        );
        expect(html).toContain('class="product-row"');
        expect(html).not.toContain('product-catalog-action');
    });
});
