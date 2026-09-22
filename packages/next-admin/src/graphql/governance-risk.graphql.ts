import { gql } from '@apollo/client';

export const GOVERNANCE_RISK_QUERY = gql`
    query GovernanceRiskControl($riskOptions: FraudRiskCaseListOptions, $auditTake: Int) {
        governanceApprovals(status: PENDING) {
            id
            createdAt
            status
            requestedByUserId
            requestReason
            expiresAt
            configVersion {
                id
                namespace
                version
                status
                payloadJson
                payloadHash
                createdByUserId
            }
        }
        fraudRiskCases(options: $riskOptions) {
            totalItems
            items {
                id
                createdAt
                caseCode
                subjectType
                subjectId
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
                decisionCode
                decisionReason
                events {
                    id
                    createdAt
                    eventType
                    actorType
                    note
                }
                appeals {
                    id
                    createdAt
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
        governanceAuditEntries(take: $auditTake) {
            totalItems
            items {
                id
                createdAt
                sequence
                eventType
                resourceType
                resourceId
                actorType
                actorLabel
                reason
                entryHash
                previousHash
            }
        }
        governanceReports {
            id
            businessDate
            metricsJson
            digest
            auditIntegrityValid
            anomalyCount
            createdAt
        }
        governedConfigVersions {
            id
            namespace
            version
            status
            payloadJson
            payloadHash
            createdByUserId
            activatedAt
            retiredAt
            createdAt
        }
    }
`;

export const SUBMIT_GOVERNED_CONFIG_MUTATION = gql`
    mutation SubmitGovernedConfig($input: SubmitGovernedConfigInput!) {
        submitGovernedConfig(input: $input) {
            id
            status
            expiresAt
        }
    }
`;

export const REVIEW_GOVERNANCE_APPROVAL_MUTATION = gql`
    mutation ReviewGovernanceApproval($input: ReviewGovernanceApprovalInput!) {
        reviewGovernanceApproval(input: $input) {
            id
            status
            reviewedAt
        }
    }
`;

export const REVIEW_FRAUD_RISK_CASE_MUTATION = gql`
    mutation ReviewFraudRiskCase($input: ReviewFraudRiskCaseInput!) {
        reviewFraudRiskCase(input: $input) {
            id
            status
            ownerUserId
            decisionCode
            decisionReason
            decidedAt
        }
    }
`;

export type GovernanceApprovalRecord = {
    id: string;
    createdAt: string;
    status: string;
    requestedByUserId: string;
    requestReason: string;
    expiresAt: string;
    configVersion: {
        id: string;
        namespace: 'FRAUD_RULES' | 'REPORT_SCHEDULE';
        version: number;
        status: string;
        payloadJson: string;
        payloadHash: string;
        createdByUserId: string;
    };
};

export type FraudRiskCaseRecord = {
    id: string;
    createdAt: string;
    caseCode: string;
    subjectType: string;
    subjectId: string;
    orderId?: string | null;
    customerId?: string | null;
    status: string;
    severity: string;
    riskScore: number;
    ruleVersion: string;
    signalsJson: string;
    recommendedAction: string;
    dueAt: string;
    ownerUserId?: string | null;
    decisionCode?: string | null;
    decisionReason?: string | null;
    events: Array<{ id: string; createdAt: string; eventType: string; actorType: string; note: string }>;
    appeals: Array<{
        id: string;
        createdAt: string;
        status: string;
        reason: string;
        response?: string | null;
    }>;
};

export type GovernanceRiskResult = {
    governanceApprovals: GovernanceApprovalRecord[];
    fraudRiskCases: { items: FraudRiskCaseRecord[]; totalItems: number };
    governanceAuditIntegrity: { valid: boolean; checkedEntries: number; brokenAt?: number | null };
    governanceAuditEntries: {
        totalItems: number;
        items: Array<{
            id: string;
            createdAt: string;
            sequence: number;
            eventType: string;
            resourceType: string;
            resourceId: string;
            actorType: string;
            actorLabel: string;
            reason: string;
            entryHash: string;
            previousHash?: string | null;
        }>;
    };
    governanceReports: Array<{
        id: string;
        businessDate: string;
        metricsJson: string;
        digest: string;
        auditIntegrityValid: boolean;
        anomalyCount: number;
        createdAt: string;
    }>;
    governedConfigVersions: Array<{
        id: string;
        namespace: string;
        version: number;
        status: string;
        payloadJson: string;
        payloadHash: string;
        createdByUserId: string;
        activatedAt?: string | null;
        retiredAt?: string | null;
        createdAt: string;
    }>;
};
