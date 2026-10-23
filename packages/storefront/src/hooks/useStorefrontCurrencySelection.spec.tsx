// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CartController } from '../cart/cart-controller';
import { Order, StorefrontCart } from '../types';

import { useStorefrontCurrencySelection } from './useStorefrontCurrencySelection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Options = Parameters<typeof useStorefrontCurrencySelection>[0];
const order = (currencyCode: string, paymentCurrencyCode = currencyCode) =>
    ({ id: 'order-a', currencyCode, state: 'AddingItems', customFields: { paymentCurrencyCode } }) as Order;
const cart = (currencyCode: string, paymentCurrencyCode = currencyCode) =>
    ({
        id: 'cart-a',
        revision: 1,
        projectedRevision: 1,
        state: 'OPEN',
        lines: [],
        checkoutOrder: order(currencyCode, paymentCurrencyCode),
    }) as unknown as StorefrontCart;

describe('shared storefront currency synchronization', () => {
    let root: ReturnType<typeof createRoot>;
    let options: Options;
    let select: ReturnType<typeof useStorefrontCurrencySelection>;
    const api = { cart: vi.fn(), setPaymentCurrencyForOrder: vi.fn() };
    function Harness() {
        select = useStorefrontCurrencySelection(options);
        return null;
    }
    const render = () => act(() => root.render(<Harness />));
    const choose = (currencyCode: string) => act(async () => select(currencyCode));
    beforeEach(() => {
        vi.clearAllMocks();
        api.cart.mockReset();
        api.setPaymentCurrencyForOrder.mockReset();
        options = {
            api,
            cartController: new CartController(),
            cart: cart('CNY'),
            customerId: 'customer-a',
            availableCurrencyCodes: ['CNY', 'MYR', 'USDT'],
            displayCurrencyCode: 'MYR',
            cartLoading: false,
            language: 'zh',
            setCart: vi.fn(),
            setCheckoutOrder: vi.fn(),
            setCartLoading: vi.fn(),
            setCartError: vi.fn(),
            commitPreference: vi.fn(),
            notify: vi.fn(),
        };
        root = createRoot(document.createElement('div'));
        render();
    });
    afterEach(() => act(() => root.unmount()));

    it('reconciles a saved MYR preference with a CNY cart and adopts the complete refreshed cart', async () => {
        const fresh = cart('MYR');
        api.cart.mockResolvedValueOnce(cart('CNY')).mockResolvedValueOnce(fresh);
        api.setPaymentCurrencyForOrder.mockResolvedValue(fresh.checkoutOrder);
        await choose('MYR');
        expect(api.setPaymentCurrencyForOrder).toHaveBeenCalledExactlyOnceWith(
            'MYR',
            expect.any(AbortSignal),
        );
        expect(options.setCart).toHaveBeenCalledExactlyOnceWith(fresh);
        expect(options.setCheckoutOrder).toHaveBeenLastCalledWith(fresh.checkoutOrder);
        expect(options.commitPreference).toHaveBeenCalledExactlyOnceWith('MYR');
        expect(api.cart).toHaveBeenCalledTimes(2);
    });

    it('distinguishes a saved currency from a failed read and retries by reading without another write', async () => {
        api.cart
            .mockResolvedValueOnce(cart('CNY'))
            .mockRejectedValueOnce(new Error('Fixture read unavailable'));
        api.setPaymentCurrencyForOrder.mockResolvedValue(order('MYR'));
        await expect(choose('MYR')).rejects.toThrow('付款币种已保存');
        expect(options.commitPreference).not.toHaveBeenCalled();
        expect(options.setCart).not.toHaveBeenCalled();
        api.cart.mockResolvedValueOnce(cart('MYR'));
        await choose('MYR');
        expect(api.setPaymentCurrencyForOrder).toHaveBeenCalledTimes(1);
        expect(options.commitPreference).toHaveBeenCalledWith('MYR');
    });

    it('reads before retrying a mutation whose response was lost', async () => {
        api.cart.mockResolvedValueOnce(cart('CNY'));
        api.setPaymentCurrencyForOrder.mockRejectedValueOnce(new Error('Fixture lost response'));
        await expect(choose('MYR')).rejects.toThrow();
        api.cart.mockResolvedValueOnce(cart('MYR'));
        await choose('MYR');
        expect(api.setPaymentCurrencyForOrder).toHaveBeenCalledTimes(1);
    });

    it('keeps USDT payment separate from the backing fiat order', async () => {
        const fresh = cart('CNY', 'USDT');
        api.cart.mockResolvedValueOnce(cart('CNY')).mockResolvedValueOnce(fresh);
        api.setPaymentCurrencyForOrder.mockResolvedValue(fresh.checkoutOrder);
        await choose('USDT');
        expect(options.setCart).toHaveBeenCalledWith(fresh);
        expect(options.commitPreference).toHaveBeenCalledWith('USDT');
    });

    it('does not mistake the native fiat currency for an already-selected payment currency', async () => {
        options = { ...options, cart: cart('MYR', 'USDT') };
        render();
        api.cart.mockResolvedValueOnce(cart('MYR', 'USDT')).mockResolvedValueOnce(cart('MYR'));
        api.setPaymentCurrencyForOrder.mockResolvedValue(order('MYR'));
        await choose('MYR');
        expect(api.setPaymentCurrencyForOrder).toHaveBeenCalledOnce();
    });

    it.each(['ArrangingPayment', 'PaymentSettled'])('does not reprice a %s order', async state => {
        const locked = cart('CNY');
        locked.checkoutOrder = { ...order('CNY'), state };
        api.cart.mockResolvedValueOnce(locked);
        await expect(choose('MYR')).rejects.toThrow('当前订单状态');
        expect(api.setPaymentCurrencyForOrder).not.toHaveBeenCalled();
    });

    it('rejects a cart that changed owner before the write', async () => {
        api.cart.mockResolvedValueOnce({ ...cart('CNY'), id: 'another-cart' });
        await expect(choose('MYR')).rejects.toThrow('购物车已变更');
        expect(api.setPaymentCurrencyForOrder).not.toHaveBeenCalled();
    });

    it('does not repeat an already-synchronized selection', async () => {
        options = { ...options, cart: cart('MYR') };
        render();
        await choose('MYR');
        expect(api.cart).not.toHaveBeenCalled();
        expect(api.setPaymentCurrencyForOrder).not.toHaveBeenCalled();
    });

    it('changes a browsing preference without creating an order for an empty cart', async () => {
        options = { ...options, cart: null };
        render();
        await choose('CNY');
        expect(options.commitPreference).toHaveBeenCalledWith('CNY');
        expect(api.cart).not.toHaveBeenCalled();
        expect(api.setPaymentCurrencyForOrder).not.toHaveBeenCalled();
    });

    it('does not update preferences or order state after a customer scope change', async () => {
        let finish!: (value: StorefrontCart) => void;
        api.cart.mockReturnValueOnce(new Promise<StorefrontCart>(resolve => (finish = resolve)));
        let pending!: Promise<void>;
        await act(async () => {
            pending = select('MYR');
            await Promise.resolve();
        });
        const rejected = expect(pending).rejects.toThrow();
        options = { ...options, customerId: 'another-customer' };
        render();
        finish(cart('MYR'));
        await act(async () => {
            await rejected;
        });
        expect(options.commitPreference).not.toHaveBeenCalled();
        expect(options.setCheckoutOrder).not.toHaveBeenCalled();
    });

    it('prevents overlapping currency writes', async () => {
        let finish!: (value: StorefrontCart) => void;
        api.cart.mockReturnValueOnce(new Promise<StorefrontCart>(resolve => (finish = resolve)));
        let pending!: Promise<void>;
        await act(async () => {
            pending = select('MYR');
            await Promise.resolve();
        });
        await expect(choose('USDT')).rejects.toThrow('请先核对');
        finish(cart('MYR'));
        await act(async () => pending);
        expect(api.setPaymentCurrencyForOrder).not.toHaveBeenCalled();
    });
});
