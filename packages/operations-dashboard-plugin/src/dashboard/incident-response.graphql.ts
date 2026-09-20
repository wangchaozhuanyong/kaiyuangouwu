import { gql } from 'graphql-tag';

export interface IncidentActionRecord {
    id: string;
    title: string;
    ownerDepartmentCode: string;
    dueAt: string;
    status: string;
    completedAt: string | null;
    completionNote: string | null;
    escalatedAt: string | null;
}

export interface IncidentEvidenceRecord {
    id: string;
    eventId: string;
    eventType: string;
    actorType: string;
    actorUserId: string | null;
    summary: string;
    evidence: Record<string, unknown>;
    occurredAt: string;
    evidenceHash: string;
    integrityValid: boolean;
}

export interface IncidentRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    eventType: string;
    ownerDepartmentCode: string;
    collaboratorDepartmentCodes: string[];
    escalationDepartmentCode: string | null;
    severity: string;
    eventState: string;
    title: string;
    occurrenceCount: number;
    firstOccurredAt: string;
    lastOccurredAt: string;
    resolvedAt: string | null;
    incidentStatus: string;
    acknowledgedAt: string | null;
    acknowledgementNote: string | null;
    recoveryObservedAt: string | null;
    recoveryValidationDueAt: string | null;
    recoveryValidatedAt: string | null;
    recoveryValidationNote: string | null;
    reviewDueAt: string | null;
    reviewSubmittedAt: string | null;
    rootCause: string | null;
    impactSummary: string | null;
    closedAt: string | null;
    actions: IncidentActionRecord[];
    evidence?: IncidentEvidenceRecord[];
}

export interface IncidentListResult {
    adminIncidents: { items: IncidentRecord[]; totalItems: number };
}

export interface IncidentDetailResult {
    adminIncident: IncidentRecord & { evidence: IncidentEvidenceRecord[] };
}

export const incidentListQuery = gql`
    query OperationsIncidentList($status: String, $severity: String) {
        adminIncidents(take: 100, status: $status, severity: $severity) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                eventType
                ownerDepartmentCode
                collaboratorDepartmentCodes
                escalationDepartmentCode
                severity
                eventState
                title
                occurrenceCount
                firstOccurredAt
                lastOccurredAt
                resolvedAt
                incidentStatus
                acknowledgedAt
                acknowledgementNote
                recoveryObservedAt
                recoveryValidationDueAt
                recoveryValidatedAt
                recoveryValidationNote
                reviewDueAt
                reviewSubmittedAt
                rootCause
                impactSummary
                closedAt
                actions {
                    id
                    title
                    ownerDepartmentCode
                    dueAt
                    status
                    completedAt
                    completionNote
                    escalatedAt
                }
            }
        }
    }
`;

export const incidentDetailQuery = gql`
    query OperationsIncidentDetail($id: ID!) {
        adminIncident(id: $id) {
            id
            createdAt
            updatedAt
            eventType
            ownerDepartmentCode
            collaboratorDepartmentCodes
            escalationDepartmentCode
            severity
            eventState
            title
            occurrenceCount
            firstOccurredAt
            lastOccurredAt
            resolvedAt
            incidentStatus
            acknowledgedAt
            acknowledgementNote
            recoveryObservedAt
            recoveryValidationDueAt
            recoveryValidatedAt
            recoveryValidationNote
            reviewDueAt
            reviewSubmittedAt
            rootCause
            impactSummary
            closedAt
            actions {
                id
                title
                ownerDepartmentCode
                dueAt
                status
                completedAt
                completionNote
                escalatedAt
            }
            evidence {
                id
                eventId
                eventType
                actorType
                actorUserId
                summary
                evidence
                occurredAt
                evidenceHash
                integrityValid
            }
        }
    }
`;

export const acknowledgeIncidentMutation = gql`
    mutation OperationsAcknowledgeIncident($id: ID!, $note: String!) {
        acknowledgeAdminIncident(id: $id, note: $note) {
            id
            incidentStatus
        }
    }
`;

export const validateIncidentRecoveryMutation = gql`
    mutation OperationsValidateIncidentRecovery($id: ID!, $note: String!) {
        validateAdminIncidentRecovery(id: $id, note: $note) {
            id
            incidentStatus
        }
    }
`;

export const submitIncidentReviewMutation = gql`
    mutation OperationsSubmitIncidentReview($id: ID!, $input: SubmitAdminIncidentReviewInput!) {
        submitAdminIncidentReview(id: $id, input: $input) {
            id
            incidentStatus
        }
    }
`;

export const completeIncidentActionMutation = gql`
    mutation OperationsCompleteIncidentAction($actionId: ID!, $note: String!) {
        completeAdminIncidentAction(actionId: $actionId, note: $note) {
            id
            incidentStatus
        }
    }
`;
