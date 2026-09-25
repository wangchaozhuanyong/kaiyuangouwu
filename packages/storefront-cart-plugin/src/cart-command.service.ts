import { Injectable } from '@nestjs/common';
import {
    CreateAddressInput,
    CreateCustomerInput,
    CurrencyCode,
    ShippingMethodQuote,
} from '@vendure/common/lib/generated-types';
import {
    ConfigService,
    ID,
    isGraphQlErrorResult,
    OrderService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHash } from 'node:crypto';

import { CartCommandInput, CartCommandStatus } from './cart-command.types';
import { StorefrontCartCommandReceipt } from './entities/storefront-cart-command-receipt.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import { CartProjectionError } from './storefront-cart.errors';
import { StorefrontCartService, StorefrontCheckoutSession } from './storefront-cart.service';

interface CommandFailure {
    errorCode: string;
    message: string;
}
export interface CartCommandResult {
    commandId: string;
    status: CartCommandStatus;
    appliedRevision: number | null;
    errorCode: string | null;
    message: string | null;
    cart: StorefrontCart;
    session: StorefrontCheckoutSession | null;
    shippingMethods: ShippingMethodQuote[] | null;
    selectedShippingMethodId: ID | null;
}

interface ShippingPreparationOutcome {
    shippingMethods: ShippingMethodQuote[];
    selectedShippingMethodId: ID | null;
}
export type CartCommandHandler = (
    ctx: RequestContext,
    value: unknown,
    cart: StorefrontCart,
) => Promise<unknown>;

/** Canonicalization is shared by execute/retry, independent of JSON object property order. */
export function cartCommandDigest(value: unknown): string {
    const canonical = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(canonical);
        if (item && typeof item === 'object')
            return Object.fromEntries(
                Object.entries(item)
                    .filter(([, entry]) => entry != null)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, entry]) => [key, canonical(entry)]),
            );
        return item;
    };
    return createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex');
}

@Injectable()
export class CartCommandService {
    private readonly handlers = new Map<string, CartCommandHandler>();

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly carts: StorefrontCartService,
        private readonly orders: OrderService,
        private readonly config: ConfigService,
    ) {}

    register(name: string, handler: CartCommandHandler): void {
        if (this.handlers.has(name)) throw new Error(`Duplicate cart command handler: ${name}`);
        this.handlers.set(name, handler);
    }

    /** Locks always precede coupon/order locks. Compatible endpoints can share this boundary. */
    async coordinate<T>(ctx: RequestContext, work: (cart: StorefrontCart) => Promise<T>): Promise<T> {
        const cart = await this.carts.lockCart(ctx);
        return work(cart);
    }

    async runTransaction<T>(ctx: RequestContext, work: () => Promise<T>): Promise<T> {
        const type = this.connection.rawConnection.options.type;
        await this.connection.startTransaction(
            ctx,
            ['sqlite', 'better-sqlite3', 'sqljs'].includes(type) ? undefined : 'READ COMMITTED',
        );
        const result = await work();
        await this.connection.commitOpenTransaction(ctx);
        return result;
    }

    async legacy<T>(ctx: RequestContext, work: (orderCtx: RequestContext) => Promise<T>): Promise<T> {
        const type = this.connection.rawConnection.options.type;
        await this.connection.startTransaction(
            ctx,
            ['sqlite', 'better-sqlite3', 'sqljs'].includes(type) ? undefined : 'READ COMMITTED',
        );
        if (!(await this.carts.hasCart(ctx))) {
            const nativeResult = await work(ctx);
            await this.connection.commitOpenTransaction(ctx);
            return nativeResult;
        }
        const result = await this.coordinate(ctx, async cart => {
            if (cart.state !== 'OPEN') throw new UserInputError('Checkout is locked.');
            await this.carts.syncActiveOrderSession(ctx, cart);
            const value = await work(contextForCartOrder(ctx, cart));
            if (!isFailure(value)) await this.carts.acceptOrderChange(ctx, cart);
            return value;
        });
        await this.connection.commitOpenTransaction(ctx);
        return result;
    }

    async execute(ctx: RequestContext, input: CartCommandInput): Promise<CartCommandResult> {
        return this.coordinate(ctx, async cart => {
            this.validateCommandId(input.commandId);
            if (String(input.cartId) !== String(cart.id))
                return this.result(ctx, cart, input.commandId, 'REJECTED', null, 'CART_SCOPE_CHANGED');
            const digest = cartCommandDigest(input);
            const repository = this.connection.getRepository(ctx, StorefrontCartCommandReceipt);
            const receipt = await repository.findOne({
                where: { cartId: cart.id, commandId: input.commandId },
            });
            if (receipt) {
                if (receipt.digest && receipt.digest !== digest) {
                    return this.result(ctx, cart, input.commandId, 'REJECTED', null, 'COMMAND_ID_REUSED');
                }
                const replayedShippingPreparation =
                    receipt.status === 'APPLIED' && input.prepareShipping
                        ? await this.shippingPreparationSnapshot(contextForCartOrder(ctx, cart), cart)
                        : undefined;
                return this.result(
                    ctx,
                    cart,
                    input.commandId,
                    receipt.status,
                    receipt.appliedRevision,
                    receipt.errorCode,
                    undefined,
                    replayedShippingPreparation,
                );
            }
            const operations = Object.entries(input).filter(
                ([key, value]) =>
                    key !== 'commandId' && key !== 'expectedRevision' && key !== 'cartId' && value != null,
            );
            let error: CommandFailure | undefined;
            if (operations.length !== 1)
                error = { errorCode: 'INVALID_CART_COMMAND', message: 'Exactly one operation is required.' };
            else if (cart.revision !== input.expectedRevision)
                error = {
                    errorCode: 'CART_REVISION_CONFLICT_ERROR',
                    message: 'Cart changed in another session. Review the latest cart before retrying.',
                };
            else if (cart.state !== 'OPEN' && !input.reopen && !input.preparePayment)
                error = {
                    errorCode: 'CART_CHECKOUT_LOCKED_ERROR',
                    message: 'Checkout is locked.',
                };
            let next = cart;
            let shippingPreparation: ShippingPreparationOutcome | undefined;
            if (!error) {
                const runner = repository.manager.queryRunner;
                if (!runner?.isTransactionActive) throw new Error('Cart commands require a transaction.');
                // Retain the cart lock while rolling back a rejected batch; its receipt commits outside this savepoint.
                await runner.startTransaction();
                try {
                    const [name, value] = operations[0];
                    await this.carts.syncActiveOrderSession(ctx, cart);
                    const outcome = await this.apply(contextForCartOrder(ctx, cart), name, value, cart);
                    if (isFailure(outcome)) {
                        error =
                            outcome instanceof CartProjectionError
                                ? { errorCode: outcome.causeCode, message: outcome.causeMessage }
                                : outcome;
                        await runner.rollbackTransaction();
                    } else {
                        if (isShippingPreparationOutcome(outcome)) {
                            shippingPreparation = outcome;
                            next = await this.carts.acceptOrderChange(ctx, cart);
                        } else {
                            next =
                                outcome instanceof StorefrontCart
                                    ? outcome
                                    : outcome instanceof StorefrontCheckoutSession
                                      ? outcome.cart
                                      : outcome == null
                                        ? cart
                                        : await this.carts.acceptOrderChange(ctx, cart);
                        }
                        await this.carts.syncActiveOrderSession(ctx, next);
                        await runner.commitTransaction();
                    }
                } catch (cause) {
                    await runner.rollbackTransaction();
                    // Unexpected failures roll back the outer transaction as well. A retry uses the SAME id.
                    if (cause instanceof UserInputError)
                        error = { errorCode: 'CART_INPUT_REJECTED', message: cause.message };
                    else throw cause;
                }
            }
            if (error) next = await this.carts.getCart(ctx);
            const status = error ? 'REJECTED' : 'APPLIED';
            await repository.save(
                new StorefrontCartCommandReceipt({
                    cartId: cart.id,
                    commandId: input.commandId,
                    digest,
                    status,
                    appliedRevision: next.revision,
                    errorCode: error?.errorCode ?? null,
                }),
            );
            return this.result(
                ctx,
                next,
                input.commandId,
                status,
                next.revision,
                error?.errorCode ?? null,
                error?.message,
                shippingPreparation,
            );
        });
    }

    async recover(
        ctx: RequestContext,
        commandId: string,
        cartId: ID,
        cancel = false,
    ): Promise<CartCommandResult> {
        return this.coordinate(ctx, async cart => {
            this.validateCommandId(commandId);
            if (String(cartId) !== String(cart.id))
                return this.result(ctx, cart, commandId, 'REJECTED', null, 'CART_SCOPE_CHANGED');
            const repository = this.connection.getRepository(ctx, StorefrontCartCommandReceipt);
            let receipt = await repository.findOne({ where: { cartId: cart.id, commandId } });
            if (!receipt && cancel) {
                receipt = await repository.save(
                    new StorefrontCartCommandReceipt({
                        cartId: cart.id,
                        commandId,
                        digest: null,
                        status: 'CANCELLED',
                        appliedRevision: cart.revision,
                        errorCode: null,
                    }),
                );
            }
            return this.result(
                ctx,
                cart,
                commandId,
                receipt?.status ?? 'NOT_FOUND',
                receipt?.appliedRevision ?? null,
                receipt?.errorCode ?? null,
            );
        });
    }

    private async apply(
        ctx: RequestContext,
        name: string,
        value: unknown,
        cart: StorefrontCart,
    ): Promise<unknown> {
        switch (name) {
            case 'changes':
                return this.carts.applyChanges(
                    ctx,
                    value as NonNullable<CartCommandInput['changes']>,
                    cart.revision,
                    cart,
                );
            case 'buyNow': {
                const item = value as NonNullable<CartCommandInput['buyNow']>;
                return this.carts.beginDirectPurchase(ctx, item, cart);
            }
            case 'prepareShipping':
                return this.prepareShipping(
                    ctx,
                    value as NonNullable<CartCommandInput['prepareShipping']>,
                    cart,
                );
            case 'beginCheckout':
                return value === true ? this.carts.beginCheckout(ctx, cart.revision) : invalid();
            case 'preparePayment':
                return value === true ? this.carts.preparePayment(ctx, cart.revision) : invalid();
            case 'reopen':
                return value === true ? this.carts.reopenCart(ctx, cart.revision) : invalid();
            case 'order':
                return this.changeOrder(ctx, value as OrderChange, cart);
            default:
                return this.handlers.get(name)?.(ctx, value, cart) ?? invalid();
        }
    }

    private async changeOrder(
        ctx: RequestContext,
        value: OrderChange,
        cart: StorefrontCart,
    ): Promise<unknown> {
        const order = cart.checkoutOrder;
        if (!order) return { errorCode: 'NO_ACTIVE_ORDER_ERROR', message: 'No active order.' };
        if (Object.values(value).filter(item => item != null).length !== 1) return invalid();
        if (value.note != null)
            return this.orders.updateCustomFields(ctx, order.id, { customerNote: value.note });
        if (value.currencyCode) return this.orders.updateOrderCurrency(ctx, order.id, value.currencyCode);
        if (value.shippingAddress)
            return this.orders.setShippingAddress(ctx, order.id, value.shippingAddress);
        if (value.shippingMethodId)
            return this.orders.setShippingMethod(ctx, order.id, [value.shippingMethodId]);
        if (value.customer) {
            const customer = await this.config.orderOptions.guestCheckoutStrategy.setCustomerForOrder(
                ctx,
                order,
                value.customer,
            );
            return isGraphQlErrorResult(customer)
                ? customer
                : this.orders.addCustomerToOrder(ctx, order.id, customer);
        }
        return invalid();
    }

    private async prepareShipping(
        ctx: RequestContext,
        input: NonNullable<CartCommandInput['prepareShipping']>,
        cart: StorefrontCart,
    ): Promise<ShippingPreparationOutcome | CommandFailure> {
        const order = cart.checkoutOrder;
        if (!order) return { errorCode: 'NO_ACTIVE_ORDER_ERROR', message: 'No active order.' };
        if (!shippingAddressesMatch(order.shippingAddress, input.shippingAddress)) {
            const addressResult = await this.orders.setShippingAddress(ctx, order.id, input.shippingAddress);
            if (isGraphQlErrorResult(addressResult)) return addressResult;
        }
        const methods = await this.orders.getEligibleShippingMethods(ctx, order.id);
        if (!methods.length) return { shippingMethods: [], selectedShippingMethodId: null };
        const selected = selectShippingMethod(methods, input);
        const shippingResult = await this.orders.setShippingMethod(ctx, order.id, [selected.id]);
        if (isGraphQlErrorResult(shippingResult)) return shippingResult;
        return { shippingMethods: methods, selectedShippingMethodId: selected.id };
    }

    private async shippingPreparationSnapshot(
        ctx: RequestContext,
        cart: StorefrontCart,
    ): Promise<ShippingPreparationOutcome | undefined> {
        if (!cart.checkoutOrder) return undefined;
        const shippingMethods = await this.orders.getEligibleShippingMethods(ctx, cart.checkoutOrder.id);
        const appliedId = cart.checkoutOrder.shippingLines?.[0]?.shippingMethodId;
        return {
            shippingMethods,
            selectedShippingMethodId:
                shippingMethods.find(method => String(method.id) === String(appliedId))?.id ?? null,
        };
    }

    private validateCommandId(id: string): void {
        if (!/^[a-zA-Z0-9_-]{16,80}$/.test(id)) throw new Error('Invalid cart command id.');
    }

    private async result(
        ctx: RequestContext,
        cart: StorefrontCart,
        commandId: string,
        status: CartCommandStatus,
        appliedRevision: number | null,
        errorCode: string | null,
        message?: string,
        shippingPreparation?: ShippingPreparationOutcome,
    ): Promise<CartCommandResult> {
        return {
            commandId,
            status,
            appliedRevision,
            errorCode,
            message: message ?? errorCode,
            cart,
            session: await this.carts.checkoutContext(ctx, cart),
            shippingMethods: shippingPreparation?.shippingMethods ?? null,
            selectedShippingMethodId: shippingPreparation?.selectedShippingMethodId ?? null,
        };
    }
}

interface OrderChange {
    note?: string;
    currencyCode?: CurrencyCode;
    shippingAddress?: CreateAddressInput;
    shippingMethodId?: ID;
    customer?: CreateCustomerInput;
}
function contextForCartOrder(ctx: RequestContext, cart: StorefrontCart): RequestContext {
    const currencyCode = cart.checkoutOrder?.currencyCode;
    return currencyCode && ctx.currencyCode !== currencyCode
        ? ctx.copy({ channel: ctx.channel, currencyCode })
        : ctx;
}
function invalid(): CommandFailure {
    return { errorCode: 'INVALID_CART_COMMAND', message: 'Unsupported cart operation.' };
}
function isFailure(value: unknown): value is CommandFailure {
    return !!value && typeof value === 'object' && 'errorCode' in value && 'message' in value;
}
function isShippingPreparationOutcome(value: unknown): value is ShippingPreparationOutcome {
    return !!value && typeof value === 'object' && 'shippingMethods' in value;
}
function shippingAddressesMatch(current: unknown, input: CreateAddressInput): boolean {
    const existing = current && typeof current === 'object' ? (current as Record<string, unknown>) : {};
    const incoming = input as unknown as Record<string, unknown>;
    const keys = [
        'fullName',
        'company',
        'streetLine1',
        'streetLine2',
        'city',
        'province',
        'postalCode',
        'countryCode',
        'phoneNumber',
    ];
    return keys.every(key => addressPart(existing[key]) === addressPart(incoming[key]));
}
function addressPart(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
function selectShippingMethod(
    methods: ShippingMethodQuote[],
    input: NonNullable<CartCommandInput['prepareShipping']>,
): ShippingMethodQuote {
    return (
        methods.find(method => String(method.id) === String(input.selectedShippingMethodId ?? '')) ??
        methods.find(method => method.code === input.preferredShippingCode) ??
        methods.find(method => method.code === input.defaultShippingCode) ??
        methods.find(method => method.priceWithTax === 0) ??
        [...methods].sort((left, right) => left.priceWithTax - right.priceWithTax)[0]
    );
}
