// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi, ShopApiError } from '../api';
import { CartController } from '../cart/cart-controller';
import { ActiveCustomer, Order, ProductVariant, StorefrontCart } from '../types';

import { useStorefrontCartActions } from './useStorefrontCartActions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Options = Parameters<typeof useStorefrontCartActions>[0];

describe('storefront cart action boundaries', () => {
    let root: ReturnType<typeof createRoot>;
    let controller: CartController;
    let options: Options;
    let value: ReturnType<typeof useStorefrontCartActions>;
    const cart = { id: 'cart-a', revision: 7, checkoutOrder: null, lines: [] } as StorefrontCart;
    const acknowledgement = {
        commandId: 'command-a',
        status: 'APPLIED' as const,
        appliedRevision: 7,
        errorCode: null,
        message: null,
    };
    const api = { cart: vi.fn() };
    function Harness() {
        value = useStorefrontCartActions(options);
        return null;
    }
    function render() {
        act(() => root.render(<Harness />));
    }
    beforeEach(() => {
        vi.resetAllMocks();
        root = createRoot(document.createElement('div'));
        controller = new CartController('fixture-store');
        vi.spyOn(controller, 'getSnapshot').mockReturnValue({ ...controller.getSnapshot(), cart });
        vi.spyOn(controller, 'recoverPending').mockResolvedValue(undefined);
        api.cart.mockResolvedValue(cart);
        options = {
            api: api as unknown as ShopApi,
            cart: { ...cart, revision: 1 },
            customer: { id: 'customer-a' } as ActiveCustomer,
            cartController: controller,
            isZh: true,
            text: { loadError: '加载失败' },
            notify: vi.fn(),
            navigate: vi.fn(),
            setCart: vi.fn(),
            setCheckoutOrder: vi.fn(),
            setCartLoading: vi.fn(),
            setCartError: vi.fn(),
            setAddingVariantId: vi.fn(),
        };
    });
    afterEach(() => {
        act(() => root.unmount());
        vi.restoreAllMocks();
    });

    it('sends guests to login with the selected variant without creating a checkout', async () => {
        options.customer = null;
        const execute = vi.spyOn(controller, 'execute');
        render();
        await value.startDirectPurchase({
            id: 'selected-variant',
            customFields: { fulfillmentType: 'physical' },
        } as ProductVariant);
        expect(options.navigate).toHaveBeenCalledWith({
            name: 'login',
            returnTo: 'purchase',
            id: 'selected-variant',
        });
        expect(execute).not.toHaveBeenCalled();
        expect(options.setCartLoading).not.toHaveBeenCalled();
    });

    it('uses the current controller revision instead of stale rendered cart state', async () => {
        const updated = { ...cart, revision: 8 };
        const mutate = vi.fn().mockResolvedValue(updated);
        render();
        expect(await value.mutateCart(mutate)).toEqual(updated);
        expect(mutate).toHaveBeenCalledWith(7);
        expect(options.setCart).toHaveBeenCalledWith(updated);
        expect(options.setCartLoading).toHaveBeenLastCalledWith(false);
    });

    it('refreshes after a revision conflict without replaying the write', async () => {
        const recovery = vi.spyOn(controller, 'recoverPending');
        const mutate = vi
            .fn()
            .mockRejectedValue(new ShopApiError('CART_REVISION_CONFLICT_ERROR', 'Conflict'));
        render();
        expect(await value.mutateCart(mutate)).toBeNull();
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(recovery).toHaveBeenCalledOnce();
        expect(api.cart).toHaveBeenCalledOnce();
        expect(options.setCartError).toHaveBeenLastCalledWith('购物车已更新，请重新操作');
        expect(options.setCartLoading).toHaveBeenLastCalledWith(false);
    });

    it('keeps navigation unchanged when buy-now has no confirmed checkout session', async () => {
        vi.spyOn(controller, 'execute').mockResolvedValue({ ...acknowledgement, cart, session: null });
        render();
        await value.startDirectPurchase({
            id: 'variant-a',
            customFields: { fulfillmentType: 'physical' },
        } as ProductVariant);
        expect(options.navigate).not.toHaveBeenCalled();
        expect(options.setCheckoutOrder).not.toHaveBeenCalled();
        expect(options.setCartError).toHaveBeenLastCalledWith('当前没有可结算的订单，请重新选择商品。');
        expect(options.setAddingVariantId).toHaveBeenLastCalledWith(null);
        expect(options.setCartLoading).toHaveBeenLastCalledWith(false);
    });

    it('publishes the confirmed buy-now session before navigating to its review page', async () => {
        const order = { id: 'order-a' } as Order;
        const session = { cart, order, checkout: null };
        const execute = vi
            .spyOn(controller, 'execute')
            .mockResolvedValue({ ...acknowledgement, cart, session });
        render();
        await value.startDirectPurchase({
            id: 'variant-a',
            customFields: { fulfillmentType: 'physical' },
        } as ProductVariant);
        expect(execute).toHaveBeenCalledWith({ buyNow: { productVariantId: 'variant-a', quantity: 1 } });
        expect(options.setCheckoutOrder).toHaveBeenCalledWith(order);
        expect(options.navigate).toHaveBeenCalledWith({ name: 'purchase' });
        expect(vi.mocked(options.setCheckoutOrder).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(options.navigate).mock.invocationCallOrder[0],
        );
    });
});
