import { gql } from '@apollo/client';

export interface ManualDeliveryRecord {
    id: string;
    state:
        'WAITING_PROCESSING' | 'DRAFT' | 'SENDING' | 'SENT' | 'EMAIL_FAILED' | 'MANUAL_REVIEW' | 'CANCELLED';
    recipientEmail: string;
    productName: string;
    sku: string;
    quantity: number;
    expectedAt: string;
    overdue: boolean;
    attemptCount: number;
    lastError?: string | null;
    sentAt?: string | null;
    order: { id: string; code: string };
    events?: Array<{
        id: string;
        createdAt: string;
        note: string;
    }>;
    packages: Array<{
        fields: Array<{ key: string; label: string; value: string; secret: boolean }>;
        note: string;
        attachmentAssetIds: string[];
    }>;
}

const LIST_FIELDS = gql`
    fragment NextAdminManualDeliveryListFields on ManualDigitalDelivery {
        id
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
    }
`;

const DETAIL_FIELDS = gql`
    fragment NextAdminManualDeliveryDetailFields on ManualDigitalDelivery {
        ...NextAdminManualDeliveryListFields
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
        events {
            id
            createdAt
            note
        }
    }
    ${LIST_FIELDS}
`;

export const GET_MANUAL_DELIVERIES = gql`
    query NextAdminManualDeliveries($options: ManualDigitalDeliveryListOptions) {
        manualDigitalDeliveries(options: $options) {
            items {
                ...NextAdminManualDeliveryListFields
            }
            totalItems
        }
    }
    ${LIST_FIELDS}
`;

export const GET_MANUAL_DELIVERY = gql`
    query NextAdminManualDelivery($id: ID!) {
        manualDigitalDelivery(id: $id) {
            ...NextAdminManualDeliveryDetailFields
        }
    }
    ${DETAIL_FIELDS}
`;

export const SAVE_MANUAL_DELIVERY_DRAFT = gql`
    mutation NextAdminSaveManualDeliveryDraft($input: SaveManualDigitalDeliveryInput!) {
        saveManualDigitalDeliveryDraft(input: $input) {
            id
            state
        }
    }
`;

export const PUBLISH_MANUAL_DELIVERY = gql`
    mutation NextAdminPublishManualDelivery($input: SaveManualDigitalDeliveryInput!) {
        publishManualDigitalDelivery(input: $input) {
            id
            state
        }
    }
`;

export const RETRY_MANUAL_DELIVERY = gql`
    mutation NextAdminRetryManualDelivery($id: ID!) {
        retryManualDigitalDelivery(id: $id) {
            id
            state
        }
    }
`;
