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
