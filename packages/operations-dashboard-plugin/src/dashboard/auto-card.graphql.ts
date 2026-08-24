import { gql } from 'graphql-tag';

export type AutoCardPoolItemState = 'AVAILABLE' | 'ASSIGNED' | 'DISABLED';
export type AutoCardDeliveryState = 'WAITING_STOCK' | 'ALLOCATED' | 'RETRYING' | 'SENT' | 'MANUAL_REVIEW';

export interface AutoCardFieldDefinition {
    key: string;
    label: string;
    labelEn: string;
    secret: boolean;
}

export interface AutoCardVariantRecord {
    id: string;
    name: string;
    sku: string;
    customFields?: {
        fulfillmentType?: string;
        digitalDeliveryMode?: string;
    } | null;
}

export interface AutoCardConfigRecord {
    id: string;
    enabled: boolean;
    formatName: string;
    delimiter: string;
    fields: AutoCardFieldDefinition[];
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
    state: AutoCardPoolItemState;
    sequence: number;
    assignedAt: string | null;
    disabledReason: string | null;
    deliveryId: string | null;
    maskedFields: Array<AutoCardFieldDefinition & { value: string }>;
}

export interface AutoCardDeliveryRecord {
    id: string;
    createdAt: string;
    state: AutoCardDeliveryState;
    recipientEmail: string;
    productName: string;
    sku: string;
    quantity: number;
    attemptCount: number;
    lastError: string | null;
    sentAt: string | null;
    order: { id: string; code: string; state: string };
    events: Array<{ id: string; createdAt: string; type: string; note: string }>;
}

export interface AutoCardWorkspaceResult {
    autoCardConfig: AutoCardConfigRecord | null;
    autoCardPoolItems: { items: AutoCardPoolItemRecord[]; totalItems: number };
    autoCardDeliveries: { items: AutoCardDeliveryRecord[]; totalItems: number };
}

export interface AutoCardTodoSummaryRecord {
    lowStockSkuCount: number;
    waitingStockDeliveryCount: number;
    manualReviewCount: number;
}

export const autoCardTodoSummaryQuery = gql`
    query AutoCardTodoSummary {
        autoCardTodoSummary {
            lowStockSkuCount
            waitingStockDeliveryCount
            manualReviewCount
        }
    }
`;

export const autoCardVariantsQuery = gql`
    query AutoCardVariants($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            items {
                id
                name
                sku
                customFields
            }
            totalItems
        }
    }
`;

export const autoCardWorkspaceQuery = gql`
    query AutoCardWorkspace($productVariantId: ID!, $poolOptions: AutoCardPoolItemListOptions) {
        autoCardConfig(productVariantId: $productVariantId) {
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
        autoCardDeliveries(options: { productVariantId: $productVariantId, take: 20 }) {
            totalItems
            items {
                id
                createdAt
                state
                recipientEmail
                productName
                sku
                quantity
                attemptCount
                lastError
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
                    note
                }
            }
        }
    }
`;

export const updateAutoCardConfigMutation = gql`
    mutation UpdateAutoCardConfig($input: UpdateAutoCardConfigInput!) {
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
            instructions
            instructionsZh
            instructionsEn
            lowStockThreshold
            availableCount
            assignedCount
            disabledCount
            waitingDeliveryCount
        }
    }
`;

export const previewAutoCardPoolImportMutation = gql`
    mutation PreviewAutoCardPoolImport($input: AutoCardImportInput!) {
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

export const importAutoCardPoolItemsMutation = gql`
    mutation ImportAutoCardPoolItems($input: AutoCardImportInput!) {
        importAutoCardPoolItems(input: $input) {
            importedCount
            duplicateCount
            availableCount
        }
    }
`;

export const revealAutoCardPoolItemMutation = gql`
    mutation RevealAutoCardPoolItem($id: ID!) {
        revealAutoCardPoolItem(id: $id) {
            key
            label
            labelEn
            value
            secret
        }
    }
`;

export const setAutoCardPoolItemEnabledMutation = gql`
    mutation SetAutoCardPoolItemEnabled($id: ID!, $enabled: Boolean!, $reason: String) {
        setAutoCardPoolItemEnabled(id: $id, enabled: $enabled, reason: $reason) {
            id
            state
            disabledReason
        }
    }
`;

export const retryAutoCardDeliveryMutation = gql`
    mutation RetryAutoCardDelivery($id: ID!) {
        retryAutoCardDelivery(id: $id) {
            id
            state
            attemptCount
            lastError
        }
    }
`;
