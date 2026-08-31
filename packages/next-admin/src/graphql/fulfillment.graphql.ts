import { gql } from '@apollo/client';

export const AUTO_CARD_VARIANTS_QUERY = gql`
    query NextAdminAutoCardVariants($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            totalItems
            items {
                id
                name
                sku
                customFields {
                    fulfillmentType
                    digitalDeliveryMode
                }
                product {
                    id
                    name
                }
            }
        }
        autoCardTodoSummary {
            lowStockSkuCount
            waitingStockDeliveryCount
            manualReviewCount
        }
    }
`;

export const AUTO_CARD_WORKSPACE_QUERY = gql`
    query NextAdminAutoCardWorkspace(
        $productVariantId: ID!
        $poolOptions: AutoCardPoolItemListOptions
        $deliveryOptions: AutoCardDeliveryListOptions
    ) {
        autoCardConfig(productVariantId: $productVariantId) {
            id
            updatedAt
            enabled
            formatName
            delimiter
            fields {
                key
                label
                labelEn
                secret
            }
            instructions
            instructionsZh
            instructionsEn
            lowStockThreshold
            availableCount
            assignedCount
            disabledCount
            waitingDeliveryCount
        }
        autoCardPoolItems(productVariantId: $productVariantId, options: $poolOptions) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                state
                sequence
                assignedAt
                disabledReason
                deliveryId
                maskedFields {
                    key
                    label
                    labelEn
                    value
                    secret
                }
            }
        }
        autoCardDeliveries(options: $deliveryOptions) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                state
                recipientEmail
                productName
                sku
                quantity
                attemptCount
                lastError
                lastDispatchedAt
                sentAt
                order {
                    id
                    code
                    state
                }
                events {
                    id
                    createdAt
                    type
                    actorType
                    note
                }
            }
        }
    }
`;

export const UPDATE_AUTO_CARD_CONFIG_MUTATION = gql`
    mutation NextAdminUpdateAutoCardConfig($input: UpdateAutoCardConfigInput!) {
        updateAutoCardConfig(input: $input) {
            id
            enabled
            formatName
            delimiter
            fields {
                key
                label
                labelEn
                secret
            }
            instructionsZh
            instructionsEn
            lowStockThreshold
        }
    }
`;

export const PREVIEW_AUTO_CARD_IMPORT_MUTATION = gql`
    mutation NextAdminPreviewAutoCardImport($input: AutoCardImportInput!) {
        previewAutoCardPoolImport(input: $input) {
            validCount
            invalidCount
            rows {
                lineNumber
                fields {
                    key
                    label
                    labelEn
                    value
                    secret
                }
            }
            errors {
                lineNumber
                message
            }
        }
    }
`;

export const IMPORT_AUTO_CARD_ITEMS_MUTATION = gql`
    mutation NextAdminImportAutoCardItems($input: AutoCardImportInput!) {
        importAutoCardPoolItems(input: $input) {
            importedCount
            duplicateCount
            availableCount
        }
    }
`;

export const REVEAL_AUTO_CARD_ITEM_MUTATION = gql`
    mutation NextAdminRevealAutoCardItem($id: ID!) {
        revealAutoCardPoolItem(id: $id) {
            key
            label
            labelEn
            value
            secret
        }
    }
`;

export const SET_AUTO_CARD_ITEM_ENABLED_MUTATION = gql`
    mutation NextAdminSetAutoCardItemEnabled($id: ID!, $enabled: Boolean!, $reason: String) {
        setAutoCardPoolItemEnabled(id: $id, enabled: $enabled, reason: $reason) {
            id
            state
            disabledReason
        }
    }
`;

export const RETRY_AUTO_CARD_DELIVERY_MUTATION = gql`
    mutation NextAdminRetryAutoCardDelivery($id: ID!) {
        retryAutoCardDelivery(id: $id) {
            id
            state
            attemptCount
            lastError
        }
    }
`;

export interface AutoCardFieldRecord {
    key: string;
    label: string;
    labelEn: string;
    value: string;
    secret: boolean;
}

export interface AutoCardVariantRecord {
    id: string;
    name: string;
    sku: string;
    customFields: { fulfillmentType?: string; digitalDeliveryMode?: string } | null;
    product: { id: string; name: string };
}

export interface AutoCardVariantsResult {
    productVariants: { totalItems: number; items: AutoCardVariantRecord[] };
    autoCardTodoSummary: {
        lowStockSkuCount: number;
        waitingStockDeliveryCount: number;
        manualReviewCount: number;
    };
}

export interface AutoCardConfigRecord {
    id: string;
    updatedAt: string;
    enabled: boolean;
    formatName: string;
    delimiter: string;
    fields: Array<Omit<AutoCardFieldRecord, 'value'>>;
    instructions: string;
    instructionsZh: string;
    instructionsEn: string;
    lowStockThreshold: number;
    availableCount: number;
    assignedCount: number;
    disabledCount: number;
    waitingDeliveryCount: number;
}

export interface AutoCardPoolItemRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    state: 'AVAILABLE' | 'ASSIGNED' | 'DISABLED';
    sequence: number;
    assignedAt: string | null;
    disabledReason: string | null;
    deliveryId: string | null;
    maskedFields: AutoCardFieldRecord[];
}

export interface AutoCardDeliveryRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    state: 'WAITING_STOCK' | 'ALLOCATED' | 'RETRYING' | 'SENT' | 'MANUAL_REVIEW';
    recipientEmail: string;
    productName: string;
    sku: string;
    quantity: number;
    attemptCount: number;
    lastError: string | null;
    lastDispatchedAt: string | null;
    sentAt: string | null;
    order: { id: string; code: string; state: string };
    events: Array<{ id: string; createdAt: string; type: string; actorType: string; note: string }>;
}

export interface AutoCardWorkspaceResult {
    autoCardConfig: AutoCardConfigRecord | null;
    autoCardPoolItems: { totalItems: number; items: AutoCardPoolItemRecord[] };
    autoCardDeliveries: { totalItems: number; items: AutoCardDeliveryRecord[] };
}

export interface AutoCardImportPreviewResult {
    previewAutoCardPoolImport: {
        validCount: number;
        invalidCount: number;
        rows: Array<{ lineNumber: number; fields: AutoCardFieldRecord[] }>;
        errors: Array<{ lineNumber: number; message: string }>;
    };
}
