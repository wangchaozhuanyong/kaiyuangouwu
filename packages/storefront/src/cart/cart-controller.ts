import type { StorefrontCart } from '../types';

import { ShopApiError } from '../api/helpers';

import {
    cartCheckoutIntent,
    cartReceiptMatchesRead,
    cartView,
    hydrateCartReceipt,
    mergeChanges,
    type CartCheckoutIntent,
    type CartCommand,
    type CartCommandResult,
    type CartOperation,
    type CartRecoveryResult,
    type CartTerminalReceipt,
} from './cart-intents';
import {
    CART_COMMAND_TIMEOUT_MS,
    CartCommandAcknowledgedReadError,
    CartCommandDeadline,
    CartCommandNotExecutedError,
    CartRepository,
    CartScopeChangedError,
    cartAbortError,
    waitForCartSignal,
    type CartCommandContext,
} from './cart-repository';

type Phase = 'idle' | 'queued' | 'saving' | 'recovering' | 'unknown' | 'locked';
interface Pending {
    operation: CartOperation;
    recoveryOnly?: boolean;
    cancelRequested?: boolean;
    command?: CartCommand;
    acknowledged?: boolean;
    terminalReceipt?: CartTerminalReceipt;
    checkoutIntent?: CartCheckoutIntent | null;
    workflowContext?: CartCommandContext;
    restoredRead?: StorefrontCart;
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
    commandAcknowledged: boolean;
    pendingCheckoutIntent: CartCheckoutIntent | null;
    lastRecovery: CartRecoveryResult | null;
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
    private restoring: {
        promise: Promise<void>;
        deadline: CartCommandDeadline;
        consumers: Set<symbol>;
    } | null = null;
    private recovering: Promise<boolean> | null = null;
    private activeWorkflow: CartCommandDeadline | null = null;
    private readonly deadlines = new Set<CartCommandDeadline>();
    private lastRecovery: CartRecoveryResult | null = null;
    constructor(private readonly scope?: string) {}

    private remember(commandId: string | null): void {
        if (!this.scope) return;
        try {
            const key = `storefront:cart-recovery:${this.scope}`;
            if (commandId) {
                const pending = this.queue.find(item => item.command?.commandId === commandId);
                sessionStorage.setItem(
                    key,
                    JSON.stringify({
                        commandId,
                        cartId: this.repository.snapshot?.id,
                        checkoutIntent: pending?.checkoutIntent ?? null,
                        terminalReceipt: pending?.terminalReceipt ?? null,
                    }),
                );
            } else sessionStorage.removeItem(key);
        } catch {
            /* Storage may be unavailable; the in-memory receipt identity remains usable. */
        }
    }

    private restore(context?: CartCommandContext): Promise<void> {
        context?.signal.throwIfAborted();
        if (!this.restoring) {
            if (this.restored || !this.scope) return Promise.resolve();
            // Recovery retains the first caller's remaining budget, while each caller
            // owns only its wait. Leaving a route must not cancel another live owner.
            const deadline = new CartCommandDeadline(
                context ? Math.max(0, context.deadlineAt - Date.now()) : CART_COMMAND_TIMEOUT_MS,
            );
            this.deadlines.add(deadline);
            const promise = this.restoreStored(deadline.context).finally(() => {
                deadline.dispose();
                this.deadlines.delete(deadline);
                if (this.restoring?.promise === promise) this.restoring = null;
            });
            this.restoring = { promise, deadline, consumers: new Set() };
        }
        const restoring = this.restoring;
        const owner = Symbol('cart-restore-owner');
        restoring.consumers.add(owner);
        return waitForCartSignal(restoring.promise, context?.signal).finally(() => {
            restoring.consumers.delete(owner);
            if (!restoring.consumers.size && this.restoring === restoring) restoring.deadline.abort();
        });
    }

    private async restoreStored(context?: CartCommandContext): Promise<void> {
        if (this.restored || !this.scope) return;
        this.restored = true;
        let stored: {
            commandId: string;
            cartId: string;
            checkoutIntent?: unknown;
            terminalReceipt?: unknown;
        } | null = null;
        try {
            stored = JSON.parse(sessionStorage.getItem(`storefront:cart-recovery:${this.scope}`) ?? 'null');
        } catch {
            return;
        }
        if (
            !stored ||
            typeof stored.commandId !== 'string' ||
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
            checkoutIntent: checkoutIntentValue(stored.checkoutIntent),
            terminalReceipt: restoreReceipt(stored.terminalReceipt, stored.commandId, stored.cartId),
            restoredRead: this.repository.snapshot,
            command: {
                commandId: stored.commandId,
                cartId: stored.cartId,
                expectedRevision: this.repository.snapshot.revision,
                changes: {},
            },
        };
        pending.acknowledged = !!pending.terminalReceipt;
        for (const item of this.queue)
            for (const waiter of item.waiters)
                waiter.reject(new Error('上次操作正在核对，请稍后再修改购物车。'));
        this.queue = [pending];
        this.phase = 'unknown';
        await this.recoverPending(false, context);
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
        commandAcknowledged: false,
        pendingCheckoutIntent: null,
        lastRecovery: null,
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
        for (const deadline of this.deadlines) deadline.abort();
        this.deadlines.clear();
        this.activeWorkflow = null;
        this.lastRecovery = null;
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

    async read(signal?: AbortSignal): Promise<StorefrontCart> {
        const deadline = new CartCommandDeadline(
            CART_COMMAND_TIMEOUT_MS,
            signal ?? this.activeWorkflow?.context.signal,
            false,
        );
        this.deadlines.add(deadline);
        try {
            return await this.readWithinDeadline(deadline.context);
        } finally {
            deadline.dispose();
            this.deadlines.delete(deadline);
        }
    }

    private async readWithinDeadline(context: CartCommandContext): Promise<StorefrontCart> {
        const signal = context.signal;
        signal?.throwIfAborted();
        if (this.queue.length && this.phase !== 'unknown' && this.phase !== 'recovering') {
            await waitForCartSignal(this.drain(), signal);
        }
        const epoch = this.epoch;
        let cart: StorefrontCart;
        try {
            cart = await this.repository.read(signal);
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
        await waitForCartSignal(this.restore(context), signal);
        if (epoch !== this.epoch) throw new Error('Cart session changed.');
        if (!this.queue.length && this.phase !== 'unknown') this.error = null;
        this.publish();
        return this.repository.snapshot ?? cart;
    }

    execute(operation: CartOperation): Promise<CartCommandResult> {
        if (this.activeWorkflow?.context.signal.aborted)
            return Promise.reject(cartAbortError(this.activeWorkflow.context.signal));
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
            } else
                this.queue.push({
                    operation,
                    checkoutIntent: cartCheckoutIntent(operation),
                    workflowContext: this.activeWorkflow?.context,
                    waiters: [{ resolve, reject }],
                });
        });
        this.lastRecovery = null;
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

    async runWithinDeadline<T>(
        operation: (signal: AbortSignal) => Promise<T>,
        timeoutMs = CART_COMMAND_TIMEOUT_MS,
    ): Promise<T> {
        if (this.activeWorkflow)
            return waitForCartSignal(
                operation(this.activeWorkflow.context.signal),
                this.activeWorkflow.context.signal,
            );
        const deadline = new CartCommandDeadline(timeoutMs);
        this.activeWorkflow = deadline;
        this.deadlines.add(deadline);
        try {
            return await waitForCartSignal(operation(deadline.context.signal), deadline.context.signal);
        } finally {
            deadline.dispose();
            this.deadlines.delete(deadline);
            if (this.activeWorkflow === deadline) this.activeWorkflow = null;
        }
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

    recoverPending(cancel = false, context?: CartCommandContext): Promise<boolean> {
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
                  ? Promise.resolve().then(() => this.recoverUnknown(pending, epoch, context))
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

    private async recoverUnknown(
        pending: Pending,
        epoch: number,
        inheritedContext?: CartCommandContext,
    ): Promise<boolean> {
        if (epoch !== this.epoch || this.queue[0] !== pending) return false;
        const owned = this.openDeadline(inheritedContext ?? this.activeWorkflow?.context);
        const deadline = owned.deadline;
        const context = this.commandContext(pending, epoch, owned.context);
        try {
            const result = await this.recoverResult(pending, epoch, context);
            if (epoch !== this.epoch) return false;
            this.finish(pending, result, true);
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
        } finally {
            if (deadline) {
                deadline.dispose();
                this.deadlines.delete(deadline);
            }
        }
    }

    private openDeadline(context?: CartCommandContext): {
        deadline: CartCommandDeadline | null;
        context: CartCommandContext;
    } {
        if (context) return { deadline: null, context };
        const deadline = new CartCommandDeadline();
        this.deadlines.add(deadline);
        return { deadline, context: deadline.context };
    }

    private commandContext(pending: Pending, epoch: number, context: CartCommandContext): CartCommandContext {
        return {
            ...context,
            acknowledge: receipt => {
                if (
                    epoch !== this.epoch ||
                    context.signal.aborted ||
                    this.queue[0] !== pending ||
                    pending.command?.commandId !== receipt.commandId ||
                    pending.command.cartId !== receipt.cart.id
                )
                    return;
                const terminal = restoreReceipt(receipt, pending.command.commandId, pending.command.cartId);
                if (!terminal) return;
                pending.acknowledged = true;
                pending.recoveryOnly = true;
                pending.terminalReceipt ??= terminal;
                this.remember(receipt.commandId);
                this.publish();
            },
        };
    }

    private preserveAcknowledgement(pending: Pending, error: unknown): void {
        if (
            error instanceof CartCommandAcknowledgedReadError &&
            error.commandId === pending.command?.commandId
        ) {
            pending.acknowledged = true;
            pending.recoveryOnly = true;
            if (error.receipt)
                pending.terminalReceipt ??= restoreReceipt(
                    error.receipt,
                    pending.command.commandId,
                    pending.command.cartId,
                );
            this.remember(pending.command.commandId);
        }
    }

    private async recoverResult(
        pending: Pending,
        epoch: number,
        context: CartCommandContext,
    ): Promise<CartCommandResult> {
        if (!pending.command) throw new Error('Cart acknowledgement is missing.');
        context.signal.throwIfAborted();
        if (pending.terminalReceipt) {
            const receipt = pending.terminalReceipt;
            try {
                const cart = pending.restoredRead ?? (await this.repository.read(context.signal));
                pending.restoredRead = undefined;
                context.signal.throwIfAborted();
                if (!cartReceiptMatchesRead(receipt, cart))
                    throw new Error('The cart read has not caught up with its confirmed receipt.');
                return hydrateCartReceipt(receipt, cart);
            } catch (error) {
                pending.restoredRead = undefined;
                if (error instanceof CartScopeChangedError) throw error;
                throw new CartCommandAcknowledgedReadError(
                    receipt.commandId,
                    'The cart command was acknowledged, but its current details could not be read.',
                    error,
                    receipt,
                );
            }
        }
        const cancelling = !!pending.cancelRequested;
        let result = await this.repository.recover(pending.command.commandId, cancelling, context);
        if (epoch !== this.epoch) return result;
        // A cancellation joining an in-flight lookup must establish its tombstone
        // before any original payload is allowed to be sent again.
        if (result.status === 'NOT_FOUND' && pending.cancelRequested && !cancelling) {
            result = await this.repository.recover(pending.command.commandId, true, context);
            if (epoch !== this.epoch) return result;
        }
        if (result.status === 'NOT_FOUND') {
            if (pending.cancelRequested || pending.recoveryOnly)
                throw new Error('尚未找到操作回执，请继续核对或取消待确认操作。');
            context.signal.throwIfAborted();
            result = await this.repository.apply(pending.command, context);
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
            const owned = this.openDeadline(pending.workflowContext);
            const deadline = owned.deadline;
            const context = this.commandContext(pending, epoch, owned.context);
            try {
                context.signal.throwIfAborted();
                const cart = this.repository.snapshot ?? (await this.repository.read(context.signal));
                if (epoch !== this.epoch) return;
                await waitForCartSignal(this.restore(context), context.signal);
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
                                ? await this.repository.apply(pending.command, context)
                                : await this.recoverResult(pending, epoch, context);
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
                        // A known outcome only needs a user-triggered read retry; never spend
                        // several more request timeouts pretending its execution is uncertain.
                        if (pending.acknowledged || context.signal.aborted) throw error;
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
                // Restoring a journal can replace this unsent operation. Its outcome
                // belongs to that restored owner and must never clear its journal.
                if (this.queue[0] !== pending) break;
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
            } finally {
                if (deadline) {
                    deadline.dispose();
                    this.deadlines.delete(deadline);
                }
            }
        }
        if (epoch !== this.epoch) return;
        this.running = false;
        if (this.phase !== 'unknown')
            this.phase = this.repository.snapshot?.state === 'PAYMENT_PENDING' ? 'locked' : 'idle';
        this.publish();
    }

    private finish(pending: Pending, result: CartCommandResult, recovered = false): void {
        this.repository.accept(result.cart);
        if (recovered)
            this.lastRecovery = {
                commandId: result.commandId,
                status: result.status,
                checkoutIntent: pending.checkoutIntent ?? null,
                result,
            };
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
            commandAcknowledged: !!this.queue[0]?.acknowledged,
            pendingCheckoutIntent: this.queue[0]?.checkoutIntent ?? null,
            lastRecovery: this.lastRecovery,
        };
        for (const listener of this.listeners) listener();
    }
}
function message(error: unknown): Error {
    return error instanceof Error ? error : new Error('购物车暂时无法更新。');
}

function checkoutIntentValue(value: unknown): CartCheckoutIntent | null {
    return value === 'beginCheckout' || value === 'buyNow' || value === 'preparePayment' ? value : null;
}

function restoreReceipt(value: unknown, commandId: string, cartId: string): CartTerminalReceipt | undefined {
    if (!value || typeof value !== 'object') return;
    const receipt = value as Partial<CartTerminalReceipt>;
    const status = receipt.status;
    const appliedRevision = receipt.appliedRevision;
    if (
        receipt.commandId !== commandId ||
        (status !== 'APPLIED' && status !== 'REJECTED' && status !== 'CANCELLED') ||
        receipt.cart?.id !== cartId ||
        !Number.isSafeInteger(receipt.cart.revision) ||
        receipt.cart.revision < 0 ||
        (appliedRevision !== null &&
            (typeof appliedRevision !== 'number' ||
                !Number.isSafeInteger(appliedRevision) ||
                appliedRevision < 0)) ||
        (status === 'APPLIED' && appliedRevision == null) ||
        (receipt.errorCode != null && typeof receipt.errorCode !== 'string')
    )
        return;
    let session: CartTerminalReceipt['session'] = null;
    if (receipt.session != null) {
        if (typeof receipt.session.orderId !== 'string' || !receipt.session.orderId) return;
        const checkout = receipt.session.checkout;
        if (
            checkout != null &&
            (typeof checkout.id !== 'string' ||
                !checkout.id ||
                !Number.isSafeInteger(checkout.cartRevision) ||
                checkout.cartRevision < 0 ||
                !['PREPARED', 'PLACED', 'ABANDONED'].includes(checkout.state) ||
                (checkout.completedAt != null && typeof checkout.completedAt !== 'string'))
        )
            return;
        session = {
            orderId: receipt.session.orderId,
            checkout: checkout
                ? {
                      id: checkout.id,
                      cartRevision: checkout.cartRevision,
                      state: checkout.state,
                      completedAt: checkout.completedAt,
                  }
                : null,
        };
    }
    return {
        commandId,
        status,
        cart: { id: cartId, revision: receipt.cart.revision },
        appliedRevision,
        errorCode: receipt.errorCode ?? null,
        session,
    };
}
