import { gql } from '@apollo/client';

const MDAC_ADMIN_FIELDS = gql`
    fragment MdacAdminSubmissionFields on MdacAdminSubmission {
        id
        status
        travelerName
        passportNo
        arrivalDate
        attempts
        referenceNo
        pin
        lastError
        submittedAt
        receiptAvailable
        waitingForWindow
        createdAt
    }
`;

export const MDAC_SUBMISSIONS = gql`
    query MdacSubmissions($status: MdacAdminSubmissionStatus, $limit: Int) {
        mdacSubmissions(status: $status, limit: $limit) {
            totalItems
            items {
                ...MdacAdminSubmissionFields
            }
        }
    }
    ${MDAC_ADMIN_FIELDS}
`;

export const MDAC_RETRY = gql`
    mutation RetryMdacSubmission($id: ID!) {
        retryMdacSubmission(id: $id) {
            ...MdacAdminSubmissionFields
        }
    }
    ${MDAC_ADMIN_FIELDS}
`;

export const MDAC_CANCEL = gql`
    mutation CancelMdacSubmission($id: ID!) {
        cancelMdacSubmission(id: $id) {
            ...MdacAdminSubmissionFields
        }
    }
    ${MDAC_ADMIN_FIELDS}
`;

export interface MdacAdminSubmission {
    id: string;
    status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'MANUAL';
    travelerName: string;
    passportNo: string;
    arrivalDate: string;
    attempts: number;
    referenceNo?: string | null;
    pin?: string | null;
    lastError?: string | null;
    submittedAt?: string | null;
    receiptAvailable: boolean;
    waitingForWindow: boolean;
    createdAt: string;
}

export interface MdacSubmissionsResult {
    mdacSubmissions: { items: MdacAdminSubmission[]; totalItems: number };
}

export const mdacStatusLabels: Record<MdacAdminSubmission['status'], string> = {
    QUEUED: '排队中',
    RUNNING: '提交中',
    DONE: '已提交',
    FAILED: '未成功',
    MANUAL: '需人工确认',
};
