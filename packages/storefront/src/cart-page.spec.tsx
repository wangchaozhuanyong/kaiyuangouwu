import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CartPage } from './pages/cart-page';
import { StorefrontContext } from './StorefrontContext';
import { readStorefrontStylesheet } from './test-stylesheet';
import { MarketConfig, Order, Product, StoreCustomerCoupon, StorefrontCart } from './types';

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

const checkoutOrder: Order = {
    id: 'order-1',
    code: 'T0001',
    state: 'AddingItems',
    totalQuantity: 1,
    subTotalWithTax: 31381,
    shippingWithTax: 0,
    totalWithTax: 31381,
    currencyCode: 'MYR',
    lines: [],
    discounts: [],
    taxSummary: [],
    couponCodes: [],
    customFields: {},
};

function coupon(overrides: Partial<StoreCustomerCoupon> = {}): StoreCustomerCoupon {
    return {
        id: 'coupon-1',
        campaignId: 'campaign-1',
        campaignName: '新客优惠券',
        campaignKind: 'ORDER_FIXED',
        status: 'AVAILABLE',
        minimumSpend: 1000,
        currencyCode: 'MYR',
        discountAmount: 500,
        discountRate: null,
        claimedAt: '2026-09-01T00:00:00.000Z',
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: null,
        lockedAt: null,
        usedAt: null,
        returnedAt: null,
        expiredAt: null,
        lockedOrderId: null,
        usedOrderId: null,
        returnCount: 0,
        usable: true,
        ...overrides,
    };
}

function renderCart(
    value: StorefrontCart | null,
    products: Product[] = [],
    coupons: StoreCustomerCoupon[] = [],
) {
    return renderToStaticMarkup(
        createElement(
            StorefrontContext.Provider,
            {
                value: {
                    cart: value,
                    customer: null,
                    products,
                    market,
                    locale: market.locale,
                    language: 'zh' as const,
                    loading: false,
                    error: null,
                    addingVariantId: null,
                    favoriteProductIds: [],
                    coupons,
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

    it('places the subtitle on the right side of the 顺手带一件 heading', () => {
        const testProduct: Product = {
            id: 'product-2',
            createdAt: '2026-08-16T00:00:00.000Z',
            name: '推荐搭配商品',
            slug: 'recommended-product',
            description: '',
            featuredAsset: null,
            assets: [],
            collections: [],
            variants: [
                {
                    id: 'variant-2',
                    name: '默认规格',
                    sku: 'REC-2',
                    priceWithTax: 2000,
                    currencyCode: 'MYR',
                    stockLevel: 'IN_STOCK',
                    saleableStockLevel: 10,
                    featuredAsset: null,
                    product: {
                        id: 'product-2',
                        name: '推荐搭配商品',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'physical' } as any,
                },
            ],
        };

        const markup = renderCart(cart, [testProduct]);

        expect(markup).toContain('顺手带一件');
        expect(markup).toContain('class="section-header has-end-subtitle"');
        expect(markup).toContain('class="section-header-end-subtitle">从当前店铺继续挑选</p>');
    });

    it('keeps the offers row visually separate from the recommendation module', () => {
        expect(readStorefrontStylesheet()).toMatch(
            /\.cart-page > \.product-section\s*\{[^}]*margin-top:\s*16px;/u,
        );
    });

    it('shows only the manually selected coupon name instead of matching automatic discounts', () => {
        const cartWithAutomaticDiscount = {
            ...cart,
            checkoutOrder: {
                ...checkoutOrder,
                discounts: [{ description: '店铺自动优惠', amountWithTax: -500 }],
            },
        };
        const unselectedMarkup = renderCart(cartWithAutomaticDiscount, [], [coupon()]);
        const couponRowMarkup = unselectedMarkup.match(/<button class="coupon-row"[\s\S]*?<\/button>/)?.[0];

        expect(couponRowMarkup).toContain('选择已领取优惠券');
        expect(couponRowMarkup).not.toContain('已优惠');
        expect(couponRowMarkup).not.toContain('新客优惠券');

        const selectedMarkup = renderCart(
            cartWithAutomaticDiscount,
            [],
            [coupon({ status: 'LOCKED', lockedOrderId: checkoutOrder.id, usable: false })],
        );

        expect(selectedMarkup).toContain('title="新客优惠券">新客优惠券</small>');
        expect(selectedMarkup).not.toContain('选择已领取优惠券');
    });
});
