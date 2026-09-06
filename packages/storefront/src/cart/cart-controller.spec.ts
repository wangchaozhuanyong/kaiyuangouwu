/* eslint-disable @typescript-eslint/require-await -- Transport mocks deliberately preserve the asynchronous API contract. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontCart } from '../types';

import { CartController } from './cart-controller';
import { cartView, type CartCommand, type CartCommandResult } from './cart-intents';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function snapshot(revision = 0): StorefrontCart {
    return {
        id: 'cart-a',
        revision,
        projectedRevision: revision,
        state: 'OPEN',
        totalQuantity: 2,
        selectedQuantity: 2,
        selectedLineCount: 2,
        selectionState: 'ALL',
        checkoutOrder: null,
        lines: [1, 2].map(id => ({
            id: String(id),
            quantity: 1,
            selected: true,
            available: true,
            productVariant: { id: String(id) } as any,
        })),
    };
}
function result(command: CartCommand, cart: StorefrontCart): CartCommandResult {
    const updated = cartView(cart, [command]);
    if (!updated) throw new Error('Missing cart fixture');
    updated.revision = cart.revision + 1;
    updated.projectedRevision = updated.revision;
    return {
        commandId: command.commandId,
        status: 'APPLIED',
        appliedRevision: updated.revision,
        errorCode: null,
        message: null,
        cart: updated,
        session: null,
    };
}
async function setup() {
    const controller = new CartController();
    let cart = snapshot();
    const apply = vi.fn(async (command: CartCommand) => {
        const response = result(command, cart);
        cart = response.cart;
        return response;
    });
    const read = vi.fn(async () => cart);
    const recover = vi.fn();
    controller.repository.setTransport({ read, apply, recover });
    await controller.read();
    return { controller, apply, read, recover };
}
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('unified cart controller', () => {
    it('keeps a malformed write acknowledgement unknown instead of treating it as a failed edit', async () => {
        vi.useFakeTimers();
        const { controller, apply, recover } = await setup();
        apply.mockImplementation(async command => ({ ...result(command, snapshot()), status: 'NOT_FOUND' }));
        recover.mockRejectedValue(new Error('Recovery unavailable'));
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(error => error);
        await vi.advanceTimersByTimeAsync(80);
        expect(await pending).toBeInstanceOf(Error);
        expect(controller.getSnapshot()).toMatchObject({
            phase: 'unknown',
            checkoutReady: false,
            confirmed: { revision: 0 },
        });
    });

    it('binds each write to its cart and resets when the authenticated owner changes', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        apply.mockImplementationOnce(async command => ({
            ...result(command, snapshot()),
            status: 'REJECTED',
            errorCode: 'CART_SCOPE_CHANGED',
            cart: { ...snapshot(), id: 'cart-b' },
        }));
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(error => error);
        await vi.advanceTimersByTimeAsync(80);
        expect(await pending).toBeInstanceOf(Error);
        expect(apply.mock.calls[0][0].cartId).toBe('cart-a');
        expect(controller.getSnapshot()).toMatchObject({
            phase: 'idle',
            pending: false,
            confirmed: { id: 'cart-b' },
        });
    });

    it('recovers a persisted receipt before any pre-bootstrap edits and never resends an unknown payload', async () => {
        vi.useFakeTimers();
        const stored = new Map([
            [
                'storefront:cart-recovery:qa',
                JSON.stringify({ cartId: 'cart-a', commandId: 'persisted-command-1234' }),
            ],
        ]);
        vi.stubGlobal('sessionStorage', {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => stored.set(key, value),
            removeItem: (key: string) => stored.delete(key),
        });
        const controller = new CartController('qa');
        const loading = deferred<StorefrontCart>();
        const apply = vi.fn();
        const recover = vi.fn(async (id: string, cancel: boolean): Promise<CartCommandResult> => ({
            commandId: id,
            status: cancel ? 'CANCELLED' : 'NOT_FOUND',
            cart: snapshot(),
            appliedRevision: null,
            errorCode: null,
            message: null,
            session: null,
        }));
        controller.repository.setTransport({ read: () => loading.promise, apply, recover });
        const reading = controller.read();
        const editing = controller
            .execute({ changes: { lines: [{ lineId: '1', quantity: 8 }] } })
            .catch(error => error);
        await vi.advanceTimersByTimeAsync(80);
        loading.resolve(snapshot());
        await reading;
        expect(await editing).toBeInstanceOf(Error);
        expect(controller.getSnapshot()).toMatchObject({
            phase: 'unknown',
            pending: true,
            editingBlocked: true,
        });
        expect(apply).not.toHaveBeenCalled();
        await controller.recoverPending(true);
        expect(controller.getSnapshot().pending).toBe(false);
        expect(stored.size).toBe(0);
    });

    it('blocks edits behind currency changes and payment preparation', async () => {
        vi.useFakeTimers();
        const { controller } = await setup();
        const changing = controller.execute({ order: { currencyCode: 'USD' } });
        await expect(controller.execute({ changes: { remove: ['1'] } })).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(80);
        await changing;
        expect(controller.getSnapshot().editingBlocked).toBe(false);
    });

    it('shows selection and quantity immediately and coalesces 20 clicks into one final target', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        const pending = Array.from({ length: 20 }, (_, index) =>
            controller.execute({
                changes: { lines: [{ lineId: '1', selected: index % 2 === 0, quantity: index + 2 }] },
            }),
        );
        expect(controller.getSnapshot().cart?.lines[0]).toMatchObject({ selected: false, quantity: 21 });
        expect(controller.getSnapshot().confirmed?.lines[0].quantity).toBe(1);
        expect(apply).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(80);
        await Promise.all(pending);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().confirmed?.lines[0].quantity).toBe(21);
    });

    it('preserves a reversal during a slow request and permits only one in-flight write', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        const first = deferred<CartCommandResult>();
        apply.mockImplementationOnce(() => first.promise);
        const a = controller.execute({ changes: { lines: [{ lineId: '1', selected: false }] } });
        await vi.advanceTimersByTimeAsync(80);
        const b = controller.execute({ changes: { lines: [{ lineId: '1', selected: true }] } });
        expect(controller.getSnapshot().cart?.lines[0].selected).toBe(true);
        expect(apply).toHaveBeenCalledTimes(1);
        first.resolve(result(apply.mock.calls[0][0], snapshot()));
        await a;
        await b;
        expect(apply).toHaveBeenCalledTimes(2);
        expect(apply.mock.calls[1][0].expectedRevision).toBe(1);
        expect(controller.getSnapshot().cart?.lines[0].selected).toBe(true);
    });

    it('deletion supersedes unsent quantity and selection without mutating the confirmed snapshot', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        const a = controller.execute({ changes: { lines: [{ lineId: '1', quantity: 8 }] } });
        const b = controller.execute({ changes: { remove: ['1'] } });
        expect(controller.getSnapshot().cart?.lines).toHaveLength(1);
        expect(controller.getSnapshot().confirmed?.lines).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(80);
        await Promise.all([a, b]);
        expect(apply.mock.calls[0][0]).toMatchObject({ changes: { lines: [], remove: ['1'] } });
    });

    it('never lets a checkout pass a rejected edit', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        apply.mockImplementationOnce(async command => ({
            ...result(command, snapshot()),
            status: 'REJECTED',
            cart: snapshot(),
            errorCode: 'INSUFFICIENT_STOCK_ERROR',
            message: '库存不足',
        }));
        const edit = controller
            .execute({ changes: { lines: [{ lineId: '1', quantity: 9 }] } })
            .catch(error => error);
        const checkout = controller.execute({ beginCheckout: true }).catch(error => error);
        await vi.advanceTimersByTimeAsync(80);
        expect(await edit).toBeInstanceOf(Error);
        expect(await checkout).toBeInstanceOf(Error);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().cart?.lines[0].quantity).toBe(1);
    });

    it('recovers a committed response loss by its original id without repeating the write', async () => {
        vi.useFakeTimers();
        const { controller, apply, recover } = await setup();
        apply.mockRejectedValueOnce(new Error('Response lost'));
        recover.mockImplementation(async id =>
            result(
                {
                    commandId: id,
                    cartId: 'cart-a',
                    expectedRevision: 0,
                    changes: { lines: [{ lineId: '1', quantity: 4 }] },
                },
                snapshot(),
            ),
        );
        const pending = controller.execute({ changes: { lines: [{ lineId: '1', quantity: 4 }] } });
        await vi.advanceTimersByTimeAsync(80);
        await pending;
        expect(apply).toHaveBeenCalledTimes(1);
        expect(recover).toHaveBeenCalledWith(apply.mock.calls[0][0].commandId, false);
        expect(controller.getSnapshot().confirmed?.lines[0].quantity).toBe(4);
    });

    it('blocks later writes after bounded unsuccessful recovery and can explicitly recover again', async () => {
        vi.useFakeTimers();
        const { controller, apply, recover } = await setup();
        apply.mockRejectedValue(new Error('Offline'));
        recover.mockRejectedValue(new Error('Offline'));
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(error => error);
        await vi.advanceTimersByTimeAsync(80);
        await pending;
        expect(controller.getSnapshot().phase).toBe('unknown');
        expect(controller.getSnapshot().checkoutReady).toBe(false);
        await expect(controller.execute({ beginCheckout: true })).rejects.toThrow();
        recover.mockImplementation(async id => ({
            ...result({ commandId: id, cartId: 'cart-a', expectedRevision: 0, changes: {} }, snapshot()),
            status: 'CANCELLED',
            cart: snapshot(),
        }));
        await controller.recoverPending(true);
        expect(controller.getSnapshot().pending).toBe(false);
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('ignores a query started before a newer command even at the same visible revision', async () => {
        vi.useFakeTimers();
        const { controller, read } = await setup();
        const stale = deferred<StorefrontCart>();
        read.mockImplementationOnce(() => stale.promise);
        const reading = controller.read();
        const editing = controller.execute({ changes: { lines: [{ lineId: '1', quantity: 3 }] } });
        await vi.advanceTimersByTimeAsync(80);
        await editing;
        stale.resolve(snapshot());
        expect((await reading).lines[0].quantity).toBe(3);
    });

    it('keeps coupon and checkout operations as ordered barriers between edit batches', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        const operations = [
            controller.execute({ changes: { lines: [{ lineId: '1', quantity: 2 }] } }),
            controller.execute({ coupon: { action: 'REMOVE', couponId: 'coupon-a' } }),
            controller.execute({ changes: { lines: [{ lineId: '1', quantity: 3 }] } }),
        ];
        await vi.advanceTimersByTimeAsync(80);
        await Promise.all(operations);
        expect(apply.mock.calls.map(([command]) => command.expectedRevision)).toEqual([0, 1, 2]);
    });

    it('rejects old-session callers and ignores their late responses after reset', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        const late = deferred<CartCommandResult>();
        apply.mockImplementationOnce(() => late.promise);
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(error => error);
        await vi.advanceTimersByTimeAsync(80);
        controller.reset();
        late.resolve(result(apply.mock.calls[0][0], snapshot()));
        await pending;
        expect(controller.getSnapshot().cart).toBeNull();
        expect(controller.getSnapshot().pending).toBe(false);
    });
});
