import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ShopApi } from '../../src/api';
import { CheckoutPage } from '../../src/checkout-page';
import '../../src/commerce-styles';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-commerce.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import { type ActiveCustomer, MarketConfig, Order, ShippingMethod, StorefrontCart } from '../../src/types';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

// No ShopApi instance or backend connection: this harness exercises the actual checkout component only.
const en = new URLSearchParams(location.search).get('language') === 'en';
const market: MarketConfig = {
    code: 'local-sync',
    currencyCode: 'MYR',
    countryCode: 'MY',
    defaultLanguageCode: en ? 'en' : 'zh_Hans',
    locale: en ? 'en-GB' : 'zh-CN',
    label: 'Local fixture',
};
const methods: ShippingMethod[] = [
    {
        id: 'a-standard',
        code: 'a-standard',
        name: en ? 'Standard' : '标准配送',
        description: '',
        priceWithTax: 600,
        metadata: { shippingGroupId: 'a', shippingGroupName: en ? 'Package 1' : '包裹 1' },
    },
    {
        id: 'a-economy',
        code: 'a-economy',
        name: en ? 'Economy' : '经济配送',
        description: '',
        priceWithTax: 400,
        metadata: { shippingGroupId: 'a', shippingGroupName: en ? 'Package 1' : '包裹 1' },
    },
    {
        id: 'b-standard',
        code: 'b-standard',
        name: en ? 'Standard' : '标准配送',
        description: '',
        priceWithTax: 300,
        metadata: { shippingGroupId: 'b', shippingGroupName: en ? 'Package 2' : '包裹 2' },
    },
];
const lines = [600, 10000].map((amount, index) => ({
    id: `line-${index}`,
    quantity: 1,
    linePriceWithTax: amount,
    proratedUnitPriceWithTax: amount,
    customFields: { fulfillmentTypeSnapshot: 'physical' as const },
    productVariant: {
        id: `variant-${index}`,
        sku: `SYNTHETIC-${index}`,
        name: en ? `Synthetic item ${index + 1}` : `合成商品 ${index + 1}`,
        priceWithTax: amount,
        currencyCode: 'MYR',
        stockLevel: 'IN_STOCK',
        featuredAsset: null,
        product: {
            id: `product-${index}`,
            name: en ? `Synthetic item ${index + 1}` : `合成商品 ${index + 1}`,
            featuredAsset: null,
        },
        customFields: { fulfillmentType: 'physical' as const },
    },
}));
const order: Order = {
    id: 'synthetic-order',
    code: 'SYNTHETIC',
    state: 'AddingItems',
    totalQuantity: 2,
    subTotalWithTax: 10600,
    shippingWithTax: 900,
    totalWithTax: 11500,
    currencyCode: 'MYR',
    lines,
    discounts: [],
    taxSummary: [],
    couponCodes: [],
    customFields: { customerNote: null },
    checkoutFulfillment: {
        fulfillmentType: 'PHYSICAL',
        containsPhysicalProducts: true,
        containsDigitalProducts: false,
        requiresShippingAddress: true,
        requiresShippingMethod: true,
    },
};
const initial: StorefrontCart = {
    id: 'synthetic-cart',
    revision: 1,
    projectedRevision: 1,
    state: 'OPEN',
    totalQuantity: 2,
    selectedQuantity: 2,
    selectedLineCount: 2,
    selectionState: 'ALL',
    lines: lines.map(line => ({
        id: `cart-${line.id}`,
        quantity: 1,
        selected: true,
        available: true,
        productVariant: line.productVariant,
    })),
    checkoutOrder: order,
};
const customer: ActiveCustomer = {
    id: 'synthetic-customer',
    firstName: 'Local',
    lastName: 'Fixture',
    emailAddress: 'synthetic@example.invalid',
    phoneNumber: null,
    orders: { items: [], totalItems: 0 },
    addresses: [
        {
            id: 'synthetic-address',
            fullName: 'Local fixture',
            streetLine1: '1 Synthetic Street',
            city: 'Kuala Lumpur',
            province: 'MY-14',
            postalCode: '50000',
            phoneNumber: '0100000000',
            country: { code: 'MY', name: 'Malaysia' },
            defaultShippingAddress: true,
            defaultBillingAddress: true,
        },
    ],
};
applyStorefrontVisualPreset(document.documentElement, 'neo-minimalist');
function Fixture() {
    const desktop = useDesktopViewport();
    const [cart, setCart] = useState(initial);
    const current = useRef(initial);
    current.current = cart;
    const [notice, setNotice] = useState('');
    const api = useMemo(
        () =>
            ({
                prepareShipping: () =>
                    Promise.resolve({
                        cart: current.current,
                        order: current.current.checkoutOrder,
                        shippingMethods: methods,
                        selectedShippingMethodId: 'a-standard',
                        selectedShippingMethodIds: ['a-standard', 'b-standard'],
                    }),
                setShippingMethodWithCart: (ids: string[]) => {
                    const shippingWithTax = methods
                        .filter(method => ids.includes(method.id))
                        .reduce((sum, method) => sum + method.priceWithTax, 0);
                    return Promise.resolve({
                        ...current.current,
                        revision: current.current.revision + 1,
                        checkoutOrder: {
                            ...(current.current.checkoutOrder ?? order),
                            shippingWithTax,
                            totalWithTax: 10600 + shippingWithTax,
                        },
                    });
                },
                preparePayment: () =>
                    Promise.reject(
                        new Error(en ? 'Payment is disabled in this local fixture' : '本地验收不提供付款'),
                    ),
                eligiblePaymentMethods: () => Promise.resolve([]),
                runWithinDeadline: async (callback: (signal: AbortSignal) => Promise<unknown>) =>
                    callback(new AbortController().signal),
            }) as unknown as ShopApi,
        [],
    );
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                <p role="status">
                    {en
                        ? 'Local synthetic acceptance · no backend connection or real order'
                        : '本地合成数据验收 · 不连接后台、不创建真实订单'}
                </p>
                <div id="storefront-content">
                    <CheckoutPage
                        api={api}
                        cart={cart}
                        order={cart.checkoutOrder}
                        customer={customer}
                        market={market}
                        language={en ? 'en' : 'zh'}
                        locale={market.locale}
                        availableProvinces={[{ code: 'MY-14', name: 'Kuala Lumpur', countryCode: 'MY' }]}
                        coupons={[]}
                        onBack={() => undefined}
                        onCartChange={setCart}
                        onSessionChange={() => undefined}
                        onNotify={setNotice}
                        onApplyCoupon={() => Promise.resolve(null)}
                        onRemoveCoupon={() => Promise.resolve(null)}
                    />
                </div>
                {notice && <p role="alert">{notice}</p>}
            </div>
        </DesktopLayoutContext.Provider>
    );
}
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const root = document.getElementById('root');
if (!root) throw new Error('Synthetic checkout root is missing');
createRoot(root).render(<RouterProvider router={router} />);
