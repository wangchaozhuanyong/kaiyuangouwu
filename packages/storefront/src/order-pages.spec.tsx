import { QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { DesktopLayoutContext } from './desktop-layout';
import { languageCodeFor } from './i18n';
import { LogisticsPage, LogisticsTrackingSheet, OrderDetailPage, OrdersPage } from './order-pages';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { DeliveryDetails, deliveryStatus } from './storefront-ui/delivery-details';
import {
    customerOrderStateLabel,
    orderNotification,
    orderStateLabel,
    orderStatesForTab,
} from './storefront-ui/order-ui';
import { orderPageStyles } from './tailwind/order-page-styles';
import { ActiveCustomer, MarketConfig, Order, StorefrontLanguage } from './types';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

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

function renderOrders(cachedOrders?: Order[], language: StorefrontLanguage = 'zh', desktop = false) {
    const client = createStorefrontQueryClient();
    if (cachedOrders) {
        client.setQueryData(
            storefrontQueryKeys.customerOrders(
                storefrontQueryKeys.market(market),
                languageCodeFor(language),
                customer.id,
                {
                    tab: 'all',
                    orderCode: '',
                },
            ),
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
        language,
        storefrontName: '测试商城',
        initialTab: 'all' as const,
        onBack: vi.fn(),
        onBuyAgain: vi.fn(),
        onNotify: vi.fn(),
    });
    return renderToStaticMarkup(
        createElement(
            QueryClientProvider,
            { client },
            createElement(DesktopLayoutContext.Provider, { value: desktop }, page),
        ),
    );
}

function renderLogistics(cachedOrders?: Order[]) {
    const client = createStorefrontQueryClient();
    if (cachedOrders) {
        client.setQueryData(
            storefrontQueryKeys.customerOrders(
                storefrontQueryKeys.market(market),
                market.defaultLanguageCode,
                customer.id,
                {
                    view: 'logistics',
                },
            ),
            {
                pages: [{ items: cachedOrders, totalItems: cachedOrders.length }],
                pageParams: [0],
            },
        );
    }
    const page = createElement(LogisticsPage, {
        api: { customerOrders: vi.fn() } as unknown as ShopApi,
        customer,
        market,
        locale: market.locale,
        language: 'zh' as const,
        onBack: vi.fn(),
        onReturnToRoute: vi.fn(),
    });
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, page));
}

describe('OrdersPage route query', () => {
    it('shows an unsubmitted cart as a cart without offering payment', () => {
        const cartOrder = { ...order, state: 'AddingItems', orderPlacedAt: null };
        for (const desktop of [false, true]) {
            const markup = renderOrders([cartOrder], 'zh', desktop);
            expect(markup).toContain('购物车中');
            expect(markup).toContain('预估合计');
            expect(markup).not.toContain('立即付款');
            expect(markup).not.toContain('实付');
        }
        expect(orderStatesForTab('pending')).toEqual(['ArrangingPayment', 'ArrangingAdditionalPayment']);
        expect(orderStateLabel('ArrangingPayment', 'zh')).toBe('待付款');
        expect(orderNotification(cartOrder, 'zh').title).toBe('商品仍在购物车');
    });

    it('renders a desktop order summary with the real total and payment entry', () => {
        const pending = { ...order, state: 'ArrangingPayment', totalQuantity: 6, totalWithTax: 10800 };
        const markup = renderOrders([pending], 'zh', true);
        expect(markup).toContain('order-summary-card');
        expect(markup).not.toContain('desktop-order-columns');
        expect(markup).not.toContain('desktop-order-values');
        expect(markup).toContain('订单 T0001');
        expect(markup).toContain('共 6 件');
        expect(markup).toContain('108');
        expect(markup).toContain('aria-label="订单号"');
        expect(markup).toContain('立即付款');
        expect(markup).toContain('没有更多订单');
        expect(markup).not.toContain('DEMO-0001');
        expect(markup).not.toContain('aria-label="搜索订单"');
    });

    it('keeps full product guidance and repeat-purchase actions in details instead of the desktop summary', () => {
        const markup = renderOrders([order], 'zh', true);
        expect(markup).toContain('查看详情');
        expect(markup).toContain('待发货');
        expect(markup).toContain('订单测试商品');
        expect(markup).not.toContain('order-product-spec');
        expect(markup).not.toContain('order-total-summary');
        expect(markup).not.toContain('再来一单');
        expect(renderOrders([order])).not.toContain('再来一单');
        expect(markup).toContain('role="img" aria-label="暂无商品图"');
        expect(markup).not.toContain('product-image-placeholder-label');
    });

    it('uses the singular English item label for one-item orders in both layouts', () => {
        for (const desktop of [false, true]) {
            const markup = renderOrders([order], 'en', desktop);
            expect(markup).toContain('1 item');
            expect(markup).not.toContain('1 items');
        }
    });

    it('includes completed orders in the same lifecycle filters on mobile', () => {
        const markup = renderOrders(undefined, 'en');

        expect(markup).toContain('>Unpaid</button>');
        expect(markup).toContain('>Processing</button>');
        expect(markup).toContain('>Shipped</button>');
        expect(markup).toContain('>Completed</button>');
        expect(markup).toContain('>Returns</button>');
        expect(markup).not.toContain('After-sales');
        expect(markup).not.toContain('To receive');
    });

    it('shows a stable loading state instead of flashing the empty state on first entry', () => {
        const markup = renderOrders();

        expect(markup).toContain('aria-label="正在加载订单"');
        expect(markup).not.toContain('暂无相关订单');
    });

    it('renders the cached order list immediately when returning to the page', () => {
        const markup = renderOrders([order]);

        expect(markup).toContain('订单测试商品');
        expect(markup).toContain('订单详情可查看配送信息');
        expect(markup).toContain('实体商品');
        expect(markup).toContain('物流可查');
        expect(markup).not.toContain('商品信息');
        expect(markup).not.toContain('售后入口');
        expect(markup).not.toContain('aria-label="Loading"');
        expect(markup).not.toContain('TEST-1');
    });

    it('uses actual digital delivery attributes as the product explanation and tags', () => {
        const digitalOrder: Order = {
            ...order,
            lines: [
                {
                    ...order.lines[0],
                    customFields: {
                        fulfillmentTypeSnapshot: 'digital',
                        digitalDeliveryModeSnapshot: 'auto_card',
                    },
                    productVariant: {
                        ...order.lines[0].productVariant,
                        customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
                    },
                },
            ],
        };
        const markup = renderOrders([digitalOrder]);

        expect(markup).toContain('支付后自动发送至下单邮箱');
        expect(markup).toContain('数字商品');
        expect(markup).toContain('自动发货');
    });

    it('keeps the product information column exactly as tall as the product image', () => {
        expect(orderPageStyles['order-card-product']).toContain('[&>img]:[height:76px]');
        expect(orderPageStyles['order-product-content']).toContain('[height:76px]');
        expect(orderPageStyles['order-card-product']).toContain('[padding:12px_0]');
    });
});

describe('LogisticsPage delivery overview', () => {
    it('keeps cancelled deliveries discoverable and states that counts cover loaded orders', () => {
        const markup = renderLogistics([{ ...order, state: 'Cancelled' }]);
        expect(markup).toContain('已取消');
        expect(markup).toContain('已加载 1 个配送订单');
        expect(markup).toContain('筛选和搜索作用于已加载订单');
        expect(markup).toContain('<table');
        expect(markup).toContain('scope="col"');
    });

    it('renders product, carrier and tracking details from cached physical orders', () => {
        const markup = renderLogistics([
            {
                ...order,
                fulfillments: [
                    {
                        id: 'fulfillment-1',
                        state: 'Shipped',
                        method: '标准配送',
                        trackingCode: 'TRACK-20841',
                        createdAt: '2026-08-17T00:00:00.000Z',
                        updatedAt: '2026-08-18T03:42:00.000Z',
                    },
                ],
            },
        ]);

        expect(markup).toContain('物流动态');
        expect(markup).toContain('订单 / 商品');
        expect(markup).toContain('配送方式 / 运单');
        expect(markup).toContain('运输中');
        expect(markup).toContain('订单测试商品');
        expect(markup).toContain('标准配送');
        expect(markup).toContain('TRACK-20841');
        expect(markup).toContain('订单详情');
        expect(markup).not.toContain('TEST-1');
    });

    it('does not mark a multi-package order delivered while another package is in transit', () => {
        expect(
            deliveryStatus({
                ...order,
                fulfillments: [
                    { state: 'Shipped', method: 'standard', updatedAt: '2026-09-27T00:00:00Z' },
                    { state: 'Delivered', method: 'standard', updatedAt: '2026-09-28T00:00:00Z' },
                ],
            }),
        ).toBe('transit');
    });

    it('never invents in-transit or delivered events for an order awaiting dispatch', () => {
        const markup = renderToStaticMarkup(
            createElement(DeliveryDetails, {
                order: { ...order, fulfillments: [] },
                locale: 'zh-CN',
                language: 'zh',
            }),
        );
        expect(markup).toContain('商家尚未创建配送包裹');
        expect(markup).toContain('暂无详细配送轨迹');
        expect(markup).not.toContain('运输派送中');
        expect(markup).not.toContain('已送达');
    });
});

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
            onConfirmDelivery: vi.fn(),
            onUnavailable: vi.fn(),
        }),
    );
}

describe('OrderDetailPage fulfillment actions', () => {
    it('uses the order currency for historic lines even when the variant currency changed', () => {
        const markup = renderDetail({
            ...order,
            lines: [
                {
                    ...order.lines[0],
                    linePriceWithTax: 304,
                    productVariant: { ...order.lines[0].productVariant, currencyCode: 'CNY' },
                },
            ],
            subTotalWithTax: 304,
            totalWithTax: 304,
        });
        expect(markup).toContain('MYR\u00a03.04');
        expect(markup).not.toContain('¥3.04');
    });

    it('does not offer payment or a broken reopen action for an unsubmitted cart', () => {
        const markup = renderDetail({ ...order, state: 'AddingItems', orderPlacedAt: null });
        expect(markup).toContain('购物车中');
        expect(markup).toContain('商品仍在购物车，尚未提交结算');
        expect(markup).not.toContain('返回修改订单');
        expect(markup).not.toContain('订单等待支付');
        expect(markup).not.toContain('page-action-bar');
    });

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

    it('offers the after-sales entry and 再来一单 button for settled orders', () => {
        const markup = renderDetail(order);

        expect(markup).toContain('申请售后');
        expect(markup).toContain('服务评价');
        expect(markup).toContain('再来一单');
        expect(markup).not.toContain('取消订单');
    });

    it('treats TestPaymentSettled as fully activated orders in status hint', () => {
        const markup = renderDetail({
            ...order,
            state: 'TestPaymentSettled',
        });

        expect(markup).toContain('订单已付款成功（测试模式），可正常测试发货、物流、评价及客服全流程');
        expect(markup).toContain('再来一单');
        expect(markup).toContain('申请售后');
    });

    it('renders LogisticsTrackingSheet with carrier info, tracking code, timeline, and customer support entry', () => {
        const shippedOrder: Order = {
            ...order,
            state: 'Shipped',
            fulfillments: [
                {
                    id: 'fulfillment-ship-1',
                    state: 'Shipped',
                    method: 'standard',
                    trackingCode: 'SF1234567890',
                    createdAt: '2026-08-17T00:00:00.000Z',
                    updatedAt: '2026-08-18T03:42:00.000Z',
                },
            ],
        };

        const markup = renderToStaticMarkup(
            createElement(LogisticsTrackingSheet, {
                order: shippedOrder,
                locale: 'zh-CN',
                language: 'zh',
                onClose: vi.fn(),
                onContactSupport: vi.fn(),
            }),
        );

        expect(markup).toContain('物流跟踪轨迹');
        expect(markup).toContain('SF1234567890');
        expect(markup).toContain('运单号');
        expect(markup).toContain('复制');
        expect(markup).toContain('运输中');
        expect(markup).toContain('8月18日 11:42');
        expect(markup).toContain('遇到物流问题？联系客服处理');
    });

    it('uses the Shop API fulfillment method to label digital delivery', () => {
        const markup = renderDetail({
            ...order,
            fulfillments: [
                {
                    id: 'fulfillment-1',
                    state: 'Delivered',
                    method: 'auto-card-email',
                    trackingCode: null,
                    createdAt: '2026-08-17T00:00:00.000Z',
                    updatedAt: '2026-08-18T03:42:00.000Z',
                },
            ],
        });

        expect(markup).toContain('自动卡密交付');
        expect(markup).not.toContain('auto-card-email');
    });
});

describe('digital order customer state labels', () => {
    it('makes modification and additional payment visible without claiming the adjusted total was paid', () => {
        const additional = { ...order, state: 'ArrangingAdditionalPayment' };
        expect(customerOrderStateLabel(additional, 'zh')).toBe('待补款');
        expect(customerOrderStateLabel(additional, 'en')).toBe('Additional payment needed');
        expect(customerOrderStateLabel({ ...order, state: 'Modifying' }, 'zh')).toBe('商家调整中');
        expect(orderNotification(additional, 'zh').tone).toBe('pending');
        expect(orderNotification(additional, 'zh').title).toBe('订单等待补款');
        expect(orderNotification({ ...order, state: 'Modifying' }, 'en').title).toContain('updating');
        for (const desktop of [false, true]) {
            const markup = renderOrders([additional], 'zh', desktop);
            expect(markup).toContain('待补款');
            expect(markup).toContain('核对补款');
            expect(markup).toContain('订单金额');
            expect(markup).not.toContain('实付');
            expect(markup).not.toContain('未知状态');
        }
        expect(renderDetail(additional)).toContain('请在下方核对并完成补款');
        expect(renderDetail(additional)).not.toContain('返回修改订单');
    });
    it('keeps shipping for physical/mixed and uses delivery labels for purely digital orders', () => {
        const digital = {
            ...order,
            lines: order.lines.map(line => ({
                ...line,
                customFields: { ...line.customFields, fulfillmentTypeSnapshot: 'digital' as const },
            })),
        };
        expect(customerOrderStateLabel(digital, 'zh')).toBe('待交付');
        expect(customerOrderStateLabel(digital, 'en')).toBe('Preparing digital delivery');
        expect(customerOrderStateLabel(order, 'zh')).toBe(orderStateLabel(order.state, 'zh'));
        expect(customerOrderStateLabel({ ...digital, lines: [...digital.lines, ...order.lines] }, 'zh')).toBe(
            orderStateLabel(order.state, 'zh'),
        );
        expect(customerOrderStateLabel({ ...digital, state: 'Delivered' }, 'zh')).toBe('已交付');
    });
});
