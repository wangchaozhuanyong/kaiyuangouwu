import type { ShopApi } from '../../src/api';
import type { DigitalReceiptStatus } from '../../src/digital-receipt-panel';
import type { MarketConfig, Order, StorefrontLanguage } from '../../src/types';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { useStorefrontBrandColors } from '../../src/hooks/useStorefrontDocument';
import { OrderDetailPage } from '../../src/order-pages';
import { OrderConfirmationPage } from '../../src/payment-pages';
import { createStorefrontQueryClient, refreshStorefrontQueries } from '../../src/query-client';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-commerce.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';
// In-memory synthetic API: no production, SMTP, funds, database or account credentials.
const params = new URLSearchParams(location.search);
const language: StorefrontLanguage = params.get('language') === 'en' ? 'en' : 'zh';
const preset = params.get('preset') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const market: MarketConfig = {
    code: 'synthetic-digital',
    currencyCode: 'CNY',
    countryCode: 'CN',
    defaultLanguageCode: language === 'zh' ? 'zh_Hans' : 'en',
    locale: language === 'zh' ? 'zh-CN' : 'en-US',
    label: 'Synthetic fixture',
};
const client = createStorefrontQueryClient();
const modes = ['manual_service', 'auto_card', 'file_download'] as const;
let reads = 0;
const claims: string[] = [];
let revoked = false;
let readFailure = false;
let readFailures = 0;
let proofMatched = true;
let additionalSubmissions = 0;
let additionalExpectedAmount = 0;
let additionalRemaining = 500;
let walletAvailable = 200;
let usdtRequests = 0;
let issuedUsdt: Record<string, unknown> | null = null;
let additionalReadFailure = false;
const lines = modes.map((mode, index) => ({
    id: `line-${index + 1}`,
    quantity: 1,
    linePriceWithTax: 100,
    proratedUnitPriceWithTax: 100,
    productVariant: {
        id: `variant-${index}`,
        name:
            language === 'zh'
                ? ['人工账号交付', '自动卡密交付', '私有文件交付'][index]
                : ['Manual digital account', 'Automatic credentials', 'Private purchased file'][index],
        sku: `SYNTHETIC-${index}`,
        priceWithTax: 100,
        currencyCode: 'CNY',
        stockLevel: 'IN_STOCK',
        featuredAsset: null,
        product: { id: `product-${index}`, name: 'Synthetic product', featuredAsset: null },
        customFields: { fulfillmentType: 'digital', digitalDeliveryMode: mode },
    },
    customFields: {
        fulfillmentTypeSnapshot: 'digital',
        digitalDeliveryModeSnapshot: mode,
        refundPolicySnapshot: 'MERCHANT_REVIEW',
    },
}));
const order = {
    id: 'synthetic-order',
    code: 'SYNTHETIC-ONLY',
    state: 'PaymentSettled',
    orderPlacedAt: '2026-10-04T12:00:00Z',
    totalQuantity: 3,
    subTotalWithTax: 300,
    shippingWithTax: 0,
    totalWithTax: 300,
    currencyCode: 'CNY',
    customer: { id: 'synthetic-customer', emailAddress: 'fixture@example.invalid' },
    lines,
    discounts: [],
    couponCodes: [],
    taxSummary: [],
    customFields: {},
    fulfillments: [],
    checkoutFulfillment: {
        fulfillmentType: 'DIGITAL',
        containsDigitalProducts: true,
        containsPhysicalProducts: false,
        requiresShippingAddress: false,
        requiresShippingMethod: false,
    },
} as Order;
if (params.has('additional')) {
    order.state = 'ArrangingAdditionalPayment';
    order.totalWithTax = 800;
}
const statuses = (): DigitalReceiptStatus[] =>
    modes.map((mode, index) => ({
        orderLineId: `line-${index + 1}`,
        mode,
        state: revoked || order.state === 'ArrangingAdditionalPayment' ? 'UNAVAILABLE' : 'READY',
        eligibleQuantity: revoked || order.state === 'ArrangingAdditionalPayment' ? 0 : 1,
        readyQuantity: revoked || order.state === 'ArrangingAdditionalPayment' ? 0 : 1,
        claimedQuantity: claims.includes(`line-${index + 1}`) ? 1 : 0,
        notificationState: mode === 'file_download' ? 'NOT_REQUIRED' : 'EMAIL_FAILED',
    }));
const api = {
    orderByConfirmationToken: () => Promise.resolve(order),
    orderAdditionalPaymentQuote: () => {
        return Promise.resolve().then(() => {
            if (additionalReadFailure) throw new Error('Synthetic remaining amount refresh failed');
            const choice = params.get('additional');
            const method =
                choice === 'usdt'
                    ? 'usdt-trc20'
                    : choice?.startsWith('wallet') && walletAvailable > 0
                      ? 'referral-balance'
                      : 'synthetic-gateway';
            return {
                orderId: order.id,
                state: order.state,
                outstandingAmount: order.state === 'ArrangingAdditionalPayment' ? additionalRemaining : 0,
                blockedReason: order.state === 'ArrangingAdditionalPayment' ? null : '补款已登记',
                walletAvailableAmount: walletAvailable,
                usdtPayment: issuedUsdt,
                methods: [
                    {
                        id: method,
                        code: method,
                        name:
                            method === 'referral-balance'
                                ? '余额'
                                : method === 'usdt-trc20'
                                  ? 'USDT'
                                  : 'Synthetic local method',
                        isEligible: true,
                    },
                ],
            };
        });
    },
    createModifiedOrderUsdtQuote: (_id: string, expected: number, proof?: string) => {
        return Promise.resolve().then(() => {
            usdtRequests++;
            additionalExpectedAmount = expected;
            proofMatched &&= proof === 'dummy-proof-one';
            issuedUsdt = {
                id: 'synthetic-quote',
                fiatAmount: 500,
                fiatCurrencyCode: 'CNY',
                usdtAmount: 0.700123,
                network: 'TRC20',
                receivingAddress: 'SYNTHETIC-NOT-A-WALLET',
                paymentStatus: 'PENDING',
                expiresAt: new Date(Date.now() + 600000).toISOString(),
            };
            return issuedUsdt;
        });
    },
    useModifiedOrderReferralBalance: (_id: string, expected: number, amount: number) => {
        return Promise.resolve().then(() => {
            additionalSubmissions++;
            additionalExpectedAmount = expected;
            additionalRemaining -= amount;
            walletAvailable -= amount;
            if (params.get('additional') === 'wallet-refresh-failure') additionalReadFailure = true;
            return order;
        });
    },
    addPaymentToModifiedOrder: async (_id: string, _method: string, amount: number, proof?: string) => {
        additionalSubmissions++;
        additionalExpectedAmount = amount;
        proofMatched &&= proof === 'dummy-proof-one';
        await new Promise(resolve => setTimeout(resolve, 50));
        if (params.get('additional') === 'unknown') throw new Error('Synthetic unknown response');
        order.state = 'PaymentSettled';
        return order;
    },
    digitalDeliveryStatuses: (_id: string, proof?: string) => {
        return Promise.resolve().then(() => {
            reads++;
            if (params.get('page') === 'confirmation')
                proofMatched &&= proof === 'dummy-proof-one' || proof === 'dummy-proof-two';
            if (readFailure) {
                readFailures++;
                throw new Error('Synthetic metadata read failed');
            }
            return statuses();
        });
    },
    claimDigitalDelivery: (_id: string, id: string) => {
        return Promise.resolve().then(() => {
            if (revoked) throw new Error('Synthetic revoked entitlement');
            if (!claims.includes(id)) claims.push(id);
            const status = statuses().find(item => item.orderLineId === id);
            if (!status) throw new Error('Synthetic entitlement was not found');
            return {
                ...status,
                instructions:
                    language === 'zh'
                        ? '合成验收资料，不是真实账号。'
                        : 'Synthetic acceptance data. No real account.',
                downloadUrl:
                    status.mode === 'file_download' ? '/digital-delivery/synthetic-file-token' : null,
                packages:
                    status.mode !== 'file_download'
                        ? [
                              {
                                  number: 1,
                                  note: 'Synthetic note with comma, pipe | and a second line\nPreserved.',
                                  fields: [
                                      {
                                          label: 'Synthetic content',
                                          value: 'dummy-private-content-only-no-real-credential',
                                      },
                                  ],
                                  attachments: [],
                              },
                          ]
                        : [],
            };
        });
    },
} as unknown as ShopApi;
(window as any).fixtureStats = () => ({
    reads,
    readFailures,
    claimCount: claims.length,
    revoked,
    proofMatched,
    additionalSubmissions,
    additionalExpectedAmount,
    additionalRemaining,
    usdtRequests,
    cacheContainsContent: JSON.stringify(
        client
            .getQueryCache()
            .getAll()
            .map(query => query.state.data),
    ).includes('dummy-private-content'),
});
(window as any).recoverAdditionalRead = () => {
    additionalReadFailure = false;
};
function Fixture() {
    const desktop = useDesktopViewport();
    const [proof, setProof] = useState('dummy-proof-one');
    useStorefrontBrandColors(undefined, preset, { ready: true, cache: false });
    applyStorefrontVisualPreset(document.documentElement, preset);
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                <div id="storefront-content">
                    <nav aria-label="Synthetic fixture controls">
                        <button
                            type="button"
                            onClick={() => {
                                revoked = true;
                                void refreshStorefrontQueries(client, {
                                    marketCode: 'synthetic-digital:CNY',
                                    languageCode: market.defaultLanguageCode,
                                    includePrivate: true,
                                });
                            }}
                        >
                            Synthetic revoke
                        </button>
                        <button type="button" onClick={() => setProof('dummy-proof-two')}>
                            Synthetic switch proof
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                readFailure = true;
                                void refreshStorefrontQueries(client, {
                                    marketCode: 'synthetic-digital:CNY',
                                    languageCode: market.defaultLanguageCode,
                                    includePrivate: true,
                                });
                            }}
                        >
                            Synthetic read failure
                        </button>
                    </nav>
                    {params.get('page') === 'confirmation' ? (
                        <OrderConfirmationPage
                            api={api}
                            code={order.code}
                            confirmationToken={proof}
                            customer={
                                params.get('customer') === 'signed-in'
                                    ? {
                                          id: 'synthetic-customer',
                                          firstName: 'Synthetic',
                                          lastName: 'Customer',
                                          emailAddress: 'fixture@example.invalid',
                                          phoneNumber: null,
                                          addresses: [],
                                          orders: { items: [], totalItems: 0 },
                                      }
                                    : null
                            }
                            market={market}
                            locale={market.locale}
                            language={language}
                        />
                    ) : (
                        <OrderDetailPage
                            api={api}
                            order={order}
                            market={market}
                            locale={market.locale}
                            language={language}
                            storefrontName="Synthetic fixture"
                            onBack={() => undefined}
                            onBuyAgain={() => Promise.resolve(undefined)}
                            onReopen={() => Promise.resolve(undefined)}
                            onCancelOrder={() => Promise.resolve(undefined)}
                            onCreateAfterSales={() => Promise.resolve(undefined)}
                            onConfirmDelivery={() => Promise.resolve(undefined)}
                            onUnavailable={() => undefined}
                        />
                    )}
                </div>
            </div>
        </DesktopLayoutContext.Provider>
    );
}
const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ['/'] }) });
(
    window as Window & { fixtureRoute?: () => Pick<typeof router.state.location, 'pathname' | 'search'> }
).fixtureRoute = () => ({
    pathname: router.state.location.pathname,
    search: router.state.location.search,
});
const container = document.getElementById('root');
if (!container) throw new Error('Synthetic receipt root was not found');
createRoot(container).render(
    <StrictMode>
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </StrictMode>,
);
// organize-imports-ignore -- Preserve ESLint grouping of type-only imports.
