import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProductCard } from './components/common/product-card';
import { ProductRow } from './components/common/product-row';
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
            stockLevel: 'IN_STOCK',
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
    it('keeps the full-card link above generated product covers while preserving action buttons', () => {
        const markup = renderToStaticMarkup(
            <ProductCard
                product={digitalProduct}
                market={market}
                locale={market.locale}
                adding={false}
                onOpen={vi.fn()}
                onFavorite={vi.fn()}
                onAdd={vi.fn()}
            />,
        );

        expect(markup).toContain('product-card-detail-link');
        expect(markup).toContain('z-10');
        expect(markup).toContain('z-20');
        expect(markup).toContain('ai-product-cover');
    });

    it('keeps list-row links above generated cover layers and add buttons above the link', () => {
        const markup = renderToStaticMarkup(
            <ProductRow
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                adding={false}
                onOpen={vi.fn()}
                onAdd={vi.fn()}
            />,
        );
        const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

        expect(markup).toContain('product-row-detail-link');
        expect(markup).toContain('ai-product-cover');
        expect(stylesheet).toMatch(/\.product-row-detail-link\s*\{[^}]*z-index:\s*10;/);
        expect(stylesheet).toMatch(/\.row-add\s*\{[^}]*z-index:\s*20;/);
    });
});
