import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ShopApi, ShopApiTimeoutError } from '../../src/api';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { PaymentPage } from '../../src/payment-pages';
import { createStorefrontQueryClient, storefrontQueryKeys } from '../../src/query-client';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-commerce.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import { MarketConfig, Order, StorefrontCart, StorefrontPaymentAttemptInput } from '../../src/types';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

// In-memory synthetic data. This fixture has no production API, funds or delivery access.
const scenario = new URLSearchParams(location.search).get('scenario') ?? 'unknown';
const market: MarketConfig = {
    code: 'synthetic-payment',
    currencyCode: 'CNY',
    countryCode: 'CN',
    defaultLanguageCode: 'zh_Hans',
    locale: 'zh-CN',
    label: 'Local synthetic fixture',
};
const original = {
    id: 'synthetic-order',
    code: 'SYNTHETIC-ONLY',
    state: 'ArrangingPayment',
    currencyCode: 'CNY',
    lines: [],
    payments: [],
    subTotalWithTax: 990,
    shippingWithTax: 0,
    totalWithTax: 990,
    taxSummary: [],
    customFields: {},
} as unknown as Order;
const cart = {
    id: 'synthetic-cart',
    state: 'PAYMENT_PENDING',
    revision: 1,
    lines: [],
} as unknown as StorefrontCart;
const method = {
    id: 'synthetic-method',
    code: 'synthetic-method',
    name: '合成支付',
    description: '',
    isEligible: true,
    eligibilityMessage: null,
};
const client = createStorefrontQueryClient();
applyStorefrontVisualPreset(document.documentElement, 'neo-minimalist');
if (scenario === 'legacy') {
    const marketScope = storefrontQueryKeys.market(market);
    const marker = {
        scope: JSON.stringify([marketScope, '', original.id]),
        orderId: original.id,
        orderCode: original.code,
        currencyCode: original.currencyCode,
        kind: 'payment',
        method: method.code,
        amount: 990,
        balanceBefore: 0,
        paymentIds: [],
    };
    sessionStorage.setItem(
        `vendure-storefront:payment-attempt:v1:${JSON.stringify([marketScope, ''])}`,
        JSON.stringify([marker]),
    );
}

function Fixture() {
    const desktop = useDesktopViewport();
    const [order, setOrder] = useState(original);
    const [calls, setCalls] = useState({ payments: 0, reads: 0, fences: 0 });
    const [api] = useState(
        () =>
            ({
                eligiblePaymentMethods: () => Promise.resolve([method]),
                createOrderConfirmationToken: () =>
                    Promise.resolve({ token: 'synthetic-token-never-persisted' }),
                addPaymentToOrder: () => {
                    setCalls(value => ({ ...value, payments: value.payments + 1 }));
                    return Promise.reject(new ShopApiTimeoutError('Synthetic lost response', true));
                },
                paymentAttempt: (input: StorefrontPaymentAttemptInput, fence = false) => {
                    setCalls(value => ({
                        ...value,
                        reads: value.reads + (fence ? 0 : 1),
                        fences: value.fences + (fence ? 1 : 0),
                    }));
                    return Promise.resolve({
                        requestId: input.requestId,
                        status:
                            scenario === 'fence'
                                ? fence
                                    ? 'NOT_EXECUTED'
                                    : 'NOT_FOUND'
                                : scenario === 'applied'
                                  ? 'APPLIED'
                                  : scenario === 'rejected'
                                    ? 'REJECTED'
                                    : 'UNKNOWN',
                        errorCode: null,
                    });
                },
                order: () =>
                    Promise.resolve(
                        scenario === 'applied' ? { ...original, state: 'PaymentSettled' } : original,
                    ),
                orderByConfirmationToken: () =>
                    Promise.resolve(
                        scenario === 'applied' ? { ...original, state: 'PaymentSettled' } : original,
                    ),
            }) as unknown as ShopApi,
    );
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div className="desktop-app-shell">
                <p className="type-caption" data-testid="fixture-counters">
                    本地合成验收：写请求 {calls.payments}，回执读取 {calls.reads}，封住未执行请求{' '}
                    {calls.fences}
                </p>
                <PaymentPage
                    api={api}
                    order={order}
                    cart={cart}
                    customer={null}
                    market={market}
                    displayCurrencyCode="CNY"
                    locale="zh-CN"
                    language="zh"
                    onCancel={() => undefined}
                    onOrderChange={setOrder}
                    onComplete={latest => {
                        setOrder(latest);
                        return Promise.resolve();
                    }}
                />
            </div>
        </DesktopLayoutContext.Provider>
    );
}
const route = createRootRoute({ component: Fixture });
const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/payment'] }),
});
const container = document.getElementById('root');
if (!container) throw new Error('Synthetic payment recovery root was not found');
createRoot(container).render(
    <QueryClientProvider client={client}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
