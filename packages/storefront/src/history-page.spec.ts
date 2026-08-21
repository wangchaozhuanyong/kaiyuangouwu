import { QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { BrowsingHistoryPage, FavoriteProductsPage } from './App';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { MarketConfig, Product } from './types';

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

const product: Product = {
    id: 'product-1',
    createdAt: '2026-08-16T00:00:00.000Z',
    name: '测试商品',
    slug: 'test-product',
    description: '用于验证足迹缓存',
    featuredAsset: null,
    assets: [],
    collections: [],
    variants: [],
};

function renderHistory(cachedProducts?: Product[]) {
    const client = createStorefrontQueryClient();
    const productIds = [product.id];
    if (cachedProducts) {
        client.setQueryData(
            storefrontQueryKeys.productsByIds(market.code, market.defaultLanguageCode, productIds),
            cachedProducts,
        );
    }
    const page = createElement(BrowsingHistoryPage, {
        api: { productsByIds: vi.fn() } as unknown as ShopApi,
        productIds,
        market,
        locale: market.locale,
        language: 'zh' as const,
        addingVariantId: null,
        onBack: vi.fn(),
        onNavigate: vi.fn(),
        onAdd: vi.fn(),
        onClear: vi.fn(),
    });
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, page));
}

function renderFavorites(cachedProducts?: Product[]) {
    const client = createStorefrontQueryClient();
    const productIds = [product.id];
    if (cachedProducts) {
        client.setQueryData(
            storefrontQueryKeys.productsByIds(market.code, market.defaultLanguageCode, productIds),
            cachedProducts,
        );
    }
    const page = createElement(FavoriteProductsPage, {
        api: { productsByIds: vi.fn() } as unknown as ShopApi,
        productIds,
        market,
        locale: market.locale,
        language: 'zh' as const,
        addingVariantId: null,
        onBack: vi.fn(),
        onNavigate: vi.fn(),
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onClear: vi.fn(),
    });
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, page));
}

describe('BrowsingHistoryPage', () => {
    it('shows a stable loading state instead of flashing the empty state on first entry', () => {
        const markup = renderHistory();

        expect(markup).toContain('aria-label="正在加载浏览足迹"');
        expect(markup).not.toContain('暂无浏览足迹');
    });

    it('renders cached history immediately when returning to the page', () => {
        const markup = renderHistory([product]);

        expect(markup).toContain('测试商品');
        expect(markup).not.toContain('aria-label="Loading"');
    });
});

describe('FavoriteProductsPage', () => {
    it('shows the shared loading state instead of flashing the empty state on first entry', () => {
        const markup = renderFavorites();

        expect(markup).toContain('aria-label="正在加载收藏商品"');
        expect(markup).not.toContain('暂无收藏商品');
    });

    it('renders cached favorites immediately when returning to the page', () => {
        const markup = renderFavorites([product]);

        expect(markup).toContain('测试商品');
        expect(markup).not.toContain('aria-label="Loading"');
    });
});
