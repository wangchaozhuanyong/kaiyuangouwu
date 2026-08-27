import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CartPage } from './pages/cart-page';
import { StorefrontContext } from './StorefrontContext';
import { MarketConfig, StorefrontCart } from './types';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
}));

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

const cart: StorefrontCart = {
    id: 'cart-1',
    revision: 1,
    state: 'OPEN',
    projectedRevision: 1,
    totalQuantity: 1,
    selectedLineCount: 1,
    selectedQuantity: 1,
    selectionState: 'ALL',
    lines: [
        {
            id: 'line-1',
            quantity: 1,
            selected: true,
            available: true,
            productVariant: {
                id: 'variant-1',
                name: '32 英寸显示器',
                sku: 'DISPLAY-32',
                priceWithTax: 31381,
                currencyCode: 'MYR',
                stockLevel: 'IN_STOCK',
                featuredAsset: null,
                product: {
                    id: 'product-1',
                    name: '32 英寸显示器',
                    featuredAsset: null,
                },
                customFields: { fulfillmentType: 'physical' },
            },
        },
    ],
    checkoutOrder: null,
};

const callbacks = {
    onToggleAll: vi.fn(),
    onSelect: vi.fn(),
    onSelectGroup: vi.fn(),
    onQuantity: vi.fn(),
    onRemove: vi.fn(),
    onFavorite: vi.fn(),
    onCheckout: vi.fn(),
    onReopen: vi.fn(),
    onAdd: vi.fn(),
    onNotify: vi.fn(),
    onRetry: vi.fn(),
    onApplyCoupon: vi.fn().mockResolvedValue(null),
    onRemoveCoupon: vi.fn().mockResolvedValue(null),
};

function renderCart(value: StorefrontCart | null) {
    return renderToStaticMarkup(
        createElement(
            StorefrontContext.Provider,
            {
                value: {
                    cart: value,
                    customer: null,
                    products: [],
                    market,
                    locale: market.locale,
                    language: 'zh' as const,
                    loading: false,
                    error: null,
                    addingVariantId: null,
                    favoriteProductIds: [],
                    coupons: [],
                    ...callbacks,
                },
            },
            createElement(CartPage),
        ),
    );
}

describe('CartPage guest cart', () => {
    it('keeps cart lines and editing controls visible for a guest customer', () => {
        const markup = renderCart(cart);

        expect(markup).toContain('游客购物车已保存');
        expect(markup).toContain('可以直接结算');
        expect(markup).toContain('32 英寸显示器');
        expect(markup).toContain('aria-label="删除 32 英寸显示器"');
        expect(markup).toContain('class="cart-line-swipe-actions"');
        expect(markup).toContain('data-cart-action="favorite"');
        expect(markup).toContain('data-cart-action="share"');
        expect(markup).toContain('data-cart-action="pin"');
        expect(markup).toContain('data-cart-action="remove"');
        expect(markup).toContain('class="cart-line-purchase-row"');
        expect(markup).not.toContain('class="cart-line-actions"><button');
        expect(markup).toContain('aria-label="减少 32 英寸显示器 数量并删除商品"');
        expect(markup).not.toContain('aria-label="减少 32 英寸显示器 数量并删除商品" disabled=""');
        expect(markup).toContain('aria-label="增加 32 英寸显示器 数量"');
        expect(markup).toContain('结算（1）');
        expect(markup).not.toContain('登录后使用购物车');
        expect(markup).not.toContain('DISPLAY-32');
    });

    it('keeps the regular decrement action when a line has more than one item', () => {
        const markup = renderCart({
            ...cart,
            totalQuantity: 2,
            selectedQuantity: 2,
            lines: [{ ...cart.lines[0], quantity: 2 }],
        });

        expect(markup).toContain('aria-label="减少 32 英寸显示器 数量"');
        expect(markup).not.toContain('数量并删除商品');
    });

    it('shows the ordinary empty state when a guest cart has no lines', () => {
        const markup = renderCart({
            ...cart,
            totalQuantity: 0,
            selectedLineCount: 0,
            selectedQuantity: 0,
            selectionState: 'NONE',
            lines: [],
        });

        expect(markup).toContain('购物车还是空的');
        expect(markup).toContain('class="page cart-page is-empty"');
        expect(markup).not.toContain('游客购物车已保存');
        expect(markup).not.toContain('结算（');
    });
});
