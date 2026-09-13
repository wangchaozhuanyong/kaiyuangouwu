import { gql } from '@apollo/client';

const usageRecordFields = gql`
    fragment ImageAiUsageRecordFields on ImageAiUsageRecord {
        id
        recordType
        createdAt
        channelId
        modelCode
        credentialCode
        credentialName
        credentialLast4
        state
        billingMode
        freeQuantity
        paidQuantity
        chargedAmount
        refundedAmount
        currencyCode
        actualCostMicrounits
        costCurrency
        missingCost
        costCompleteness
        missingCostCount
        costBreakdown {
            currency
            amount
        }
        errorMessage
        customer {
            id
            firstName
            lastName
            emailAddress
        }
    }
`;

export const IMAGE_AI_USAGE_RECORDS_QUERY = gql`
    ${usageRecordFields}
    query NextAdminImageAiUsageRecords($input: ImageAiUsageRecordListInput) {
        imageAiUsageRecords(input: $input) {
            totalItems
            items {
                ...ImageAiUsageRecordFields
            }
        }
    }
`;

export const IMAGE_AI_USAGE_DETAIL_QUERY = gql`
    ${usageRecordFields}
    query NextAdminImageAiUsageRecordDetail($recordType: String!, $id: ID!) {
        imageAiUsageRecord(recordType: $recordType, id: $id) {
            record {
                ...ImageAiUsageRecordFields
            }
            costAdjustments {
                id
                recordType
                recordIdSnapshot
                batchId
                reviewer
                authorizationRef
                reviewedAt
                reason
                matchingStatus
                previousAdjustmentId
                oldCostMicrounits
                oldCurrency
                newCostMicrounits
                newCurrency
                sourceHash
                supplierBills {
                    supplierScope
                    billId
                    amountMicrounits
                    currency
                    billedAt
                    displayedTime
                    timeZone
                    evidenceHash
                }
            }
            inputPrompt
            outputPrompt
            totalTokens
            providerRequestIds
            attempts {
                callId
                attemptNumber
                stage
                outcome
                modelId
                credentialNameSnapshot
                createdAt
                headerRequestId
                headerRequestIdSource
                modelResponseId
                providerRequestId
                httpStatus
                latencyMs
                actualCostMicrounits
                costCurrency
                costSource
                matchingStatus
                reportedCostEvidence
            }
            outputs {
                id
                state
                billingMode
                chargeAmount
                providerRequestId
                errorMessage
                refundedAt
            }
            timeline {
                at
                stage
                status
                amount
                currencyCode
                costMicrounits
                message
                keyName
                keyLast4
            }
        }
    }
`;

export interface ImageAiUsageRecord {
    id: string;
    recordType: 'PROMPT_OPTIMIZATION' | 'IMAGE_GENERATION';
    createdAt: string;
    channelId: string;
    modelCode: string;
    credentialCode: string;
    credentialName: string;
    credentialLast4: string;
    state: string;
    billingMode: string;
    freeQuantity: number;
    paidQuantity: number;
    chargedAmount: number;
    refundedAmount: number;
    currencyCode: string;
    actualCostMicrounits?: number | null;
    costCurrency?: string | null;
    missingCost: boolean;
    costCompleteness: string;
    missingCostCount: number;
    costBreakdown: Array<{ currency: string; amount: number }>;
    errorMessage?: string | null;
    customer: { id: string; firstName: string; lastName: string; emailAddress: string };
}

export interface ImageAiUsageRecordsQueryResult {
    imageAiUsageRecords: { items: ImageAiUsageRecord[]; totalItems: number };
}

export interface ImageAiUsageRecordDetailQueryResult {
    imageAiUsageRecord: {
        record: ImageAiUsageRecord;
        costAdjustments: Array<{
            id: string;
            recordType: string;
            recordIdSnapshot: string;
            batchId: string;
            reviewer: string;
            authorizationRef: string;
            reviewedAt: string;
            reason: string;
            matchingStatus: string;
            previousAdjustmentId: string | null;
            oldCostMicrounits: number | null;
            oldCurrency: string | null;
            newCostMicrounits: number | null;
            newCurrency: string | null;
            sourceHash: string;
            supplierBills: Array<{
                supplierScope: string;
                billId: string;
                amountMicrounits: number;
                currency: string;
                billedAt: string | null;
                displayedTime: string;
                timeZone: string | null;
                evidenceHash: string;
            }>;
        }>;
        inputPrompt: string;
        outputPrompt?: string | null;
        totalTokens?: number | null;
        providerRequestIds: string[];
        attempts: Array<{
            callId: string | null;
            attemptNumber: number;
            stage: string;
            outcome: string;
            modelId: string;
            credentialNameSnapshot: string;
            createdAt: string;
            headerRequestId: string | null;
            headerRequestIdSource: string | null;
            modelResponseId: string | null;
            providerRequestId: string | null;
            httpStatus: number | null;
            latencyMs: number;
            actualCostMicrounits: number | null;
            costCurrency: string | null;
            costSource: string;
            matchingStatus: string;
            reportedCostEvidence: { amount: number; currency: string | null; field: string } | null;
        }>;
        outputs: Array<{
            id: string;
            state: string;
            billingMode: string;
            chargeAmount: number;
            providerRequestId?: string | null;
            errorMessage?: string | null;
            refundedAt?: string | null;
        }>;
        timeline: Array<{
            at: string;
            stage: string;
            status: string;
            amount?: number | null;
            currencyCode?: string | null;
            costMicrounits?: number | null;
            message: string;
            keyName?: string | null;
            keyLast4?: string | null;
        }>;
    };
}
