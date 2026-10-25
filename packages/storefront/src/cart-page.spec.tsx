// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CartCommandAcknowledgedReadError } from './cart/cart-repository';
import { DesktopLayoutContext } from './desktop-layout';
import { CartPage, type CartPageProps } from './pages/cart-page';
import { CartPageContext } from './storefront-page-contexts';
import { formatMoney } from './storefront-ui/product-display';
import { readStorefrontStylesheet } from './test-stylesheet';
import { MarketConfig, Order, Product, StoreCustomerCoupon, StorefrontCart } from './types';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
    Link: ({ children, to, ...props }: import('react').PropsWithChildren<{ to: string }>) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

const cart: StorefrontCart = {
    id: 'cart-1',
    revision: 1,
    state: 'OPEN',
    projectedRevision: 1,
    totalQuantity: 1,
    selectedLineCount: 1,
    selectedQuantity: 1,
    selectionState: 'ALL',
    lines: [
        {
            id: 'line-1',
            quantity: 1,
            selected: true,
            available: true,
            productVariant: {
                id: 'variant-1',
                name: '32 英寸显示器',
                sku: 'DISPLAY-32',
                priceWithTax: 31381,
                currencyCode: 'MYR',
                stockLevel: 'IN_STOCK',
                featuredAsset: null,
                product: {
                    id: 'product-1',
                    name: '32 英寸显示器',
                    featuredAsset: null,
                },
                customFields: { fulfillmentType: 'physical' },
            },
        },
    ],
    checkoutOrder: null,
};

const callbacks = {
    onToggleAll: vi.fn(),
    onSelect: vi.fn(),
    onSelectGroup: vi.fn(),
    onQuantity: vi.fn(),
    onRemove: vi.fn(),
    onFavorite: vi.fn(),
    onCheckout: vi.fn(),
    onReopen: vi.fn(),
    onNotify: vi.fn(),
    onRetry: vi.fn(),
    onCancelPending: vi.fn(),
    onApplyCoupon: vi.fn().mockResolvedValue(null),
    onRemoveCoupon: vi.fn().mockResolvedValue(null),
};

const checkoutOrder: Order = {
    id: 'order-1',
    code: 'T0001',
    state: 'AddingItems',
    totalQuantity: 1,
    subTotalWithTax: 31381,
    shippingWithTax: 0,
    totalWithTax: 31381,
    currencyCode: 'MYR',
    lines: [],
    discounts: [],
    taxSummary: [],
    couponCodes: [],
    customFields: {},
};

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

function renderCart(
    value: StorefrontCart | null,
    products: Product[] = [],
    coupons: StoreCustomerCoupon[] = [],
    selectionPending = false,
    checkoutPending = false,
    overrides: Partial<CartPageProps> = {},
    desktop = false,
) {
    return renderToStaticMarkup(
        createElement(
            DesktopLayoutContext.Provider,
            { value: desktop },
            createElement(
                CartPageContext.Provider,
                {
                    value: {
                        cart: value,
                        customer: null,
                        products,
                        market,
                        locale: market.locale,
                        language: 'zh' as const,
                        loading: selectionPending,
                        selectionPending,
                        checkoutPending,
                        error: null,
                        favoriteProductIds: [],
                        coupons,
                        ...callbacks,
                        ...overrides,
                    },
                },
                createElement(CartPage),
            ),
        ),
    );
}

describe('CartPage guest cart', () => {
    describe.each([false, true])('quoted line pricing, desktop=%s', desktop => {
        function quotedCart(currencyCode = 'CNY', quantity = 1, unit = 3277, subtotal = unit * quantity) {
            const originalVariant = cart.lines[0].productVariant;
            if (!originalVariant) throw new Error('Cart fixture requires a variant');
            const variant = { ...originalVariant, priceWithTax: 3267, currencyCode };
            return {
                ...cart,
                totalQuantity: quantity,
                selectedQuantity: quantity,
                lines: [{ ...cart.lines[0], quantity, productVariant: variant }],
                checkoutOrder: {
                    ...checkoutOrder,
                    totalQuantity: quantity,
                    currencyCode,
                    subTotalWithTax: subtotal,
                    totalWithTax: subtotal,
                    lines: [
                        {
                            id: 'quoted-line',
                            quantity,
                            unitPriceWithTax: unit,
                            linePriceWithTax: subtotal,
                            proratedUnitPriceWithTax: unit,
                            productVariant: variant,
                            customFields: { fulfillmentTypeSnapshot: 'physical' as const },
                        },
                    ],
                },
            };
        }
        function prices(value: StorefrontCart, overrides: Partial<CartPageProps> = {}) {
            const host = document.createElement('div');
            host.innerHTML = renderCart(value, [], [], false, false, overrides, desktop);
            return {
                unit: host.querySelector(desktop ? '.desktop-cart-unit-price' : '.cart-line-purchase-row b')
                    ?.textContent,
                subtotal: host.querySelector('.desktop-cart-amount')?.textContent,
                summary: host.querySelector('.cart-checkout-bar')?.textContent,
            };
        }
        it.each(['CNY', 'MYR'])('uses the saved quote when live %s catalog pricing changes', currency => {
            const result = prices(quotedCart(currency));
            expect(result.unit).toContain('32.77');
            expect(result.summary).toContain('32.77');
            if (desktop) expect(result.subtotal).toContain('32.77');
        });
        it('keeps native line rounding instead of multiplying the displayed rounded unit', () => {
            const result = prices(quotedCart('CNY', 3, 333, 1000));
            expect(result.unit).toContain('3.33');
            expect(result.summary).toContain(formatMoney(1000, 'CNY', market.locale));
            if (desktop) expect(result.subtotal).toBe(formatMoney(1000, 'CNY', market.locale));
        });
        it('shows the base unit and line amounts before the separately listed order discount', () => {
            const value = quotedCart('CNY', 2, 1000);
            value.checkoutOrder.lines[0].proratedUnitPriceWithTax = 900;
            value.checkoutOrder.discounts = [
                { adjustmentSource: 'promotion', description: 'Offer', amountWithTax: -200 },
            ];
            value.checkoutOrder.subTotalWithTax = value.checkoutOrder.totalWithTax = 1800;
            const result = prices(value);
            expect(result.unit).toBe(formatMoney(1000, 'CNY', market.locale));
            expect(result.summary).toContain(formatMoney(1800, 'CNY', market.locale));
            if (desktop) expect(result.subtotal).toBe(formatMoney(2000, 'CNY', market.locale));
        });
        it('uses the same confirmed snapshot as the summary after an unresolved command', () => {
            const confirmedCart = quotedCart();
            const changed = quotedCart('CNY', 1, 9999);
            const result = prices(changed, { commandUnknown: true, confirmedCart });
            expect(result.unit).toContain('32.77');
            expect(result.summary).toContain('32.77');
        });
        it.each(['unselected', 'different-quantity', 'different-variant', 'guest'])(
            'does not apply an unrelated quote: %s',
            scenario => {
                const value = quotedCart();
                if (scenario === 'unselected') value.lines[0].selected = false;
                if (scenario === 'different-quantity') value.checkoutOrder.lines[0].quantity = 2;
                if (scenario === 'different-variant')
                    value.checkoutOrder.lines[0].productVariant = {
                        ...value.checkoutOrder.lines[0].productVariant,
                        id: 'other-variant',
                    };
                const result = prices(scenario === 'guest' ? { ...value, checkoutOrder: null } : value);
                expect(result.unit).toContain('32.67');
            },
        );
    });
    it.each(['zh', 'en'] as const)(
        'labels retained prices as last confirmed after a failed read: %s',
        language => {
            const value = { ...cart, checkoutOrder: { ...checkoutOrder, currencyCode: 'CNY' } };
            const markup = renderCart(value, [], [], false, false, {
                language,
                error: 'Payment currency saved; cart refresh failed.',
            });
            expect(markup).toContain(
                language === 'zh'
                    ? '上次确认的订单计价币种：CNY'
                    : 'Last confirmed order pricing currency: CNY',
            );
            expect(markup).toContain(
                language === 'zh' ? '请先刷新核对当前金额' : 'Refresh to verify current totals',
            );
        },
    );

    it.each(['store-a', 'store-b'])(
        'identifies the authoritative cart currency when the browsing preference differs: %s',
        code => {
            const value = {
                ...cart,
                checkoutOrder: {
                    ...checkoutOrder,
                    currencyCode: 'CNY',
                    subTotalWithTax: 3277,
                    totalWithTax: 3277,
                },
            };
            const markup = renderCart(value, [], [], false, false, { market: { ...market, code } });
            expect(markup).toContain('订单计价币种：CNY');
            expect(markup).toContain('当前浏览币种为 MYR');
        },
    );

    it('keeps confirmed summary amounts, discounts and currency from the same cart snapshot', () => {
        const changed = {
            ...cart,
            checkoutOrder: {
                ...checkoutOrder,
                currencyCode: 'CNY',
                discounts: [{ amountWithTax: -200 }] as Order['discounts'],
            },
        };
        const markup = renderCart(changed, [], [], false, false, {
            commandUnknown: true,
            confirmedCart: { ...cart, checkoutOrder },
        });
        const host = document.createElement('div');
        host.innerHTML = markup;
        expect(host.querySelector('.cart-summary-breakdown')?.textContent).toContain('MYR 313.81');
        expect(host.querySelector('.cart-summary-breakdown')?.textContent).not.toContain('315.81');
    });

    it.each(['zh', 'en'] as const)(
        'explains an acknowledged result with a failed display read and offers review without cancellation: %s',
        language => {
            const error = new CartCommandAcknowledgedReadError(
                'confirmed-command-1234',
                'Display read failed',
            );
            const markup = renderCart({ ...cart, checkoutOrder }, [], [], true, false, {
                language,
                commandUnknown: true,
                commandAcknowledged: error instanceof CartCommandAcknowledgedReadError,
                error: error.message,
            });
            expect(markup).toContain(language === 'zh' ? '操作结果已确认' : 'The result is confirmed');
            expect(markup).toContain(language === 'zh' ? '勿重复提交' : 'Do not submit again');
            expect(markup).toContain('MYR 313.81');
            expect(markup).not.toContain('提交结果尚未确认');
            expect(markup).not.toContain('取消待确认操作');
            expect(markup).not.toContain('Cancel pending operation');
            expect(markup).not.toContain('计算中…');
            const host = document.createElement('div');
            host.innerHTML = markup;
            const actions = host.querySelectorAll<HTMLButtonElement>('.cart-recovery-actions button');
            expect(actions).toHaveLength(1);
            expect(actions[0].disabled).toBe(false);
            expect(host.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.disabled).toBe(true);
        },
    );

    it.each(['zh', 'en'] as const)(
        'keeps the last confirmed amount and recovery actions visible for an unknown result: %s',
        language => {
            const markup = renderCart(
                { ...cart, checkoutOrder: { ...checkoutOrder, subTotalWithTax: 99999 } },
                [],
                [],
                true,
                false,
                {
                    language,
                    commandUnknown: true,
                    editingBlocked: true,
                    confirmedCart: { ...cart, checkoutOrder },
                    error: 'UNKNOWN_RESULT',
                },
            );
            expect(markup).toContain('MYR 313.81');
            expect(markup).not.toContain('999.99');
            expect(markup).not.toContain('计算中…');
            expect(markup).not.toContain('Updating…');
            expect(markup).toContain(language === 'zh' ? '上次已确认金额' : 'Last confirmed amount');
            const recovery = document.createElement('div');
            recovery.innerHTML = markup;
            const actions = recovery.querySelectorAll<HTMLButtonElement>('.cart-recovery-actions button');
            expect(actions).toHaveLength(2);
            expect([...actions].every(button => !button.disabled)).toBe(true);
            expect(recovery.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
            expect(recovery.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.disabled).toBe(
                true,
            );
            expect(recovery.querySelector('strong[aria-busy="true"]')).toBeNull();
        },
    );

    it('disables both recovery actions while reconciliation is running without hiding the amount', () => {
        const markup = renderCart({ ...cart, checkoutOrder }, [], [], true, false, {
            commandUnknown: true,
            recoveryPending: true,
        });
        const host = document.createElement('div');
        host.innerHTML = markup;
        expect(markup).toContain('MYR 313.81');
        expect(markup).toContain('正在核对…');
        expect(markup).not.toContain('计算中…');
        expect(
            [...host.querySelectorAll<HTMLButtonElement>('.cart-recovery-actions button')].every(
                button => button.disabled,
            ),
        ).toBe(true);
        expect(host.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.disabled).toBe(true);
    });

    it('restores quantity and checkout controls after the pending result is resolved', () => {
        const host = document.createElement('div');
        host.innerHTML = renderCart({ ...cart, checkoutOrder });
        expect(host.querySelector('.cart-recovery-panel')).toBeNull();
        expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(false);
        expect(
            host.querySelector<HTMLButtonElement>('[aria-label="增加 32 英寸显示器 数量"]')?.disabled,
        ).toBe(false);
        expect(host.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.disabled).toBe(false);
    });

    it('preserves the ability to reopen a confirmed order that is waiting for payment', () => {
        const host = document.createElement('div');
        host.innerHTML = renderCart(
            { ...cart, state: 'PAYMENT_PENDING', checkoutOrder },
            [],
            [],
            false,
            false,
            { editingBlocked: true },
        );
        const reopen = host.querySelector<HTMLButtonElement>('.cart-pending-actions > button');
        expect(reopen?.textContent).toBe('返回修改订单');
        expect(reopen?.disabled).toBe(false);
        expect(host.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.disabled).toBe(true);
    });

    it('lets users reconcile an unknown result and resumes editing only after the resolved state arrives', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const onRetry = vi.fn();
        const onCancelPending = vi.fn();
        const onQuantity = vi.fn();
        const onCheckout = vi.fn();
        const render = (overrides: Partial<CartPageProps>) =>
            act(() => {
                root.render(
                    createElement(
                        CartPageContext.Provider,
                        {
                            value: {
                                cart: { ...cart, checkoutOrder },
                                customer: null,
                                products: [],
                                market,
                                locale: market.locale,
                                language: 'zh',
                                loading: true,
                                commandUnknown: true,
                                editingBlocked: true,
                                error: '结果待确认',
                                favoriteProductIds: [],
                                coupons: [],
                                ...callbacks,
                                onRetry,
                                onCancelPending,
                                onQuantity,
                                onCheckout,
                                ...overrides,
                            },
                        },
                        createElement(CartPage),
                    ),
                );
            });
        render({});
        act(() => {
            host.querySelector<HTMLButtonElement>('.cart-recovery-actions button')?.click();
        });
        expect(onRetry).toHaveBeenCalledOnce();
        render({ recoveryPending: true });
        act(() => {
            for (const button of host.querySelectorAll<HTMLButtonElement>('.cart-recovery-actions button')) {
                button.click();
            }
            host.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.click();
        });
        expect(onRetry).toHaveBeenCalledOnce();
        expect(onCancelPending).not.toHaveBeenCalled();
        expect(onCheckout).not.toHaveBeenCalled();
        render({ commandUnknown: false, editingBlocked: false, loading: false, error: null });
        act(() => {
            host.querySelector<HTMLButtonElement>('[aria-label="增加 32 英寸显示器 数量"]')?.click();
            host.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.click();
        });
        expect(onQuantity).toHaveBeenCalledExactlyOnceWith('line-1', 2);
        expect(onCheckout).toHaveBeenCalledOnce();
        act(() => root.unmount());
        host.remove();
    });

    it.each([false, true])(
        'keeps normal acknowledged selection in place while the cart read completes (desktop=%s)',
        desktop => {
            const markup = renderCart(
                { ...cart, checkoutOrder },
                [],
                [],
                true,
                false,
                {
                    commandAcknowledged: true,
                    commandUnknown: false,
                    editingBlocked: true,
                    confirmedCart: { ...cart, checkoutOrder },
                },
                desktop,
            );
            expect(markup).not.toContain('cart-recovery-panel');
            expect(markup).not.toContain('暂时无法读取最新购物车');
            expect(markup).toContain('32 英寸显示器');
            const host = document.createElement('div');
            host.innerHTML = markup;
            expect(host.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.disabled).toBe(true);
            expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
        },
    );

    it('still presents a genuinely failed acknowledged read even before the unknown flag arrives', () => {
        const markup = renderCart({ ...cart, checkoutOrder }, [], [], true, false, {
            commandAcknowledged: true,
            commandUnknown: false,
            editingBlocked: true,
            error: 'Synthetic cart projection read failure',
        });
        expect(markup).toContain('cart-recovery-panel');
        expect(markup).toContain('操作结果已确认');
        expect(markup).not.toContain('取消待确认操作');
        const host = document.createElement('div');
        host.innerHTML = markup;
        expect(host.querySelector<HTMLButtonElement>('.cart-checkout-bar button')?.disabled).toBe(true);
    });

    it('keeps selection responsive while totals are pending and blocks checkout until confirmed', () => {
        const markup = renderCart({ ...cart, checkoutOrder }, [], [], true);
        expect(markup).toContain('计算中…');
        expect(markup).toContain('aria-busy="true"');
        const checkbox = markup.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
        expect(checkbox).toBeDefined();
        expect(checkbox).not.toContain('disabled');
        expect(markup).toContain('disabled="">结算（1）');
        expect(markup).not.toContain('aria-label="增加 32 英寸显示器 数量" disabled=""');
    });

    it('keeps the confirmed total stable while checkout opens and moves progress onto the action', () => {
        const markup = renderCart({ ...cart, checkoutOrder }, [], [], false, true);
        expect(markup).toContain('MYR 313.81');
        expect(markup).not.toContain('计算中…');
        expect(markup).toContain('class="cart-summary-panel"');
        expect(markup).not.toContain('class="coupon-row"');
        expect(markup).toContain('aria-busy="true"');
        expect(markup).toContain('disabled="">正在进入结算…</button>');
    });

    it('keeps cart lines and editing controls visible for a guest customer', () => {
        const markup = renderCart(cart);

        expect(markup).toContain('游客购物车已保存');
        expect(markup).toContain('可以直接结算');
        expect(markup).toContain('32 英寸显示器');
        expect(markup).toContain('aria-label="删除 32 英寸显示器"');
        expect(markup).toContain('class="cart-line-swipe-actions"');
        expect(markup).toContain('data-cart-action="favorite"');
        expect(markup).toContain('data-cart-action="share"');
        expect(markup).toContain('data-cart-action="pin"');
        expect(markup).toContain('data-cart-action="remove"');
        expect(markup).toContain('class="cart-line-purchase-row"');
        expect(markup).not.toContain('class="cart-line-actions"><button');
        expect(markup).toContain('aria-label="减少 32 英寸显示器 数量并删除商品"');
        expect(markup).not.toContain('aria-label="减少 32 英寸显示器 数量并删除商品" disabled=""');
        expect(markup).toContain('aria-label="增加 32 英寸显示器 数量"');
        expect(markup).toContain('结算（1）');
        expect(markup).not.toContain('登录后使用购物车');
        expect(markup).not.toContain('DISPLAY-32');
    });

    it('keeps the regular decrement action when a line has more than one item', () => {
        const markup = renderCart({
            ...cart,
            totalQuantity: 2,
            selectedQuantity: 2,
            lines: [{ ...cart.lines[0], quantity: 2 }],
        });

        expect(markup).toContain('aria-label="减少 32 英寸显示器 数量"');
        expect(markup).not.toContain('数量并删除商品');
    });

    it('shows the ordinary empty state when a guest cart has no lines', () => {
        const markup = renderCart({
            ...cart,
            totalQuantity: 0,
            selectedLineCount: 0,
            selectedQuantity: 0,
            selectionState: 'NONE',
            lines: [],
        });

        expect(markup).toContain('购物车还是空的');
        expect(markup).toContain('class="page cart-page is-empty"');
        expect(markup).not.toContain('游客购物车已保存');
        expect(markup).not.toContain('结算（');
    });

    it('places the subtitle on the right side of the 顺手带一件 heading', () => {
        const testProduct: Product = {
            id: 'product-2',
            createdAt: '2026-08-16T00:00:00.000Z',
            name: '推荐搭配商品',
            slug: 'recommended-product',
            description: '',
            featuredAsset: null,
            assets: [],
            collections: [],
            variants: [
                {
                    id: 'variant-2',
                    name: '默认规格',
                    sku: 'REC-2',
                    priceWithTax: 2000,
                    currencyCode: 'MYR',
                    stockLevel: 'IN_STOCK',
                    saleableStockLevel: 10,
                    featuredAsset: null,
                    product: {
                        id: 'product-2',
                        name: '推荐搭配商品',
                        featuredAsset: null,
                    },
                    customFields: { fulfillmentType: 'physical' } as any,
                },
            ],
        };

        const markup = renderCart(cart, [testProduct]);

        expect(markup).toContain('顺手带一件');
        expect(markup).toContain('class="section-header has-end-subtitle"');
        expect(markup).toMatch(/class="[^"]*section-header-end-subtitle[^"]*"[^>]*>继续挑选好物<\/p>/);
    });

    it('uses one responsive cart workspace and keeps the coupon in the checkout summary', () => {
        const stylesheet = readStorefrontStylesheet([
            './styles/desktop-pages.css',
            './styles/cart-layout.css',
        ]);
        expect(stylesheet).toMatch(/\.cart-page > \.product-section\s*\{[^}]*margin-top:\s*24px;/u);
        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.cart-commerce-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 280px;/u,
        );
        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.cart-summary-panel > \.coupon-row\s*\{[^}]*width:\s*100%;/u,
        );
        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.cart-checkout-bar\s*\{[^}]*position:\s*static;[^}]*transform:\s*none;/u,
        );
        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.cart-checkout-bar\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/u,
        );
        expect(stylesheet).toMatch(/\.cart-summary-panel > \.coupon-row,[\s\S]*?border:\s*0;/u);
        expect(stylesheet).toMatch(/\.coupon-label-desktop\s*\{[^}]*display:\s*none;/u);
        expect(stylesheet).toMatch(
            /\.desktop-store-layout \.coupon-label-desktop\s*\{[^}]*display:\s*inline;/u,
        );
    });

    it('shows only the manually selected coupon name instead of matching automatic discounts', () => {
        const cartWithAutomaticDiscount = {
            ...cart,
            checkoutOrder: {
                ...checkoutOrder,
                discounts: [
                    {
                        adjustmentSource: 'Promotion:automatic-discount',
                        description: '店铺自动优惠',
                        amountWithTax: -500,
                    },
                ],
            },
        };
        const unselectedMarkup = renderCart(cartWithAutomaticDiscount, [], [coupon()]);
        const couponRowMarkup = unselectedMarkup.match(/<button class="coupon-row"[\s\S]*?<\/button>/)?.[0];

        expect(unselectedMarkup).toContain('class="cart-summary-panel has-coupons"');
        expect(couponRowMarkup).toContain('选择已领取优惠券');
        expect(couponRowMarkup).toContain('优惠券');
        expect(couponRowMarkup).not.toContain('已优惠');
        expect(couponRowMarkup).not.toContain('新客优惠券');

        const selectedMarkup = renderCart(
            cartWithAutomaticDiscount,
            [],
            [coupon({ status: 'LOCKED', lockedOrderId: checkoutOrder.id, usable: false })],
        );

        expect(selectedMarkup).toContain('title="新客优惠券">新客优惠券</small>');
        expect(selectedMarkup).not.toContain('选择已领取优惠券');
    });

    it('opens the coupon chooser from the responsive summary control', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);

        act(() => {
            root.render(
                createElement(
                    CartPageContext.Provider,
                    {
                        value: {
                            cart: { ...cart, checkoutOrder },
                            customer: null,
                            products: [],
                            market,
                            locale: market.locale,
                            language: 'zh' as const,
                            loading: false,
                            error: null,
                            favoriteProductIds: [],
                            coupons: [coupon()],
                            ...callbacks,
                        },
                    },
                    createElement(CartPage),
                ),
            );
        });

        const trigger = host.querySelector<HTMLButtonElement>('.cart-summary-panel > .coupon-row');
        expect(trigger).not.toBeNull();
        expect(trigger?.disabled).toBe(false);

        act(() => {
            trigger?.click();
        });

        expect(document.querySelector('.coupon-selector-sheet')).not.toBeNull();

        act(() => root.unmount());
        host.remove();
    });
});
