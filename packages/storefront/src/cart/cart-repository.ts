import type { StorefrontCart } from '../types';
import type { CartCommand, CartCommandResult, CartTerminalReceipt } from './cart-intents';

import { ShopApiTimeoutError } from '../api/helpers';

export const CART_COMMAND_TIMEOUT_MS = 20_000;

export interface CartCommandContext {
    signal: AbortSignal;
    deadlineAt: number;
    acknowledge?: (receipt: CartTerminalReceipt) => void;
}

export function cartAbortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

/** A caller can stop waiting without cancelling a read owned by another caller. */
export function waitForCartSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
        void promise.catch(() => undefined);
        return Promise.reject(cartAbortError(signal));
    }
    return new Promise<T>((resolve, reject) => {
        const aborted = () => reject(cartAbortError(signal));
        signal.addEventListener('abort', aborted, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    });
}

export class CartCommandDeadline {
    readonly controller = new AbortController();
    readonly context: CartCommandContext;
    private readonly timer: ReturnType<typeof setTimeout>;
    private readonly releaseExternal: () => void;
    constructor(timeoutMs = CART_COMMAND_TIMEOUT_MS, external?: AbortSignal, resultUnknown = true) {
        this.context = { signal: this.controller.signal, deadlineAt: Date.now() + timeoutMs };
        this.timer = setTimeout(
            () =>
                this.controller.abort(
                    new ShopApiTimeoutError(
                        resultUnknown
                            ? '请求超时，提交结果暂时无法确认，请先核对后继续。'
                            : '请求超时，请检查网络后重试。',
                        resultUnknown,
                    ),
                ),
            timeoutMs,
        );
        const aborted = () => {
            if (external) this.controller.abort(cartAbortError(external));
        };
        external?.addEventListener('abort', aborted, { once: true });
        if (external?.aborted) aborted();
        this.releaseExternal = () => external?.removeEventListener('abort', aborted);
    }
    dispose(): void {
        clearTimeout(this.timer);
        this.releaseExternal();
    }
    abort(): void {
        this.controller.abort(new Error('Cart session changed.'));
        this.dispose();
    }
}

export class CartScopeChangedError extends Error {
    constructor(readonly cart: StorefrontCart) {
        super('Cart session changed.');
    }
}

/** Only the first apply may prove that execution never started. */
export class CartCommandNotExecutedError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'CartCommandNotExecutedError';
        if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause });
    }
}

/** A terminal receipt is known; only its complete display data still needs reading. */
export class CartCommandAcknowledgedReadError extends Error {
    constructor(
        readonly commandId: string,
        message: string,
        cause?: unknown,
        readonly receipt?: CartTerminalReceipt,
    ) {
        super(message);
        this.name = 'CartCommandAcknowledgedReadError';
        if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause });
    }
}

export interface CartTransport {
    read(signal?: AbortSignal): Promise<StorefrontCart>;
    apply(command: CartCommand, context?: CartCommandContext): Promise<CartCommandResult>;
    recover(commandId: string, cancel: boolean, context?: CartCommandContext): Promise<CartCommandResult>;
}

interface SharedCartRead {
    controller: AbortController;
    consumers: Set<symbol>;
    promise: Promise<StorefrontCart>;
}

/** One admission boundary for command responses, focus/SSE refreshes and route queries. */
export class CartRepository {
    private generation = 0;
    private confirmed: StorefrontCart | null = null;
    private transport?: CartTransport;
    private reading: SharedCartRead | null = null;
    setTransport(transport: CartTransport): void {
        this.transport = transport;
    }
    get snapshot(): StorefrontCart | null {
        return this.confirmed;
    }
    reset(): void {
        this.generation++;
        this.reading?.controller.abort();
        this.confirmed = null;
        this.reading = null;
    }
    invalidateReads(): void {
        this.generation++;
        this.reading?.controller.abort();
        this.reading = null;
    }
    accept(cart: StorefrontCart): StorefrontCart {
        if (!this.confirmed || (this.confirmed.id === cart.id && cart.revision >= this.confirmed.revision))
            this.confirmed = cart;
        return this.confirmed;
    }
    read(signal?: AbortSignal): Promise<StorefrontCart> {
        if (signal?.aborted) return Promise.reject(cartAbortError(signal));
        const reading = this.reading ?? this.startRead();
        const owner = Symbol('cart-read-owner');
        reading.consumers.add(owner);
        return waitForCartSignal(reading.promise, signal).finally(() => {
            reading.consumers.delete(owner);
            if (!reading.consumers.size && this.reading === reading) {
                this.reading = null;
                reading.controller.abort();
            }
        });
    }
    private startRead(): SharedCartRead {
        const generation = this.generation;
        const controller = new AbortController();
        const promise = this.client
            .read(controller.signal)
            .then(cart => {
                controller.signal.throwIfAborted();
                if (generation === this.generation) {
                    if (this.confirmed && cart.id !== this.confirmed.id)
                        throw new CartScopeChangedError(cart);
                    return this.accept(cart);
                }
                if (this.confirmed) return this.confirmed;
                throw new Error('Cart session changed.');
            })
            .finally(() => {
                if (this.reading?.promise === promise) this.reading = null;
            });
        const reading: SharedCartRead = { controller, consumers: new Set(), promise };
        this.reading = reading;
        return reading;
    }
    apply(command: CartCommand, context?: CartCommandContext): Promise<CartCommandResult> {
        return waitForCartSignal(this.client.apply(command, context), context?.signal).then(result =>
            this.validate(result, command.commandId, false),
        );
    }
    recover(id: string, cancel = false, context?: CartCommandContext): Promise<CartCommandResult> {
        return waitForCartSignal(this.client.recover(id, cancel, context), context?.signal).then(result =>
            this.validate(result, id, true),
        );
    }
    private validate(result: CartCommandResult, commandId: string, recovery: boolean): CartCommandResult {
        if (result?.errorCode === 'CART_SCOPE_CHANGED' && result.cart)
            throw new CartScopeChangedError(result.cart);
        if (
            !result ||
            result.commandId !== commandId ||
            !['APPLIED', 'REJECTED', 'CANCELLED', 'NOT_FOUND'].includes(result.status) ||
            (!recovery && result.status === 'NOT_FOUND') ||
            !result.cart ||
            !Number.isSafeInteger(result.cart.revision) ||
            result.cart.revision < 0 ||
            !Array.isArray(result.cart.lines) ||
            (this.confirmed && result.cart.id !== this.confirmed.id)
        ) {
            throw new Error('The server did not return a valid acknowledgement for this cart.');
        }
        return result;
    }
    private get client(): CartTransport {
        if (!this.transport) throw new Error('Cart transport is not connected.');
        return this.transport;
    }
}
