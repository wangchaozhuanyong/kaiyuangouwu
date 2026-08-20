import { gql } from 'graphql-tag';

export type AfterSalesState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';
export type AfterSalesType = 'REFUND_ONLY' | 'RETURN_AND_REFUND';

export interface AfterSalesRequestRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    code: string;
    type: AfterSalesType;
    state: AfterSalesState;
    reason: string;
    description: string;
    currencyCode: string;
    requestedAmount: number;
    approvedAmount: number | null;
    resolution: string | null;
    customerName: string;
    customerEmail: string;
    order: { id: string; code: string; state: string };
    items: Array<{
        id: string;
        quantity: number;
        lineAmountWithTax: number;
        productName: string;
        sku: string;
        fulfillmentType: string;
    }>;
    events: Array<{
        id: string;
        createdAt: string;
        state: AfterSalesState;
        actorType: string;
        actorLabel: string;
        actorId: string | null;
        note: string;
    }>;
}

export interface AfterSalesRequestsResult {
    afterSalesRequests: {
        items: AfterSalesRequestRecord[];
        totalItems: number;
    };
}

export const afterSalesRequestsQuery = gql`
    query OperationsAfterSalesRequests($options: AfterSalesRequestListOptions) {
        afterSalesRequests(options: $options) {
            totalItems
            items {
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
                order {
                    id
                    code
                    state
                }
                items {
                    id
                    quantity
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
        }
    }
`;

export const transitionAfterSalesRequestMutation = gql`
    mutation OperationsTransitionAfterSalesRequest($input: TransitionAfterSalesRequestInput!) {
        transitionAfterSalesRequest(input: $input) {
            id
            state
            approvedAmount
            resolution
            updatedAt
        }
    }
`;
