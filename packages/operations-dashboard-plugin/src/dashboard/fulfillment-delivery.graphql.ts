import { gql } from 'graphql-tag';

export type FulfillmentDeliveryStatus = 'IN_TRANSIT' | 'EXCEPTION' | 'DELIVERED';

export interface FulfillmentDeliveryRecord {
    id: string;
    status: FulfillmentDeliveryStatus;
    carrier: string;
    trackingCode: string;
    exceptionReason: string | null;
    proofReference: string | null;
    nextActionDueAt: string | null;
    overdue: boolean;
    events: Array<{
        id: string;
        createdAt: string;
        actorLabel: string;
        actorId: string | null;
        note: string;
    }>;
}

export interface FulfillmentDeliveryOrderResult {
    order: {
        id: string;
        fulfillments: Array<{
            id: string;
            state: string;
            method: string;
            trackingCode: string | null;
            deliveryEvidence: FulfillmentDeliveryRecord | null;
        }>;
    } | null;
}

export const fulfillmentDeliveryOrderQuery = gql`
    query OperationsFulfillmentDeliveryOrder($id: ID!) {
        order(id: $id) {
            id
            fulfillments {
                id
                state
                method
                trackingCode
                deliveryEvidence {
                    id
                    status
                    carrier
                    trackingCode
                    exceptionReason
                    proofReference
                    nextActionDueAt
                    overdue
                    events {
                        id
                        createdAt
                        actorLabel
                        actorId
                        note
                    }
                }
            }
        }
    }
`;

export const updateFulfillmentDeliveryMutation = gql`
    mutation OperationsUpdateFulfillmentDelivery($input: UpdateFulfillmentDeliveryInput!) {
        updateFulfillmentDelivery(input: $input) {
            id
            status
            carrier
            trackingCode
            exceptionReason
            proofReference
            nextActionDueAt
            overdue
        }
    }
`;
