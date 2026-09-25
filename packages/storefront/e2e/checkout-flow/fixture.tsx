/* eslint-disable import/order -- The Prettier import organizer places type imports after runtime imports. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
    ActiveCustomer,
    MarketConfig,
    Product,
    ProductVariant,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontCheckoutSession,
} from '../../src/types';

import { ShopApi } from '../../src/api';
import { CartController } from '../../src/cart/cart-controller';
import { CheckoutPage } from '../../src/checkout-page';
import '../../src/commerce-styles';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { ProductDetailPage } from '../../src/pages/product-detail-page';
import { ProductDetailPageContext } from '../../src/storefront-page-contexts';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-commerce.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/locale-preferences.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';
/* eslint-enable import/order */

// This entry exists only in the E2E harness; all data writes use the local Shop API.
const params = new URLSearchParams(location.search);
const market: MarketConfig = {
    code: params.get('channel') ?? '',
    currencyCode: 'MYR',
    countryCode: 'MY',
    defaultLanguageCode: 'zh_Hans',
    locale: 'zh-CN',
    label: 'Local fixture',
};
const api = new ShopApi(market);
const controller = new CartController(`checkout-fixture:${market.code}`);
api.enableCartCommands(controller);
applyStorefrontVisualPreset(document.documentElement, 'modern-oriental');

async function initialize() {
    // Synthetic customer credentials created by the test, not a production account.
    await api.login(params.get('email') ?? '', 'local-checkout-fixture');
    let cart = await api.cart();
    if (cart.state === 'PAYMENT_PENDING') cart = await api.reopenCart(cart.revision);
    const productId = params.get('productId');
    if (!cart.lines.length) {
        for (const id of productId
            ? [params.get('digital')]
            : [params.get('physical'), params.get('digital')]) {
            if (id) cart = await api.addItem(id, cart.revision, 1);
        }
    }
    let customer = await api.activeCustomer();
    if (!customer?.addresses?.length) {
        await api.createAddress({
            fullName: 'Browser Checkout',
            streetLine1: '1 Test Street',
            city: 'Kuala Lumpur',
            province: 'Kuala Lumpur',
            postalCode: '50000',
            countryCode: 'MY',
            phoneNumber: '+60100000000',
            defaultShippingAddress: true,
            defaultBillingAddress: true,
        });
        customer = await api.activeCustomer();
    }
    const campaignId = params.get('campaign');
    let coupons = await api.myCoupons();
    if (campaignId && !coupons.some(coupon => coupon.campaignId === campaignId)) {
        await api.claimCoupon(campaignId);
        coupons = await api.myCoupons();
    }
    const product = productId ? await api.product(productId) : null;
    if (productId && !product) throw new Error('Synthetic product was not found');
    const session = productId ? null : await api.beginCheckout(cart.revision);
    return { cart: session?.cart ?? cart, customer, coupons, product };
}

function Fixture() {
    const desktop = useDesktopViewport();
    const [cart, setCart] = useState<StorefrontCart | null>(null);
    const [customer, setCustomer] = useState<ActiveCustomer | null>(null);
    const [coupons, setCoupons] = useState<StoreCustomerCoupon[]>([]);
    const [session, setSession] = useState<StorefrontCheckoutSession | null>(null);
    const [product, setProduct] = useState<Product | null>(null);
    const [showCheckout, setShowCheckout] = useState(!params.has('productId'));
    const [addingVariantId, setAddingVariantId] = useState<string | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        void initialize()
            .then(data => {
                setCart(data.cart);
                setCustomer(data.customer);
                setCoupons(data.coupons);
                setProduct(data.product);
            })
            .catch(reason => setError(String(reason)));
    }, []);
    async function couponChange(id: string, remove: boolean) {
        try {
            if (remove) await api.removeCustomerCoupon(id);
            else await api.applyCustomerCoupon(id);
            setCart(await api.cart());
            setCoupons(await api.myCoupons());
            return null;
        } catch (reason) {
            return String(reason);
        }
    }
    async function addProduct(variant: ProductVariant, quantity: number) {
        if (!cart) return;
        setAddingVariantId(variant.id);
        try {
            setCart(await api.addItem(variant.id, cart.revision, quantity));
        } catch (reason) {
            setError(String(reason));
        } finally {
            setAddingVariantId(null);
        }
    }
    async function buyProduct(variant: ProductVariant, quantity: number) {
        setAddingVariantId(variant.id);
        try {
            const result = await controller.execute({
                buyNow: { productVariantId: variant.id, quantity },
            });
            if (!result.session) throw new Error('Buy-now checkout session was not created');
            setCart(result.session.cart);
            setShowCheckout(true);
        } catch (reason) {
            setError(String(reason));
        } finally {
            setAddingVariantId(null);
        }
    }
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                <div id="storefront-content">
                    {error ? (
                        <p role="alert">{error}</p>
                    ) : session ? (
                        <section aria-label="Prepared local order">
                            <h1>订单已准备</h1>
                            <output data-order-id={session.order.id} data-total={session.order.totalWithTax}>
                                {session.order.state} · {session.order.currencyCode}{' '}
                                {session.order.totalWithTax / 100}
                            </output>
                        </section>
                    ) : !cart ? (
                        <p role="status">正在加载本地结算</p>
                    ) : product && !showCheckout ? (
                        <>
                            <output data-testid="fixture-cart-quantity">{cart.totalQuantity}</output>
                            <ProductDetailPageContext.Provider
                                value={{
                                    api,
                                    product,
                                    products: [product],
                                    cartQuantity: cart.totalQuantity,
                                    market,
                                    locale: market.locale,
                                    language: 'zh',
                                    storefrontName: 'Local fixture',
                                    logoUrl: null,
                                    flashSaleItems: [],
                                    couponCampaigns: [],
                                    customerCoupons: coupons,
                                    addingVariantId,
                                    favorite: false,
                                    onAdd: (variant, quantity) => void addProduct(variant, quantity),
                                    onBuyNow: (variant, quantity) => void buyProduct(variant, quantity),
                                    onFavorite: () => undefined,
                                    onNotify: () => undefined,
                                }}
                            >
                                <ProductDetailPage />
                            </ProductDetailPageContext.Provider>
                        </>
                    ) : (
                        <CheckoutPage
                            api={api}
                            cart={cart}
                            order={cart.checkoutOrder}
                            customer={customer}
                            market={market}
                            storefrontCode={params.get('storeCode') ?? ''}
                            availableProvinces={[{ code: 'MY-14', name: 'Kuala Lumpur', countryCode: 'MY' }]}
                            locale="zh-CN"
                            language="zh"
                            coupons={coupons}
                            onBack={() => undefined}
                            onNotify={() => undefined}
                            onCartChange={setCart}
                            onSessionChange={setSession}
                            onApplyCoupon={id => couponChange(id, false)}
                            onRemoveCoupon={id => couponChange(id, true)}
                        />
                    )}
                </div>
            </div>
        </DesktopLayoutContext.Provider>
    );
}
const rootRoute = createRootRoute({ component: Fixture });
const router = createRouter({
    routeTree: rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: '/payment' })]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Checkout fixture root is missing');
createRoot(rootElement).render(
    <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
