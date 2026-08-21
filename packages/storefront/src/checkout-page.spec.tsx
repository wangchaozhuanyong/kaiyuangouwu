import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { CheckoutPage } from './checkout-page';
import {
    ActiveCustomer,
    MarketConfig,
    Order,
    OrderLine,
    ProductVariant,
    StorefrontCart,
} from './types';

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

function variant(fulfillmentType: 'physical' | 'digital', id: string): ProductVariant {
    return {
        id,
        name: fulfillmentType === 'digital' ? '数字模板包' : '32 英寸显示器',
        sku: fulfillmentType === 'digital' ? 'DIGITAL-TEMPLATE' : 'DISPLAY-32',
        priceWithTax: 31381,
        currencyCode: 'MYR',
        stockLevel: 'IN_STOCK',
        featuredAsset: null,
        product: {
            id: `product-${id}`,
            name: fulfillmentType === 'digital' ? '数字模板包' : '32 英寸显示器',
            featuredAsset: null,
        },
        customFields: { fulfillmentType },
    };
}

function line(productVariant: ProductVariant, id: string): OrderLine {
    return {
        id,
        quantity: 1,
        linePriceWithTax: productVariant.priceWithTax,
        proratedUnitPriceWithTax: productVariant.priceWithTax,
        productVariant,
        customFields: { fulfillmentTypeSnapshot: productVariant.customFields.fulfillmentType },
    };
}

function orderFor(type: 'DIGITAL' | 'PHYSICAL' | 'MIXED', deliveryEmail?: string): Order {
    const lines =
        type === 'DIGITAL'
            ? [line(variant('digital', 'digital'), 'line-digital')]
            : type === 'PHYSICAL'
              ? [line(variant('physical', 'physical'), 'line-physical')]
              : [
                    line(variant('physical', 'physical'), 'line-physical'),
                    line(variant('digital', 'digital'), 'line-digital'),
                ];
    const containsPhysicalProducts = type !== 'DIGITAL';
    const containsDigitalProducts = type !== 'PHYSICAL';
    return {
        id: 'order-1',
        code: 'T0001',
        state: 'AddingItems',
        totalQuantity: lines.length,
        subTotalWithTax: lines.reduce((sum, item) => sum + item.linePriceWithTax, 0),
        shippingWithTax: 0,
        totalWithTax: lines.reduce((sum, item) => sum + item.linePriceWithTax, 0),
        currencyCode: 'MYR',
        lines,
        discounts: [],
        taxSummary: [],
        couponCodes: [],
        customFields: { customerNote: null, deliveryEmail },
        checkoutFulfillment: {
            fulfillmentType: type,
            containsPhysicalProducts,
            containsDigitalProducts,
            requiresShippingAddress: containsPhysicalProducts,
            requiresShippingMethod: containsPhysicalProducts,
        },
    };
}

function cartFor(order: Order): StorefrontCart {
    return {
        id: 'cart-1',
        revision: 1,
        state: 'OPEN',
        projectedRevision: 1,
        totalQuantity: order.totalQuantity,
        selectedLineCount: order.lines.length,
        selectedQuantity: order.totalQuantity,
        selectionState: 'ALL',
        lines: order.lines.map(item => ({
            id: `cart-${item.id}`,
            quantity: item.quantity,
            selected: true,
            available: true,
            productVariant: item.productVariant,
        })),
        checkoutOrder: order,
    };
}

function renderCheckout(order: Order, customer: ActiveCustomer | null = null): string {
    return renderToStaticMarkup(
        createElement(CheckoutPage, {
            mode: 'purchase' as const,
            api: {} as ShopApi,
            cart: cartFor(order),
            order,
            customer,
            market,
            availableCountries: [{ code: 'MY', name: '马来西亚' }],
            locale: market.locale,
            language: 'zh' as const,
            onBack: vi.fn(),
            onSessionChange: vi.fn(),
            onCartChange: vi.fn(),
            onNavigate: vi.fn(),
            onNotify: vi.fn(),
            onApplyCoupon: vi.fn().mockResolvedValue(null),
            onRemoveCoupon: vi.fn().mockResolvedValue(null),
        }),
    );
}

describe('CheckoutPage digital delivery', () => {
    it('shows only the delivery email for a guest digital order', () => {
        const markup = renderCheckout(orderFor('DIGITAL'));

        expect(markup).toContain('接收方式');
        expect(markup).toContain('name="deliveryEmail"');
        expect(markup).toContain('type="email"');
        expect(markup).toContain('邮箱自动交付');
        expect(markup).toContain('确认并支付');
        expect(markup).not.toContain('name="firstName"');
        expect(markup).not.toContain('name="lastName"');
        expect(markup).not.toContain('收货地址');
        expect(markup).not.toContain('下一步，选择配送');
    });

    it('prefers the order email while allowing a logged-in customer to edit it', () => {
        const customer = {
            id: 'customer-1',
            firstName: '王',
            lastName: '先生',
            emailAddress: 'account@example.com',
            phoneNumber: null,
            addresses: null,
            orders: { items: [], totalItems: 0 },
        } satisfies ActiveCustomer;

        const markup = renderCheckout(orderFor('DIGITAL', 'delivery@example.com'), customer);

        expect(markup).toContain('value="delivery@example.com"');
        expect(markup).not.toContain('value="account@example.com"');
        expect(markup).toContain('name="deliveryEmail"');
    });

    it('keeps contact, address and shipping preparation for mixed orders', () => {
        const markup = renderCheckout(orderFor('MIXED'));

        expect(markup).toContain('name="firstName"');
        expect(markup).toContain('name="lastName"');
        expect(markup).toContain('收货地址');
        expect(markup).toContain('填写地址后计算');
        expect(markup).not.toContain('name="deliveryEmail"');
    });
});
