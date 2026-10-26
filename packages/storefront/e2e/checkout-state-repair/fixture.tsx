// Synthetic in-memory data only; this entry never connects to a Shop API.
import { QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { type ShopApi } from '../../src/api';
import { CheckoutPage } from '../../src/checkout-page';
import '../../src/commerce-styles';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { SupportPage } from '../../src/pages/support-page';
import { PaymentPage } from '../../src/payment-pages';
import { createStorefrontQueryClient } from '../../src/query-client';
import { invalidateStorefrontRealtimeQueries } from '../../src/realtime-updates';
import { GptRechargeRoutePage } from '../../src/route-pages/gpt-recharge-route-page';
import { SupportPageContext } from '../../src/storefront-page-contexts';
import '../../src/storefront-styles';
import { StorefrontContext, type StorefrontContextValue } from '../../src/StorefrontContext';
import { StorefrontShell } from '../../src/StorefrontShell';
import {
    type ActiveCustomer,
    type Order,
    type StorefrontCart,
    type StorefrontContentBlock,
} from '../../src/types';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'checkout';
const market = {
    code: 'synthetic-state-repair',
    currencyCode: 'CNY',
    defaultLanguageCode: 'zh_Hans',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: 'Synthetic fixture',
};
const cache = createStorefrontQueryClient();
const emails = [
    { id: 'default', emailAddress: 'default@example.test', isDefault: true },
    { id: 'work', emailAddress: 'work@example.test', isDefault: false },
];
const original = {
    id: 'synthetic-order',
    code: 'SYNTHETIC-ONLY',
    state: 'AddingItems',
    currencyCode: 'CNY',
    totalQuantity: 1,
    subTotalWithTax: 990,
    shippingWithTax: 0,
    totalWithTax: 990,
    lines: [
        {
            id: 'synthetic-line',
            quantity: 1,
            linePriceWithTax: 990,
            proratedUnitPriceWithTax: 990,
            customFields: {},
            productVariant: {
                id: 'synthetic-variant',
                name: '测试数字商品',
                sku: 'SYNTHETIC',
                priceWithTax: 990,
                currencyCode: 'CNY',
                stockLevel: 'IN_STOCK',
                featuredAsset: null,
                customFields: { fulfillmentType: 'digital' },
                product: { id: 'synthetic-product', name: '测试数字商品', featuredAsset: null },
            },
        },
    ],
    discounts: [],
    taxSummary: [],
    couponCodes: [],
    payments: [],
    customFields: { customerNote: null },
    checkoutFulfillment: {
        fulfillmentType: 'DIGITAL',
        containsDigitalProducts: true,
        requiresShippingAddress: false,
    },
} as unknown as Order;
const support = {
    id: 'support',
    code: 'support',
    type: 'SUPPORT',
    title: '测试客服中心',
    subtitle: '',
    body: '',
    enabled: true,
    imageUrl: null,
    settings: {},
    items: [
        {
            id: 'support-telegram',
            enabled: true,
            position: 0,
            imageUrl: null,
            targetType: 'URL',
            targetValue: 'https://example.test/support',
            settings: { supportChannel: 'TELEGRAM' },
            label: '客服',
            description: '',
        },
    ],
} as unknown as StorefrontContentBlock;
applyStorefrontVisualPreset(
    document.documentElement,
    params.get('preset') === 'classic' ? 'classic' : 'neo-minimalist',
);

// Only the arrival of translated public branding is controlled here. The shell,
// route, locale sheet, QueryClient and recharge form are the production components.
function RechargeShellFixture() {
    const [language, setLanguage] = useState<'zh' | 'en'>('zh');
    const [brandReady, setBrandReady] = useState(true);
    const api = useMemo(
        () => ({
            request: (query: string) => {
                if (!query.startsWith('query GptRechargeConfig'))
                    return Promise.reject(new Error('This fixture permits config reads only.'));
                return Promise.resolve({ gptRechargeConfig: { enabled: true, maintenance: false } });
            },
        }),
        [],
    );
    const runtime = {
        market,
        language,
        api,
        route: { name: 'gpt-recharge' },
        storefrontCode: brandReady ? market.code : '',
        storefrontName: brandReady ? 'Synthetic recharge store' : '',
        storefrontContextResolved: true,
        configQuery: { isError: false, isFetching: !brandReady },
        displayCurrencyCode: 'CNY',
        currencySelectorEnabled: true,
        availableCurrencyCodes: ['CNY'],
        collections: [],
        contentBlocks: [],
        toggleLanguage: () => {
            setBrandReady(false);
            setLanguage(value => (value === 'zh' ? 'en' : 'zh'));
        },
        switchCurrency: () => undefined,
        goBack: () => undefined,
    };
    return (
        <>
            <button data-testid="resolve-brand" disabled={brandReady} onClick={() => setBrandReady(true)}>
                Resolve translated branding
            </button>
            <StorefrontShell
                state={
                    {
                        storefrontContextValue: runtime,
                        displayedRoute: { name: 'gpt-recharge' },
                        language,
                        isZh: language === 'zh',
                        online: true,
                        customer: null,
                        customerLoadState: 'ready',
                        storefrontUnavailable: false,
                        storefrontAccessMode: 'LIVE',
                        pageDataPending: !brandReady,
                        retryAccount: () => undefined,
                        retryPageLoad: () => undefined,
                    } as never
                }
            />
        </>
    );
}

function Fixture() {
    const desktop = useDesktopViewport();
    const [language, setLanguage] = useState<'zh' | 'en'>(params.get('language') === 'en' ? 'en' : 'zh');
    const [currency, setCurrency] = useState('CNY');
    const [flowStage, setFlowStage] = useState<'checkout' | 'payment'>('checkout');
    const [storeIndex, setStoreIndex] = useState(0);
    const selectedMarket = { ...market, code: `synthetic-state-repair-${storeIndex}` };
    const paymentView = view === 'payment' || (view === 'flow' && flowStage === 'payment');
    const [refresh, setRefresh] = useState(0);
    const [readFailure, setReadFailure] = useState(true);
    const [otherCustomer, setOtherCustomer] = useState(false);
    const [notice, setNotice] = useState('');
    const [counts, setCounts] = useState({ noteWrites: 0, noteReads: 0, reviews: 0, methodReads: 0 });
    const savedNote = useRef<string | null>(null);
    const order = {
        ...original,
        state: paymentView ? 'ArrangingPayment' : 'AddingItems',
        customFields: { customerNote: savedNote.current, paymentCurrencyCode: currency },
    };
    const cart = {
        id: 'synthetic-cart',
        revision: 1,
        lines: [],
        state: paymentView ? 'PAYMENT_PENDING' : 'OPEN',
        checkoutOrder: order,
    } as unknown as StorefrontCart;
    const customer = {
        id: otherCustomer ? 'customer-b' : 'customer-a',
        emailAddress: otherCustomer ? 'other@example.test' : 'account@example.test',
        addresses: [],
    } as unknown as ActiveCustomer;
    const api = useMemo(
        () =>
            ({
                request: async () =>
                    await Promise.resolve({ gptRechargeConfig: { enabled: true, maintenance: false } }),
                myDeliveryEmails: async () => await Promise.resolve(emails),
                setOrderNote: async (note: string) => {
                    await Promise.resolve();
                    savedNote.current = note;
                    setCounts(value => ({ ...value, noteWrites: value.noteWrites + 1 }));
                    return original;
                },
                cart: async () => {
                    await Promise.resolve();
                    setCounts(value => ({ ...value, noteReads: value.noteReads + 1 }));
                    if (readFailure && view !== 'flow') throw new Error('Synthetic read failure');
                    return cart;
                },
                runWithinDeadline: async (callback: (signal: AbortSignal) => Promise<unknown>) =>
                    await Promise.resolve(callback(new AbortController().signal)),
                setDeliveryEmail: async () => await Promise.resolve(order),
                setCustomer: async () => await Promise.resolve(order),
                setPaymentCurrencyForOrder: async () => await Promise.resolve(order),
                preparePayment: async () =>
                    await Promise.resolve({
                        cart: { ...cart, state: 'PAYMENT_PENDING' },
                        order: { ...order, state: 'ArrangingPayment' },
                    }),
                eligiblePaymentMethods: async () => {
                    await Promise.resolve();
                    setCounts(value => ({ ...value, methodReads: value.methodReads + 1 }));
                    return [
                        {
                            id: currency,
                            code: currency === 'USDT' ? 'usdt-trc20' : 'stripe-card',
                            name: currency === 'USDT' ? 'USDT-TRC20' : 'Synthetic card',
                            isEligible: true,
                            description: '',
                        },
                    ];
                },
                referralProgram: async () => await Promise.resolve({ enabled: false }),
                createUsdtCheckoutQuote: async () => await Promise.resolve(null),
                contentReviewsApi: {
                    currentCustomerServiceReview: async () => await Promise.resolve(null),
                    submitCustomerServiceReview: async (input: object) => {
                        await Promise.resolve();
                        setCounts(value => ({ ...value, reviews: value.reviews + 1 }));
                        return { id: 'synthetic-review', ...input };
                    },
                },
            }) as unknown as ShopApi,
        [currency, refresh, readFailure, flowStage, storeIndex],
    );
    const runtime = {
        market: selectedMarket,
        language,
        api,
        displayCurrencyCode: currency,
        collections: [],
        contentBlocks: [],
        currencySelectorEnabled: true,
        availableCurrencyCodes: ['CNY', 'USDT'],
        storefrontName: '本地测试',
        toggleLanguage: () => setLanguage(value => (value === 'zh' ? 'en' : 'zh')),
        switchCurrency: setCurrency,
        goBack: () => undefined,
    } as unknown as StorefrontContextValue;
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                <div data-testid="fixture-controls">
                    <button onClick={() => setLanguage(value => (value === 'zh' ? 'en' : 'zh'))}>
                        Toggle language
                    </button>
                    <button onClick={() => setRefresh(value => value + 1)}>Refresh customer</button>
                    <button onClick={() => setCurrency(value => (value === 'USDT' ? 'CNY' : 'USDT'))}>
                        Toggle currency
                    </button>
                    <button onClick={() => setReadFailure(false)}>Restore reads</button>
                    <button onClick={() => setOtherCustomer(value => !value)}>Switch customer</button>
                    <button onClick={() => setStoreIndex(value => (value + 1) % 3)}>Switch store</button>
                    <button
                        onClick={() => {
                            void invalidateStorefrontRealtimeQueries(
                                cache,
                                {
                                    version: 1,
                                    id: 'synthetic-store-event',
                                    occurredAt: '2026-10-26T00:00:00Z',
                                    topics: ['orders'],
                                },
                                {
                                    marketCode: 'synthetic-state-repair-0:CNY',
                                    languageCode: language === 'zh' ? 'zh_Hans' : 'en',
                                    customerId: 'customer-a',
                                },
                            );
                        }}
                    >
                        Refresh original store
                    </button>
                    <output data-testid="counters" style={{ display: 'block', overflowWrap: 'anywhere' }}>
                        {JSON.stringify(counts)}
                    </output>
                </div>
                <p role="status" data-testid="notice">
                    {notice}
                </p>
                {(view === 'checkout' || (view === 'flow' && flowStage === 'checkout')) && (
                    <CheckoutPage
                        api={api}
                        cart={cart}
                        order={order}
                        customer={customer}
                        market={selectedMarket}
                        locale={market.locale}
                        language={language}
                        paymentCurrencyCode={currency}
                        onBack={() => undefined}
                        onSessionChange={() => undefined}
                        onContinueCheckout={
                            view === 'flow'
                                ? () => {
                                      setFlowStage('payment');
                                      return true;
                                  }
                                : undefined
                        }
                        onCartChange={() => undefined}
                        onNotify={setNotice}
                        coupons={[]}
                        onApplyCoupon={async () => await Promise.resolve(null)}
                        onRemoveCoupon={async () => await Promise.resolve(null)}
                    />
                )}
                {view === 'support' && (
                    <SupportPageContext.Provider
                        value={{
                            api,
                            customer,
                            content: support,
                            language,
                            orderCode: 'SYNTHETIC-ONLY',
                            onNotify: setNotice,
                        }}
                    >
                        <SupportPage />
                    </SupportPageContext.Provider>
                )}
                {paymentView && (
                    <PaymentPage
                        api={api}
                        cart={cart}
                        order={order}
                        customer={customer}
                        market={selectedMarket}
                        displayCurrencyCode={currency}
                        locale={market.locale}
                        language={language}
                        onCancel={() => {
                            if (view === 'flow') setFlowStage('checkout');
                        }}
                        onComplete={async () => await Promise.resolve(undefined)}
                        onOrderChange={() => undefined}
                    />
                )}
                {view === 'gpt' && (
                    <StorefrontContext.Provider value={runtime}>
                        <Suspense fallback={null}>
                            <GptRechargeRoutePage />
                        </Suspense>
                    </StorefrontContext.Provider>
                )}
            </div>
        </DesktopLayoutContext.Provider>
    );
}

function RechargeRouteProbe() {
    const [committed, setCommitted] = useState(false);
    useEffect(() => setCommitted(true), []);
    return (
        <>
            <span hidden data-testid="recharge-route-ready" data-committed={committed} />
            <GptRechargeRoutePage />
        </>
    );
}
const rootRoute = createRootRoute({ component: view === 'gpt-shell' ? RechargeShellFixture : Fixture });
const rechargeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: RechargeRouteProbe,
});
const router = createRouter({
    routeTree: view === 'gpt-shell' ? rootRoute.addChildren([rechargeRoute]) : rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Synthetic fixture root is missing');
createRoot(rootElement).render(
    <QueryClientProvider client={cache}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
