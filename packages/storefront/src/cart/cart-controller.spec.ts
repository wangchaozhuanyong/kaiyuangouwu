/* eslint-disable @typescript-eslint/require-await -- Transport mocks deliberately preserve the asynchronous API contract. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontCart } from '../types';

import { CartController } from './cart-controller';
import { cartView, type CartCommand, type CartCommandResult } from './cart-intents';
import { CartCommandAcknowledgedReadError, CartCommandNotExecutedError } from './cart-repository';

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
async function setup(scope?: string) {
    const controller = new CartController(scope);
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
function recoveryStorage() {
    const stored = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
    });
    return stored;
}
async function unknownCart(scope?: string) {
    const state = await setup(scope);
    state.apply.mockRejectedValueOnce(new Error('Response lost'));
    state.recover.mockRejectedValue(new Error('Recovery unavailable'));
    const submitted = state.controller
        .execute({ changes: { lines: [{ lineId: '1', quantity: 4 }] } })
        .catch(error => error);
    await vi.advanceTimersByTimeAsync(80);
    await submitted;
    return state;
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
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(caughtError => caughtError);
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
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(caughtError => caughtError);
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
            .catch(caughtError => caughtError);
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

    it('sends Buy now immediately instead of waiting for the edit batching window', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        const started = deferred<void>();
        apply.mockImplementationOnce(async command => {
            started.resolve();
            return result(command, snapshot());
        });

        const pending = controller.execute({
            buyNow: { productVariantId: '1', quantity: 1 },
        });

        await started.promise;
        expect(vi.getTimerCount()).toBe(0);
        expect(apply).toHaveBeenCalledTimes(1);
        await pending;
    });

    it('flushes a queued edit before an immediate Buy now command without losing command order', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();

        const edit = controller.execute({ changes: { lines: [{ lineId: '1', quantity: 3 }] } });
        const buyNow = controller.execute({ buyNow: { productVariantId: '1', quantity: 1 } });

        await Promise.all([edit, buyNow]);
        expect(apply).toHaveBeenCalledTimes(2);
        expect(apply.mock.calls[0][0]).toMatchObject({
            expectedRevision: 0,
            changes: { lines: [{ lineId: '1', quantity: 3 }] },
        });
        expect(apply.mock.calls[1][0]).toMatchObject({
            expectedRevision: 1,
            buyNow: { productVariantId: '1', quantity: 1 },
        });
        expect(vi.getTimerCount()).toBe(0);
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
            .catch(caughtError => caughtError);
        const checkout = controller.execute({ beginCheckout: true }).catch(caughtError => caughtError);
        await vi.advanceTimersByTimeAsync(80);
        expect(await edit).toBeInstanceOf(Error);
        expect(await checkout).toBeInstanceOf(Error);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().cart?.lines[0].quantity).toBe(1);
    });

    it('keeps confirmed totals visible while a checkout command is pending', async () => {
        vi.useFakeTimers();
        const { controller } = await setup();
        const checkout = controller.execute({ beginCheckout: true });
        expect(controller.getSnapshot()).toMatchObject({
            pending: true,
            totalsPending: false,
            editingBlocked: true,
        });
        await vi.advanceTimersByTimeAsync(80);
        await checkout;
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
        const recoveryError = new Error('Offline');
        recover.mockRejectedValue(recoveryError);
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(caughtError => caughtError);
        await vi.advanceTimersByTimeAsync(80);
        const error = await pending;
        expect(error).toMatchObject({
            errorCode: 'UNKNOWN_RESULT',
            message: '保存结果尚未确认，请重试核对后再结算。',
        });
        expect(error.cause).toBe(recoveryError);
        expect(Object.keys(error)).not.toContain('cause');
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

    it('keeps cancellation unknown when its receipt is missing without resending the write', async () => {
        vi.useFakeTimers();
        const { controller, apply, recover } = await setup();
        apply.mockRejectedValue(new Error('Response lost'));
        recover.mockRejectedValue(new Error('Recovery unavailable'));
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(caughtError => caughtError);
        await vi.advanceTimersByTimeAsync(80);
        await pending;
        const command = apply.mock.calls[0][0];
        recover.mockResolvedValue({
            ...result(command, snapshot()),
            status: 'NOT_FOUND',
            appliedRevision: null,
            cart: snapshot(),
        });

        await controller.recoverPending(true);

        expect(recover).toHaveBeenLastCalledWith(command.commandId, true);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot()).toMatchObject({
            phase: 'unknown',
            pending: true,
            editingBlocked: true,
            checkoutReady: false,
            confirmed: { revision: 0 },
        });
        expect(controller.getSnapshot().error?.message).toBe(
            '尚未找到操作回执，请继续核对或取消待确认操作。',
        );
        await expect(controller.execute({ beginCheckout: true })).rejects.toThrow();
    });

    it('reports unresolved recovery and reads newer confirmed data without losing its pending identity', async () => {
        vi.useFakeTimers();
        const stored = recoveryStorage();
        const { controller, apply, read, recover } = await unknownCart('qa');
        const identity = stored.get('storefront:cart-recovery:qa');

        expect(await controller.recoverPending()).toBe(false);
        const recoveryError = controller.getSnapshot().error;
        const latest = snapshot(8);
        latest.lines[0].quantity = 2;
        read.mockResolvedValueOnce(latest);

        expect(await controller.read()).toBe(latest);
        expect(read).toHaveBeenCalledTimes(2);
        expect(stored.get('storefront:cart-recovery:qa')).toBe(identity);
        expect(controller.getSnapshot()).toMatchObject({
            phase: 'unknown',
            pending: true,
            totalsPending: false,
            editingBlocked: true,
            checkoutReady: false,
            confirmed: { revision: 8 },
            cart: {
                revision: 8,
                lines: [
                    { id: '1', quantity: 2 },
                    { id: '2', quantity: 1 },
                ],
            },
        });
        expect(controller.getSnapshot().error).toBe(recoveryError);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(recover).toHaveBeenLastCalledWith(apply.mock.calls[0][0].commandId, false);
        await expect(controller.drain()).rejects.toThrow('购物车操作结果尚未确认');
    });

    it('shares a manual recovery request and lets drain finish after its acknowledgement', async () => {
        vi.useFakeTimers();
        const { controller, apply, recover } = await unknownCart();
        const late = deferred<CartCommandResult>();
        recover.mockImplementationOnce(() => late.promise);
        const calls = recover.mock.calls.length;
        const first = controller.recoverPending();
        const second = controller.recoverPending();
        expect(second).toBe(first);
        await Promise.resolve();
        const draining = controller.drain();
        expect(controller.getSnapshot()).toMatchObject({ phase: 'recovering', totalsPending: false });
        expect(recover).toHaveBeenCalledTimes(calls + 1);

        late.resolve(result(apply.mock.calls[0][0], snapshot()));

        expect(await first).toBe(true);
        expect(await second).toBe(true);
        await expect(draining).resolves.toBeUndefined();
        expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', pending: false });
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('rejects drain when an in-flight manual recovery remains unresolved', async () => {
        vi.useFakeTimers();
        const { controller, recover } = await unknownCart();
        const late = deferred<CartCommandResult>();
        recover.mockImplementationOnce(() => late.promise);
        const recovering = controller.recoverPending();
        await Promise.resolve();
        const draining = controller.drain().catch(error => error);
        late.reject(new Error('Still offline'));

        expect(await recovering).toBe(false);
        expect(await draining).toMatchObject({ message: 'Still offline' });
        expect(controller.getSnapshot()).toMatchObject({ phase: 'unknown', pending: true });
    });

    it('joins the automatic recovery already in flight without issuing a second lookup', async () => {
        vi.useFakeTimers();
        const { controller, apply, recover } = await setup();
        const late = deferred<CartCommandResult>();
        apply.mockRejectedValueOnce(new Error('Response lost'));
        recover.mockImplementationOnce(() => late.promise);
        const edit = controller.execute({ changes: { remove: ['1'] } });
        await vi.advanceTimersByTimeAsync(80);
        expect(controller.getSnapshot().phase).toBe('recovering');
        const first = controller.recoverPending();
        const second = controller.recoverPending();
        expect(first).toBe(second);
        expect(recover).toHaveBeenCalledTimes(1);
        late.resolve(result(apply.mock.calls[0][0], snapshot()));

        expect(await first).toBe(true);
        await edit;
        expect(apply).toHaveBeenCalledTimes(1);
        expect(recover).toHaveBeenCalledTimes(1);
    });

    it('reports resolved cancellation joining automatic recovery even though the original edit is rejected', async () => {
        vi.useFakeTimers();
        const { controller, apply, recover } = await setup();
        const late = deferred<CartCommandResult>();
        apply.mockRejectedValueOnce(new Error('Response lost'));
        recover.mockImplementationOnce(() => late.promise);
        const edit = controller.execute({ changes: { remove: ['1'] } }).catch(error => error);
        await vi.advanceTimersByTimeAsync(80);
        const command = apply.mock.calls[0][0];
        recover.mockResolvedValueOnce({
            ...result(command, snapshot()),
            status: 'CANCELLED',
            cart: snapshot(),
        });
        const cancellation = controller.recoverPending(true);
        late.resolve({ ...result(command, snapshot()), status: 'NOT_FOUND', cart: snapshot() });

        expect(await cancellation).toBe(true);
        expect(await edit).toMatchObject({ errorCode: 'CART_COMMAND_CANCELLED' });
        expect(recover).toHaveBeenLastCalledWith(command.commandId, true);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().pending).toBe(false);
    });

    it('ignores a late recovery after an unknown-state read detects a different authenticated cart', async () => {
        vi.useFakeTimers();
        const stored = recoveryStorage();
        const { controller, apply, read, recover } = await unknownCart('qa');
        const late = deferred<CartCommandResult>();
        recover.mockImplementationOnce(() => late.promise);
        const recovery = controller.recoverPending();
        await Promise.resolve();
        const otherCart = { ...snapshot(), id: 'cart-b' };
        read.mockResolvedValueOnce(otherCart);
        expect(await controller.read()).toBe(otherCart);
        late.resolve(result(apply.mock.calls[0][0], snapshot()));

        expect(await recovery).toBe(false);
        expect(controller.getSnapshot()).toMatchObject({
            phase: 'idle',
            pending: false,
            confirmed: { id: 'cart-b' },
        });
        expect(stored.size).toBe(0);
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('honours cancellation joining a missing-receipt lookup before replaying the original command', async () => {
        vi.useFakeTimers();
        const { controller, apply, recover } = await unknownCart();
        const command = apply.mock.calls[0][0];
        const late = deferred<CartCommandResult>();
        recover.mockImplementationOnce(() => late.promise);
        recover.mockResolvedValueOnce({
            ...result(command, snapshot()),
            status: 'CANCELLED',
            cart: snapshot(),
        });
        const lookup = controller.recoverPending();
        await Promise.resolve();
        const cancellation = controller.recoverPending(true);
        expect(cancellation).toBe(lookup);
        late.resolve({
            ...result(command, snapshot()),
            status: 'NOT_FOUND',
            appliedRevision: null,
            cart: snapshot(),
        });

        expect(await cancellation).toBe(true);
        expect(recover).toHaveBeenLastCalledWith(command.commandId, true);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', pending: false });
    });

    it('releases a first apply proven not executed and rejects dependent checkout without recovering or replaying', async () => {
        vi.useFakeTimers();
        const stored = recoveryStorage();
        const { controller, apply, recover } = await setup('qa');
        const cause = new Error('GraphQL validation failed before execution');
        const notExecutedError = new CartCommandNotExecutedError('Invalid command query', cause);
        apply.mockRejectedValueOnce(notExecutedError);
        const edit = controller.execute({ changes: { remove: ['1'] } }).catch(error => error);
        const checkout = controller.execute({ beginCheckout: true }).catch(error => error);
        const draining = controller.drain().catch(error => error);
        await vi.advanceTimersByTimeAsync(80);

        expect(await edit).toBe(notExecutedError);
        expect(await checkout).toBe(notExecutedError);
        expect(await draining).toBe(notExecutedError);
        expect(notExecutedError.cause).toBe(cause);
        expect(stored.size).toBe(0);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(recover).not.toHaveBeenCalled();
        expect(controller.getSnapshot()).toMatchObject({
            phase: 'idle',
            pending: false,
            editingBlocked: false,
            totalsPending: false,
            confirmed: { revision: 0 },
            cart: { lines: [{ id: '1' }, { id: '2' }] },
        });
        await controller.read();
        expect(controller.getSnapshot().error).toBeNull();
        await expect(
            controller.execute({ buyNow: { productVariantId: '1', quantity: 1 } }),
        ).resolves.toMatchObject({ status: 'APPLIED' });
    });

    it('does not unlock an uncertain write when only its recovery request is proven not executed', async () => {
        vi.useFakeTimers();
        const stored = recoveryStorage();
        const { controller, apply, recover } = await setup('qa');
        apply.mockRejectedValueOnce(new Error('Original response lost'));
        recover.mockRejectedValue(new CartCommandNotExecutedError('Recovery query validation failed'));
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(error => error);
        await vi.advanceTimersByTimeAsync(80);
        expect(await pending).toMatchObject({ errorCode: 'UNKNOWN_RESULT' });
        const identity = stored.get('storefront:cart-recovery:qa');

        expect(await controller.recoverPending()).toBe(false);
        expect(stored.get('storefront:cart-recovery:qa')).toBe(identity);
        expect(controller.getSnapshot()).toMatchObject({
            phase: 'unknown',
            pending: true,
            editingBlocked: true,
        });
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it.each(['APPLIED', 'REJECTED', 'CANCELLED'] as const)(
        'never replays an acknowledged %s write while its complete cart read is failing',
        async status => {
            vi.useFakeTimers();
            const { controller, apply, recover } = await setup();
            apply.mockImplementationOnce(async submittedCommand => {
                throw new CartCommandAcknowledgedReadError(
                    submittedCommand.commandId,
                    'Acknowledged, display read failed',
                    new Error('Read offline'),
                );
            });
            recover.mockImplementation(async id => ({
                ...result({ commandId: id, cartId: 'cart-a', expectedRevision: 0, changes: {} }, snapshot()),
                status: 'NOT_FOUND',
                appliedRevision: null,
                cart: snapshot(),
            }));
            const edit = controller.execute({ changes: { remove: ['1'] } }).catch(error => error);
            await vi.advanceTimersByTimeAsync(80);
            await edit;
            expect(controller.getSnapshot()).toMatchObject({
                phase: 'unknown',
                pending: true,
                editingBlocked: true,
            });
            expect(await controller.recoverPending()).toBe(false);
            expect(apply).toHaveBeenCalledTimes(1);

            const command = apply.mock.calls[0][0];
            recover.mockResolvedValueOnce({ ...result(command, snapshot()), status });
            expect(await controller.recoverPending()).toBe(true);
            expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', pending: false });
            expect(apply).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['automatic', 'manual'] as const)(
        'does not replay a late missing receipt after reset during %s recovery',
        async recoveryMode => {
            vi.useFakeTimers();
            const { controller, apply, recover } = await setup();
            const late = deferred<CartCommandResult>();
            apply.mockRejectedValueOnce(new Error('Response lost'));
            recover.mockRejectedValue(new Error('Recovery unavailable'));
            if (recoveryMode === 'automatic') recover.mockImplementationOnce(() => late.promise);
            const pending = controller
                .execute({ changes: { remove: ['1'] } })
                .catch(caughtError => caughtError);
            await vi.advanceTimersByTimeAsync(80);
            let recovery: Promise<boolean> | undefined;
            if (recoveryMode === 'manual') {
                await pending;
                recover.mockImplementationOnce(() => late.promise);
                recovery = controller.recoverPending();
            }
            expect(controller.getSnapshot().phase).toBe('recovering');
            const command = apply.mock.calls[0][0];

            controller.reset();
            late.resolve({
                ...result(command, snapshot()),
                status: 'NOT_FOUND',
                appliedRevision: null,
                cart: snapshot(),
            });
            await recovery;
            await vi.advanceTimersByTimeAsync(0);
            await pending;

            expect(apply).toHaveBeenCalledTimes(1);
            expect(controller.getSnapshot()).toMatchObject({
                phase: 'idle',
                confirmed: null,
                cart: null,
                pending: false,
                error: null,
            });
        },
    );

    it.each(['automatic', 'manual'] as const)(
        'keeps the original command identity when %s recovery confirms no receipt exists',
        async recoveryMode => {
            vi.useFakeTimers();
            const { controller, apply, recover } = await setup();
            apply.mockRejectedValueOnce(new Error('Request lost'));
            const missingReceipt = async (commandId: string) => ({
                ...result({ commandId, cartId: 'cart-a', expectedRevision: 0, changes: {} }, snapshot()),
                status: 'NOT_FOUND' as const,
                appliedRevision: null,
                cart: snapshot(),
            });
            if (recoveryMode === 'automatic') recover.mockImplementation(missingReceipt);
            else recover.mockRejectedValue(new Error('Recovery unavailable'));
            const pending = controller
                .execute({ changes: { remove: ['1'] } })
                .catch(caughtError => caughtError);
            await vi.advanceTimersByTimeAsync(80);
            await pending;
            if (recoveryMode === 'manual') {
                expect(controller.getSnapshot().phase).toBe('unknown');
                recover.mockImplementation(missingReceipt);
                await controller.recoverPending();
            }

            expect(apply).toHaveBeenCalledTimes(2);
            expect(apply.mock.calls[1][0]).toBe(apply.mock.calls[0][0]);
            expect(recover).toHaveBeenLastCalledWith(apply.mock.calls[0][0].commandId, false);
            expect(controller.getSnapshot()).toMatchObject({
                phase: 'idle',
                pending: false,
                confirmed: { revision: 1 },
                error: null,
            });
            expect(controller.getSnapshot().cart?.lines.map(line => line.id)).toEqual(['2']);
        },
    );

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
        const pending = controller.execute({ changes: { remove: ['1'] } }).catch(caughtError => caughtError);
        await vi.advanceTimersByTimeAsync(80);
        controller.reset();
        late.resolve(result(apply.mock.calls[0][0], snapshot()));
        await pending;
        expect(controller.getSnapshot().cart).toBeNull();
        expect(controller.getSnapshot().pending).toBe(false);
    });
});

describe('rejected selection recovery', () => {
    it('restores the confirmed selection, keeps the stock code, and clears rejection after a successful refresh', async () => {
        vi.useFakeTimers();
        const { controller, apply } = await setup();
        const before = controller.getSnapshot().cart;
        apply.mockImplementation(async command => ({
            commandId: command.commandId,
            status: 'REJECTED',
            appliedRevision: 0,
            errorCode: 'INSUFFICIENT_STOCK_ERROR',
            message: 'INSUFFICIENT_STOCK_ERROR',
            cart: snapshot(),
            session: null,
        }));
        const pending = controller
            .execute({ changes: { lines: [{ lineId: '1', selected: false }] } })
            .catch(caughtError => caughtError);
        expect(controller.getSnapshot().cart?.selectedQuantity).toBe(1);
        await vi.advanceTimersByTimeAsync(80);
        expect(await pending).toMatchObject({
            errorCode: 'INSUFFICIENT_STOCK_ERROR',
            selectionRejected: true,
        });
        expect(controller.getSnapshot().cart).toEqual(before);
        expect(controller.getSnapshot().pending).toBe(false);
        await controller.read();
        expect(controller.getSnapshot().error).toBeNull();
    });
});
