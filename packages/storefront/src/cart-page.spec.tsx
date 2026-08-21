import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CartPage } from './App';
import { MarketConfig, StorefrontCart } from './types';

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
    onCheckout: vi.fn(),
    onReopen: vi.fn(),
    onNavigate: vi.fn(),
    onAdd: vi.fn(),
    onRetry: vi.fn(),
    onApplyCoupon: vi.fn().mockResolvedValue(null),
    onRemoveCoupon: vi.fn().mockResolvedValue(null),
};

function renderCart(value: StorefrontCart | null) {
    return renderToStaticMarkup(
        createElement(CartPage, {
            cart: value,
            customer: null,
            products: [],
            market,
            locale: market.locale,
            language: 'zh' as const,
            loading: false,
            error: null,
            addingVariantId: null,
            ...callbacks,
        }),
    );
}

describe('CartPage guest cart', () => {
    it('keeps cart lines and editing controls visible for a guest customer', () => {
        const markup = renderCart(cart);

        expect(markup).toContain('游客购物车已保存');
        expect(markup).toContain('可以直接结算');
        expect(markup).toContain('32 英寸显示器');
        expect(markup).toContain('aria-label="删除 32 英寸显示器"');
        expect(markup).toContain('aria-label="减少 32 英寸显示器 数量"');
        expect(markup).toContain('aria-label="增加 32 英寸显示器 数量"');
        expect(markup).toContain('结算（1）');
        expect(markup).not.toContain('登录后使用购物车');
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
        expect(markup).not.toContain('游客购物车已保存');
        expect(markup).not.toContain('结算（');
    });
});
