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
    OrderLimitError,
    OrderService,
    ProductVariantService,
    RequestContext,
    SessionService,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';

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
    | StorefrontCheckoutSession
    | StorefrontCartMutationError
    | OrderLimitError;

interface CartOwner {
    ownerType: StorefrontCartOwnerType;
    ownerId: ID;
}

interface AddStorefrontCartItemInput {
    productVariantId: ID;
    quantity: number;
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

    async getCart(ctx: RequestContext): Promise<StorefrontCart> {
        const owner = await this.getOwner(ctx);
        const cart = await this.findOrCreateCart(ctx, owner);
        await this.initializeCart(ctx, cart, owner);
        return this.loadCart(ctx, cart.id, owner);
    }

    async addItem(
        ctx: RequestContext,
        input: AddStorefrontCartItemInput,
        expectedRevision: number,
    ): Promise<StorefrontCartMutationResult> {
        const cart = await this.getCart(ctx);
        const mutableError = this.validateMutable(cart, expectedRevision);
        if (mutableError) {
            return mutableError;
        }

        const variant = await this.productVariantService.findOne(ctx, input.productVariantId);
        if (!variant || !variant.enabled || !variant.product.enabled) {
            return new CartLineUnavailableError(input.productVariantId);
        }

        const existingLine = cart.lines.find(line => idsAreEqual(line.productVariantId, variant.id));
        const newLineQuantity = (existingLine?.quantity ?? 0) + input.quantity;
        const quantityError = this.validateQuantity(input.quantity, newLineQuantity);
        if (quantityError) {
            return quantityError;
        }
        const cartLimitError = this.validateCartLimit(
            cart.lines.reduce((total, line) => total + line.quantity, 0) + input.quantity,
        );
        if (cartLimitError) {
            return cartLimitError;
        }

        const owner = await this.getOwner(ctx);
        const revisionError = await this.claimRevision(ctx, cart, owner, expectedRevision);
        if (revisionError) {
            return revisionError;
        }

        const lineRepository = this.connection.getRepository(ctx, StorefrontCartLine);
        if (existingLine) {
            await lineRepository.update(existingLine.id, { quantity: newLineQuantity });
        } else {
            await lineRepository.save(
                new StorefrontCartLine({
                    cartId: cart.id,
                    productVariantId: variant.id,
                    quantity: input.quantity,
                    selected: true,
                    orderLineId: null,
                }),
            );
        }
        return this.projectCart(ctx, await this.loadCart(ctx, cart.id, owner), owner);
    }

    async setLineQuantity(
        ctx: RequestContext,
        lineId: ID,
        quantity: number,
        expectedRevision: number,
    ): Promise<StorefrontCartMutationResult> {
        const cart = await this.getCart(ctx);
        const mutableError = this.validateMutable(cart, expectedRevision);
        if (mutableError) {
            return mutableError;
        }
        const line = cart.lines.find(item => idsAreEqual(item.id, lineId));
        if (!line) {
            return new CartLineNotFoundError([lineId]);
        }
        const quantityError = this.validateQuantity(quantity, quantity);
        if (quantityError) {
            return quantityError;
        }
        const cartLimitError = this.validateCartLimit(
            cart.lines.reduce((total, item) => total + item.quantity, 0) - line.quantity + quantity,
        );
        if (cartLimitError) {
            return cartLimitError;
        }
        if (line.quantity === quantity) {
            return this.projectCart(ctx, cart, await this.getOwner(ctx));
        }

        const owner = await this.getOwner(ctx);
        const revisionError = await this.claimRevision(ctx, cart, owner, expectedRevision);
        if (revisionError) {
            return revisionError;
        }
        await this.connection.getRepository(ctx, StorefrontCartLine).update(line.id, { quantity });
        return this.projectCart(ctx, await this.loadCart(ctx, cart.id, owner), owner);
    }

    async removeLines(
        ctx: RequestContext,
        lineIds: ID[],
        expectedRevision: number,
    ): Promise<StorefrontCartMutationResult> {
        const cart = await this.getCart(ctx);
        const mutableError = this.validateMutable(cart, expectedRevision);
        if (mutableError) {
            return mutableError;
        }
        const uniqueLineIds = this.uniqueIds(lineIds);
        const missingLineIds = uniqueLineIds.filter(
            lineId => !cart.lines.some(line => idsAreEqual(line.id, lineId)),
        );
        if (missingLineIds.length > 0) {
            return new CartLineNotFoundError(missingLineIds);
        }
        if (uniqueLineIds.length === 0) {
            return this.projectCart(ctx, cart, await this.getOwner(ctx));
        }

        const owner = await this.getOwner(ctx);
        const revisionError = await this.claimRevision(ctx, cart, owner, expectedRevision);
        if (revisionError) {
            return revisionError;
        }
        await this.connection.getRepository(ctx, StorefrontCartLine).delete({ id: In(uniqueLineIds) });
        return this.projectCart(ctx, await this.loadCart(ctx, cart.id, owner), owner);
    }

    async setLinesSelected(
        ctx: RequestContext,
        lineIds: ID[],
        selected: boolean,
        expectedRevision: number,
    ): Promise<StorefrontCartMutationResult> {
        const cart = await this.getCart(ctx);
        const mutableError = this.validateMutable(cart, expectedRevision);
        if (mutableError) {
            return mutableError;
        }
        const uniqueLineIds = this.uniqueIds(lineIds);
        const matchingLines = uniqueLineIds.map(lineId =>
            cart.lines.find(line => idsAreEqual(line.id, lineId)),
        );
        const missingLineIds = uniqueLineIds.filter((_, index) => !matchingLines[index]);
        if (missingLineIds.length > 0) {
            return new CartLineNotFoundError(missingLineIds);
        }
        const changedLineIds = matchingLines
            .filter((line): line is StorefrontCartLine => !!line && line.selected !== selected)
            .map(line => line.id);
        if (changedLineIds.length === 0) {
            return this.projectCart(ctx, cart, await this.getOwner(ctx));
        }

        const owner = await this.getOwner(ctx);
        const revisionError = await this.claimRevision(ctx, cart, owner, expectedRevision);
        if (revisionError) {
            return revisionError;
        }
        await this.connection
            .getRepository(ctx, StorefrontCartLine)
            .update({ id: In(changedLineIds) }, { selected });
        return this.projectCart(ctx, await this.loadCart(ctx, cart.id, owner), owner);
    }

    async setAllLinesSelected(
        ctx: RequestContext,
        selected: boolean,
        expectedRevision: number,
    ): Promise<StorefrontCartMutationResult> {
        const cart = await this.getCart(ctx);
        const mutableError = this.validateMutable(cart, expectedRevision);
        if (mutableError) {
            return mutableError;
        }
        const changedLineIds = cart.lines.filter(line => line.selected !== selected).map(line => line.id);
        if (changedLineIds.length === 0) {
            return this.projectCart(ctx, cart, await this.getOwner(ctx));
        }

        const owner = await this.getOwner(ctx);
        const revisionError = await this.claimRevision(ctx, cart, owner, expectedRevision);
        if (revisionError) {
            return revisionError;
        }
        await this.connection
            .getRepository(ctx, StorefrontCartLine)
            .update({ id: In(changedLineIds) }, { selected });
        return this.projectCart(ctx, await this.loadCart(ctx, cart.id, owner), owner);
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
        // Preserve customer, address and shipping changes made after beginCheckout unless the cart changed.
        const projected = await this.projectCart(ctx, cart, owner);
        if (isGraphQlErrorResult(projected)) {
            return projected;
        }
        if (!projected.checkoutOrder) {
            return new CartProjectionError('ORDER_MISSING', 'No checkout order exists for the selection.');
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
        const guestCart = await cartRepository.findOne({
            where: {
                channelId: ctx.channelId,
                ownerType: 'SESSION',
                ownerId: ctx.session.id,
            },
            relations: ['lines'],
        });
        let customerCart = await cartRepository.findOne({
            where: {
                channelId: ctx.channelId,
                ownerType: 'CUSTOMER',
                ownerId: customer.id,
            },
            relations: ['lines'],
        });
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
            customerCart = new StorefrontCart({ ...guestCart, ...customerOwner });
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
            await cartRepository.delete(guestCart.id);
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

        if (!customerCart) {
            return;
        }
        const mergedCart = await this.loadCart(ctx, customerCart.id, customerOwner);
        const projected = await this.projectCart(ctx, mergedCart, customerOwner, true);
        if (isGraphQlErrorResult(projected)) {
            throw new Error(`${projected.errorCode}: ${projected.message}`);
        }
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
        const orderLinesByVariant = new Map<string, (typeof order.lines)[number][]>();
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
        const variants = await Promise.all(
            cart.lines.map(line => this.productVariantService.findOne(ctx, line.productVariantId)),
        );
        for (const [index, line] of cart.lines.entries()) {
            const variant = variants[index];
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
        const selectedLines = cart.lines.filter(line => line.selected);
        const unavailableLine = selectedLines.find(
            line => !line.productVariant?.enabled || !line.productVariant.product?.enabled,
        );
        if (unavailableLine) {
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
            if (order.lines.length > 0) {
                const removeResult = await this.orderService.removeAllItemsFromOrder(ctx, order.id);
                if (isGraphQlErrorResult(removeResult)) {
                    return new CartProjectionError(removeResult.errorCode, removeResult.message);
                }
                order = removeResult;
            }
            if (selectedLines.length > 0) {
                const addResult = await this.orderService.addItemsToOrder(
                    ctx,
                    order.id,
                    selectedLines.map(line => ({
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
        }

        const lineRepository = this.connection.getRepository(ctx, StorefrontCartLine);
        await lineRepository.update({ cartId: cart.id }, { orderLineId: null });
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
                await lineRepository.update(cartLine.id, { orderLineId: orderLine.id });
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
        return this.loadCart(ctx, cart.id, owner);
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
