import { gql } from 'graphql-tag';

export const shopApiExtensions = gql`
    enum StorefrontCartState {
        OPEN
        PAYMENT_PENDING
    }

    enum StorefrontCartSelectionState {
        NONE
        PARTIAL
        ALL
    }

    type StorefrontCart implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        revision: Int!
        state: StorefrontCartState!
        projectedRevision: Int
        lines: [StorefrontCartLine!]!
        totalQuantity: Int!
        selectedLineCount: Int!
        selectedQuantity: Int!
        selectionState: StorefrontCartSelectionState!
        checkoutOrder: Order
    }

    type StorefrontCartLine implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        quantity: Int!
        selected: Boolean!
        available: Boolean!
        productVariant: ProductVariant
    }

    input AddStorefrontCartItemInput {
        productVariantId: ID!
        quantity: Int!
    }

    type CartRevisionConflictError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        expectedRevision: Int!
        actualRevision: Int!
    }

    type CartLineNotFoundError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        lineIds: [ID!]!
    }

    type CartLineUnavailableError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        productVariantId: ID!
    }

    type CartCheckoutLockedError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        state: String!
    }

    type InvalidCartQuantityError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        quantity: Int!
        maxQuantity: Int!
    }

    type CartProjectionError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        causeCode: String!
        causeMessage: String!
    }

    type CartEmptySelectionError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
    }

    enum StorefrontCartCheckoutState {
        PREPARED
        PLACED
        ABANDONED
    }

    type StorefrontCartCheckout implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        cartRevision: Int!
        state: StorefrontCartCheckoutState!
        completedAt: DateTime
        order: Order!
    }

    type StorefrontCheckoutSession {
        cart: StorefrontCart!
        order: Order!
        checkout: StorefrontCartCheckout
    }

    union StorefrontCartResult =
        | StorefrontCart
        | CartRevisionConflictError
        | CartLineNotFoundError
        | CartLineUnavailableError
        | CartCheckoutLockedError
        | InvalidCartQuantityError
        | CartProjectionError
        | CartEmptySelectionError
        | OrderLimitError

    union StorefrontCheckoutResult =
        | StorefrontCheckoutSession
        | CartRevisionConflictError
        | CartLineUnavailableError
        | CartCheckoutLockedError
        | CartProjectionError
        | CartEmptySelectionError
        | OrderLimitError

    input StorefrontCartLineChangeInput {
        lineId: ID!
        quantity: Int
        selected: Boolean
    }
    input StorefrontCartChangesInput {
        add: [AddStorefrontCartItemInput!]
        lines: [StorefrontCartLineChangeInput!]
        remove: [ID!]
    }
    input StorefrontCartOrderChangeInput {
        note: String
        currencyCode: CurrencyCode
        shippingAddress: CreateAddressInput
        shippingMethodId: ID
        customer: CreateCustomerInput
    }
    input StorefrontCartCommandInput {
        cartId: ID!
        commandId: String!
        expectedRevision: Int!
        changes: StorefrontCartChangesInput
        buyNow: AddStorefrontCartItemInput
        order: StorefrontCartOrderChangeInput
        beginCheckout: Boolean
        preparePayment: Boolean
        reopen: Boolean
    }
    enum StorefrontCartCommandStatus {
        APPLIED
        REJECTED
        CANCELLED
        NOT_FOUND
    }
    type StorefrontCartCommandResult {
        commandId: String!
        status: StorefrontCartCommandStatus!
        appliedRevision: Int
        errorCode: String
        message: String
        cart: StorefrontCart!
        session: StorefrontCheckoutSession
    }

    extend type Query {
        storefrontCart: StorefrontCart!
    }

    extend type Mutation {
        applyStorefrontCartCommand(input: StorefrontCartCommandInput!): StorefrontCartCommandResult!
        recoverStorefrontCartCommand(
            cartId: ID!
            commandId: String!
            cancel: Boolean = false
        ): StorefrontCartCommandResult!
        addStorefrontCartItem(
            input: AddStorefrontCartItemInput!
            expectedRevision: Int!
        ): StorefrontCartResult!
        setStorefrontCartLineQuantity(
            lineId: ID!
            quantity: Int!
            expectedRevision: Int!
        ): StorefrontCartResult!
        removeStorefrontCartLines(lineIds: [ID!]!, expectedRevision: Int!): StorefrontCartResult!
        setStorefrontCartLinesSelected(
            lineIds: [ID!]!
            selected: Boolean!
            expectedRevision: Int!
        ): StorefrontCartResult!
        setAllStorefrontCartLinesSelected(selected: Boolean!, expectedRevision: Int!): StorefrontCartResult!
        beginStorefrontCheckout(expectedRevision: Int!): StorefrontCheckoutResult!
        prepareStorefrontCartPayment(expectedRevision: Int!): StorefrontCheckoutResult!
        reopenStorefrontCart(expectedRevision: Int!): StorefrontCartResult!
    }
`;
