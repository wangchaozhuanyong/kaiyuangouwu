import { gql } from '@apollo/client';

export const ORDER_OPERATIONS_QUERY = gql`
    query NextAdminOrderOperations($id: ID!) {
        order(id: $id) {
            id
            code
            state
            totalWithTax
            currencyCode
            payments {
                id
                createdAt
                state
                nextStates
                method
                transactionId
                amount
                errorMessage
                refunds {
                    id
                    createdAt
                    state
                    total
                    reason
                    transactionId
                }
            }
            sellerOrders {
                id
                code
                state
                orderPlacedAt
                currencyCode
                totalWithTax
                channels {
                    id
                    code
                    seller {
                        id
                        name
                    }
                }
            }
            storeCouponAllocations {
                id
                customerCouponId
                campaignId
                campaignName
                status
                currencyCode
                discountAmountWithTax
                refundedAmount
                usedAt
                refundedAt
                refundId
            }
        }
    }
`;

export const PAYMENT_METHODS_FOR_MANUAL_QUERY = gql`
    query NextAdminPaymentMethodsForManualPayment {
        paymentMethods(options: { take: 100, filter: { enabled: { eq: true } } }) {
            items {
                id
                name
                code
                description
                enabled
            }
            totalItems
        }
    }
`;

const PAYMENT_RESULT_FIELDS = gql`
    fragment NextAdminPaymentOperationResultFields on Payment {
        id
        state
        nextStates
        amount
        method
        transactionId
        errorMessage
    }
`;

export const ADD_MANUAL_PAYMENT_MUTATION = gql`
    mutation NextAdminAddManualPayment($input: ManualPaymentInput!) {
        addManualPaymentToOrder(input: $input) {
            __typename
            ... on Order {
                id
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const SETTLE_PAYMENT_MUTATION = gql`
    ${PAYMENT_RESULT_FIELDS}
    mutation NextAdminSettlePayment($id: ID!) {
        settlePayment(id: $id) {
            __typename
            ... on Payment {
                ...NextAdminPaymentOperationResultFields
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const TRANSITION_PAYMENT_MUTATION = gql`
    ${PAYMENT_RESULT_FIELDS}
    mutation NextAdminTransitionPayment($id: ID!, $state: String!) {
        transitionPaymentToState(id: $id, state: $state) {
            __typename
            ... on Payment {
                ...NextAdminPaymentOperationResultFields
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const CANCEL_PAYMENT_MUTATION = gql`
    ${PAYMENT_RESULT_FIELDS}
    mutation NextAdminCancelPayment($id: ID!) {
        cancelPayment(id: $id) {
            __typename
            ... on Payment {
                ...NextAdminPaymentOperationResultFields
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const SETTLE_REFUND_MUTATION = gql`
    mutation NextAdminSettleRefund($input: SettleRefundInput!) {
        settleRefund(input: $input) {
            __typename
            ... on Refund {
                id
                state
                total
                transactionId
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export interface OrderOperationPayment {
    id: string;
    createdAt: string;
    state: string;
    nextStates: string[];
    method: string;
    transactionId: string | null;
    amount: number;
    errorMessage: string | null;
    refunds: Array<{
        id: string;
        createdAt: string;
        state: string;
        total: number;
        reason: string | null;
        transactionId: string | null;
    }>;
}

export interface OrderOperationsData {
    order: {
        id: string;
        code: string;
        state: string;
        totalWithTax: number;
        currencyCode: string;
        payments: OrderOperationPayment[];
        sellerOrders: Array<{
            id: string;
            code: string;
            state: string;
            orderPlacedAt: string | null;
            currencyCode: string;
            totalWithTax: number;
            channels: Array<{ id: string; code: string; seller: { id: string; name: string } | null }>;
        }> | null;
        storeCouponAllocations: Array<{
            id: string;
            customerCouponId: string;
            campaignId: string;
            campaignName: string;
            status: string;
            currencyCode: string;
            discountAmountWithTax: number;
            refundedAmount: number;
            usedAt: string | null;
            refundedAt: string | null;
            refundId: string | null;
        }>;
    } | null;
}

export interface PaymentMethodsForManualData {
    paymentMethods: {
        items: Array<{ id: string; name: string; code: string; description: string; enabled: boolean }>;
        totalItems: number;
    };
}

export interface OrderOperationResult {
    __typename: string;
    id?: string;
    state?: string;
    errorCode?: string;
    message?: string;
}
