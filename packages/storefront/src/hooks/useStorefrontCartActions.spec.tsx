// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { ShopApi, ShopApiError } from '../api';
import { CartController } from '../cart/cart-controller';
import { ActiveCustomer, Order, ProductVariant, StorefrontCart } from '../types';

import { useStorefrontCartActions } from './useStorefrontCartActions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Options = Parameters<typeof useStorefrontCartActions>[0];

describe('storefront cart action boundaries', () => {
    let root: ReturnType<typeof createRoot>;
    let controller: CartController;
    let recoverPendingSpy: MockInstance<CartController['recoverPending']>;
    let options: Options;
    let value: ReturnType<typeof useStorefrontCartActions>;
    const cart: StorefrontCart = {
        id: 'cart-a',
        revision: 7,
        checkoutOrder: null,
        lines: [],
        state: 'OPEN',
        projectedRevision: 7,
        totalQuantity: 0,
        selectedLineCount: 0,
        selectedQuantity: 0,
        selectionState: 'NONE',
    };
    const acknowledgement = {
        commandId: 'command-a',
        status: 'APPLIED' as const,
        appliedRevision: 7,
        errorCode: null,
        message: null,
    };
    const api = { cart: vi.fn(), addItem: vi.fn() };
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
        vi.spyOn(controller, 'getSnapshot').mockReturnValue({
            ...controller.getSnapshot(),
            cart,
            confirmed: cart,
        });
        recoverPendingSpy = vi.spyOn(controller, 'recoverPending').mockResolvedValue(true);
        api.cart.mockResolvedValue(cart);
        api.addItem.mockResolvedValue(cart);
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

    it.each([true, false])(
        'blocks sold-out additions and existing unselected quantities in the active language: zh=%s',
        async isZh => {
            options.isZh = isZh;
            const productVariant = {
                id: 'variant-a',
                name: 'Test product',
                saleableStockLevel: 2,
                customFields: { fulfillmentType: 'physical' },
            } as ProductVariant;
            vi.mocked(controller.getSnapshot).mockReturnValue({
                ...controller.getSnapshot(),
                cart: {
                    ...cart,
                    lines: [{ id: 'line-a', quantity: 2, selected: false, available: true, productVariant }],
                },
            });
            render();
            expect(await value.addToCart(productVariant)).toBeNull();
            expect(options.notify).toHaveBeenLastCalledWith(
                expect.stringContaining(isZh ? '最多可购买 2 件' : 'Up to 2 available'),
            );
            expect(options.setCart).not.toHaveBeenCalled();
            vi.mocked(controller.getSnapshot).mockReturnValue({ ...controller.getSnapshot(), cart });
            await value.addToCart({ ...productVariant, saleableStockLevel: 0 });
            expect(options.notify).toHaveBeenLastCalledWith(
                expect.stringContaining(isZh ? '已售罄' : 'Sold out'),
            );
        },
    );

    it('checks the requested quantity against cart stock before sending one add command', async () => {
        const productVariant = {
            id: 'variant-a',
            name: 'Test product',
            saleableStockLevel: 4,
            customFields: { fulfillmentType: 'physical' },
        } as ProductVariant;
        vi.mocked(controller.getSnapshot).mockReturnValue({
            ...controller.getSnapshot(),
            cart: {
                ...cart,
                lines: [{ id: 'line-a', quantity: 2, selected: true, available: true, productVariant }],
            },
        });
        render();
        expect(await value.addToCart(productVariant, 3)).toBeNull();
        expect(api.addItem).not.toHaveBeenCalled();
        await value.addToCart(productVariant, 2);
        expect(api.addItem).toHaveBeenCalledOnce();
        expect(api.addItem).toHaveBeenCalledWith('variant-a', 7, 2);
    });

    it('sends guests to login with the selected variant without creating a checkout', async () => {
        options.customer = null;
        const execute = vi.spyOn(controller, 'execute');
        render();
        await value.startDirectPurchase(
            {
                id: 'selected-variant',
                customFields: { fulfillmentType: 'physical' },
            } as ProductVariant,
            3,
        );
        expect(options.navigate).toHaveBeenCalledWith({
            name: 'login',
            returnTo: 'purchase',
            id: 'selected-variant',
            quantity: 3,
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
        await act(async () => {
            expect(await value.mutateCart(mutate)).toBeNull();
        });
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(recovery).toHaveBeenCalledOnce();
        expect(api.cart).toHaveBeenCalledOnce();
        expect(options.setCartError).toHaveBeenLastCalledWith('购物车已更新，请重新操作');
        expect(options.setCartLoading).toHaveBeenLastCalledWith(false);
    });

    it.each([true, false])(
        'preserves the confirmed contents without an extra read when recovery is unresolved: zh=%s',
        async isZh => {
            options.isZh = isZh;
            const latest = { ...cart, revision: 8 };
            recoverPendingSpy.mockResolvedValue(false);
            vi.mocked(controller.getSnapshot).mockReturnValue({
                ...controller.getSnapshot(),
                phase: 'unknown',
                editingBlocked: true,
                confirmed: latest,
            });
            api.cart.mockResolvedValue(latest);
            render();
            await act(async () => {
                expect(await value.refreshCart()).toEqual(latest);
            });
            expect(api.cart).not.toHaveBeenCalled();
            expect(options.setCart).toHaveBeenCalledWith(latest);
            expect(options.setCartError).toHaveBeenLastCalledWith(
                isZh ? '结果待确认，请核对购物车。' : 'Result unconfirmed. Review your cart.',
            );
            expect(options.setCartError).not.toHaveBeenCalledWith(null);
            expect(value.cartRecoveryPending).toBe(false);
            expect(value.cartActionsBlocked()).toBe(true);
        },
    );

    it('clears the warning only after recovery and a fresh snapshot complete', async () => {
        render();
        await act(async () => {
            await value.refreshCart();
        });
        expect(options.setCartError).toHaveBeenLastCalledWith(null);
        expect(value.cartRecoveryPending).toBe(false);
        expect(value.cartActionsBlocked()).toBe(false);
        const mutation = vi.fn().mockResolvedValue(cart);
        expect(await value.mutateCart(mutation)).toEqual(cart);
        expect(mutation).toHaveBeenCalledOnce();
    });

    it('retains the unknown warning and confirmed contents when the recovery refresh fails', async () => {
        recoverPendingSpy.mockRejectedValue(new Error('Network unavailable'));
        vi.mocked(controller.getSnapshot).mockReturnValue({
            ...controller.getSnapshot(),
            phase: 'unknown',
            editingBlocked: true,
        });
        render();
        await act(async () => {
            await expect(value.refreshCart()).rejects.toThrow('Network unavailable');
        });
        expect(options.setCart).not.toHaveBeenCalled();
        expect(options.setCheckoutOrder).not.toHaveBeenCalled();
        expect(options.setCartError).toHaveBeenLastCalledWith('结果待确认，请核对购物车。');
        expect(value.cartRecoveryPending).toBe(false);
    });

    it.each([
        ['beginCheckout', 'checkout', true],
        ['beginCheckout', 'checkout', false],
        ['buyNow', 'purchase', true],
        ['buyNow', 'purchase', false],
        ['preparePayment', 'payment', true],
        ['preparePayment', 'payment', false],
    ] as const)(
        'resumes confirmed %s at %s from the recovered snapshot: zh=%s',
        async (checkoutIntent, destination, isZh) => {
            options.isZh = isZh;
            const order = { id: 'order-a' } as Order;
            const latest = { ...cart, revision: 8, checkoutOrder: order };
            const session = { cart: latest, order, checkout: null };
            const recoveredState = {
                ...controller.getSnapshot(),
                phase: checkoutIntent === 'preparePayment' ? ('locked' as const) : ('idle' as const),
                editingBlocked: checkoutIntent === 'preparePayment',
                confirmed: latest,
                cart: latest,
                lastRecovery: {
                    commandId: acknowledgement.commandId,
                    status: 'APPLIED' as const,
                    checkoutIntent,
                    result: { ...acknowledgement, cart: latest, session },
                },
            };
            vi.mocked(controller.getSnapshot).mockReturnValue({
                ...controller.getSnapshot(),
                phase: 'unknown',
                editingBlocked: true,
                commandAcknowledged: true,
                pendingCheckoutIntent: checkoutIntent,
            });
            recoverPendingSpy.mockImplementation(() => {
                vi.mocked(controller.getSnapshot).mockReturnValue(recoveredState);
                return Promise.resolve(true);
            });
            render();
            await act(async () => {
                expect(await value.refreshCart()).toEqual(latest);
            });
            expect(api.cart).not.toHaveBeenCalled();
            expect(options.setCart).toHaveBeenCalledWith(latest);
            expect(options.setCheckoutOrder).toHaveBeenLastCalledWith(order);
            expect(options.navigate).toHaveBeenCalledExactlyOnceWith({ name: destination }, true);
            expect(options.setCartError).toHaveBeenLastCalledWith(null);
            await act(async () => {
                await value.refreshCart();
            });
            expect(options.navigate).toHaveBeenCalledOnce();
        },
    );

    it.each(['CANCELLED', 'REJECTED'] as const)(
        'keeps %s recovery in the cart without starting a checkout',
        async status => {
            const recoveredState = {
                ...controller.getSnapshot(),
                lastRecovery: {
                    commandId: acknowledgement.commandId,
                    status,
                    checkoutIntent: 'beginCheckout' as const,
                    result: { ...acknowledgement, status, cart, session: null },
                },
            };
            vi.mocked(controller.getSnapshot).mockReturnValue({
                ...controller.getSnapshot(),
                phase: 'unknown',
                editingBlocked: true,
            });
            recoverPendingSpy.mockImplementation(() => {
                vi.mocked(controller.getSnapshot).mockReturnValue(recoveredState);
                return Promise.resolve(true);
            });
            render();
            await act(async () => {
                await value.refreshCart();
            });
            expect(options.navigate).not.toHaveBeenCalled();
            expect(api.cart).not.toHaveBeenCalled();
        },
    );

    it('keeps a confirmed operation distinct from an unknown result when its latest read fails', async () => {
        vi.mocked(controller.getSnapshot).mockReturnValue({
            ...controller.getSnapshot(),
            phase: 'unknown',
            editingBlocked: true,
            commandAcknowledged: true,
        });
        recoverPendingSpy.mockRejectedValue(new Error('Read failed'));
        render();
        await act(async () => {
            await expect(value.refreshCart()).rejects.toThrow('Read failed');
        });
        expect(options.setCartError).toHaveBeenLastCalledWith('操作已确认，请重试读取购物车。');
        expect(api.cart).not.toHaveBeenCalled();
    });

    it.each([null, 'beginCheckout'] as const)(
        'stays on the cart when a recovered edit has no checkout intent or no session: %s',
        async checkoutIntent => {
            const recoveredState = {
                ...controller.getSnapshot(),
                lastRecovery: {
                    commandId: acknowledgement.commandId,
                    status: 'APPLIED' as const,
                    checkoutIntent,
                    result: { ...acknowledgement, cart, session: null },
                },
            };
            vi.mocked(controller.getSnapshot).mockReturnValue({
                ...controller.getSnapshot(),
                phase: 'unknown',
                editingBlocked: true,
            });
            recoverPendingSpy.mockImplementation(() => {
                vi.mocked(controller.getSnapshot).mockReturnValue(recoveredState);
                return Promise.resolve(true);
            });
            render();
            await act(async () => {
                await value.refreshCart();
            });
            expect(options.navigate).not.toHaveBeenCalled();
            expect(options.setCart).toHaveBeenCalledWith(cart);
            expect(api.cart).not.toHaveBeenCalled();
        },
    );

    it('resumes an already applied checkout when cancellation arrived after its commit', async () => {
        const order = { id: 'order-a' } as Order;
        const latest = { ...cart, checkoutOrder: order };
        const recoveredState = {
            ...controller.getSnapshot(),
            cart: latest,
            confirmed: latest,
            lastRecovery: {
                commandId: acknowledgement.commandId,
                status: 'APPLIED' as const,
                checkoutIntent: 'beginCheckout' as const,
                result: {
                    ...acknowledgement,
                    cart: latest,
                    session: { cart: latest, order, checkout: null },
                },
            },
        };
        vi.mocked(controller.getSnapshot).mockReturnValue({
            ...controller.getSnapshot(),
            phase: 'unknown',
            editingBlocked: true,
        });
        recoverPendingSpy.mockImplementation(() => {
            vi.mocked(controller.getSnapshot).mockReturnValue(recoveredState);
            return Promise.resolve(true);
        });
        render();
        await act(async () => {
            await value.cancelPendingCartCommand();
        });
        expect(recoverPendingSpy).toHaveBeenCalledExactlyOnceWith(true);
        expect(options.navigate).toHaveBeenCalledExactlyOnceWith({ name: 'checkout' }, true);
        expect(api.cart).not.toHaveBeenCalled();
    });

    it('ignores recovery completed after the signed-in customer changes', async () => {
        let finish!: (recovered: boolean) => void;
        recoverPendingSpy.mockReturnValue(
            new Promise(resolve => {
                finish = resolve;
            }),
        );
        vi.mocked(controller.getSnapshot).mockReturnValue({
            ...controller.getSnapshot(),
            phase: 'unknown',
            editingBlocked: true,
        });
        render();
        let pending!: Promise<StorefrontCart>;
        act(() => {
            pending = value.refreshCart();
        });
        options.customer = { id: 'customer-b' } as ActiveCustomer;
        render();
        await act(async () => {
            finish(true);
            await expect(pending).rejects.toThrow('Cart session changed.');
        });
        expect(options.setCart).not.toHaveBeenCalled();
        expect(options.setCheckoutOrder).not.toHaveBeenCalled();
        expect(options.navigate).not.toHaveBeenCalled();
        expect(value.cartRecoveryPending).toBe(false);
    });

    it('coalesces review and cancellation requests while blocking mutations and direct purchase', async () => {
        let finishRecovery!: (recovered: boolean) => void;
        recoverPendingSpy.mockReturnValue(
            new Promise(resolve => {
                finishRecovery = resolve;
            }),
        );
        const execute = vi.spyOn(controller, 'execute');
        render();
        let pending!: Promise<StorefrontCart>;
        act(() => {
            pending = value.refreshCart();
        });
        expect(value.cartRecoveryPending).toBe(true);
        expect(value.cancelPendingCartCommand()).toBe(pending);
        const mutation = vi.fn();
        expect(await value.mutateCart(mutation)).toBeNull();
        await value.startDirectPurchase({ id: 'variant-a' } as ProductVariant);
        expect(mutation).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(recoverPendingSpy).toHaveBeenCalledExactlyOnceWith(false);
        await act(async () => {
            finishRecovery(true);
            await pending;
        });
        expect(api.cart).toHaveBeenCalledOnce();
        expect(value.cartRecoveryPending).toBe(false);
    });

    it('uses cancellation recovery and refreshes its confirmed server outcome', async () => {
        render();
        await act(async () => {
            expect(await value.cancelPendingCartCommand()).toEqual(cart);
        });
        expect(recoverPendingSpy).toHaveBeenCalledExactlyOnceWith(true);
        expect(api.cart).toHaveBeenCalledOnce();
        expect(options.setCartError).toHaveBeenLastCalledWith(null);
    });

    it('does not run review or cart writes while checkout is starting', async () => {
        options.checkoutStartingRef = { current: true };
        const execute = vi.spyOn(controller, 'execute');
        render();
        await expect(value.refreshCart()).rejects.toThrow('购物车正在更新');
        expect(await value.mutateCart(vi.fn())).toBeNull();
        await value.startDirectPurchase({ id: 'variant-a' } as ProductVariant);
        expect(recoverPendingSpy).not.toHaveBeenCalled();
        expect(api.cart).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(options.setCartError).not.toHaveBeenCalled();
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

    it.each([true, false])(
        'directs uncertain add and buy-now results to cart review without claiming success: zh=%s',
        async isZh => {
            options.isZh = isZh;
            const uncertain = new ShopApiError('UNKNOWN_RESULT', 'Unknown acknowledgement');
            api.addItem.mockRejectedValue(uncertain);
            vi.spyOn(controller, 'execute').mockRejectedValue(uncertain);
            const variant = {
                id: 'variant-a',
                customFields: { fulfillmentType: 'physical' },
            } as ProductVariant;
            render();
            await value.addToCart(variant);
            await value.startDirectPurchase(variant);
            const expected = isZh ? '结果待确认，请核对购物车。' : 'Result unconfirmed. Review your cart.';
            expect(vi.mocked(options.notify).mock.calls).toEqual([[expected], [expected]]);
            expect(options.setCartError).toHaveBeenLastCalledWith(expected);
            expect(options.setCart).not.toHaveBeenCalled();
            expect(options.setCheckoutOrder).not.toHaveBeenCalled();
            expect(options.navigate).not.toHaveBeenCalled();
        },
    );

    it('publishes the confirmed buy-now session before navigating to its review page', async () => {
        const order = { id: 'order-a' } as Order;
        const session = { cart, order, checkout: null };
        const execute = vi
            .spyOn(controller, 'execute')
            .mockResolvedValue({ ...acknowledgement, cart, session });
        render();
        await value.startDirectPurchase(
            {
                id: 'variant-a',
                customFields: { fulfillmentType: 'physical' },
            } as ProductVariant,
            3,
        );
        expect(execute).toHaveBeenCalledWith({ buyNow: { productVariantId: 'variant-a', quantity: 3 } });
        expect(options.setCheckoutOrder).toHaveBeenCalledWith(order);
        expect(options.navigate).toHaveBeenCalledWith({ name: 'purchase' });
        expect(vi.mocked(options.setCheckoutOrder).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(options.navigate).mock.invocationCallOrder[0],
        );
    });
});
