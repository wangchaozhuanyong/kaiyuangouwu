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
    Order,
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
import { PaymentPage } from '../../src/payment-pages';
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
const language = params.get('language') === 'en' ? 'en' : 'zh';
const market: MarketConfig = {
    code: params.get('channel') ?? '',
    currencyCode: params.get('currency') ?? 'MYR',
    countryCode: params.get('country') ?? 'MY',
    defaultLanguageCode: language === 'en' ? 'en' : 'zh_Hans',
    locale: language === 'en' ? 'en-GB' : 'zh-CN',
    label: 'Local fixture',
};
const api = new ShopApi(market);
const controller = new CartController(`checkout-fixture:${market.code}`);
api.enableCartCommands(controller);
applyStorefrontVisualPreset(document.documentElement, 'neo-minimalist');

async function initialize() {
    // Synthetic customer credentials created by the test, not a production account.
    await api.login(params.get('email') ?? '', 'local-checkout-fixture');
    const accessMode =
        params.get('controlledPayment') === '1' ? (await api.storefrontConfig()).accessMode : undefined;
    if (params.get('controlledPayment') === '1' && accessMode !== 'PREVIEW') {
        throw new Error('The synthetic checkout must use the actual PREVIEW access mode.');
    }
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
            city: market.countryCode === 'GB' ? 'London' : 'Kuala Lumpur',
            province: market.countryCode === 'GB' ? 'London' : 'Kuala Lumpur',
            postalCode: market.countryCode === 'GB' ? 'SW1A 1AA' : '50000',
            countryCode: market.countryCode ?? 'MY',
            phoneNumber: market.countryCode === 'GB' ? '+441000000000' : '+60100000000',
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
    return { cart: session?.cart ?? cart, customer, coupons, product, accessMode };
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
    const [accessMode, setAccessMode] = useState<string | undefined>();
    const [preparedVerified, setPreparedVerified] = useState(false);
    const [paymentError, setPaymentError] = useState('');
    const controlledPayment = params.get('controlledPayment') === '1';
    useEffect(() => {
        void initialize()
            .then(data => {
                setCart(data.cart);
                setCustomer(data.customer);
                setCoupons(data.coupons);
                setProduct(data.product);
                setAccessMode(data.accessMode);
            })
            .catch(reason => setError(String(reason)));
    }, []);
    useEffect(() => {
        if (!controlledPayment || session?.order.state !== 'ArrangingPayment') return;
        let active = true;
        void (async () => {
            const methods = await api.eligiblePaymentMethods(undefined, session.order.id);
            const eligible = methods.filter(method => method.isEligible).map(method => method.code);
            if (eligible.length !== 1 || eligible[0] !== 'controlled-test-payment-platform') {
                throw new Error('The local PREVIEW fixture must offer only its controlled test payment.');
            }
            const response = await fetch('/__public-preview-fixture/prepared', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: session.order.id }),
            });
            if (!response.ok)
                throw new Error('The local backend has not confirmed the prepared resource holds.');
            if (active) setPreparedVerified(true);
        })().catch(reason => {
            if (active) setPaymentError(String(reason));
        });
        return () => {
            active = false;
        };
    }, [controlledPayment, session?.order.id, session?.order.state]);
    function updatePaymentOrder(order: Order) {
        setSession(current => (current ? { ...current, order } : current));
    }
    async function reopenPayment() {
        if (!session) return;
        try {
            setCart(await api.reopenCart(session.cart.revision));
            setSession(null);
            setPreparedVerified(false);
            setCoupons(await api.myCoupons());
        } catch (reason) {
            setPaymentError(String(reason));
        }
    }
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
                {accessMode === 'PREVIEW' && (
                    <aside
                        className="storefront-preview-notice type-helper"
                        role="status"
                        data-access-mode={accessMode}
                    >
                        <strong>{language === 'zh' ? '公开预览' : 'Public preview'}</strong>
                        <span>
                            {language === 'zh'
                                ? '店铺尚未正式营业；测试支付只会生成模拟订单。'
                                : 'This store is not live yet. Test payments create simulated orders only.'}
                        </span>
                    </aside>
                )}
                <div id="storefront-content">
                    {controlledPayment && (
                        <p role="status">
                            Synthetic local checkout — no external payment provider or real charge.
                        </p>
                    )}
                    {controlledPayment && (
                        <p className="type-helper">
                            Apply the synthetic coupon, refresh to confirm it persists, enter both delivery
                            email fields, submit the checkout form, then select Confirm test payment on the
                            actual payment page.
                        </p>
                    )}
                    {error ? (
                        <p role="alert">{error}</p>
                    ) : session &&
                      controlledPayment &&
                      preparedVerified &&
                      session.order.state === 'ArrangingPayment' ? (
                        <PaymentPage
                            api={api}
                            cart={session.cart}
                            order={session.order}
                            customer={customer}
                            market={market}
                            displayCurrencyCode={market.currencyCode}
                            locale={market.locale}
                            language={language}
                            onOrderChange={updatePaymentOrder}
                            onComplete={order => Promise.resolve(updatePaymentOrder(order))}
                            onCancel={() => void reopenPayment()}
                        />
                    ) : session ? (
                        <section aria-label="Prepared local order">
                            <h1>订单已准备</h1>
                            <output data-order-id={session.order.id} data-total={session.order.totalWithTax}>
                                {session.order.state} · {session.order.currencyCode}{' '}
                                {session.order.totalWithTax / 100}
                            </output>
                            {controlledPayment && (
                                <>
                                    {paymentError && <p role="alert">{paymentError}</p>}
                                    {session.order.state === 'PaymentSettled' ? (
                                        <p role="status">
                                            Settled — controlled simulation, no external charge.
                                        </p>
                                    ) : (
                                        <p role="status">
                                            Confirming natural resource holds and controlled payment
                                            eligibility…
                                        </p>
                                    )}
                                </>
                            )}
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
                                    language,
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
                            availableProvinces={
                                market.countryCode === 'MY'
                                    ? [{ code: 'MY-14', name: 'Kuala Lumpur', countryCode: 'MY' }]
                                    : []
                            }
                            locale={market.locale}
                            language={language}
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
