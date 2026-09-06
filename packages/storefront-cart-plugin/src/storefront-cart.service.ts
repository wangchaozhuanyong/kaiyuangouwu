import { Injectable } from '@nestjs/common';
import {
    ActiveOrderService,
    ConfigService,
    CustomerService,
    ForbiddenError,
    ID,
    idsAreEqual,
    InternalServerError,
    isGraphQlErrorResult,
    LanguageCode,
    OrderLimitError,
    OrderService,
    PaymentMethod,
    ProductVariantService,
    RequestContext,
    SessionService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { CartChanges } from './cart-command.types';
import { StorefrontCartCheckoutLine } from './entities/storefront-cart-checkout-line.entity';
import { StorefrontCartCheckout } from './entities/storefront-cart-checkout.entity';
import { StorefrontCartLine } from './entities/storefront-cart-line.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import {
    CartCheckoutLockedError,
    CartEmptySelectionError,
    CartLineNotFoundError,
    CartLineUnavailableError,
    CartProjectionError,
    CartRevisionConflictError,
    InvalidCartQuantityError,
    StorefrontCartMutationError,
} from './storefront-cart.errors';
import { StorefrontCartOwnerType } from './types';

export type StorefrontCartMutationResult = StorefrontCart | StorefrontCartMutationError | OrderLimitError;

export class StorefrontCheckoutSession {
    readonly __typename = 'StorefrontCheckoutSession';

    constructor(
        readonly cart: StorefrontCart,
        readonly order: NonNullable<StorefrontCart['checkoutOrder']>,
        readonly checkout: StorefrontCartCheckout | null,
    ) {}
}

export type StorefrontCheckoutResult =
    StorefrontCheckoutSession | StorefrontCartMutationError | OrderLimitError;

interface CartOwner {
    ownerType: StorefrontCartOwnerType;
    ownerId: ID;
}

interface AddStorefrontCartItemInput {
    productVariantId: ID;
    quantity: number;
}

const NON_PRODUCTION_PAYMENT_PATTERN = /(?:^|[-_\s])(demo|dummy|mock|sandbox|test)(?:$|[-_\s])|测试/iu;
const INTERNAL_BALANCE_PAYMENT_CODES = new Set(['referral-balance', 'referral-balance-payment']);

export function isRegisteredProductionPaymentMethod(
    method: Pick<PaymentMethod, 'code' | 'handler' | 'translations'>,
    registeredHandlerCodes: ReadonlySet<string>,
): boolean {
    const handlerCode = method.handler?.code;
    if (!handlerCode || !registeredHandlerCodes.has(handlerCode)) {
        return false;
    }
    if (INTERNAL_BALANCE_PAYMENT_CODES.has(method.code) || INTERNAL_BALANCE_PAYMENT_CODES.has(handlerCode)) {
        return false;
    }
    const searchable = [
        method.code,
        handlerCode,
        ...(method.translations ?? []).flatMap(translation => [translation.name, translation.description]),
    ].join(' ');
    return !NON_PRODUCTION_PAYMENT_PATTERN.test(searchable);
}

@Injectable()
export class StorefrontCartService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly activeOrderService: ActiveOrderService,
        private readonly customerService: CustomerService,
        private readonly orderService: OrderService,
        private readonly productVariantService: ProductVariantService,
        private readonly sessionService: SessionService,
        private readonly configService: ConfigService,
    ) {}

    async hasCart(ctx: RequestContext): Promise<boolean> {
        const owner = await this.getOwner(ctx);
        return this.connection
            .getRepository(ctx, StorefrontCart)
            .existsBy({ channelId: ctx.channelId, ...owner });
    }

    async getCart(ctx: RequestContext): Promise<StorefrontCart> {
        const owner = await this.getOwner(ctx);
        const cart = await this.findOrCreateCart(ctx, owner);
        await this.initializeCart(ctx, cart, owner);
        return this.loadCart(ctx, cart.id, owner);
    }

    async addItem(ctx: RequestContext, input: AddStorefrontCartItemInput, expectedRevision: number) {
        return this.applyChanges(ctx, { add: [input] }, expectedRevision);
    }

    async setLineQuantity(ctx: RequestContext, lineId: ID, quantity: number, expectedRevision: number) {
        return this.applyChanges(ctx, { lines: [{ lineId, quantity }] }, expectedRevision);
    }

    async removeLines(ctx: RequestContext, lineIds: ID[], expectedRevision: number) {
        return this.applyChanges(ctx, { remove: lineIds }, expectedRevision);
    }

    async setLinesSelected(ctx: RequestContext, lineIds: ID[], selected: boolean, expectedRevision: number) {
        return this.applyChanges(
            ctx,
            { lines: lineIds.map(lineId => ({ lineId, selected })) },
            expectedRevision,
        );
    }

    async setAllLinesSelected(ctx: RequestContext, selected: boolean, expectedRevision: number) {
        const cart = await this.getCart(ctx);
        const lines = cart.lines.filter(
            line => !selected || (line.productVariant?.enabled && line.productVariant.product?.enabled),
        );
        return this.applyChanges(
            ctx,
            { lines: lines.map(line => ({ lineId: line.id, selected })) },
            expectedRevision,
            cart,
        );
    }

    /** Validate the whole batch before writing; one revision and one delta projection per command. */
    async applyChanges(
        ctx: RequestContext,
        changes: CartChanges,
        expectedRevision: number,
        snapshot?: StorefrontCart,
    ): Promise<StorefrontCartMutationResult> {
        const cart = snapshot ?? (await this.getCart(ctx));
        const mutableError = this.validateMutable(cart, expectedRevision);
        if (mutableError) return mutableError;
        const original = new Map(cart.lines.map(line => [String(line.id), line]));
        const removed = new Set((changes.remove ?? []).map(String));
        const missing = [...removed, ...(changes.lines ?? []).map(line => String(line.lineId))].filter(
            id => !original.has(id),
        );
        if (missing.length) return new CartLineNotFoundError([...new Set(missing)]);
        const lines = cart.lines
            .filter(line => !removed.has(String(line.id)))
            .map(line => new StorefrontCartLine({ ...line }));
        for (const change of changes.lines ?? []) {
            if (removed.has(String(change.lineId))) continue;
            const line = lines.find(item => idsAreEqual(item.id, change.lineId));
            if (!line) return new CartLineNotFoundError([change.lineId]);
            if (change.quantity != null) {
                const error = this.validateQuantity(change.quantity, change.quantity);
                if (error) return error;
                line.quantity = change.quantity;
            }
            if (change.selected != null) line.selected = change.selected;
            if (
                (change.selected === true || change.quantity != null) &&
                (!line.productVariant?.enabled || !line.productVariant.product?.enabled)
            ) {
                return new CartLineUnavailableError(line.productVariantId);
            }
        }
        for (const addition of changes.add ?? []) {
            let line = lines.find(item => idsAreEqual(item.productVariantId, addition.productVariantId));
            const variant =
                line?.productVariant ??
                (await this.productVariantService.findOne(ctx, addition.productVariantId));
            if (!variant?.enabled || !variant.product?.enabled)
                return new CartLineUnavailableError(addition.productVariantId);
            const quantity = (line?.quantity ?? 0) + addition.quantity;
            const error = this.validateQuantity(addition.quantity, quantity);
            if (error) return error;
            if (line) {
                line.quantity = quantity;
            } else {
                line = new StorefrontCartLine({
                    cartId: cart.id,
                    productVariantId: variant.id,
                    quantity,
                    selected: true,
                    orderLineId: null,
                });
                line.productVariant = variant;
                lines.push(line);
            }
        }
        const limit = this.validateCartLimit(lines.reduce((total, line) => total + line.quantity, 0));
        if (limit) return limit;
        const changed = lines.filter(line => {
            const previous = original.get(String(line.id));
            return !previous || previous.quantity !== line.quantity || previous.selected !== line.selected;
        });
        const owner = await this.getOwner(ctx);
        if (!changed.length && !removed.size) return this.projectCart(ctx, cart, owner);
        const revisionError = await this.claimRevision(ctx, cart, owner, expectedRevision);
        if (revisionError) return revisionError;
        const repository = this.connection.getRepository(ctx, StorefrontCartLine);
        if (removed.size) await repository.delete({ cartId: cart.id, id: In([...removed]) });
        for (const line of changed) {
            if (line.id != null) {
                await repository.update(line.id, { quantity: line.quantity, selected: line.selected });
            } else {
                const saved = await repository.save(line);
                Object.assign(line, saved);
            }
        }
        cart.lines = lines;
        cart.revision = expectedRevision + 1;
        cart.projectedRevision = null;
        return this.projectCart(ctx, cart, owner);
    }

    /** The caller must already hold a transaction. All cart/order writers lock cart before coupons. */
    async lockCart(ctx: RequestContext): Promise<StorefrontCart> {
        const owner = await this.getOwner(ctx);
        const cart = await this.findOrCreateCart(ctx, owner);
        const repository = this.connection.getRepository(ctx, StorefrontCart);
        // A no-op UPDATE is portable to SQLite and obtains an exclusive row lock in MySQL/Postgres.
        await repository.update(
            { id: cart.id, channelId: ctx.channelId, ...owner },
            { lastActivityAt: new Date() },
        );
        await this.initializeCart(ctx, cart, owner);
        return this.loadCart(ctx, cart.id, owner);
    }

    /** Used by order lifecycle and coupon maintenance jobs, which have no customer session. */
    async lockForOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        await this.connection
            .getRepository(ctx, StorefrontCart)
            .update({ channelId: ctx.channelId, checkoutOrderId: orderId }, { lastActivityAt: new Date() });
    }

    async isOrderPaymentLocked(ctx: RequestContext, orderId: ID): Promise<boolean> {
        const repository = this.connection.getRepository(ctx, StorefrontCart);
        const query = repository
            .createQueryBuilder('cart')
            .where({ channelId: ctx.channelId, checkoutOrderId: orderId });
        if (
            repository.manager.queryRunner?.isTransactionActive &&
            !['sqlite', 'better-sqlite3', 'sqljs'].includes(this.connection.rawConnection.options.type)
        )
            query.setLock('pessimistic_read');
        return (await query.getOne())?.state === 'PAYMENT_PENDING';
    }

    withTransaction<T>(ctx: RequestContext, work: (ctx: RequestContext) => Promise<T>): Promise<T> {
        const type = this.connection.rawConnection.options.type;
        return this.connection.withTransaction(
            ctx,
            work,
            ['sqlite', 'better-sqlite3', 'sqljs'].includes(type) ? undefined : 'READ COMMITTED',
        );
    }

    async withOrderChange<T>(
        ctx: RequestContext,
        orderId: ID,
        work: (ctx: RequestContext) => Promise<T>,
    ): Promise<T> {
        const run = async (txCtx: RequestContext) => {
            await this.lockForOrder(txCtx, orderId);
            if (await this.isOrderPaymentLocked(txCtx, orderId)) {
                throw new UserInputError('Checkout is locked. Reopen the order before changing its price.');
            }
            const result = await work(txCtx);
            await this.connection
                .getRepository(txCtx, StorefrontCart)
                .createQueryBuilder()
                .update(StorefrontCart)
                .set({ revision: () => 'revision + 1', projectedRevision: null })
                .where({ channelId: txCtx.channelId, checkoutOrderId: orderId })
                .execute();
            return result;
        };
        return this.connection.getRepository(ctx, StorefrontCart).manager.queryRunner?.isTransactionActive
            ? run(ctx)
            : this.withTransaction(ctx, run);
    }

    async acceptOrderChange(ctx: RequestContext, cart: StorefrontCart): Promise<StorefrontCart> {
        const repository = this.connection.getRepository(ctx, StorefrontCart);
        const current = await repository.findOneOrFail({ where: { id: cart.id } });
        const revision = current.revision + 1;
        await repository.update(cart.id, {
            revision,
            projectedRevision:
                current.projectedRevision === current.revision ? revision : current.projectedRevision,
        });
        return this.loadCart(ctx, cart.id, await this.getOwner(ctx));
    }

    async checkoutContext(
        ctx: RequestContext,
        cart: StorefrontCart,
    ): Promise<StorefrontCheckoutSession | null> {
        if (cart.state === 'PAYMENT_PENDING') {
            const session = await this.getPreparedCheckoutSession(ctx, cart);
            return isGraphQlErrorResult(session) ? null : session;
        }
        return cart.checkoutOrder ? new StorefrontCheckoutSession(cart, cart.checkoutOrder, null) : null;
    }

    async syncActiveOrderSession(ctx: RequestContext, cart: StorefrontCart): Promise<void> {
        if (
            ctx.session &&
            cart.checkoutOrder &&
            !idsAreEqual(ctx.session.activeOrderId, cart.checkoutOrder.id)
        ) {
            await this.sessionService.setActiveOrder(ctx, ctx.session, cart.checkoutOrder);
        }
    }

    async beginCheckout(ctx: RequestContext, expectedRevision: number): Promise<StorefrontCheckoutResult> {
        const cart = await this.getCart(ctx);
        const mutableError = this.validateMutable(cart, expectedRevision);
        if (mutableError) {
            return mutableError;
        }
        if (!cart.lines.some(line => line.selected)) {
            return new CartEmptySelectionError();
        }
        const owner = await this.getOwner(ctx);
        const projected = await this.projectCart(ctx, cart, owner, true);
        if (isGraphQlErrorResult(projected)) {
            return projected;
        }
        if (!projected.checkoutOrder) {
            return new CartProjectionError('ORDER_MISSING', 'No checkout order exists for the selection.');
        }
        return new StorefrontCheckoutSession(projected, projected.checkoutOrder, null);
    }

    async preparePayment(ctx: RequestContext, expectedRevision: number): Promise<StorefrontCheckoutResult> {
        const cart = await this.getCart(ctx);
        if (cart.revision !== expectedRevision) {
            return new CartRevisionConflictError(expectedRevision, cart.revision);
        }
        if (cart.state === 'PAYMENT_PENDING') {
            return this.getPreparedCheckoutSession(ctx, cart);
        }
        if (!cart.lines.some(line => line.selected)) {
            return new CartEmptySelectionError();
        }

        const owner = await this.getOwner(ctx);
        // Recheck current stock and prices while preserving the order details entered after beginCheckout.
        const projected = await this.projectCart(ctx, cart, owner, true);
        if (isGraphQlErrorResult(projected)) {
            return projected;
        }
        if (!projected.checkoutOrder) {
            return new CartProjectionError('ORDER_MISSING', 'No checkout order exists for the selection.');
        }
        if (
            process.env.NODE_ENV === 'production' &&
            projected.checkoutOrder.totalWithTax > 0 &&
            !(await this.hasProductionPaymentMethod(ctx))
        ) {
            const message =
                ctx.languageCode === LanguageCode.zh_Hans
                    ? '当前店铺尚未配置可用的正式支付方式，暂时无法提交订单'
                    : 'This store does not have an available production payment method yet.';
            return new CartProjectionError('PAYMENT_UNAVAILABLE', message, message);
        }
        const lock = await this.connection.getRepository(ctx, StorefrontCart).update(
            {
                id: projected.id,
                channelId: ctx.channelId,
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
                revision: expectedRevision,
                state: 'OPEN',
            },
            { state: 'PAYMENT_PENDING', lastActivityAt: new Date() },
        );
        if (lock.affected !== 1) {
            return new CartRevisionConflictError(expectedRevision, projected.revision);
        }

        const checkout = await this.saveCheckoutSnapshot(ctx, projected, projected.checkoutOrder);
        const transition = await this.orderService.transitionToState(
            ctx,
            projected.checkoutOrder.id,
            'ArrangingPayment',
        );
        if (isGraphQlErrorResult(transition)) {
            return new CartProjectionError(transition.errorCode, transition.transitionError);
        }
        const lockedCart = await this.loadCart(ctx, projected.id, owner);
        lockedCart.checkoutOrder = transition;
        checkout.order = transition;
        return new StorefrontCheckoutSession(lockedCart, transition, checkout);
    }

    private async hasProductionPaymentMethod(ctx: RequestContext): Promise<boolean> {
        const registeredHandlerCodes = new Set(
            this.configService.paymentOptions.paymentMethodHandlers.map(handler => handler.code),
        );
        if (registeredHandlerCodes.size === 0) {
            return false;
        }
        const methods = await this.connection.getRepository(ctx, PaymentMethod).find({
            where: { enabled: true, channels: { id: ctx.channelId } },
            relations: { channels: true, translations: true },
        });
        return methods.some(method => isRegisteredProductionPaymentMethod(method, registeredHandlerCodes));
    }

    async reopenCart(ctx: RequestContext, expectedRevision: number): Promise<StorefrontCartMutationResult> {
        const cart = await this.getCart(ctx);
        if (cart.revision !== expectedRevision) {
            return new CartRevisionConflictError(expectedRevision, cart.revision);
        }
        if (cart.state === 'OPEN') {
            return cart;
        }
        if (!cart.checkoutOrder) {
            return new CartProjectionError('ORDER_MISSING', 'The pending checkout order no longer exists.');
        }
        const order = await this.orderService.findOne(ctx, cart.checkoutOrder.id, ['lines', 'payments']);
        if (!order) {
            return new CartProjectionError('ORDER_MISSING', 'The pending checkout order no longer exists.');
        }
        if (order.payments.some(payment => payment.state === 'Authorized' || payment.state === 'Settled')) {
            return new CartCheckoutLockedError(cart.state);
        }
        if (order.state !== 'ArrangingPayment' && order.state !== 'AddingItems') {
            return new CartCheckoutLockedError(cart.state);
        }
        if (order.state === 'ArrangingPayment') {
            const transition = await this.orderService.transitionToState(ctx, order.id, 'AddingItems');
            if (isGraphQlErrorResult(transition)) {
                return new CartProjectionError(transition.errorCode, transition.message);
            }
        }
        await this.connection
            .getRepository(ctx, StorefrontCartCheckout)
            .update({ cartId: cart.id, orderId: order.id, state: 'PREPARED' }, { state: 'ABANDONED' });
        const owner = await this.getOwner(ctx);
        const reopened = await this.connection.getRepository(ctx, StorefrontCart).update(
            {
                id: cart.id,
                channelId: ctx.channelId,
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
                revision: expectedRevision,
                state: 'PAYMENT_PENDING',
            },
            {
                state: 'OPEN',
                revision: expectedRevision + 1,
                projectedRevision: expectedRevision + 1,
                lastActivityAt: new Date(),
            },
        );
        if (reopened.affected !== 1) {
            return new CartRevisionConflictError(expectedRevision, cart.revision);
        }
        return this.loadCart(ctx, cart.id, owner);
    }

    async mergeAfterLogin(ctx: RequestContext, userId: ID): Promise<void> {
        if (!ctx.session) {
            return;
        }
        const customer = await this.customerService.findOneByUserId(ctx, userId);
        if (!customer) {
            return;
        }
        const cartRepository = this.connection.getRepository(ctx, StorefrontCart);
        const owners = [
            { channelId: ctx.channelId, ownerType: 'SESSION' as const, ownerId: ctx.session.id },
            { channelId: ctx.channelId, ownerType: 'CUSTOMER' as const, ownerId: customer.id },
        ];
        const type = this.connection.rawConnection.options.type;
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(type);
        // Login may inherit an older REPEATABLE READ transaction. Read the locked rows
        // themselves, including their lines, so a concurrent edit is not merged from a stale snapshot.
        const merging = sqlite
            ? await cartRepository.find({ where: owners, relations: ['lines'], order: { id: 'ASC' } })
            : await cartRepository
                  .createQueryBuilder('cart')
                  .leftJoinAndSelect('cart.lines', 'line')
                  .where(owners)
                  .orderBy('cart.id', 'ASC')
                  .setLock('pessimistic_write', undefined, type === 'postgres' ? ['cart'] : undefined)
                  .getMany();
        for (const cart of merging) await cartRepository.update(cart.id, { lastActivityAt: new Date() });
        const guestCart = merging.find(cart => cart.ownerType === 'SESSION');
        const customerCart = merging.find(cart => cart.ownerType === 'CUSTOMER');
        if (!guestCart && !customerCart) {
            return;
        }
        if (guestCart?.state === 'PAYMENT_PENDING' || customerCart?.state === 'PAYMENT_PENDING') {
            return;
        }
        const activeOrder = await this.orderService.getActiveOrderForUser(ctx, userId);
        const customerOwner: CartOwner = { ownerType: 'CUSTOMER', ownerId: customer.id };

        if (guestCart && !customerCart) {
            await cartRepository.update(guestCart.id, {
                ...customerOwner,
                checkoutOrderId: activeOrder?.id ?? null,
                projectedRevision: null,
                lastActivityAt: new Date(),
            });
        } else if (guestCart && customerCart) {
            const lineRepository = this.connection.getRepository(ctx, StorefrontCartLine);
            const customerLines = new Map(
                customerCart.lines.map(line => [line.productVariantId.toString(), line]),
            );
            for (const guestLine of guestCart.lines) {
                const existing = customerLines.get(guestLine.productVariantId.toString());
                if (existing) {
                    await lineRepository.update(existing.id, {
                        quantity: existing.quantity + guestLine.quantity,
                        selected: existing.selected || guestLine.selected,
                        orderLineId: null,
                    });
                } else {
                    await lineRepository.save(
                        new StorefrontCartLine({
                            cartId: customerCart.id,
                            productVariantId: guestLine.productVariantId,
                            quantity: guestLine.quantity,
                            selected: guestLine.selected,
                            orderLineId: null,
                        }),
                    );
                }
            }
            await this.connection
                .getRepository(ctx, StorefrontCartCheckout)
                .update({ cartId: guestCart.id }, { cartId: customerCart.id });
            await lineRepository.delete({ cartId: guestCart.id });
            await cartRepository.update(guestCart.id, {
                revision: guestCart.revision + 1,
                projectedRevision: null,
                checkoutOrderId: null,
                initialized: true,
                lastActivityAt: new Date(),
            });
            await cartRepository.update(customerCart.id, {
                revision: Math.max(customerCart.revision, guestCart.revision) + 1,
                checkoutOrderId: activeOrder?.id ?? null,
                projectedRevision: null,
                initialized: true,
                lastActivityAt: new Date(),
            });
        } else if (customerCart) {
            await cartRepository.update(customerCart.id, {
                checkoutOrderId: activeOrder?.id ?? customerCart.checkoutOrderId,
                projectedRevision: null,
                lastActivityAt: new Date(),
            });
        }

        // Keep authentication independent from checkout reconstruction. The merge operations above
        // invalidate projectedRevision, so the next cart mutation or checkout attempt will rebuild
        // the active order in its own request and can surface a cart-specific recovery error there.
    }

    private async getOwner(ctx: RequestContext): Promise<CartOwner> {
        if (!ctx.session) {
            throw new InternalServerError('error.no-active-session');
        }
        if (!ctx.activeUserId) {
            return { ownerType: 'SESSION', ownerId: ctx.session.id };
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            throw new ForbiddenError();
        }
        return { ownerType: 'CUSTOMER', ownerId: customer.id };
    }

    private async findOrCreateCart(ctx: RequestContext, owner: CartOwner): Promise<StorefrontCart> {
        const repository = this.connection.getRepository(ctx, StorefrontCart);
        const existing = await repository.findOne({
            where: { channelId: ctx.channelId, ownerType: owner.ownerType, ownerId: owner.ownerId },
        });
        if (existing) {
            return existing;
        }

        const activeOrder = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (owner.ownerType === 'CUSTOMER' && activeOrder) {
            const sessionCart = await repository.findOne({
                where: { channelId: ctx.channelId, checkoutOrderId: activeOrder.id },
            });
            if (sessionCart?.ownerType === 'SESSION') {
                await repository.update(sessionCart.id, owner);
                return new StorefrontCart({ ...sessionCart, ...owner });
            }
        }

        await repository
            .createQueryBuilder()
            .insert()
            .into(StorefrontCart)
            .values({
                channelId: ctx.channelId,
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
                revision: 0,
                state: 'OPEN',
                checkoutOrderId: null,
                projectedRevision: null,
                initialized: false,
                lastActivityAt: new Date(),
            })
            .orIgnore()
            .execute();

        const created = await repository.findOne({
            where: { channelId: ctx.channelId, ownerType: owner.ownerType, ownerId: owner.ownerId },
        });
        if (!created) {
            throw new InternalServerError('error.cannot-locate-created-entity');
        }
        return created;
    }

    private async initializeCart(ctx: RequestContext, cart: StorefrontCart, owner: CartOwner): Promise<void> {
        if (cart.initialized) {
            return;
        }
        const repository = this.connection.getRepository(ctx, StorefrontCart);
        const claimed = await repository.update(
            {
                id: cart.id,
                channelId: ctx.channelId,
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
                initialized: false,
            },
            { initialized: true },
        );
        if (claimed.affected !== 1) {
            return;
        }

        const activeOrder = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!activeOrder) {
            await repository.update(cart.id, { projectedRevision: 0 });
            return;
        }
        const order = await this.orderService.findOne(ctx, activeOrder.id, ['lines']);
        if (!order) {
            return;
        }
        const orderLinesByVariant = new Map<string, Array<(typeof order.lines)[number]>>();
        for (const orderLine of order.lines) {
            const key = orderLine.productVariantId.toString();
            orderLinesByVariant.set(key, [...(orderLinesByVariant.get(key) ?? []), orderLine]);
        }
        const importedLines = [...orderLinesByVariant.values()].map(
            orderLines =>
                new StorefrontCartLine({
                    cartId: cart.id,
                    productVariantId: orderLines[0].productVariantId,
                    quantity: orderLines.reduce((total, line) => total + line.quantity, 0),
                    selected: true,
                    orderLineId: orderLines[0].id,
                }),
        );
        if (importedLines.length > 0) {
            await this.connection.getRepository(ctx, StorefrontCartLine).save(importedLines);
        }
        await repository.update(cart.id, {
            checkoutOrderId: order.id,
            projectedRevision: cart.revision,
            lastActivityAt: new Date(),
        });
    }

    private async loadCart(ctx: RequestContext, cartId: ID, owner: CartOwner): Promise<StorefrontCart> {
        const cart = await this.connection.getRepository(ctx, StorefrontCart).findOne({
            where: {
                id: cartId,
                channelId: ctx.channelId,
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
            },
            relations: ['lines'],
            order: { lines: { createdAt: 'ASC', id: 'ASC' } },
        });
        if (!cart) {
            throw new ForbiddenError();
        }
        const variants = await this.productVariantService.findByIdsWithProduct(
            ctx,
            cart.lines.map(line => line.productVariantId),
        );
        const variantsById = new Map(variants.map(variant => [String(variant.id), variant]));
        for (const line of cart.lines) {
            const variant = variantsById.get(String(line.productVariantId));
            if (variant) {
                line.productVariant = variant;
            }
        }
        cart.checkoutOrder = cart.checkoutOrderId
            ? ((await this.orderService.findOne(ctx, cart.checkoutOrderId)) ?? null)
            : null;
        return cart;
    }

    private async projectCart(
        ctx: RequestContext,
        cart: StorefrontCart,
        owner: CartOwner,
        force = false,
    ): Promise<StorefrontCartMutationResult> {
        if (!force && cart.projectedRevision === cart.revision) {
            return cart;
        }
        const requestedLines = cart.lines.filter(line => line.selected);
        const selectedLines = requestedLines.filter(
            line => line.productVariant?.enabled && line.productVariant.product?.enabled,
        );
        const unavailableLine = requestedLines.find(
            line => !line.productVariant?.enabled || !line.productVariant.product?.enabled,
        );
        if (force && unavailableLine) {
            return new CartLineUnavailableError(unavailableLine.productVariantId);
        }

        let order = cart.checkoutOrder;
        if (order && (!order.active || order.state !== 'AddingItems')) {
            return new CartProjectionError(
                'ORDER_NOT_EDITABLE',
                `Order ${order.code} is in state ${order.state}.`,
            );
        }
        if (!order && selectedLines.length > 0) {
            order = await this.orderService.create(ctx, ctx.activeUserId);
            await this.connection.getRepository(ctx, StorefrontCart).update(
                {
                    id: cart.id,
                    channelId: ctx.channelId,
                    ownerType: owner.ownerType,
                    ownerId: owner.ownerId,
                },
                { checkoutOrderId: order.id },
            );
        }

        if (order) {
            // Checkout validates every retained line without destroying order line identity,
            // coupon allocations, delivery contacts or shipping selections.
            const retainedVariantIds = new Set<string>();
            const removedLineIds = order.lines
                .filter(line => {
                    const variantId = String(line.productVariantId);
                    if (
                        retainedVariantIds.has(variantId) ||
                        !selectedLines.some(cartLine =>
                            idsAreEqual(cartLine.productVariantId, line.productVariantId),
                        )
                    )
                        return true;
                    retainedVariantIds.add(variantId);
                    return false;
                })
                .map(line => line.id);
            if (removedLineIds.length > 0) {
                const removeResult = await this.orderService.removeItemsFromOrder(
                    ctx,
                    order.id,
                    removedLineIds,
                );
                if (isGraphQlErrorResult(removeResult)) {
                    return new CartProjectionError(removeResult.errorCode, removeResult.message);
                }
                order = removeResult;
            }

            const quantityChanges = order.lines.flatMap(line => {
                const cartLine = selectedLines.find(selected =>
                    idsAreEqual(selected.productVariantId, line.productVariantId),
                );
                return cartLine && (force || cartLine.quantity !== line.quantity)
                    ? [{ orderLineId: line.id, quantity: cartLine.quantity }]
                    : [];
            });
            if (quantityChanges.length > 0) {
                const adjustResult = await this.orderService.adjustOrderLines(ctx, order.id, quantityChanges);
                if (adjustResult.errorResults.length > 0) {
                    const error = adjustResult.errorResults[0];
                    return new CartProjectionError(error.errorCode, error.message);
                }
                order = adjustResult.order;
            }

            const existingOrderLines = order.lines;
            const addedLines = selectedLines.filter(
                cartLine =>
                    !existingOrderLines.some(line =>
                        idsAreEqual(line.productVariantId, cartLine.productVariantId),
                    ),
            );
            if (addedLines.length > 0) {
                const addResult = await this.orderService.addItemsToOrder(
                    ctx,
                    order.id,
                    addedLines.map(line => ({
                        productVariantId: line.productVariantId,
                        quantity: line.quantity,
                    })),
                );
                if (addResult.errorResults.length > 0) {
                    const error = addResult.errorResults[0];
                    return new CartProjectionError(error.errorCode, error.message);
                }
                order = addResult.order;
            }
            if (force) order = await this.orderService.applyPriceAdjustments(ctx, order, order.lines);
        }

        const lineRepository = this.connection.getRepository(ctx, StorefrontCartLine);
        const unselectedLineIds = cart.lines
            .filter(
                line =>
                    !selectedLines.some(selected => idsAreEqual(selected.id, line.id)) &&
                    line.orderLineId != null,
            )
            .map(line => line.id);
        if (unselectedLineIds.length > 0) {
            await lineRepository.update({ id: In(unselectedLineIds) }, { orderLineId: null });
        }
        if (order) {
            for (const cartLine of selectedLines) {
                const orderLine = order.lines.find(line =>
                    idsAreEqual(line.productVariantId, cartLine.productVariantId),
                );
                if (!orderLine) {
                    return new CartProjectionError(
                        'ORDER_LINE_MISSING',
                        `No projected order line exists for variant ${cartLine.productVariantId}.`,
                    );
                }
                if (cartLine.orderLineId == null || !idsAreEqual(cartLine.orderLineId, orderLine.id)) {
                    await lineRepository.update(cartLine.id, { orderLineId: orderLine.id });
                }
            }
        }
        await this.connection.getRepository(ctx, StorefrontCart).update(
            {
                id: cart.id,
                channelId: ctx.channelId,
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
            },
            {
                checkoutOrderId: order?.id ?? null,
                projectedRevision: cart.revision,
                lastActivityAt: new Date(),
            },
        );
        cart.checkoutOrder = order;
        cart.checkoutOrderId = order?.id ?? null;
        cart.projectedRevision = cart.revision;
        cart.updatedAt = new Date();
        return cart;
    }

    private async saveCheckoutSnapshot(
        ctx: RequestContext,
        cart: StorefrontCart,
        order: NonNullable<StorefrontCart['checkoutOrder']>,
    ): Promise<StorefrontCartCheckout> {
        const checkoutRepository = this.connection.getRepository(ctx, StorefrontCartCheckout);
        let checkout = await checkoutRepository.findOne({ where: { orderId: order.id } });
        if (!checkout) {
            checkout = await checkoutRepository.save(
                new StorefrontCartCheckout({
                    cartId: cart.id,
                    orderId: order.id,
                    cartRevision: cart.revision,
                    state: 'PREPARED',
                    completedAt: null,
                }),
            );
        } else {
            checkout.cartRevision = cart.revision;
            checkout.state = 'PREPARED';
            checkout.completedAt = null;
            checkout = await checkoutRepository.save(checkout);
            await this.connection
                .getRepository(ctx, StorefrontCartCheckoutLine)
                .delete({ checkoutId: checkout.id });
        }
        checkout.lines = await this.connection.getRepository(ctx, StorefrontCartCheckoutLine).save(
            cart.lines
                .filter(line => line.selected)
                .map(
                    line =>
                        new StorefrontCartCheckoutLine({
                            checkoutId: checkout.id,
                            cartLineId: line.id,
                            productVariantId: line.productVariantId,
                            quantity: line.quantity,
                        }),
                ),
        );
        checkout.order = order;
        return checkout;
    }

    private async getPreparedCheckoutSession(
        ctx: RequestContext,
        cart: StorefrontCart,
    ): Promise<StorefrontCheckoutResult> {
        if (!cart.checkoutOrder || cart.checkoutOrder.state !== 'ArrangingPayment') {
            return new CartCheckoutLockedError(cart.state);
        }
        const checkout = await this.connection.getRepository(ctx, StorefrontCartCheckout).findOne({
            where: {
                cartId: cart.id,
                orderId: cart.checkoutOrder.id,
                cartRevision: cart.revision,
                state: 'PREPARED',
            },
            relations: ['lines'],
        });
        if (!checkout) {
            return new CartProjectionError(
                'CHECKOUT_SNAPSHOT_MISSING',
                'The pending checkout snapshot no longer exists.',
            );
        }
        checkout.order = cart.checkoutOrder;
        return new StorefrontCheckoutSession(cart, cart.checkoutOrder, checkout);
    }

    private validateMutable(
        cart: StorefrontCart,
        expectedRevision: number,
    ): CartCheckoutLockedError | CartRevisionConflictError | undefined {
        if (cart.state !== 'OPEN') {
            return new CartCheckoutLockedError(cart.state);
        }
        if (!Number.isInteger(expectedRevision) || cart.revision !== expectedRevision) {
            return new CartRevisionConflictError(expectedRevision, cart.revision);
        }
    }

    private async claimRevision(
        ctx: RequestContext,
        cart: StorefrontCart,
        owner: CartOwner,
        expectedRevision: number,
    ): Promise<CartCheckoutLockedError | CartRevisionConflictError | undefined> {
        const repository = this.connection.getRepository(ctx, StorefrontCart);
        const result = await repository.update(
            {
                id: cart.id,
                channelId: ctx.channelId,
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
                revision: expectedRevision,
                state: 'OPEN',
            },
            {
                revision: expectedRevision + 1,
                projectedRevision: null,
                lastActivityAt: new Date(),
            },
        );
        if (result.affected === 1) {
            return;
        }
        const current = await repository.findOne({
            where: {
                id: cart.id,
                channelId: ctx.channelId,
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
            },
        });
        if (!current) {
            throw new ForbiddenError();
        }
        return current.state !== 'OPEN'
            ? new CartCheckoutLockedError(current.state)
            : new CartRevisionConflictError(expectedRevision, current.revision);
    }

    private validateQuantity(
        requestedQuantity: number,
        resultingLineQuantity: number,
    ): InvalidCartQuantityError | undefined {
        const maxQuantity = this.configService.orderOptions.orderLineItemsLimit;
        if (
            !Number.isInteger(requestedQuantity) ||
            requestedQuantity <= 0 ||
            resultingLineQuantity > maxQuantity
        ) {
            return new InvalidCartQuantityError(
                !Number.isInteger(requestedQuantity) || requestedQuantity <= 0
                    ? requestedQuantity
                    : resultingLineQuantity,
                maxQuantity,
            );
        }
    }

    private validateCartLimit(resultingCartQuantity: number): OrderLimitError | undefined {
        const maxItems = this.configService.orderOptions.orderItemsLimit;
        if (resultingCartQuantity > maxItems) {
            return new OrderLimitError({ maxItems });
        }
    }

    private uniqueIds(ids: ID[]): ID[] {
        return [...new Map(ids.map(id => [id.toString(), id])).values()];
    }
}
