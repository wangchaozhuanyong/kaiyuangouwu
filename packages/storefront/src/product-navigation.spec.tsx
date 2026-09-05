import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProductCard } from './components/common/product-card';
import { buildProductRowSmartInfo, ProductRow } from './components/common/product-row';
import { readStorefrontStylesheet } from './test-stylesheet';
import { MarketConfig, Product } from './types';

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

const digitalProduct: Product = {
    id: 'product-1',
    createdAt: '2026-08-25T00:00:00.000Z',
    name: 'ChatGPT Plus 成品号',
    slug: 'chatgpt-plus',
    description: '数字商品',
    featuredAsset: null,
    assets: [],
    collections: [],
    variants: [
        {
            id: 'variant-1',
            name: '默认规格',
            sku: 'CHATGPT-PLUS',
            priceWithTax: 9900,
            currencyCode: 'MYR',
            saleableStockLevel: null,
            featuredAsset: null,
            product: { id: 'product-1', name: 'ChatGPT Plus 成品号', featuredAsset: null },
            autoCardAvailableStock: 10,
            customFields: {
                fulfillmentType: 'digital',
                digitalDeliveryMode: 'auto_card',
            },
        },
    ],
};

describe('product image navigation layers', () => {
    it('keeps square mobile artwork but uses a calmer 4:3 desktop media frame', () => {
        const markup = renderToStaticMarkup(
            <ProductCard
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).toContain('aspect-square');
        expect(markup).toContain('min-[900px]:aspect-[4/3]');
        expect(markup).toContain('[&amp;_img]:object-contain');
    });

    it('derives compact one-line product information from fulfillment and warranty data', () => {
        const info = buildProductRowSmartInfo(
            { ...digitalProduct, description: 'ChatGPT Plus 正规渠道，质保一个月' },
            'zh',
        );

        expect(info).toEqual({
            primary: '数字商品 · 邮箱自动发货',
            secondary: '质保一个月',
        });
    });

    it('does not cover manual digital product images with a delivery badge', () => {
        const manualServiceProduct: Product = {
            ...digitalProduct,
            variants: [
                {
                    ...digitalProduct.variants[0],
                    customFields: {
                        ...digitalProduct.variants[0].customFields,
                        digitalDeliveryMode: 'manual_service',
                    },
                },
            ],
        };
        const markup = renderToStaticMarkup(
            <ProductCard
                product={manualServiceProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).not.toContain('人工数字服务');
        expect(markup).toContain('不限库存');
    });

    it('keeps the full-card link and favorite action without rendering quick add controls', () => {
        const markup = renderToStaticMarkup(
            <ProductCard
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
                onFavorite={vi.fn()}
            />,
        );

        expect(markup).toContain('product-card-detail-link');
        expect(markup).toContain('z-10');
        expect(markup).toContain('z-20');
        expect(markup).toContain('ai-product-cover');
        expect(markup).toContain('库存 10');
        expect(markup).not.toContain('加入购物车');
        expect(markup).not.toContain('含税');
    });

    it('keeps list-row links above generated cover layers without add buttons', () => {
        const markup = renderToStaticMarkup(
            <ProductRow
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );
        const stylesheet = readStorefrontStylesheet();

        expect(markup).toContain('product-row-detail-link');
        expect(markup).toContain('ai-product-cover');
        expect(markup).toContain('库存 10');
        expect(markup).not.toContain('加入购物车');
        expect(stylesheet).toMatch(/\.product-row-detail-link\s*\{[^}]*z-index:\s*10;/);
        expect(stylesheet).not.toMatch(/\.row-add\s*\{/);
    });

    it('keeps list-row prices inline instead of applying copy layout to nested price spans', () => {
        const markup = renderToStaticMarkup(
            <ProductRow
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );
        const stylesheet = readStorefrontStylesheet();

        expect(markup).toContain('price-lockup');
        expect(stylesheet).toMatch(/\.price-lockup\s*\{[^}]*display:\s*inline-flex;/);
        expect(stylesheet).toMatch(/\.product-row-desc\s*\{/);
        expect(stylesheet).not.toMatch(/\.product-row\s+span\s*,\s*\.product-row\s+small\s*\{/);
    });

    it('shows sold-out status and keeps card title and subtitle on one line', () => {
        const soldOutProduct: Product = {
            ...digitalProduct,
            name: 'A very long product title that must remain on one line',
            variants: [{ ...digitalProduct.variants[0], autoCardAvailableStock: 0 }],
        };
        const markup = renderToStaticMarkup(
            <ProductCard
                product={soldOutProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).toContain('已售罄');
        expect(markup).toContain('whitespace-nowrap');
        expect(markup).toContain('items-center justify-between gap-2');
        expect(markup).not.toContain('-webkit-line-clamp:2');
    });

    it('does not use the internal SKU as customer-facing fallback copy', () => {
        const productWithoutDescription = { ...digitalProduct, description: '' };
        const cardMarkup = renderToStaticMarkup(
            <ProductCard
                product={productWithoutDescription}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );
        const rowMarkup = renderToStaticMarkup(
            <ProductRow
                product={productWithoutDescription}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(cardMarkup).not.toContain('CHATGPT-PLUS');
        expect(rowMarkup).not.toContain('CHATGPT-PLUS');
    });

    it('uses the active content language instead of the currency locale for stock labels', () => {
        const soldOutProduct: Product = {
            ...digitalProduct,
            variants: [{ ...digitalProduct.variants[0], autoCardAvailableStock: 0 }],
        };
        const markup = renderToStaticMarkup(
            <ProductCard
                product={soldOutProduct}
                market={market}
                locale="zh-CN"
                language="en"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).toContain('Sold out');
        expect(markup).not.toContain('已售罄');
    });

    it('ensures product detail header has transparent background, dark frosted buttons and no blur when unscrolled', () => {
        const stylesheet = readStorefrontStylesheet();

        expect(stylesheet).toMatch(/\.subpage\s*\{[^}]*overflow-x:\s*clip;/);
        expect(stylesheet).toMatch(/\.topbar\.product-detail-header[\s\S]*?background:\s*transparent;/);
        expect(stylesheet).toMatch(/\.topbar\.product-detail-header[\s\S]*?backdrop-filter:\s*none;/);
        expect(stylesheet).toMatch(/\.topbar\.product-detail-header[\s\S]*?margin-bottom:\s*-52px;/);
        expect(stylesheet).toMatch(
            /\.topbar\.product-detail-header\s+button[\s\S]*?background:\s*rgba\(24,\s*28,\s*26,\s*0\.46\);/,
        );
        expect(stylesheet).toMatch(
            /\.topbar\.product-detail-header\.is-scrolled[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\);/,
        );
    });
});
