import { gql } from 'graphql-tag';

export type AfterSalesState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';
export type AfterSalesType = 'REFUND_ONLY' | 'RETURN_AND_REFUND' | 'EXCHANGE' | 'RESHIP';
export type AfterSalesReturnStatus =
    'NOT_REQUIRED' | 'AWAITING_SHIPMENT' | 'IN_TRANSIT' | 'RECEIVED' | 'INSPECTED';
export type AfterSalesReplacementStatus = 'NOT_REQUIRED' | 'PENDING' | 'SHIPPED' | 'EXCEPTION' | 'DELIVERED';

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
    returnStatus: AfterSalesReturnStatus;
    returnInstructions: string | null;
    returnCarrier: string | null;
    returnTrackingCode: string | null;
    replacementStatus: AfterSalesReplacementStatus;
    replacementCarrier: string | null;
    replacementTrackingCode: string | null;
    replacementException: string | null;
    replacementProofReference: string | null;
    nextActionDueAt: string | null;
    overdue: boolean;
    customerName: string;
    customerEmail: string;
    order: {
        id: string;
        code: string;
        state: string;
        payments: Array<{
            id: string;
            refunds: Array<{
                id: string;
                createdAt: string;
                state: string;
                total: number;
                transactionId: string | null;
            }>;
        }>;
    };
    refund: { id: string; state: string; total: number; transactionId: string | null } | null;
    refundedAt: string | null;
    items: Array<{
        id: string;
        quantity: number;
        lineAmountWithTax: number;
        productName: string;
        sku: string;
        fulfillmentType: string;
        acceptedReturnQuantity: number;
        rejectedReturnQuantity: number;
        returnLotCode: string | null;
        inventoryOperationId: string | null;
        returnStockLocation: { id: string; name: string } | null;
    }>;
    events: Array<{
        id: string;
        createdAt: string;
        state: AfterSalesState;
        eventType: string;
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
                returnStatus
                returnInstructions
                returnCarrier
                returnTrackingCode
                replacementStatus
                replacementCarrier
                replacementTrackingCode
                replacementException
                replacementProofReference
                nextActionDueAt
                overdue
                customerName
                customerEmail
                order {
                    id
                    code
                    state
                    payments {
                        id
                        refunds {
                            id
                            createdAt
                            state
                            total
                            transactionId
                        }
                    }
                }
                refund {
                    id
                    state
                    total
                    transactionId
                }
                refundedAt
                items {
                    id
                    quantity
                    lineAmountWithTax
                    productName
                    sku
                    fulfillmentType
                    acceptedReturnQuantity
                    rejectedReturnQuantity
                    returnLotCode
                    inventoryOperationId
                    returnStockLocation {
                        id
                        name
                    }
                }
                events {
                    id
                    createdAt
                    state
                    eventType
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

export const receiveAfterSalesReturnMutation = gql`
    mutation OperationsReceiveAfterSalesReturn($input: ReceiveAfterSalesReturnInput!) {
        receiveAfterSalesReturn(input: $input) {
            id
            returnStatus
            updatedAt
        }
    }
`;

export const inspectAfterSalesReturnMutation = gql`
    mutation OperationsInspectAfterSalesReturn($input: InspectAfterSalesReturnInput!) {
        inspectAfterSalesReturn(input: $input) {
            id
            returnStatus
            updatedAt
        }
    }
`;

export const updateAfterSalesReplacementMutation = gql`
    mutation OperationsUpdateAfterSalesReplacement($input: UpdateAfterSalesReplacementInput!) {
        updateAfterSalesReplacement(input: $input) {
            id
            replacementStatus
            updatedAt
        }
    }
`;

export const afterSalesStockLocationsQuery = gql`
    query OperationsAfterSalesStockLocations {
        stockLocations(options: { take: 200 }) {
            items {
                id
                name
            }
        }
    }
`;
