import { gql } from 'graphql-tag';

export interface GovernanceApprovalRecord {
    id: string;
    status: string;
    requestedByUserId: string;
    requestReason: string;
    expiresAt: string;
    configVersion: {
        namespace: 'FRAUD_RULES' | 'REPORT_SCHEDULE';
        version: number;
        payloadJson: string;
        payloadHash: string;
    };
}

export interface FraudRiskCaseRecord {
    id: string;
    caseCode: string;
    orderId: string | null;
    customerId: string | null;
    status: string;
    severity: string;
    riskScore: number;
    ruleVersion: string;
    signalsJson: string;
    recommendedAction: string;
    dueAt: string;
    ownerUserId: string | null;
    decisionReason: string | null;
    appeals: Array<{ id: string; status: string; reason: string; response: string | null }>;
}

export interface GovernanceRiskResult {
    governanceApprovals: GovernanceApprovalRecord[];
    fraudRiskCases: { items: FraudRiskCaseRecord[]; totalItems: number };
    governanceAuditIntegrity: { valid: boolean; checkedEntries: number; brokenAt: number | null };
    governanceAuditEntries: {
        totalItems: number;
        items: Array<{
            id: string;
            sequence: number;
            eventType: string;
            resourceType: string;
            resourceId: string;
            actorLabel: string;
            reason: string;
            entryHash: string;
        }>;
    };
    governanceReports: Array<{
        id: string;
        businessDate: string;
        metricsJson: string;
        digest: string;
        auditIntegrityValid: boolean;
        anomalyCount: number;
    }>;
}

export const governanceRiskQuery = gql`
    query OperationsGovernanceRisk {
        governanceApprovals(status: PENDING) {
            id
            status
            requestedByUserId
            requestReason
            expiresAt
            configVersion {
                namespace
                version
                payloadJson
                payloadHash
            }
        }
        fraudRiskCases(options: { take: 100 }) {
            totalItems
            items {
                id
                caseCode
                orderId
                customerId
                status
                severity
                riskScore
                ruleVersion
                signalsJson
                recommendedAction
                dueAt
                ownerUserId
                decisionReason
                appeals {
                    id
                    status
                    reason
                    response
                }
            }
        }
        governanceAuditIntegrity {
            valid
            checkedEntries
            brokenAt
        }
        governanceAuditEntries(take: 50) {
            totalItems
            items {
                id
                sequence
                eventType
                resourceType
                resourceId
                actorLabel
                reason
                entryHash
            }
        }
        governanceReports {
            id
            businessDate
            metricsJson
            digest
            auditIntegrityValid
            anomalyCount
        }
    }
`;

export const submitGovernedConfigMutation = gql`
    mutation OperationsSubmitGovernedConfig($input: SubmitGovernedConfigInput!) {
        submitGovernedConfig(input: $input) {
            id
            status
            expiresAt
        }
    }
`;

export const reviewGovernanceApprovalMutation = gql`
    mutation OperationsReviewGovernanceApproval($input: ReviewGovernanceApprovalInput!) {
        reviewGovernanceApproval(input: $input) {
            id
            status
            reviewedAt
        }
    }
`;

export const reviewFraudRiskCaseMutation = gql`
    mutation OperationsReviewFraudRiskCase($input: ReviewFraudRiskCaseInput!) {
        reviewFraudRiskCase(input: $input) {
            id
            status
            ownerUserId
            decisionCode
            decisionReason
        }
    }
`;
