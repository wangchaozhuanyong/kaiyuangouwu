import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProductRow } from './components/common/product-row';
import { desktopCatalogInput, desktopCatalogRoute } from './desktop-catalog-query';
import { supportsDesktopCatalog } from './desktop-layout';
import { MarketConfig, Product } from './types';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
}));

describe('desktop catalog navigation', () => {
    it('clears remembered category filters and starts home controls from the visible all-products state', () => {
        const remembered = {
            collectionId: 'old-category',
            childId: 'old-child',
            minPrice: '100',
            maxPrice: '200',
            fulfillment: 'digital' as const,
            inStockOnly: true,
        };
        const reset = { ...remembered, ...desktopCatalogRoute({ name: 'home' }) };
        expect(reset).toMatchObject({
            collectionId: 'all',
            childId: 'all',
            minPrice: undefined,
            maxPrice: undefined,
            fulfillment: 'all',
            inStockOnly: false,
        });
        const stock = { ...remembered, ...desktopCatalogRoute({ name: 'home' }, { inStockOnly: true }) };
        expect(desktopCatalogInput(stock)).toMatchObject({
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
        expect(desktopCatalogRoute(route, { sort: 'newest' })).toMatchObject({ ...route, sort: 'newest' });
        expect(
            desktopCatalogRoute({ name: 'search', term: 'Token', inStockOnly: true }, { sort: 'price-asc' }),
        ).toMatchObject({ name: 'search', term: 'Token', inStockOnly: true, sort: 'price-asc' });
    });
    it('loads the complete catalog on the home page without selecting the first category', () => {
        expect(desktopCatalogInput({ name: 'home' })).toMatchObject({
            collectionId: undefined,
            term: undefined,
            sort: 'recommended',
            inStockOnly: false,
        });
        expect(
            desktopCatalogInput({ name: 'category', collectionId: 'all', childId: 'all' }).collectionId,
        ).toBeUndefined();
    });

    it('keeps the parent scope for All and uses the child scope when selected', () => {
        expect(
            desktopCatalogInput({ name: 'category', collectionId: 'parent', childId: 'all' }).collectionId,
        ).toBe('parent');
        expect(
            desktopCatalogInput({ name: 'category', collectionId: 'parent', childId: 'child' }).collectionId,
        ).toBe('child');
    });

    it('sends search, stock, fulfillment, and minor-unit prices to the existing catalog API', () => {
        expect(
            desktopCatalogInput({
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

    it('keeps the layout scoped to the verified default Channel', () => {
        expect(supportsDesktopCatalog('__default_channel__')).toBe(true);
        expect(supportsDesktopCatalog('my-malaysia')).toBe(false);
        expect(supportsDesktopCatalog('')).toBe(false);
        expect(supportsDesktopCatalog('unknown-store')).toBe(false);
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
