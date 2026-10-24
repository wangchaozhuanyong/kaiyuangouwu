import type { ShopApi } from '../api';
import type { Order, StorefrontCart, StorefrontLanguage } from '../types';
import type { CartController } from './cart-controller';

import { StorefrontDisplayError, storefrontErrorMessage } from '../storefront-errors';

export interface CurrencySelectionOptions {
    api: Pick<ShopApi, 'cart' | 'setPaymentCurrencyForOrder'>;
    cartController: CartController;
    cart: StorefrontCart | null;
    customerId: string | undefined;
    availableCurrencyCodes: string[];
    displayCurrencyCode: string;
    cartLoading: boolean;
    language: StorefrontLanguage;
    setCart: (cart: StorefrontCart) => void;
    setCheckoutOrder: (order: Order | null) => void;
    setCartLoading: (loading: boolean) => void;
    setCartError: (error: string | null) => void;
    commitPreference: (currencyCode: string) => void;
    notify: (message: string) => void;
}

function currencyMatches(order: Order | null | undefined, currencyCode: string) {
    return (
        !!order &&
        (order.customFields?.paymentCurrencyCode || order.currencyCode) === currencyCode &&
        (currencyCode === 'USDT' || order.currencyCode === currencyCode)
    );
}

/** Reuse server payment validation, then adopt the complete confirmed cart. */
export async function confirmCurrencySelection(
    options: CurrencySelectionOptions,
    currencyCode: string,
    signal: AbortSignal,
    isCurrent: () => boolean,
) {
    const { api, cartController, language } = options;
    const assertOwner = () => {
        signal.throwIfAborted();
        if (!isCurrent()) throw new Error('Cart session changed.');
    };
    assertOwner();
    if (
        currencyCode === options.displayCurrencyCode &&
        (!options.cart?.checkoutOrder || currencyMatches(options.cart.checkoutOrder, currencyCode))
    )
        return;
    if (!options.availableCurrencyCodes.includes(currencyCode))
        throw new StorefrontDisplayError(
            { zh: '当前店铺未开放该付款币种', en: 'This payment currency is unavailable.' },
            language,
        );
    if (cartController.getSnapshot().editingBlocked)
        throw new StorefrontDisplayError(
            { zh: '请先核对当前购物车操作', en: 'Review your cart first.' },
            language,
        );
    let acknowledged = false;
    options.setCartError(null);
    try {
        if (options.cart?.checkoutOrder) {
            await cartController.drain();
            assertOwner();
            // Read first: a prior request may have succeeded even if its response was lost.
            let fresh = await api.cart(signal);
            assertOwner();
            const orderId = options.cart.checkoutOrder.id;
            const assertCart = () => {
                if (fresh.id !== options.cart?.id || fresh.checkoutOrder?.id !== orderId)
                    throw new StorefrontDisplayError(
                        { zh: '购物车已变更，请重新核对', en: 'The cart changed. Review it again.' },
                        language,
                    );
            };
            assertCart();
            if (!currencyMatches(fresh.checkoutOrder, currencyCode)) {
                if (fresh.state !== 'OPEN' || fresh.checkoutOrder?.state !== 'AddingItems')
                    throw new StorefrontDisplayError(
                        { zh: '当前订单状态不能切换付款币种', en: 'This order cannot change currency.' },
                        language,
                    );
                const updatedOrder = await api.setPaymentCurrencyForOrder(currencyCode, signal);
                acknowledged = true;
                assertOwner();
                if (updatedOrder.id !== orderId || !currencyMatches(updatedOrder, currencyCode))
                    throw new StorefrontDisplayError(
                        { zh: '订单币种尚未同步', en: 'The order currency is not synchronized yet.' },
                        language,
                    );
                options.setCheckoutOrder(updatedOrder);
                fresh = await api.cart(signal);
                assertOwner();
                assertCart();
            }
            if (!currencyMatches(fresh.checkoutOrder, currencyCode))
                throw new StorefrontDisplayError(
                    { zh: '订单币种尚未同步', en: 'The order currency is not synchronized yet.' },
                    language,
                );
            options.setCart(fresh);
            options.setCheckoutOrder(fresh.checkoutOrder);
        }
        assertOwner();
        options.commitPreference(currencyCode);
    } catch (error) {
        if (!isCurrent() || signal.aborted) throw error;
        const failure = acknowledged
            ? new StorefrontDisplayError(
                  {
                      zh: '付款币种已保存，但购物车读取未完成。请重试读取核对，无需重复提交。',
                      en: 'Payment currency saved; cart refresh failed. Retry reading the cart without resubmitting.',
                  },
                  language,
              )
            : error;
        const message = storefrontErrorMessage(failure, language);
        options.setCartError(message);
        options.notify(message);
        throw failure;
    }
}
