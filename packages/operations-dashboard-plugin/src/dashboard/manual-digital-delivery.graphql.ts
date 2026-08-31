import { gql } from 'graphql-tag';

export type ManualDeliveryState =
    'WAITING_PROCESSING' | 'DRAFT' | 'SENDING' | 'SENT' | 'EMAIL_FAILED' | 'MANUAL_REVIEW' | 'CANCELLED';

export interface ManualDeliveryRecord {
    id: string;
    createdAt: string;
    state: ManualDeliveryState;
    recipientEmail: string;
    productName: string;
    sku: string;
    quantity: number;
    expectedAt: string;
    overdue: boolean;
    attemptCount: number;
    lastError: string | null;
    sentAt: string | null;
    order: { id: string; code: string };
    events: Array<{
        id: string;
        createdAt: string;
        type: string;
        actorType: string;
        actorId: string | null;
        note: string;
    }>;
    packages: Array<{
        fields: Array<{ key: string; label: string; value: string; secret: boolean }>;
        note: string;
        attachmentAssetIds: string[];
    }>;
}

const fields = gql`
    fragment ManualDeliveryFields on ManualDigitalDelivery {
        id
        createdAt
        state
        recipientEmail
        productName
        sku
        quantity
        expectedAt
        overdue
        attemptCount
        lastError
        sentAt
        order {
            id
            code
        }
        events {
            id
            createdAt
            type
            actorType
            actorId
            note
        }
        packages {
            fields {
                key
                label
                value
                secret
            }
            note
            attachmentAssetIds
        }
    }
`;

export const manualDigitalDeliveriesQuery = gql`
    ${fields}
    query ManualDigitalDeliveries($options: ManualDigitalDeliveryListOptions) {
        manualDigitalDeliveries(options: $options) {
            items {
                ...ManualDeliveryFields
            }
            totalItems
        }
    }
`;

export const saveManualDigitalDeliveryDraftMutation = gql`
    ${fields}
    mutation SaveManualDigitalDeliveryDraft($input: SaveManualDigitalDeliveryInput!) {
        saveManualDigitalDeliveryDraft(input: $input) {
            ...ManualDeliveryFields
        }
    }
`;

export const publishManualDigitalDeliveryMutation = gql`
    ${fields}
    mutation PublishManualDigitalDelivery($input: SaveManualDigitalDeliveryInput!) {
        publishManualDigitalDelivery(input: $input) {
            ...ManualDeliveryFields
        }
    }
`;

export const retryManualDigitalDeliveryMutation = gql`
    ${fields}
    mutation RetryManualDigitalDelivery($id: ID!) {
        retryManualDigitalDelivery(id: $id) {
            ...ManualDeliveryFields
        }
    }
`;
