import { ID } from '@vendure/core';

abstract class StorefrontCartError {
    abstract readonly __typename: string;
    abstract readonly errorCode: string;
    abstract readonly message: string;
}

export class CartRevisionConflictError extends StorefrontCartError {
    readonly __typename = 'CartRevisionConflictError';
    readonly errorCode = 'CART_REVISION_CONFLICT_ERROR';
    readonly message = 'The cart changed in another request. Reload the cart and try again.';

    constructor(
        readonly expectedRevision: number,
        readonly actualRevision: number,
    ) {
        super();
    }
}

export class CartLineNotFoundError extends StorefrontCartError {
    readonly __typename = 'CartLineNotFoundError';
    readonly errorCode = 'CART_LINE_NOT_FOUND_ERROR';
    readonly message = 'One or more cart lines do not belong to the active cart.';

    constructor(readonly lineIds: ID[]) {
        super();
    }
}

export class CartLineUnavailableError extends StorefrontCartError {
    readonly __typename = 'CartLineUnavailableError';
    readonly errorCode = 'CART_LINE_UNAVAILABLE_ERROR';
    readonly message = 'The product variant is not available in the active channel.';

    constructor(readonly productVariantId: ID) {
        super();
    }
}

export class CartCheckoutLockedError extends StorefrontCartError {
    readonly __typename = 'CartCheckoutLockedError';
    readonly errorCode = 'CART_CHECKOUT_LOCKED_ERROR';
    readonly message = 'The cart cannot be changed while checkout is pending.';

    constructor(readonly state: string) {
        super();
    }
}

export class InvalidCartQuantityError extends StorefrontCartError {
    readonly __typename = 'InvalidCartQuantityError';
    readonly errorCode = 'INVALID_CART_QUANTITY_ERROR';
    readonly message = 'The requested cart quantity is outside the allowed range.';

    constructor(
        readonly quantity: number,
        readonly maxQuantity: number,
    ) {
        super();
    }
}

export class CartProjectionError extends StorefrontCartError {
    readonly __typename = 'CartProjectionError';
    readonly errorCode = 'CART_PROJECTION_ERROR';

    constructor(
        readonly causeCode: string,
        readonly causeMessage: string,
        readonly message = 'The selected cart items could not be synchronized to checkout.',
    ) {
        super();
    }
}

export class CartEmptySelectionError extends StorefrontCartError {
    readonly __typename = 'CartEmptySelectionError';
    readonly errorCode = 'CART_EMPTY_SELECTION_ERROR';
    readonly message = 'Select at least one available cart item before checkout.';
}

export type StorefrontCartMutationError =
    | CartRevisionConflictError
    | CartLineNotFoundError
    | CartLineUnavailableError
    | CartCheckoutLockedError
    | InvalidCartQuantityError
    | CartProjectionError
    | CartEmptySelectionError;
