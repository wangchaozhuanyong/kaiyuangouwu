import type { StorefrontCart } from '../types';

import { ShopApiError } from '../api/helpers';

import {
    cartView,
    mergeChanges,
    type CartCommand,
    type CartCommandResult,
    type CartOperation,
} from './cart-intents';
import {
    CartCommandAcknowledgedReadError,
    CartCommandNotExecutedError,
    CartRepository,
    CartScopeChangedError,
} from './cart-repository';

type Phase = 'idle' | 'queued' | 'saving' | 'recovering' | 'unknown' | 'locked';
interface Pending {
    operation: CartOperation;
    recoveryOnly?: boolean;
    cancelRequested?: boolean;
    command?: CartCommand;
    waiters: Array<{ resolve(value: CartCommandResult): void; reject(error: Error): void }>;
}
export interface CartState {
    confirmed: StorefrontCart | null;
    cart: StorefrontCart | null;
    phase: Phase;
    pending: boolean;
    totalsPending: boolean;
    checkoutReady: boolean;
    editingBlocked: boolean;
    error: Error | null;
}

/** Owns every first-party cart/order write. Payment charging deliberately has no entry here. */
export class CartController {
    readonly repository = new CartRepository();
    private readonly listeners = new Set<() => void>();
    private queue: Pending[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;
    private running = false;
    private epoch = 0;
    private restored = false;
    private restoring: Promise<void> | null = null;
    private recovering: Promise<boolean> | null = null;
    constructor(private readonly scope?: string) {}

    private remember(commandId: string | null): void {
        if (!this.scope) return;
        try {
            const key = `storefront:cart-recovery:${this.scope}`;
            if (commandId)
                sessionStorage.setItem(
                    key,
                    JSON.stringify({ commandId, cartId: this.repository.snapshot?.id }),
                );
            else sessionStorage.removeItem(key);
        } catch {
            /* Storage may be unavailable; the in-memory receipt identity remains usable. */
        }
    }

    private restore(): Promise<void> {
        if (this.restoring) return this.restoring;
        const pending = this.restoreStored().finally(() => {
            if (this.restoring === pending) this.restoring = null;
        });
        this.restoring = pending;
        return pending;
    }

    private async restoreStored(): Promise<void> {
        if (this.restored || !this.scope) return;
        this.restored = true;
        let stored: { commandId: string; cartId: string } | null = null;
        try {
            stored = JSON.parse(sessionStorage.getItem(`storefront:cart-recovery:${this.scope}`) ?? 'null');
        } catch {
            return;
        }
        if (
            !stored ||
            stored.cartId !== this.repository.snapshot?.id ||
            !/^[a-zA-Z0-9_-]{16,80}$/.test(stored.commandId)
        ) {
            this.remember(null);
            return;
        }
        const pending: Pending = {
            operation: { changes: {} },
            recoveryOnly: true,
            waiters: [],
            command: {
                commandId: stored.commandId,
                cartId: stored.cartId,
                expectedRevision: this.repository.snapshot.revision,
                changes: {},
            },
        };
        for (const item of this.queue)
            for (const waiter of item.waiters)
                waiter.reject(new Error('上次操作正在核对，请稍后再修改购物车。'));
        this.queue = [pending];
        this.phase = 'unknown';
        await this.recoverPending();
    }
    private error: Error | null = null;
    private phase: Phase = 'idle';
    private state: CartState = {
        confirmed: null,
        cart: null,
        phase: 'idle',
        pending: false,
        totalsPending: false,
        checkoutReady: false,
        editingBlocked: false,
        error: null,
    };
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };
    getSnapshot = (): CartState => this.state;

    reset(clearRecovery = true): void {
        if (clearRecovery) this.remember(null);
        this.restored = false;
        this.restoring = null;
        this.recovering = null;
        this.epoch++;
        clearTimeout(this.timer);
        this.timer = undefined;
        for (const item of this.queue)
            for (const waiter of item.waiters) waiter.reject(new Error('Cart session changed.'));
        this.queue = [];
        this.running = false;
        this.phase = 'idle';
        this.error = null;
        this.repository.reset();
        this.publish();
    }

    async read(): Promise<StorefrontCart> {
        if (this.queue.length && this.phase !== 'unknown' && this.phase !== 'recovering') {
            await this.drain();
        }
        const epoch = this.epoch;
        let cart: StorefrontCart;
        try {
            cart = await this.repository.read();
        } catch (error) {
            if (epoch !== this.epoch) throw new Error('Cart session changed.');
            if (error instanceof CartScopeChangedError) {
                this.reset();
                this.repository.accept(error.cart);
                this.publish();
                return error.cart;
            }
            throw error;
        }
        if (epoch !== this.epoch) throw new Error('Cart session changed.');
        await this.restore();
        if (epoch !== this.epoch) throw new Error('Cart session changed.');
        if (!this.queue.length && this.phase !== 'unknown') this.error = null;
        this.publish();
        return this.repository.snapshot ?? cart;
    }

    execute(operation: CartOperation): Promise<CartCommandResult> {
        if (this.phase === 'unknown' || this.queue[0]?.recoveryOnly)
            return Promise.reject(new Error('上次操作结果尚未确认，请先重试核对。'));
        if (this.state.editingBlocked && this.queue.length)
            return Promise.reject(new Error('正在切换币种或确认结算，请稍后再修改商品。'));
        const promise = new Promise<CartCommandResult>((resolve, reject) => {
            const tail = this.queue.at(-1);
            if (
                tail &&
                !tail.command &&
                'changes' in tail.operation &&
                'changes' in operation &&
                !tail.operation.changes.add?.length &&
                !operation.changes.add?.length
            ) {
                tail.operation = { changes: mergeChanges(tail.operation.changes, operation.changes) };
                tail.waiters.push({ resolve, reject });
            } else this.queue.push({ operation, waiters: [{ resolve, reject }] });
        });
        this.error = null;
        const flushImmediately = 'buyNow' in operation;
        if (flushImmediately && !this.running) {
            clearTimeout(this.timer);
            this.timer = undefined;
            this.phase = 'queued';
        } else if (!this.running && !this.timer) {
            this.phase = 'queued';
            this.timer = setTimeout(() => {
                this.timer = undefined;
                void this.flush();
            }, 80);
        }
        this.publish();
        if (flushImmediately && !this.running) void this.flush();
        return promise;
    }

    async drain(): Promise<void> {
        if (!this.queue.length) return;
        if (this.phase === 'unknown') throw new Error('购物车操作结果尚未确认。');
        clearTimeout(this.timer);
        this.timer = undefined;
        await new Promise<void>((resolve, reject) => {
            const complete = () => {
                if (this.phase === 'unknown' || !this.queue.length) {
                    unsubscribe();
                    if (this.error) reject(this.error);
                    else resolve();
                }
            };
            const unsubscribe = this.subscribe(complete);
            complete();
            void this.flush();
        });
    }

    recoverPending(cancel = false): Promise<boolean> {
        const pending = this.queue[0];
        if (cancel && pending) pending.cancelRequested = true;
        if (this.recovering) return this.recovering;
        if (!pending) return Promise.resolve(true);
        const epoch = this.epoch;
        const recoverUnknown = this.phase === 'unknown' && !!pending.command;
        const recovery =
            this.running && this.phase !== 'unknown'
                ? this.drain().then(
                      () => epoch === this.epoch && !this.queue.length,
                      () => epoch === this.epoch && !this.queue.length,
                  )
                : recoverUnknown
                  ? Promise.resolve().then(() => this.recoverUnknown(pending, epoch))
                  : Promise.resolve(false);
        const tracked = recovery.finally(() => {
            if (this.recovering === tracked) this.recovering = null;
        });
        this.recovering = tracked;
        if (recoverUnknown) {
            this.phase = 'recovering';
            this.publish();
        }
        return tracked;
    }

    private async recoverUnknown(pending: Pending, epoch: number): Promise<boolean> {
        if (epoch !== this.epoch || this.queue[0] !== pending) return false;
        try {
            const result = await this.recoverResult(pending, epoch);
            if (epoch !== this.epoch) return false;
            this.finish(pending, result);
            this.phase = this.repository.snapshot?.state === 'PAYMENT_PENDING' ? 'locked' : 'idle';
            this.publish();
            void this.flush();
            return true;
        } catch (error) {
            if (epoch !== this.epoch) return false;
            if (error instanceof CartScopeChangedError) {
                this.reset();
                this.repository.accept(error.cart);
                this.publish();
                return false;
            }
            this.preserveAcknowledgement(pending, error);
            this.phase = 'unknown';
            this.error = message(error);
            this.publish();
            return false;
        }
    }

    private preserveAcknowledgement(pending: Pending, error: unknown): void {
        if (
            error instanceof CartCommandAcknowledgedReadError &&
            error.commandId === pending.command?.commandId
        )
            pending.recoveryOnly = true;
    }

    private async recoverResult(pending: Pending, epoch: number): Promise<CartCommandResult> {
        if (!pending.command) throw new Error('Cart acknowledgement is missing.');
        const cancelling = !!pending.cancelRequested;
        let result = await this.repository.recover(pending.command.commandId, cancelling);
        if (epoch !== this.epoch) return result;
        // A cancellation joining an in-flight lookup must establish its tombstone
        // before any original payload is allowed to be sent again.
        if (result.status === 'NOT_FOUND' && pending.cancelRequested && !cancelling) {
            result = await this.repository.recover(pending.command.commandId, true);
            if (epoch !== this.epoch) return result;
        }
        if (result.status === 'NOT_FOUND') {
            if (pending.cancelRequested || pending.recoveryOnly)
                throw new Error('尚未找到操作回执，请继续核对或取消待确认操作。');
            result = await this.repository.apply(pending.command);
        }
        return result;
    }

    private async flush(): Promise<void> {
        if (
            this.running ||
            this.phase === 'unknown' ||
            this.phase === 'recovering' ||
            this.queue[0]?.recoveryOnly ||
            !this.queue.length
        )
            return;
        this.running = true;
        const epoch = this.epoch;
        while (this.queue.length && epoch === this.epoch) {
            const pending = this.queue[0];
            let notExecuted = false;
            try {
                const cart = this.repository.snapshot ?? (await this.repository.read());
                if (epoch !== this.epoch) return;
                await this.restore();
                if (epoch !== this.epoch) return;
                if (this.queue[0] !== pending) {
                    if (this.getSnapshot().phase === 'unknown') break;
                    continue;
                }
                this.repository.invalidateReads();
                pending.command ??= {
                    ...pending.operation,
                    commandId: crypto.randomUUID(),
                    cartId: cart.id,
                    expectedRevision: cart.revision,
                };
                this.remember(pending.command.commandId);
                this.phase = 'saving';
                this.publish();
                let result: CartCommandResult | undefined;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        result =
                            attempt === 0
                                ? await this.repository.apply(pending.command)
                                : await this.recoverResult(pending, epoch);
                        if (epoch !== this.epoch) return;
                        break;
                    } catch (error) {
                        if (epoch !== this.epoch) return;
                        if (error instanceof CartScopeChangedError) throw error;
                        if (attempt === 0 && error instanceof CartCommandNotExecutedError) {
                            notExecuted = true;
                            throw error;
                        }
                        this.preserveAcknowledgement(pending, error);
                        this.phase = 'recovering';
                        this.publish();
                        if (attempt === 2) throw error;
                    }
                }
                if (epoch !== this.epoch) return;
                if (!result) throw new Error('Cart acknowledgement is missing.');
                this.finish(pending, result);
            } catch (error) {
                if (epoch !== this.epoch) return;
                if (error instanceof CartScopeChangedError) {
                    this.reset();
                    this.repository.accept(error.cart);
                    this.publish();
                    return;
                }
                const unresolved = !!pending.command && !notExecuted;
                this.error =
                    unresolved && !(error instanceof CartCommandAcknowledgedReadError)
                        ? new ShopApiError('UNKNOWN_RESULT', '保存结果尚未确认，请重试核对后再结算。')
                        : message(error);
                if (unresolved) {
                    if (this.error !== error)
                        Object.defineProperty(this.error, 'cause', {
                            value: error,
                        });
                    this.phase = 'unknown';
                } else {
                    this.remember(null);
                    this.queue.shift();
                    this.phase = 'idle';
                }
                for (const waiter of pending.waiters) waiter.reject(this.error);
                pending.waiters = [];
                // Later operations must not pass a failed or uncertain prerequisite.
                for (const later of this.queue.slice(unresolved ? 1 : 0))
                    for (const waiter of later.waiters) waiter.reject(this.error);
                this.queue = unresolved ? [pending] : [];
                break;
            }
        }
        if (epoch !== this.epoch) return;
        this.running = false;
        if (this.phase !== 'unknown')
            this.phase = this.repository.snapshot?.state === 'PAYMENT_PENDING' ? 'locked' : 'idle';
        this.publish();
    }

    private finish(pending: Pending, result: CartCommandResult): void {
        this.repository.accept(result.cart);
        this.remember(null);
        this.queue.shift();
        if (result.status !== 'APPLIED') {
            const error = new ShopApiError(
                result.errorCode ?? 'CART_COMMAND_CANCELLED',
                result.message ?? '购物车更新未生效，请检查后重试。',
            );
            Object.assign(error, {
                selectionRejected:
                    'changes' in pending.operation &&
                    pending.operation.changes.lines?.some(line => line.selected != null),
            });
            this.error = error;
            for (const waiter of pending.waiters) waiter.reject(error);
            // A queued checkout must never continue after a rejected edit.
            for (const later of this.queue) for (const waiter of later.waiters) waiter.reject(error);
            this.queue = [];
        } else {
            this.error = null;
            for (const waiter of pending.waiters) waiter.resolve(result);
        }
        this.publish();
    }

    private publish(): void {
        const confirmed = this.repository.snapshot;
        const pending = this.queue.length > 0;
        const uncertain = this.phase === 'unknown' || this.phase === 'recovering';
        const totalsPending =
            !uncertain &&
            this.queue.some(item => {
                const operation = item.operation;
                if ('changes' in operation || 'coupon' in operation || 'buyNow' in operation) return true;
                if ('prepareShipping' in operation) return true;
                return (
                    'order' in operation &&
                    ('currencyCode' in operation.order || 'shippingMethodId' in operation.order)
                );
            });
        this.state = {
            confirmed,
            cart: uncertain
                ? confirmed
                : cartView(
                      confirmed,
                      this.queue.map(item => item.operation),
                  ),
            phase: this.phase,
            pending,
            totalsPending,
            editingBlocked:
                this.phase === 'unknown' ||
                this.phase === 'recovering' ||
                !!this.queue[0]?.recoveryOnly ||
                confirmed?.state === 'PAYMENT_PENDING' ||
                this.queue.some(
                    item =>
                        ('order' in item.operation && 'currencyCode' in item.operation.order) ||
                        'beginCheckout' in item.operation ||
                        'preparePayment' in item.operation ||
                        'buyNow' in item.operation,
                ),
            checkoutReady: !!confirmed?.selectedQuantity && confirmed.state === 'OPEN' && !pending,
            error: this.error,
        };
        for (const listener of this.listeners) listener();
    }
}
function message(error: unknown): Error {
    return error instanceof Error ? error : new Error('购物车暂时无法更新。');
}
