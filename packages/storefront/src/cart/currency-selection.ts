import type { ShopApi } from '../api';
import type { Order, StorefrontCart, StorefrontLanguage } from '../types';
import type { CartController } from './cart-controller';

import { storefrontErrorMessage } from '../storefront-errors';

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

class CurrencySelectionError extends Error {}

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
    const isZh = language === 'zh';
    if (
        currencyCode === options.displayCurrencyCode &&
        (!options.cart?.checkoutOrder || currencyMatches(options.cart.checkoutOrder, currencyCode))
    )
        return;
    if (!options.availableCurrencyCodes.includes(currencyCode))
        throw new Error(isZh ? '当前店铺未开放该付款币种' : 'This payment currency is unavailable.');
    if (cartController.getSnapshot().editingBlocked)
        throw new Error(isZh ? '请先核对当前购物车操作' : 'Review the current cart operation first.');
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
                    throw new CurrencySelectionError(
                        isZh ? '购物车已变更，请重新核对' : 'The cart changed. Review it again.',
                    );
            };
            assertCart();
            if (!currencyMatches(fresh.checkoutOrder, currencyCode)) {
                if (fresh.state !== 'OPEN' || fresh.checkoutOrder?.state !== 'AddingItems')
                    throw new CurrencySelectionError(
                        isZh ? '当前订单状态不能切换付款币种' : 'This order cannot change currency.',
                    );
                const updatedOrder = await api.setPaymentCurrencyForOrder(currencyCode, signal);
                acknowledged = true;
                assertOwner();
                if (updatedOrder.id !== orderId || !currencyMatches(updatedOrder, currencyCode))
                    throw new CurrencySelectionError(
                        isZh ? '订单币种尚未同步' : 'The order currency is not synchronized yet.',
                    );
                options.setCheckoutOrder(updatedOrder);
                fresh = await api.cart(signal);
                assertOwner();
                assertCart();
            }
            if (!currencyMatches(fresh.checkoutOrder, currencyCode))
                throw new CurrencySelectionError(
                    isZh ? '订单币种尚未同步' : 'The order currency is not synchronized yet.',
                );
            options.setCart(fresh);
            options.setCheckoutOrder(fresh.checkoutOrder);
        }
        assertOwner();
        options.commitPreference(currencyCode);
    } catch (error) {
        if (!isCurrent() || signal.aborted) throw error;
        const message = acknowledged
            ? isZh
                ? '付款币种已保存，但购物车读取未完成。请重试读取核对，无需重复提交。'
                : 'Payment currency saved; cart refresh failed. Retry reading the cart without resubmitting.'
            : error instanceof CurrencySelectionError
              ? error.message
              : storefrontErrorMessage(error, language);
        options.setCartError(message);
        options.notify(message);
        throw new Error(message);
    }
}
