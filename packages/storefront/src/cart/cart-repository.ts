import type { StorefrontCart } from '../types';
import type { CartCommand, CartCommandResult } from './cart-intents';

export class CartScopeChangedError extends Error {
    constructor(readonly cart: StorefrontCart) {
        super('Cart session changed.');
    }
}

export interface CartTransport {
    read(signal?: AbortSignal): Promise<StorefrontCart>;
    apply(command: CartCommand): Promise<CartCommandResult>;
    recover(commandId: string, cancel: boolean): Promise<CartCommandResult>;
}

/** One admission boundary for command responses, focus/SSE refreshes and route queries. */
export class CartRepository {
    private generation = 0;
    private confirmed: StorefrontCart | null = null;
    private transport?: CartTransport;
    private reading: Promise<StorefrontCart> | null = null;
    setTransport(transport: CartTransport): void {
        this.transport = transport;
    }
    get snapshot(): StorefrontCart | null {
        return this.confirmed;
    }
    reset(): void {
        this.generation++;
        this.confirmed = null;
        this.reading = null;
    }
    invalidateReads(): void {
        this.generation++;
        this.reading = null;
    }
    accept(cart: StorefrontCart): StorefrontCart {
        if (!this.confirmed || (this.confirmed.id === cart.id && cart.revision >= this.confirmed.revision))
            this.confirmed = cart;
        return this.confirmed;
    }
    read(): Promise<StorefrontCart> {
        if (this.reading) return this.reading;
        const generation = this.generation;
        const pending = this.client
            .read()
            .then(cart => {
                if (generation === this.generation) {
                    if (this.confirmed && cart.id !== this.confirmed.id)
                        throw new CartScopeChangedError(cart);
                    return this.accept(cart);
                }
                if (this.confirmed) return this.confirmed;
                throw new Error('Cart session changed.');
            })
            .finally(() => {
                if (this.reading === pending) this.reading = null;
            });
        this.reading = pending;
        return pending;
    }
    apply(command: CartCommand): Promise<CartCommandResult> {
        return this.client.apply(command).then(result => this.validate(result, command.commandId, false));
    }
    recover(id: string, cancel = false): Promise<CartCommandResult> {
        return this.client.recover(id, cancel).then(result => this.validate(result, id, true));
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
