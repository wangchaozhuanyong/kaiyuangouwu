// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi, ShopApiError } from './api';
import { CheckoutPage } from './checkout-page';
import { checkoutPageStyles } from './tailwind/checkout-page-styles';
import {
    ActiveCustomer,
    MarketConfig,
    Order,
    OrderLine,
    ProductVariant,
    ShippingMethod,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontFlashSale,
} from './types';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};
const availableProvinces = [
    { code: 'MY-10', name: '雪兰莪', countryCode: 'MY' },
    { code: 'MY-14', name: '吉隆坡', countryCode: 'MY' },
];

function variant(fulfillmentType: 'physical' | 'digital', id: string): ProductVariant {
    return {
        id,
        name: fulfillmentType === 'digital' ? '数字模板包' : '32 英寸显示器',
        sku: fulfillmentType === 'digital' ? 'DIGITAL-TEMPLATE' : 'DISPLAY-32',
        priceWithTax: 31381,
        currencyCode: 'MYR',
        stockLevel: 'IN_STOCK',
        featuredAsset: null,
        product: {
            id: `product-${id}`,
            name: fulfillmentType === 'digital' ? '数字模板包' : '32 英寸显示器',
            featuredAsset: null,
        },
        customFields: { fulfillmentType },
    };
}

function line(productVariant: ProductVariant, id: string): OrderLine {
    return {
        id,
        quantity: 1,
        linePriceWithTax: productVariant.priceWithTax,
        proratedUnitPriceWithTax: productVariant.priceWithTax,
        productVariant,
        customFields: { fulfillmentTypeSnapshot: productVariant.customFields.fulfillmentType },
    };
}

function orderFor(type: 'DIGITAL' | 'PHYSICAL' | 'MIXED', deliveryEmail?: string): Order {
    const lines =
        type === 'DIGITAL'
            ? [line(variant('digital', 'digital'), 'line-digital')]
            : type === 'PHYSICAL'
              ? [line(variant('physical', 'physical'), 'line-physical')]
              : [
                    line(variant('physical', 'physical'), 'line-physical'),
                    line(variant('digital', 'digital'), 'line-digital'),
                ];
    const containsPhysicalProducts = type !== 'DIGITAL';
    const containsDigitalProducts = type !== 'PHYSICAL';
    return {
        id: 'order-1',
        code: 'T0001',
        state: 'AddingItems',
        totalQuantity: lines.length,
        subTotalWithTax: lines.reduce((sum, item) => sum + item.linePriceWithTax, 0),
        shippingWithTax: 0,
        totalWithTax: lines.reduce((sum, item) => sum + item.linePriceWithTax, 0),
        currencyCode: 'MYR',
        lines,
        discounts: [],
        taxSummary: [],
        couponCodes: [],
        customFields: { customerNote: null, deliveryEmail },
        checkoutFulfillment: {
            fulfillmentType: type,
            containsPhysicalProducts,
            containsDigitalProducts,
            requiresShippingAddress: containsPhysicalProducts,
            requiresShippingMethod: containsPhysicalProducts,
        },
    };
}

function cartFor(order: Order): StorefrontCart {
    return {
        id: 'cart-1',
        revision: 1,
        state: 'OPEN',
        projectedRevision: 1,
        totalQuantity: order.totalQuantity,
        selectedLineCount: order.lines.length,
        selectedQuantity: order.totalQuantity,
        selectionState: 'ALL',
        lines: order.lines.map(item => ({
            id: `cart-${item.id}`,
            quantity: item.quantity,
            selected: true,
            available: true,
            productVariant: item.productVariant,
        })),
        checkoutOrder: order,
    };
}

function coupon(overrides: Partial<StoreCustomerCoupon> = {}): StoreCustomerCoupon {
    return {
        id: 'coupon-1',
        campaignId: 'campaign-1',
        campaignName: '新客优惠券',
        campaignKind: 'ORDER_FIXED',
        status: 'AVAILABLE',
        minimumSpend: 1000,
        currencyCode: 'MYR',
        discountAmount: 500,
        discountRate: null,
        claimedAt: '2026-09-01T00:00:00.000Z',
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: null,
        lockedAt: null,
        usedAt: null,
        returnedAt: null,
        expiredAt: null,
        lockedOrderId: null,
        usedOrderId: null,
        returnCount: 0,
        usable: true,
        ...overrides,
    };
}

function renderCheckout(
    order: Order,
    customer: ActiveCustomer | null = null,
    coupons: StoreCustomerCoupon[] = [],
    flashSales: StorefrontFlashSale[] = [],
): string {
    return renderToStaticMarkup(
        createElement(CheckoutPage, {
            mode: 'purchase' as const,
            api: {} as ShopApi,
            cart: cartFor(order),
            order,
            customer,
            market,
            availableCountries: [{ code: 'MY', name: '马来西亚' }],
            availableProvinces,
            locale: market.locale,
            language: 'zh' as const,
            onBack: vi.fn(),
            onSessionChange: vi.fn(),
            onCartChange: vi.fn(),
            onNotify: vi.fn(),
            coupons,
            flashSales,
            onApplyCoupon: vi.fn().mockResolvedValue(null),
            onRemoveCoupon: vi.fn().mockResolvedValue(null),
        }),
    );
}

describe('CheckoutPage digital delivery', () => {
    it('shows only the delivery email for a guest digital order', () => {
        const markup = renderCheckout(orderFor('DIGITAL'));

        expect(markup).toContain('接收方式');
        expect(markup).toContain('name="deliveryEmail"');
        expect(markup).toContain('type="email"');
        expect(markup).toContain('邮箱自动交付');
        expect(markup).toContain('确认并支付');
        expect(markup).not.toContain('name="firstName"');
        expect(markup).not.toContain('name="lastName"');
        expect(markup).not.toContain('收货地址');
        expect(markup).not.toContain('下一步，选择配送');
        expect(markup).not.toContain('DIGITAL-TEMPLATE');
    });

    it('prefers the order email while allowing a logged-in customer to edit it', () => {
        const customer = {
            id: 'customer-1',
            firstName: '王',
            lastName: '先生',
            emailAddress: 'account@example.com',
            phoneNumber: null,
            addresses: null,
            orders: { items: [], totalItems: 0 },
        } satisfies ActiveCustomer;

        const markup = renderCheckout(orderFor('DIGITAL', 'delivery@example.com'), customer);

        expect(markup).toContain('value="delivery@example.com"');
        expect(markup).not.toContain('value="account@example.com"');
        expect(markup).toContain('name="deliveryEmail"');
    });

    it('keeps contact, address and shipping preparation for mixed orders', () => {
        const markup = renderCheckout(orderFor('MIXED'));

        expect(markup).toContain('name="firstName"');
        expect(markup).toContain('name="lastName"');
        expect(markup).toContain('收货地址');
        expect(markup).toContain('添加地址后计算');
        expect(markup).toContain('name="deliveryEmail"');
        expect(markup).toContain('name="confirmDeliveryEmail"');
        expect(markup).not.toContain('<select name="province"');
        expect(markup).toContain('去添加收货地址');
    });

    it('does not use red focus styling for delivery email inputs or the saved-email trigger', () => {
        const fieldStyle = checkoutPageStyles['digital-delivery-email-field'];
        const triggerStyle = checkoutPageStyles['digital-delivery-email-trigger'];

        expect(fieldStyle).not.toContain('var(--accent)');
        expect(fieldStyle).toContain('[&_input:focus]:[border-color:#3b82f6]');
        expect(triggerStyle).not.toContain('var(--accent)');
        expect(triggerStyle).toContain('[&:focus-visible]:[border-color:#3b82f6]');
        expect(triggerStyle).toContain('[&:focus-visible]:[outline:0]');
    });

    it('centers checkout-assurance spans and displays full-width order submission button with count and price', () => {
        const assuranceStyle = checkoutPageStyles['checkout-assurance'];
        expect(assuranceStyle).toContain('[&_span]:[justify-content:center]');

        const submitStyle = checkoutPageStyles['submit-order-bar'];
        expect(submitStyle).toContain('[display:flex]');
        expect(submitStyle).toContain('[&>button]:[width:100%]');

        const markup = renderCheckout(orderFor('DIGITAL'), null);
        expect(markup).toContain('确认并支付（1件）需支付');

        const checkoutMarkup = renderToStaticMarkup(
            createElement(CheckoutPage, {
                mode: 'checkout',
                api: {} as ShopApi,
                cart: cartFor(orderFor('DIGITAL')),
                order: orderFor('DIGITAL'),
                customer: null,
                market,
                availableCountries: [{ code: 'MY', name: '马来西亚' }],
                locale: market.locale,
                language: 'zh' as const,
                onBack: vi.fn(),
                onSessionChange: vi.fn(),
                onCartChange: vi.fn(),
                onNotify: vi.fn(),
                coupons: [],
                onApplyCoupon: vi.fn().mockResolvedValue(null),
                onRemoveCoupon: vi.fn().mockResolvedValue(null),
            }),
        );
        expect(checkoutMarkup).toContain('提交订单（1件）需支付');
    });

    it('shows the selected coupon name and does not infer a selection from an available coupon', () => {
        const order = orderFor('DIGITAL');
        const unselectedMarkup = renderCheckout(order, null, [coupon()]);

        expect(unselectedMarkup).toContain('选择已领取优惠券');
        expect(unselectedMarkup).not.toContain('新客优惠券');

        const selectedMarkup = renderCheckout(order, null, [
            coupon({ status: 'LOCKED', lockedOrderId: order.id, usable: false }),
        ]);

        expect(selectedMarkup).toContain('title="新客优惠券">新客优惠券');
        expect(selectedMarkup).not.toContain('已使用优惠券');
    });

    it('does not show a payment-method option before the order is submitted', () => {
        const markup = renderCheckout(orderFor('PHYSICAL'));

        expect(markup).not.toContain('支付方式');
        expect(markup).not.toContain('提交后选择');
    });

    it('shows flash-sale savings separately from other order discounts', () => {
        const order = orderFor('DIGITAL');
        order.discounts = [
            {
                adjustmentSource: 'Promotion:flash-sale-1',
                description: '周末特价',
                amountWithTax: -2_500,
            },
            {
                adjustmentSource: 'Promotion:coupon-1',
                description: '新客优惠',
                amountWithTax: -500,
            },
        ];
        order.subTotalWithTax -= 3_000;
        order.totalWithTax -= 3_000;
        const flashSales: StorefrontFlashSale[] = [
            {
                id: 'flash-sale-1',
                startsAt: null,
                endsAt: null,
                items: [],
            },
        ];

        const markup = renderCheckout(order, null, [], flashSales);

        expect(markup).toContain('秒杀优惠');
        expect(markup).toContain('其他优惠');
        expect(markup).toMatch(/秒杀优惠<\/dt><dd>-[^<]*25<\/dd>/u);
        expect(markup).toMatch(/其他优惠<\/dt><dd>-[^<]*5<\/dd>/u);
    });
});

describe('CheckoutPage automatic delivery and drawer', () => {
    const methods: ShippingMethod[] = [
        { id: 'economy', code: 'economy', name: '经济配送', description: '较慢', priceWithTax: 100 },
        {
            id: 'standard',
            code: 'store-fixture-store-standard-delivery',
            name: '标准配送',
            description: '商家配置',
            priceWithTax: 500,
        },
    ];
    const address = {
        id: 'address-1',
        fullName: '测试收货人',
        phoneNumber: '0100000000',
        streetLine1: '10 Example Road',
        streetLine2: '',
        city: 'Petaling Jaya',
        province: 'MY-10',
        postalCode: '47301',
        country: { code: 'MY', name: 'Malaysia' },
        defaultShippingAddress: true,
        defaultBillingAddress: false,
    };
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        navigate.mockClear();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    async function flush(action = () => undefined as void) {
        await act(async () => {
            action();
            await Promise.resolve();
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(401);
        });
    }
    function mount(options: { methods?: ShippingMethod[]; selectedCode?: string; manual?: boolean } = {}) {
        const order = orderFor('PHYSICAL');
        if (options.selectedCode)
            order.checkoutShipping = {
                methodCode: options.selectedCode,
                methodName: '已有选择',
                priceWithTax: 100,
                freeShippingApplied: false,
            };
        const customer = {
            id: 'customer-shipping',
            firstName: '测试',
            lastName: '',
            emailAddress: 'fixture@example.com',
            phoneNumber: null,
            addresses: options.manual ? [] : [address],
            orders: { items: [], totalItems: 0 },
        } satisfies ActiveCustomer;
        const api = {
            setShippingAddress: vi.fn().mockResolvedValue(order),
            eligibleShippingMethods: vi.fn().mockResolvedValue(options.methods ?? methods),
            setShippingMethod: vi.fn().mockResolvedValue(order),
            cart: vi.fn().mockResolvedValue(cartFor(order)),
            preparePayment: vi.fn().mockResolvedValue({ cart: cartFor(order), order }),
        };
        const onCartChange = vi.fn();
        const props = {
            mode: 'purchase' as const,
            api: api as unknown as ShopApi,
            cart: cartFor(order),
            order,
            customer,
            market,
            storefrontCode: 'fixture-store',
            availableCountries: [{ code: 'MY', name: 'Malaysia' }],
            availableProvinces,
            locale: market.locale,
            language: 'zh' as const,
            onBack: vi.fn(),
            onSessionChange: vi.fn(),
            onCartChange,
            onNotify: vi.fn(),
            coupons: [],
            onApplyCoupon: vi.fn(),
            onRemoveCoupon: vi.fn(),
        };
        act(() => root.render(createElement(CheckoutPage, props)));
        return { api, props, order, onCartChange };
    }
    function element<T extends Element = HTMLElement>(selector: string): T {
        const match = container.querySelector<T>(selector);
        if (!match) throw new Error(`Missing checkout element: ${selector}`);
        return match;
    }
    const trigger = () => element<HTMLButtonElement>('.shipping-method-trigger');
    const submitButton = () => element<HTMLButtonElement>('.submit-order-bar > button');

    it('uses the configured standard delivery even when a cheaper option is listed first, without submitting', async () => {
        const { api } = mount();
        expect(submitButton().disabled).toBe(true);
        await flush();
        expect(api.setShippingAddress).toHaveBeenCalledTimes(1);
        expect(api.setShippingMethod).toHaveBeenCalledWith('standard');
        expect(trigger().textContent).toContain('标准配送');
        expect(submitButton().disabled).toBe(false);
        expect(container.textContent).not.toContain('下一步，选择配送');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(api.preparePayment).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('keeps an eligible saved choice, opens a drawer and switches without submitting the checkout form', async () => {
        const { api } = mount({ selectedCode: 'economy' });
        await flush();
        expect(api.setShippingMethod).toHaveBeenCalledWith('economy');
        await flush(() => trigger().click());
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(container.querySelector('.checkout-options fieldset')).toBeNull();
        await flush(() => element<HTMLInputElement>('input[value="standard"]').click());
        expect(api.setShippingMethod).toHaveBeenLastCalledWith('standard');
        expect(trigger().textContent).toContain('标准配送');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(api.preparePayment).not.toHaveBeenCalled();
    });

    it('uses the only eligible delivery without a chooser, then submits in one click', async () => {
        const { api } = mount({ methods: [methods[1]] });
        await flush();
        expect(trigger().disabled).toBe(true);
        expect(trigger().hasAttribute('aria-haspopup')).toBe(false);
        await flush(() =>
            element('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        expect(api.preparePayment).toHaveBeenCalledTimes(1);
        expect(api.setShippingAddress).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith({ to: '/payment', search: {}, replace: true });
    });

    it('blocks payment on an unavailable quote and retries only delivery', async () => {
        const { api } = mount({ methods: [] });
        await flush();
        expect(container.textContent).toContain('当前地址没有可用配送方式');
        expect(submitButton().disabled).toBe(true);
        expect(api.setShippingMethod).not.toHaveBeenCalled();
        api.eligibleShippingMethods.mockResolvedValue(methods);
        await flush(() => trigger().click());
        expect(trigger().textContent).toContain('标准配送');
        expect(submitButton().disabled).toBe(false);
        expect(api.preparePayment).not.toHaveBeenCalled();
    });

    it('serializes rapid address changes and ignores the stale quote', async () => {
        const { api, props, onCartChange } = mount();
        let finishOldAddress!: (order: Order) => void;
        api.setShippingAddress.mockImplementationOnce(
            () =>
                new Promise<Order>(resolve => {
                    finishOldAddress = resolve;
                }),
        );
        await flush();
        const nextProps = {
            ...props,
            customer: { ...props.customer, addresses: [{ ...address, postalCode: '50450' }] },
        };
        await flush(() => root.render(createElement(CheckoutPage, nextProps)));
        expect(api.setShippingAddress).toHaveBeenCalledTimes(1);
        await flush(() => finishOldAddress(props.order));
        expect(api.setShippingAddress).toHaveBeenCalledTimes(2);
        expect(api.setShippingAddress).toHaveBeenLastCalledWith(
            expect.objectContaining({ postalCode: '50450' }),
        );
        expect(api.eligibleShippingMethods).toHaveBeenCalledTimes(1);
        expect(onCartChange).toHaveBeenCalledTimes(1);
        expect(submitButton().disabled).toBe(false);
    });

    it('recalculates item changes but keeps the summary mounted during cart updates', async () => {
        const { api, props, order } = mount();
        await flush();
        const summary = container.querySelector('.price-summary');
        const changedOrder = {
            ...order,
            lines: order.lines.map(orderLine => ({
                ...orderLine,
                quantity: 2,
                linePriceWithTax: orderLine.linePriceWithTax * 2,
            })),
        };
        await flush(() =>
            root.render(createElement(CheckoutPage, { ...props, order: changedOrder, cartPending: true })),
        );
        expect(api.eligibleShippingMethods).toHaveBeenCalledTimes(2);
        expect(container.querySelector('.price-summary')).toBe(summary);
        expect(summary?.textContent).toContain('商品金额');
        expect(summary?.textContent).toContain('合计');
        expect(submitButton().disabled).toBe(true);
    });

    it('keeps a failed switch in the drawer and requires a fresh quote before submission', async () => {
        const { api } = mount();
        await flush();
        await flush(() => trigger().click());
        api.setShippingMethod.mockRejectedValueOnce(
            new ShopApiError('INELIGIBLE_SHIPPING_METHOD_ERROR', 'Shipping is ineligible'),
        );
        await flush(() => element<HTMLInputElement>('input[value="economy"]').click());
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
            '此配送方式不适用于当前订单，请重新选择。',
        );
        expect(submitButton().disabled).toBe(true);
        const retry = [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
            button => button.textContent === '重新计算配送',
        );
        await flush(() => retry?.click());
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(trigger().textContent).toContain('标准配送');
        expect(submitButton().disabled).toBe(false);
        expect(api.preparePayment).not.toHaveBeenCalled();
    });

    it('routes an empty address card and CTA to address management without writing or submitting', async () => {
        const { api } = mount({ manual: true });
        await flush();
        expect(container.querySelector('input[name="fullName"]')).toBeNull();
        expect(container.querySelector('.smart-paste-toggle-btn')).toBeNull();
        expect(container.querySelector('.checkout-address-quick-switcher')).toBeNull();
        expect(container.textContent).toContain('添加地址后计算');
        expect(submitButton().disabled).toBe(false);
        expect(submitButton().type).toBe('button');
        expect(submitButton().textContent).toBe('去添加收货地址');
        await flush(() => element<HTMLButtonElement>('.saved-address').click());
        await flush(() => submitButton().click());
        expect(navigate).toHaveBeenCalledTimes(2);
        expect(navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                to: '/addresses',
                search: expect.objectContaining({ returnTo: 'purchase', checkoutOrderId: 'order-1' }),
            }),
        );
        expect(api.setShippingAddress).not.toHaveBeenCalled();
        expect(api.preparePayment).not.toHaveBeenCalled();
    });

    it('opens the incomplete saved address for editing and does not quote it', async () => {
        const { api, props } = mount({ manual: true });
        act(() =>
            root.render(
                createElement(CheckoutPage, {
                    ...props,
                    customer: { ...props.customer, addresses: [{ ...address, phoneNumber: '' }] },
                }),
            ),
        );
        await flush();
        expect(submitButton().disabled).toBe(false);
        expect(submitButton().textContent).toBe('去完善收货地址');
        await flush(() => submitButton().click());
        expect(navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                to: '/addresses',
                search: expect.objectContaining({ addressId: address.id, editAddress: true }),
            }),
        );
        expect(api.setShippingAddress).not.toHaveBeenCalled();
    });

    it('shows loading before addresses resolve without flashing the add-address action', async () => {
        const { api, props } = mount({ manual: true });
        act(() => root.render(createElement(CheckoutPage, { ...props, customerLoading: true })));
        await flush();
        expect(container.textContent).toContain('正在加载收货地址');
        expect(container.textContent).not.toContain('去添加收货地址');
        expect(container.querySelector('.saved-address')).toBeNull();
        expect(submitButton().disabled).toBe(true);
        expect(api.setShippingAddress).not.toHaveBeenCalled();
    });

    it('quotes the returned selection, including apartment, without changing default or order progress', async () => {
        const { api, props, order } = mount({ selectedCode: 'economy' });
        const second = {
            ...address,
            id: 'address-2',
            fullName: '第二收货人',
            streetLine2: 'Unit 12',
            defaultShippingAddress: false,
        };
        order.customFields.customerNote = '到达后电话联系';
        order.couponCodes = ['SAVED'];
        act(() =>
            root.render(
                createElement(CheckoutPage, {
                    ...props,
                    order,
                    selectedAddressId: second.id,
                    customer: { ...props.customer, addresses: [address, second] },
                }),
            ),
        );
        await flush();
        expect(api.setShippingAddress).toHaveBeenLastCalledWith(
            expect.objectContaining({ fullName: '第二收货人', streetLine2: 'Unit 12' }),
        );
        expect(api.setShippingMethod).toHaveBeenLastCalledWith('standard');
        expect(container.textContent).toContain('到达后电话联系');
        expect(order.couponCodes).toEqual(['SAVED']);
        expect(address.defaultShippingAddress).toBe(true);
        expect(container.querySelectorAll('.saved-address')).toHaveLength(1);
        expect(submitButton().disabled).toBe(false);
    });
});

describe('CheckoutPage submission authentication and recovery', () => {
    async function interact(action: () => void) {
        await act(async () => {
            action();
            await Promise.resolve();
        });
    }

    it.each(['zh', 'en'] as const)(
        'releases the submit button immediately on an email conflict in %s',
        async language => {
            const container = document.createElement('div');
            document.body.append(container);
            const root = createRoot(container);
            const order = orderFor('DIGITAL', 'delivery@example.com');
            const notify = vi.fn();
            const setDeliveryEmail = vi
                .fn()
                .mockRejectedValue(
                    new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'EMAIL_ADDRESS_CONFLICT_ERROR'),
                );
            const refreshCart = vi.fn(() => new Promise<StorefrontCart>(() => undefined));
            const preparePayment = vi.fn();
            const customer = {
                id: 'customer-1',
                emailAddress: 'account@example.com',
                addresses: [],
            } as unknown as ActiveCustomer;
            try {
                await interact(() =>
                    root.render(
                        createElement(CheckoutPage, {
                            api: {
                                setDeliveryEmail,
                                cart: refreshCart,
                                preparePayment,
                                myDeliveryEmails: vi.fn().mockResolvedValue([]),
                            } as unknown as ShopApi,
                            cart: cartFor(order),
                            order,
                            customer,
                            market,
                            availableCountries: [],
                            locale: market.locale,
                            language,
                            onBack: vi.fn(),
                            onSessionChange: vi.fn(),
                            onCartChange: vi.fn(),
                            onNotify: notify,
                            coupons: [],
                            onApplyCoupon: vi.fn(),
                            onRemoveCoupon: vi.fn(),
                        }),
                    ),
                );
                for (const input of container.querySelectorAll<HTMLInputElement>('input[type="email"]'))
                    input.value = 'delivery@example.com';
                await interact(() =>
                    container
                        .querySelector('form')
                        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
                );
                expect(notify).toHaveBeenCalledWith(
                    language === 'zh'
                        ? '该邮箱已注册，请登录对应账户后继续结算'
                        : 'This email is already registered. Sign in to that account to continue checkout.',
                );
                expect(container.textContent).not.toContain('EMAIL_ADDRESS_CONFLICT_ERROR');
                expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
                    false,
                );
                expect(refreshCart).not.toHaveBeenCalled();
                expect(preparePayment).not.toHaveBeenCalled();
            } finally {
                act(() => root.unmount());
                container.remove();
            }
        },
    );

    it('blocks submission if the customer session disappears', async () => {
        const container = document.createElement('div');
        const root = createRoot(container);
        const order = orderFor('PHYSICAL');
        const setCustomer = vi.fn();
        const preparePayment = vi.fn();
        navigate.mockClear();
        try {
            await interact(() =>
                root.render(
                    createElement(CheckoutPage, {
                        mode: 'purchase',
                        api: { setCustomer, preparePayment } as unknown as ShopApi,
                        cart: cartFor(order),
                        order,
                        customer: null,
                        market,
                        availableCountries: [],
                        locale: market.locale,
                        language: 'zh',
                        onBack: vi.fn(),
                        onSessionChange: vi.fn(),
                        onCartChange: vi.fn(),
                        onNotify: vi.fn(),
                        coupons: [],
                        onApplyCoupon: vi.fn(),
                        onRemoveCoupon: vi.fn(),
                    }),
                ),
            );
            await interact(() =>
                container
                    .querySelector('form')
                    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
            );
            expect(navigate).toHaveBeenCalledWith({
                to: '/login',
                search: { returnTo: 'purchase' },
                replace: false,
            });
            expect(setCustomer).not.toHaveBeenCalled();
            expect(preparePayment).not.toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
        }
    });
});
