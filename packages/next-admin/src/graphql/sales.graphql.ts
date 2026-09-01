import { gql } from '@apollo/client';

const ORDER_LIST_FIELDS = gql`
    fragment SalesOrderListFields on Order {
        id
        createdAt
        updatedAt
        orderPlacedAt
        code
        state
        active
        totalQuantity
        totalWithTax
        currencyCode
        customer {
            id
            firstName
            lastName
            emailAddress
            phoneNumber
        }
        shippingAddress {
            fullName
            company
            streetLine1
            streetLine2
            city
            province
            postalCode
            country
            countryCode
            phoneNumber
        }
        lines {
            id
            quantity
            featuredAsset {
                id
                name
                preview
            }
            productVariant {
                id
                name
                sku
                options {
                    id
                    name
                    code
                }
                customFields {
                    fulfillmentType
                    digitalDeliveryMode
                }
            }
            customFields {
                fulfillmentTypeSnapshot
                digitalDeliveryModeSnapshot
            }
            fulfillmentLines {
                fulfillmentId
                quantity
            }
        }
        fulfillments {
            id
            state
            nextStates
            handlerCode
            method
            trackingCode
            lines {
                orderLineId
                quantity
            }
        }
        payments {
            id
            state
            method
            transactionId
            amount
            refunds {
                id
                state
                total
                reason
                transactionId
            }
        }
    }
`;

const AFTER_SALES_FIELDS = gql`
    fragment AdminAfterSalesFields on AfterSalesRequest {
        id
        createdAt
        updatedAt
        code
        type
        state
        reason
        description
        currencyCode
        requestedAmount
        approvedAmount
        resolution
        customerName
        customerEmail
        respondedAt
        completedAt
        cancelledAt
        refundedAt
        refund {
            id
            state
            total
            reason
            transactionId
        }
        order {
            id
            code
            state
            totalWithTax
            currencyCode
            payments {
                id
                state
                method
                amount
                refunds {
                    id
                    state
                    total
                    reason
                    transactionId
                }
            }
        }
        items {
            id
            orderLineId
            quantity
            unitPriceWithTax
            lineAmountWithTax
            productName
            sku
            fulfillmentType
        }
        events {
            id
            createdAt
            state
            actorType
            actorLabel
            actorId
            note
        }
    }
`;

export const GET_SALES_ORDERS = gql`
    query GetSalesOrders($options: OrderListOptions) {
        orders(options: $options) {
            items {
                ...SalesOrderListFields
            }
            totalItems
        }
        physicalFulfillmentTodoCount
    }
    ${ORDER_LIST_FIELDS}
`;

export const GET_SALES_ORDER = gql`
    query GetSalesOrder($id: ID!) {
        order(id: $id) {
            ...SalesOrderListFields
            nextStates
            type
            subTotalWithTax
            shippingWithTax
            discounts {
                description
                amountWithTax
            }
            couponCodes
            channels {
                id
                code
                token
            }
            billingAddress {
                fullName
                company
                streetLine1
                streetLine2
                city
                province
                postalCode
                country
                countryCode
                phoneNumber
            }
            lines {
                id
                unitPriceWithTax
                proratedUnitPriceWithTax
                linePriceWithTax
                discountedLinePriceWithTax
            }
            shippingLines {
                id
                discountedPriceWithTax
                shippingMethod {
                    id
                    code
                    name
                    fulfillmentHandlerCode
                }
            }
            history(options: { take: 100, sort: { createdAt: DESC } }) {
                totalItems
                items {
                    id
                    type
                    createdAt
                    isPublic
                    administrator {
                        id
                        firstName
                        lastName
                    }
                    data
                }
            }
        }
        fulfillmentHandlers {
            code
            args {
                name
                type
                required
            }
        }
    }
    ${ORDER_LIST_FIELDS}
`;

export const SET_SALES_ORDER_CUSTOM_FIELDS = gql`
    mutation SetSalesOrderCustomFields($input: UpdateOrderInput!) {
        setOrderCustomFields(input: $input) {
            id
            updatedAt
        }
    }
`;

export const CREATE_DRAFT_ORDER = gql`
    mutation CreateSalesDraftOrder {
        createDraftOrder {
            id
            code
            state
        }
    }
`;

export const DELETE_DRAFT_ORDER = gql`
    mutation DeleteSalesDraftOrder($orderId: ID!) {
        deleteDraftOrder(orderId: $orderId) {
            result
            message
        }
    }
`;

export const ADD_ITEM_TO_DRAFT_ORDER = gql`
    mutation AddSalesDraftOrderItem($orderId: ID!, $input: AddItemToDraftOrderInput!) {
        addItemToDraftOrder(orderId: $orderId, input: $input) {
            __typename
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const ADJUST_DRAFT_ORDER_LINE = gql`
    mutation AdjustSalesDraftOrderLine($orderId: ID!, $input: AdjustDraftOrderLineInput!) {
        adjustDraftOrderLine(orderId: $orderId, input: $input) {
            __typename
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const REMOVE_DRAFT_ORDER_LINE = gql`
    mutation RemoveSalesDraftOrderLine($orderId: ID!, $orderLineId: ID!) {
        removeDraftOrderLine(orderId: $orderId, orderLineId: $orderLineId) {
            __typename
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const SET_DRAFT_ORDER_CUSTOMER = gql`
    mutation SetSalesDraftOrderCustomer($orderId: ID!, $customerId: ID!) {
        setCustomerForDraftOrder(orderId: $orderId, customerId: $customerId) {
            __typename
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const SET_DRAFT_ORDER_SHIPPING_ADDRESS = gql`
    mutation SetSalesDraftOrderShippingAddress($orderId: ID!, $input: CreateAddressInput!) {
        setDraftOrderShippingAddress(orderId: $orderId, input: $input) {
            id
        }
    }
`;

export const SET_DRAFT_ORDER_BILLING_ADDRESS = gql`
    mutation SetSalesDraftOrderBillingAddress($orderId: ID!, $input: CreateAddressInput!) {
        setDraftOrderBillingAddress(orderId: $orderId, input: $input) {
            id
        }
    }
`;

export const GET_DRAFT_ORDER_SHIPPING_METHODS = gql`
    query GetSalesDraftOrderShippingMethods($orderId: ID!) {
        eligibleShippingMethodsForDraftOrder(orderId: $orderId) {
            id
            code
            name
            description
            price
            priceWithTax
        }
    }
`;

export const SET_DRAFT_ORDER_SHIPPING_METHOD = gql`
    mutation SetSalesDraftOrderShippingMethod($orderId: ID!, $shippingMethodId: ID!) {
        setDraftOrderShippingMethod(orderId: $orderId, shippingMethodId: $shippingMethodId) {
            __typename
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const APPLY_DRAFT_ORDER_COUPON = gql`
    mutation ApplySalesDraftOrderCoupon($orderId: ID!, $couponCode: String!) {
        applyCouponCodeToDraftOrder(orderId: $orderId, couponCode: $couponCode) {
            __typename
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const REMOVE_DRAFT_ORDER_COUPON = gql`
    mutation RemoveSalesDraftOrderCoupon($orderId: ID!, $couponCode: String!) {
        removeCouponCodeFromDraftOrder(orderId: $orderId, couponCode: $couponCode) {
            id
        }
    }
`;

export const ORDER_VARIANT_SEARCH_QUERY = gql`
    query SearchSalesOrderVariants($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            items {
                id
                name
                sku
                price
                currencyCode
                stockLevel
                enabled
                featuredAsset {
                    id
                    preview
                }
            }
            totalItems
        }
    }
`;

export const ORDER_CUSTOMER_SEARCH_QUERY = gql`
    query SearchSalesOrderCustomers($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                firstName
                lastName
                emailAddress
                phoneNumber
                addresses {
                    id
                    fullName
                    company
                    streetLine1
                    streetLine2
                    city
                    province
                    postalCode
                    phoneNumber
                    defaultShippingAddress
                    defaultBillingAddress
                    country {
                        code
                        name
                    }
                }
            }
            totalItems
        }
    }
`;

export const MODIFY_SALES_ORDER = gql`
    mutation ModifySalesOrder($input: ModifyOrderInput!) {
        modifyOrder(input: $input) {
            __typename
            ... on ErrorResult {
                errorCode
                message
            }
            ... on Order {
                id
                code
                state
                totalWithTax
                currencyCode
                lines {
                    id
                    quantity
                    unitPriceWithTax
                    linePriceWithTax
                    productVariant {
                        id
                        name
                        sku
                    }
                }
            }
        }
    }
`;

export const ADD_ORDER_FULFILLMENT = gql`
    mutation AddSalesOrderFulfillment($input: FulfillOrderInput!) {
        addFulfillmentToOrder(input: $input) {
            __typename
            ... on Fulfillment {
                id
                state
                method
                trackingCode
                lines {
                    orderLineId
                    quantity
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const TRANSITION_SALES_FULFILLMENT = gql`
    mutation TransitionSalesFulfillment($id: ID!, $state: String!) {
        transitionFulfillmentToState(id: $id, state: $state) {
            __typename
            ... on Fulfillment {
                id
                state
                nextStates
                method
                trackingCode
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on FulfillmentStateTransitionError {
                transitionError
            }
        }
    }
`;

export const TRANSITION_SALES_ORDER = gql`
    mutation TransitionSalesOrder($id: ID!, $state: String!) {
        transitionOrderToState(id: $id, state: $state) {
            __typename
            ... on Order {
                id
                state
                nextStates
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on OrderStateTransitionError {
                transitionError
            }
        }
    }
`;

export const ADD_SALES_ORDER_NOTE = gql`
    mutation AddSalesOrderNote($input: AddNoteToOrderInput!) {
        addNoteToOrder(input: $input) {
            id
            updatedAt
        }
    }
`;

export const REFUND_SALES_ORDER = gql`
    mutation RefundSalesOrder($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            __typename
            ... on Refund {
                id
                state
                total
                reason
                transactionId
                method
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const CANCEL_SALES_ORDER = gql`
    mutation CancelSalesOrder($input: CancelOrderInput!) {
        cancelOrder(input: $input) {
            __typename
            ... on Order {
                id
                state
                nextStates
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const GET_AFTER_SALES_REQUESTS = gql`
    query GetAdminAfterSalesRequests($options: AfterSalesRequestListOptions) {
        afterSalesRequests(options: $options) {
            items {
                ...AdminAfterSalesFields
            }
            totalItems
        }
    }
    ${AFTER_SALES_FIELDS}
`;

export const TRANSITION_AFTER_SALES_REQUEST = gql`
    mutation TransitionAdminAfterSalesRequest($input: TransitionAfterSalesRequestInput!) {
        transitionAfterSalesRequest(input: $input) {
            ...AdminAfterSalesFields
        }
    }
    ${AFTER_SALES_FIELDS}
`;

export const GET_STOREFRONT_REVIEWS = gql`
    query GetAdminStorefrontReviews($options: StorefrontReviewListOptions) {
        storefrontReviews(options: $options) {
            items {
                id
                createdAt
                updatedAt
                state
                rating
                title
                body
                customerName
                productName
                sku
                merchantResponse
                moderatedAt
                orderLineId
                productId
                productVariantId
                verifiedPurchase
            }
            totalItems
            averageRating
        }
    }
`;

export const MODERATE_STOREFRONT_REVIEW = gql`
    mutation ModerateAdminStorefrontReview($input: ModerateStorefrontReviewInput!) {
        moderateStorefrontReview(input: $input) {
            id
            updatedAt
            state
            merchantResponse
            moderatedAt
        }
    }
`;
