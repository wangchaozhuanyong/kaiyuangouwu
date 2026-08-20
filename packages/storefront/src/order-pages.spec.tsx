import { QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { OrdersPage } from './order-pages';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { ActiveCustomer, MarketConfig, Order } from './types';

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

const order: Order = {
    id: 'order-1',
    code: 'T0001',
    state: 'PaymentSettled',
    orderPlacedAt: '2026-08-16T00:00:00.000Z',
    totalQuantity: 1,
    subTotalWithTax: 12900,
    shippingWithTax: 0,
    totalWithTax: 12900,
    currencyCode: 'MYR',
    lines: [
        {
            id: 'line-1',
            quantity: 1,
            linePriceWithTax: 12900,
            productVariant: {
                id: 'variant-1',
                name: '订单测试商品',
                sku: 'TEST-1',
                priceWithTax: 12900,
                currencyCode: 'MYR',
                stockLevel: 'IN_STOCK',
                featuredAsset: null,
                product: { featuredAsset: null },
                customFields: { fulfillmentType: 'physical' },
            },
            customFields: { fulfillmentTypeSnapshot: 'physical' },
        },
    ],
    discounts: [],
    couponCodes: [],
    customFields: {},
};

const customer: ActiveCustomer = {
    id: 'customer-1',
    firstName: '测试',
    lastName: '用户',
    emailAddress: 'customer@example.com',
    phoneNumber: null,
    addresses: [],
    orders: { items: [order], totalItems: 1 },
};

function renderOrders(cachedOrders?: Order[]) {
    const client = createStorefrontQueryClient();
    if (cachedOrders) {
        client.setQueryData(
            storefrontQueryKeys.customerOrders(market.code, market.defaultLanguageCode, customer.id, {
                tab: 'all',
                orderCode: '',
            }),
            {
                pages: [{ items: cachedOrders, totalItems: cachedOrders.length }],
                pageParams: [0],
            },
        );
    }
    const page = createElement(OrdersPage, {
        api: { customerOrders: vi.fn() } as unknown as ShopApi,
        customer,
        market,
        locale: market.locale,
        language: 'zh' as const,
        storefrontName: '测试商城',
        initialTab: 'all' as const,
        onBack: vi.fn(),
        onNavigate: vi.fn(),
        onBuyAgain: vi.fn(),
    });
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, page));
}

describe('OrdersPage route query', () => {
    it('shows a stable loading state instead of flashing the empty state on first entry', () => {
        const markup = renderOrders();

        expect(markup).toContain('aria-label="Loading"');
        expect(markup).not.toContain('暂无相关订单');
    });

    it('renders the cached order list immediately when returning to the page', () => {
        const markup = renderOrders([order]);

        expect(markup).toContain('订单测试商品');
        expect(markup).not.toContain('aria-label="Loading"');
    });
});
