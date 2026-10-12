import { afterEach, describe, expect, it, vi } from 'vitest';

import { CartController } from '../cart/cart-controller';
import { type CartCommand, type CartOperation } from '../cart/cart-intents';
import { CartCommandNotExecutedError } from '../cart/cart-repository';
import {
    type CustomerAddressInput,
    type MarketConfig,
    type Order,
    type ProductVariant,
    type StorefrontCart,
} from '../types';

import { CartCheckoutApi } from './cart-checkout';
import { type ShopApiContext } from './client-context';

const shippingInput = {
    shippingAddress: {
        fullName: 'Fixture customer',
        streetLine1: 'Fixture street',
        city: 'Fixture city',
        province: 'Fixture province',
        postalCode: '10000',
        countryCode: 'MY',
    } as CustomerAddressInput,
};

function fixture(
    options: {
        loseReceipt?: boolean;
        recoveryStatus?: 'APPLIED' | 'REJECTED' | 'CANCELLED';
        shippingFailure?: 'read' | 'reject';
        failedReadsAfterWrite?: number;
        firstStatus?: 'REJECTED';
    } = {},
) {
    const controller = new CartController();
    let cart: StorefrontCart = {
        id: 'cart-a',
        revision: 102,
        projectedRevision: 102,
        state: 'OPEN',
        totalQuantity: 1,
        selectedQuantity: 1,
        selectedLineCount: 1,
        selectionState: 'ALL',
        checkoutOrder: { id: 'order-a', currencyCode: 'MYR', customer: { id: 'customer-a' } } as Order,
        lines: [
            {
                id: 'line-a',
                quantity: 1,
                selected: true,
                available: true,
                productVariant: { id: 'variant-a' } as ProductVariant,
            },
        ],
    };
    let blocked = false;
    let failuresRemaining = options.failedReadsAfterWrite ?? Infinity;
    let firstWriteGate: Promise<void> | undefined;
    let nextRead: ((signal?: AbortSignal) => Promise<unknown>) | undefined;
    const writes: CartCommand[] = [];
    const request = vi.fn(
        (document: string, variables?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
            if (document.includes('query StorefrontCart')) {
                if (blocked) {
                    failuresRemaining--;
                    if (!failuresRemaining) blocked = false;
                    return Promise.reject(new Error('Fixture display read unavailable'));
                }
                if (nextRead) {
                    const read = nextRead;
                    nextRead = undefined;
                    return read(signal);
                }
                return Promise.resolve({ storefrontCart: cart });
            }
            if (document.includes('mutation RecoverStorefrontCartCommand')) {
                if (blocked) return Promise.reject(new Error('Fixture recovery unavailable'));
                const command = writes[0];
                return Promise.resolve({
                    recoverStorefrontCartCommand: {
                        commandId: command.commandId,
                        status: options.recoveryStatus ?? 'APPLIED',
                        appliedRevision: options.recoveryStatus === 'APPLIED' ? cart.revision : null,
                        errorCode:
                            options.recoveryStatus === 'REJECTED'
                                ? 'INSUFFICIENT_STOCK_ERROR'
                                : 'CART_COMMAND_CANCELLED',
                        message: 'Original command was not applied',
                        cart: { id: cart.id, revision: cart.revision },
                        session: null,
                    },
                });
            }
            if (document.includes('mutation ApplyStorefrontCartCommand')) {
                const command = variables?.input as CartCommand;
                writes.push(command);
                if (writes.length === 1 && options.loseReceipt) {
                    blocked = true;
                    return Promise.reject(new Error('Fixture lost receipt'));
                }
                if (!(writes.length === 1 && options.firstStatus))
                    cart = { ...cart, revision: cart.revision + 1, projectedRevision: cart.revision + 1 };
                if (
                    (writes.length === 1 && options.failedReadsAfterWrite !== 0) ||
                    ('prepareShipping' in command && options.shippingFailure === 'read')
                )
                    blocked = true;
                const payload = {
                    applyStorefrontCartCommand: {
                        commandId: command.commandId,
                        status:
                            (writes.length === 1 && options.firstStatus) ||
                            ('prepareShipping' in command && options.shippingFailure === 'reject')
                                ? 'REJECTED'
                                : 'APPLIED',
                        appliedRevision: cart.revision,
                        errorCode:
                            writes.length === 1 && options.firstStatus
                                ? 'INSUFFICIENT_STOCK_ERROR'
                                : 'prepareShipping' in command && options.shippingFailure === 'reject'
                                  ? 'CART_INPUT_REJECTED'
                                  : null,
                        message:
                            writes.length === 1 && options.firstStatus
                                ? 'Original command was not applied'
                                : 'prepareShipping' in command && options.shippingFailure === 'reject'
                                  ? 'No delivery for this address'
                                  : null,
                        cart: { id: cart.id, revision: cart.revision },
                        session: null,
                        shippingMethods: [
                            {
                                id: 'shipping-a',
                                code: 'fixture-standard',
                                name: 'Fixture shipping',
                                priceWithTax: 0,
                            },
                        ],
                        selectedShippingMethodId: 'shipping-a',
                    },
                };
                return writes.length === 1 && firstWriteGate
                    ? firstWriteGate.then(() => payload)
                    : Promise.resolve(payload);
            }
            return Promise.reject(new Error('Unexpected fixture request'));
        },
    );
    const ctx = {
        market: { code: 'fixture-store', currencyCode: 'MYR' } as MarketConfig,
        languageCode: 'zh',
        request,
    } as unknown as ShopApiContext;
    const api = new CartCheckoutApi(ctx);
    api.connect(controller);
    return {
        api,
        controller,
        request,
        writes,
        cart: () => cart,
        allowReads: () => {
            blocked = false;
        },
        replaceCart: (value: StorefrontCart) => {
            cart = value;
        },
        delayRead: (read: (signal?: AbortSignal) => Promise<unknown>) => {
            nextRead = read;
        },
        market: ctx.market,
        holdFirstWrite: () => {
            let release!: () => void;
            firstWriteGate = new Promise(resolve => {
                release = resolve;
            });
            return release;
        },
    };
}

async function unknownCoupon(
    state: ReturnType<typeof fixture>,
    operation: CartOperation = { coupon: { action: 'BEST' } },
) {
    await state.controller.read();
    await state.controller.execute(operation).catch(() => undefined);
    expect(state.controller.getSnapshot().phase).toBe('unknown');
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('shipping after confirmation of an existing ordinary cart command', () => {
    it('continues shipping that queued behind a saving coupon but was removed before submission', async () => {
        const state = fixture({ failedReadsAfterWrite: 2 });
        await state.controller.read();
        const release = state.holdFirstWrite();
        const coupon = state.controller.execute({ coupon: { action: 'BEST' } }).catch(() => undefined);
        await vi.waitFor(() => expect(state.controller.getSnapshot().phase).toBe('saving'));
        const shipping = state.api.prepareShipping(shippingInput).catch(error => error);
        release();
        await coupon;
        expect(await shipping).toMatchObject({ cart: { revision: 104 }, order: { id: 'order-a' } });
        expect(state.writes.filter(command => 'coupon' in command)).toHaveLength(1);
        expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(1);
        state.controller.reset();
    });

    it.each(['reject', 'unknown'] as const)(
        'does not resubmit shipping blocked by an earlier %s shipping command',
        async outcome => {
            const state = fixture({
                failedReadsAfterWrite: outcome === 'reject' ? 0 : 2,
                firstStatus: outcome === 'reject' ? 'REJECTED' : undefined,
            });
            await state.controller.read();
            const release = state.holdFirstWrite();
            const previousShipping = state.controller
                .execute({ prepareShipping: shippingInput })
                .catch(() => undefined);
            await vi.waitFor(() => expect(state.controller.getSnapshot().phase).toBe('saving'));
            const recover = vi.spyOn(state.controller, 'recoverPending');
            const shipping = state.api.prepareShipping(shippingInput).catch(error => error);
            release();
            await previousShipping;
            expect(await shipping).toBeInstanceOf(Error);
            expect(state.writes).toHaveLength(1);
            expect(recover).not.toHaveBeenCalled();
            state.controller.reset();
        },
    );

    it('can continue after a known nonempty edit without confusing it with a restored placeholder', async () => {
        const state = fixture();
        await unknownCoupon(state, { changes: { lines: [{ lineId: 'line-a', quantity: 1 }] } });
        expect(state.controller.canRecoverForShipping()).toBe(true);
        state.allowReads();
        expect((await state.api.prepareShipping(shippingInput)).cart.revision).toBe(104);
        expect(state.writes).toHaveLength(2);
        state.controller.reset();
    });

    it('continues an unqueued shipping request after the acknowledged coupon recovers', async () => {
        const state = fixture();
        await unknownCoupon(state);
        expect(state.controller.getSnapshot()).toMatchObject({
            phase: 'unknown',
            pendingCheckoutIntent: null,
            commandAcknowledged: true,
        });
        const recover = vi.spyOn(state.controller, 'recoverPending');
        state.allowReads();
        const shipping = await state.api.prepareShipping(shippingInput);
        expect(shipping.order.id).toBe('order-a');
        expect(shipping.cart.revision).toBe(104);
        expect(recover).toHaveBeenCalledOnce();
        expect(state.writes.filter(command => 'coupon' in command)).toHaveLength(1);
        expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(1);
        expect(
            state.request.mock.calls.filter(([document]) =>
                document.includes('mutation RecoverStorefrontCartCommand'),
            ),
        ).toHaveLength(0);
        state.controller.reset();
    });

    it('joins an existing acknowledged recovery instead of starting another lookup', async () => {
        const state = fixture();
        await unknownCoupon(state);
        state.allowReads();
        let complete!: () => void;
        state.delayRead(
            () =>
                new Promise(resolve => {
                    complete = () => resolve({ storefrontCart: state.cart() });
                }),
        );
        const existing = state.controller.recoverPending(false);
        await vi.waitFor(() => expect(state.controller.getSnapshot().phase).toBe('recovering'));
        const before = state.request.mock.calls.length;
        const shipping = state.api.prepareShipping(shippingInput);
        await Promise.resolve();
        expect(state.request.mock.calls).toHaveLength(before);
        complete();
        expect(await existing).toBe(true);
        expect((await shipping).cart.revision).toBe(104);
        expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(1);
        state.controller.reset();
    });

    it.each(['cart', 'order', 'currency', 'customer', 'variant', 'quantity', 'selected', 'payment'] as const)(
        'keeps shipping unqueued when recovery changes its %s scope',
        async changed => {
            const state = fixture();
            await unknownCoupon(state);
            const current = state.cart();
            const order = current.checkoutOrder;
            if (!order?.customer) throw new Error('Missing fixture order customer');
            state.replaceCart({
                ...current,
                id: changed === 'cart' ? 'cart-b' : current.id,
                state: changed === 'payment' ? 'PAYMENT_PENDING' : 'OPEN',
                checkoutOrder: {
                    ...order,
                    id: changed === 'order' ? 'order-b' : order.id,
                    currencyCode: changed === 'currency' ? 'CNY' : order.currencyCode,
                    customer: {
                        ...order.customer,
                        id: changed === 'customer' ? 'customer-b' : order.customer.id,
                    },
                },
                lines: current.lines.map(line => {
                    const variant = line.productVariant;
                    if (!variant) throw new Error('Missing fixture variant');
                    return {
                        ...line,
                        quantity: changed === 'quantity' ? 2 : line.quantity,
                        selected: changed === 'selected' ? false : line.selected,
                        productVariant: { ...variant, id: changed === 'variant' ? 'variant-b' : variant.id },
                    };
                }),
            });
            state.allowReads();
            await expect(state.api.prepareShipping(shippingInput)).rejects.toBeInstanceOf(Error);
            expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(0);
            state.controller.reset();
        },
    );

    it.each(['controller', 'store'] as const)(
        'does not continue after its %s owner changes during recovery',
        async changed => {
            const state = fixture();
            await unknownCoupon(state);
            state.allowReads();
            let complete!: () => void;
            state.delayRead(
                () =>
                    new Promise(resolve => {
                        complete = () => resolve({ storefrontCart: state.cart() });
                    }),
            );
            const shipping = state.api.prepareShipping(shippingInput).catch(error => error);
            await vi.waitFor(() => expect(state.controller.getSnapshot().phase).toBe('recovering'));
            if (changed === 'controller') state.api.connect(new CartController());
            else state.market.code = 'other-store';
            complete();
            expect(await shipping).toMatchObject({ message: 'Cart session changed.' });
            expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(0);
            state.controller.reset();
        },
    );

    it.each(['REJECTED', 'CANCELLED'] as const)(
        'retains an original %s outcome without sending shipping',
        async recoveryStatus => {
            const state = fixture({ loseReceipt: true, recoveryStatus });
            await unknownCoupon(state);
            state.allowReads();
            await expect(state.api.prepareShipping(shippingInput)).rejects.toMatchObject({
                message: 'Original command was not applied',
            });
            expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(0);
            state.controller.reset();
        },
    );

    it.each([
        { buyNow: { productVariantId: 'variant-a', quantity: 1 } },
        { beginCheckout: true },
        { preparePayment: true },
        { prepareShipping: shippingInput },
    ] as CartOperation[])(
        'does not recover a pending checkout or previously issued shipping command: %j',
        async operation => {
            const state = fixture();
            await unknownCoupon(state, operation);
            state.allowReads();
            const recover = vi.spyOn(state.controller, 'recoverPending');
            await expect(state.api.prepareShipping(shippingInput)).rejects.toBeInstanceOf(
                CartCommandNotExecutedError,
            );
            expect(recover).not.toHaveBeenCalled();
            expect(state.writes).toHaveLength(1);
            state.controller.reset();
        },
    );

    it('does not recover a restored journal whose original operation is unknown', async () => {
        const state = fixture();
        const stored = new Map<string, string>();
        stored.set(
            'storefront:cart-recovery:fixture-store',
            JSON.stringify({
                commandId: 'fixture-restored-command-0001',
                cartId: state.cart().id,
                checkoutIntent: null,
                terminalReceipt: {
                    commandId: 'fixture-restored-command-0001',
                    status: 'APPLIED',
                    appliedRevision: 105,
                    cart: { id: 'cart-a', revision: 105 },
                    errorCode: null,
                    session: null,
                },
            }),
        );
        vi.stubGlobal('sessionStorage', {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => stored.set(key, value),
            removeItem: (key: string) => stored.delete(key),
        });
        const controller = new CartController('fixture-store');
        state.api.connect(controller);
        await controller.read();
        expect(controller.getSnapshot().phase).toBe('unknown');
        expect(controller.canRecoverForShipping()).toBe(false);
        const recover = vi.spyOn(controller, 'recoverPending');
        await expect(state.api.prepareShipping(shippingInput)).rejects.toBeInstanceOf(
            CartCommandNotExecutedError,
        );
        expect(recover).not.toHaveBeenCalled();
        expect(state.writes).toHaveLength(0);
        controller.reset();
        vi.unstubAllGlobals();
    });

    it('does not repeat a shipping write whose own acknowledgement read fails', async () => {
        const state = fixture({ shippingFailure: 'read' });
        await unknownCoupon(state);
        state.allowReads();
        await expect(state.api.prepareShipping(shippingInput)).rejects.toBeInstanceOf(Error);
        expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(1);
        state.controller.reset();
    });

    it('does not submit shipping if checkout is queued after the existing recovery', async () => {
        const state = fixture();
        await unknownCoupon(state);
        state.allowReads();
        const original = state.controller.recoverPending.bind(state.controller);
        vi.spyOn(state.controller, 'recoverPending').mockImplementation(async (...args) => {
            const recovered = await original(...args);
            void state.controller.execute({ preparePayment: true }).catch(() => undefined);
            return recovered;
        });
        await expect(state.api.prepareShipping(shippingInput)).rejects.toBeInstanceOf(
            CartCommandNotExecutedError,
        );
        expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(0);
        state.controller.reset();
    });

    it('drains an existing ordinary queue before sending the previously unqueued shipping operation', async () => {
        const state = fixture();
        await unknownCoupon(state);
        state.allowReads();
        const original = state.controller.recoverPending.bind(state.controller);
        vi.spyOn(state.controller, 'recoverPending').mockImplementation(async (...args) => {
            const recovered = await original(...args);
            void state.controller
                .execute({ changes: { lines: [{ lineId: 'line-a', quantity: 1 }] } })
                .catch(() => undefined);
            return recovered;
        });
        expect((await state.api.prepareShipping(shippingInput)).cart.revision).toBe(105);
        expect(
            state.writes.map(command =>
                'coupon' in command ? 'coupon' : 'changes' in command ? 'changes' : 'shipping',
            ),
        ).toEqual(['coupon', 'changes', 'shipping']);
        state.controller.reset();
    });

    it('keeps a shipping business rejection visible without resubmitting it', async () => {
        const state = fixture({ shippingFailure: 'reject' });
        await unknownCoupon(state);
        state.allowReads();
        await expect(state.api.prepareShipping(shippingInput)).rejects.toMatchObject({
            message: 'No delivery for this address',
        });
        expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(1);
        state.controller.reset();
    });

    it('bounds recovery waiting and the new shipping write with one twenty-second signal', async () => {
        vi.useFakeTimers();
        const state = fixture();
        await state.controller.read();
        const coupon = state.controller.execute({ coupon: { action: 'BEST' } }).catch(() => undefined);
        await vi.advanceTimersByTimeAsync(80);
        await coupon;
        state.allowReads();
        let completeRecovery!: () => void;
        state.delayRead(
            () =>
                new Promise(resolve => {
                    completeRecovery = () => resolve({ storefrontCart: state.cart() });
                }),
        );
        const shipping = state.api.prepareShipping(shippingInput).catch(error => error);
        await vi.advanceTimersByTimeAsync(19_900);
        state.delayRead(
            signal =>
                new Promise((_resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
                }),
        );
        completeRecovery();
        await vi.advanceTimersByTimeAsync(100);
        expect(await shipping).toMatchObject({ name: 'ShopApiTimeoutError', resultUnknown: false });
        expect(state.writes.filter(command => 'prepareShipping' in command)).toHaveLength(1);
        state.controller.reset();
    });
});
