import { QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { OrderDetailPage, OrdersPage } from './order-pages';
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
    taxSummary: [],
    lines: [
        {
            id: 'line-1',
            quantity: 1,
            linePriceWithTax: 12900,
            proratedUnitPriceWithTax: 12900,
            productVariant: {
                id: 'variant-1',
                name: '订单测试商品',
                sku: 'TEST-1',
                priceWithTax: 12900,
                currencyCode: 'MYR',
                stockLevel: 'IN_STOCK',
                featuredAsset: null,
                product: { id: 'product-1', name: '订单测试商品', featuredAsset: null },
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
        onNotify: vi.fn(),
    });
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, page));
}

describe('OrdersPage route query', () => {
    it('shows a stable loading state instead of flashing the empty state on first entry', () => {
        const markup = renderOrders();

        expect(markup).toContain('aria-label="正在加载订单"');
        expect(markup).not.toContain('暂无相关订单');
    });

    it('renders the cached order list immediately when returning to the page', () => {
        const markup = renderOrders([order]);

        expect(markup).toContain('订单测试商品');
        expect(markup).not.toContain('aria-label="Loading"');
    });
});

describe('OrderDetailPage fulfillment actions', () => {
    function renderDetail(detailOrder: Order) {
        return renderToStaticMarkup(
            createElement(OrderDetailPage, {
                order: detailOrder,
                market,
                locale: market.locale,
                language: 'zh' as const,
                storefrontName: '测试商城',
                onBack: vi.fn(),
                onBuyAgain: vi.fn(),
                onReopen: vi.fn(),
                onCancelOrder: vi.fn(),
                onCreateAfterSales: vi.fn(),
                onUnavailable: vi.fn(),
            }),
        );
    }

    it('shows included tax, delivery timing and the safe cancellation entry for authorized physical orders', () => {
        const markup = renderDetail({
            ...order,
            state: 'PaymentAuthorized',
            taxSummary: [{ description: 'SST', taxRate: 8, taxBase: 11944, taxTotal: 956 }],
            checkoutShipping: {
                methodCode: 'standard',
                methodName: '标准配送',
                priceWithTax: 0,
                estimateMinDays: 2,
                estimateMaxDays: 4,
                freeShippingApplied: true,
            },
        });

        expect(markup).toContain('其中 SST (8%)');
        expect(markup).toContain('标准配送 · 预计 2–4 天 · 免邮');
        expect(markup).toContain('取消订单');
    });

    it('does not offer direct cancellation for digitally delivered orders', () => {
        const markup = renderDetail({
            ...order,
            state: 'PaymentAuthorized',
            lines: [
                {
                    ...order.lines[0],
                    customFields: { fulfillmentTypeSnapshot: 'digital' },
                    productVariant: {
                        ...order.lines[0].productVariant,
                        customFields: { fulfillmentType: 'digital' },
                    },
                },
            ],
        });

        expect(markup).not.toContain('取消订单');
    });

    it('offers the after-sales entry for settled orders', () => {
        const markup = renderDetail(order);

        expect(markup).toContain('申请售后');
        expect(markup).not.toContain('取消订单');
    });
});
