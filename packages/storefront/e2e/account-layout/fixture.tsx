/* eslint-disable import/order -- Match the project's import organizer. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { ShopApi } from '../../src/api';
import { DesktopAccountNavigation } from '../../src/components/common/desktop-account-navigation';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { DesktopAccountPage } from '../../src/pages/desktop-account-page';
import { ProductDetailPage } from '../../src/pages/product-detail-page';
import { ReviewCenterPage } from '../../src/review-pages';
import { ProductDetailPageContext } from '../../src/storefront-page-contexts';
import { StorefrontContext, StorefrontContextValue } from '../../src/StorefrontContext';
import '../../src/styles.css';
import '../../src/styles/account-catalog-surfaces.css';
import '../../src/styles/account-identity.css';
import '../../src/styles/ai-product-covers.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-catalog.css';
import '../../src/styles/desktop-commerce.css';
import '../../src/styles/desktop-home.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/modals-and-support.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import {
    ActiveCustomer,
    MarketConfig,
    Product,
    StorefrontLanguage,
    StorefrontReview,
    StorefrontReviewCandidate,
    SubmitStorefrontReviewInput,
} from '../../src/types';

// Actual production components; all account/product/review data is synthetic and writes stay in memory.
const params = new URLSearchParams(location.search);
const language: StorefrontLanguage = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const view = params.get('view') ?? 'reviews';
const count = Number(params.get('count') ?? 1);
const palette = resolveStorefrontSemanticPalette(preset, { accentColor: '#087f91' });
document.documentElement.dataset.storefrontPreset = preset;
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);
document.documentElement.style.colorScheme = preset === 'classic' ? 'light' : 'dark';
const market: MarketConfig = {
    code: 'layout-local-only',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: language === 'zh' ? 'zh-CN' : 'en-MY',
    label: 'Local sample',
};
const image = '/storefront/categories/category-desk-setup.jpg';
const name =
    language === 'zh' ? '桌面空间组合 · 本地样本商品' : 'Desk essentials collection · local sample product';
const product = {
    id: 'sample-product',
    createdAt: '2026-10-01T00:00:00Z',
    name,
    slug: 'local-sample',
    description: '<p>本地布局样本，不是线上商品与交易数据。</p>',
    assets: [{ id: 'sample-image', preview: image }],
    featuredAsset: { id: 'sample-image', preview: image },
    customFields: {
        fulfillmentType: 'digital',
        refundPolicy: 'MERCHANT_REVIEW',
        manualDeliverySlaMinutes: 1440,
    },
    collections: [],
    variants: [
        {
            id: 'sample-variant',
            name: language === 'zh' ? '原木色' : 'Natural wood',
            sku: 'SAMPLE',
            priceWithTax: 9900,
            currencyCode: 'MYR',
            stockLevel: 'IN_STOCK',
            saleableStockLevel: 10,
            featuredAsset: { id: 'sample-image', preview: image },
            product: { id: 'sample-product', name, featuredAsset: { id: 'sample-image', preview: image } },
            customFields: {
                fulfillmentType: 'digital',
                digitalDeliveryMode: 'manual_service',
            },
        },
    ],
} as Product;
let candidates: StorefrontReviewCandidate[] = Array.from({ length: count }, (_, index) => ({
    orderLineId: `sample-line-${index + 1}`,
    orderId: `sample-order-${index + 1}`,
    orderCode: `LOCAL-20261002-${index + 1}`,
    orderState: 'Delivered',
    productId: product.id,
    productVariantId: product.variants[0].id,
    productName: name,
    variantName: product.variants[0].name,
    sku: 'SAMPLE',
    unitPriceWithTax: 9900,
    currencyCode: 'MYR',
    fulfillmentType: 'digital',
    imageUrl: image,
}));
const reviews: StorefrontReview[] = [];
const customer = {
    id: 'local-customer',
    firstName: language === 'zh' ? '用户' : 'Customer',
    lastName: language === 'zh' ? '示例' : 'Sample ',
    emailAddress: 'sample@example.invalid',
    phoneNumber: null,
    addresses: [],
    orders: {
        totalItems: 2,
        items: [0, 1].map(index => ({
            id: `sample-order-${index + 1}`,
            code: `LOCAL-20261002-${index + 1}`,
            state: index ? 'PaymentSettled' : 'ArrangingPayment',
            totalWithTax: 9900,
            currencyCode: 'MYR',
            lines: [
                {
                    id: `sample-line-${index + 1}`,
                    quantity: 1,
                    featuredAsset: { id: 'sample-image', preview: image },
                    productVariant: product.variants[0],
                    customFields: { fulfillmentTypeSnapshot: 'digital' },
                },
            ],
        })),
    },
} as unknown as ActiveCustomer;
let fail = params.get('fail') === '1';
const api = {
    myReviews: () => Promise.resolve([...reviews]),
    reviewCandidates: ({ skip = 0, take = 20 } = {}) => Promise.resolve(candidates.slice(skip, skip + take)),
    submitReview: async (input: SubmitStorefrontReviewInput) => {
        await new Promise(resolve => setTimeout(resolve, 300));
        if (fail) {
            fail = false;
            throw new Error('Failed to fetch');
        }
        candidates = candidates.filter(item => item.orderLineId !== input.orderLineId);
        reviews.push({
            id: `review-${input.orderLineId}`,
            productId: product.id,
            productName: name,
            rating: input.rating,
            title: input.title,
            body: input.body,
            anonymous: input.anonymous ?? false,
            updatedAt: new Date().toISOString(),
            sku: 'SAMPLE',
            verifiedPurchase: true,
            state: 'PENDING',
            images: [],
            createdAt: new Date().toISOString(),
            customerName: 'Sample',
        });
    },
    dailyRecommendations: () => Promise.resolve({ items: [], expiresAt: '2099-01-01T00:00:00Z' }),
    productReviews: () => Promise.resolve({ items: [], totalItems: 0, averageRating: 0 }),
} as unknown as ShopApi;
function Fixture() {
    const desktop = useDesktopViewport();
    const [notice, setNotice] = useState('');
    const context = {
        route: { name: view === 'reviews' ? 'reviews' : 'account' },
        language,
        customer,
        supportContent: undefined,
        reviewSettingsStatus: 'enabled',
    } as StorefrontContextValue;
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <StorefrontContext.Provider value={context}>
                <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                    <aside style={{ padding: '12px 24px', fontSize: 12, color: 'var(--muted)' }}>
                        本地组件验收 · 合成样本 · 不连接生产接口
                        {['reviews', 'account', 'product'].map(page => (
                            <a
                                key={page}
                                style={{ marginRight: 12, color: 'var(--accent-ink)' }}
                                href={`?view=${page}&skin=${preset}&lang=${language}&count=${count}`}
                            >
                                {page}
                            </a>
                        ))}
                    </aside>
                    {notice && (
                        <p role="status" style={{ padding: '0 24px' }}>
                            {notice}
                        </p>
                    )}
                    <div
                        className={
                            desktop && view !== 'product'
                                ? 'desktop-shell-frame desktop-account-layout'
                                : undefined
                        }
                        style={{
                            maxWidth: 1440,
                            margin: '0 auto',
                            padding: desktop ? '24px' : '0',
                            display: desktop && view !== 'product' ? 'grid' : 'block',
                            gridTemplateColumns: '256px minmax(0,1fr)',
                            gap: 24,
                            alignItems: 'start',
                        }}
                    >
                        {desktop && view !== 'product' && <DesktopAccountNavigation />}
                        {view === 'reviews' ? (
                            <ReviewCenterPage
                                api={api}
                                customer={customer}
                                market={market}
                                language={language}
                                onBack={() => undefined}
                                onProduct={() => undefined}
                                onShop={() => undefined}
                                onSignIn={() => undefined}
                                onNotify={setNotice}
                            />
                        ) : view === 'account' ? (
                            <DesktopAccountPage
                                api={api}
                                customer={customer}
                                products={[]}
                                market={market}
                                locale={market.locale}
                                language={language}
                                storefrontName="Local sample"
                                favoriteProductCount={0}
                                couponCount={0}
                                onContentTarget={() => undefined}
                                pending={false}
                                counts={{ pending: 0, shipping: 1, receiving: 0, completed: 0 }}
                                countsError={false}
                                onRetryCounts={() => undefined}
                                afterSalesCount={0}
                                referralEnabled={false}
                                referralPending={false}
                                referralBalance={0}
                                referralBalanceStatus="ready"
                                onRetryReferral={() => undefined}
                                navigate={route => setNotice(`Local navigation: ${route.name}`)}
                            />
                        ) : (
                            <ProductDetailPageContext.Provider
                                value={{
                                    api,
                                    product,
                                    products: [],
                                    cartQuantity: 0,
                                    market,
                                    locale: market.locale,
                                    language,
                                    reviewEnabled: false,
                                    storefrontName: 'Local sample',
                                    logoUrl: null,
                                    flashSaleItems: [],
                                    couponCampaigns: [],
                                    customerCoupons: [],
                                    addingVariantId: null,
                                    favorite: false,
                                    onAdd: () => undefined,
                                    onBuyNow: () => undefined,
                                    onFavorite: () => undefined,
                                    onNotify: setNotice,
                                }}
                            >
                                <ProductDetailPage />
                            </ProductDetailPageContext.Provider>
                        )}
                    </div>
                </div>
            </StorefrontContext.Provider>
        </DesktopLayoutContext.Provider>
    );
}
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
createRoot(root).render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
