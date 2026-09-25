import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// eslint-disable-next-line import/order -- Prettier organizes type-only imports after runtime imports.
import type { ActiveCustomer, MarketConfig, StoreCustomerCoupon } from '../../src/types';

import { ShopApi } from '../../src/api';
import { CartController } from '../../src/cart/cart-controller';
import { useCart } from '../../src/cart/use-cart';
import { useStorefrontCoupons } from '../../src/hooks/useStorefrontCoupons';

const params = new URLSearchParams(location.search);
const market: MarketConfig = {
    code: '',
    currencyCode: 'MYR',
    countryCode: 'MY',
    defaultLanguageCode: 'zh_Hans',
    locale: 'zh-CN',
    label: 'Local fixture',
};
const api = new ShopApi(market);
const controller = new CartController('coupon-hook-local');
api.enableCartCommands(controller);

function CouponHookFixture() {
    const cartState = useCart(controller);
    const [customer, setCustomer] = useState<ActiveCustomer | null>(null);
    const [coupons, setCoupons] = useState<StoreCustomerCoupon[]>([]);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const cart = cartState.cart;

    useEffect(() => {
        const unsubscribe = controller.subscribe(() => {
            void api
                .myCoupons()
                .then(setCoupons)
                .catch(() => undefined);
        });
        void (async () => {
            await api.login(params.get('email') ?? '', 'local-checkout-fixture');
            let activeCart = await api.cart();
            const variantId = params.get('digital');
            if (!activeCart.lines.length && variantId)
                activeCart = await api.addItem(variantId, activeCart.revision, 1);
            const campaignId = params.get('campaign');
            let owned = await api.myCoupons();
            if (campaignId && !owned.some(coupon => coupon.campaignId === campaignId)) {
                await api.claimCoupon(campaignId);
                owned = await api.myCoupons();
            }
            await api.beginCheckout(activeCart.revision);
            setCustomer(await api.activeCustomer());
            setCoupons(owned);
            setReady(true);
        })().catch(reason => setError(String(reason)));
        return unsubscribe;
    }, []);

    const { removeCoupon } = useStorefrontCoupons({
        api,
        market,
        language: 'zh',
        vendureLanguageCode: 'zh_Hans',
        storefrontContextResolved: true,
        customerAuthenticated: Boolean(customer),
        cart,
        cartState,
        route: { name: 'cart' },
        customer,
        myCoupons: coupons,
        customerCouponsQuery: { isPending: !ready },
        customerCouponQueryKey: ['coupon-hook-local', customer?.id ?? '', 'coupons'],
        couponCampaignsQueryKey: ['coupon-hook-local', 'campaigns'],
        notify: () => undefined,
        navigate: () => undefined,
        refreshCart: () => api.cart(),
        setCartLoading: () => undefined,
        setCartError: message => setError(message ?? ''),
    });
    const selected = coupons.find(coupon => coupon.lockedOrderId === cart?.checkoutOrder?.id);
    async function remove() {
        if (!selected) return;
        const message = await removeCoupon(selected.id);
        if (message) {
            setError(message);
            return;
        }
        await api.cart();
        setCoupons(await api.myCoupons());
    }

    if (error) return <p role="alert">{error}</p>;
    if (!ready || !cart?.checkoutOrder) return <p role="status">正在加载用券状态</p>;
    return (
        <main>
            <output
                data-testid="coupon-hook-state"
                data-cart-id={cart.id}
                data-order-id={cart.checkoutOrder.id}
                data-total={cart.checkoutOrder.totalWithTax}
            >
                {selected ? `已使用：${selected.campaignName}` : '未使用优惠券'}
            </output>
            <button type="button" disabled={!selected || cartState.pending} onClick={() => void remove()}>
                取消用券
            </button>
        </main>
    );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Coupon hook fixture root is missing');
createRoot(rootElement).render(
    <QueryClientProvider client={new QueryClient()}>
        <CouponHookFixture />
    </QueryClientProvider>,
);
