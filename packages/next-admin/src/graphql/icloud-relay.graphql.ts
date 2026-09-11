import { gql } from '@apollo/client';

export type IcloudAccountStatus = 'ACTIVE' | 'DISABLED' | 'AUTH_ERROR' | 'SYNCING';
export type IcloudVirtualEmailStatus = 'ACTIVE' | 'DISABLED';

export interface IcloudPrimaryAccount {
    id: string;
    createdAt: string;
    updatedAt: string;
    email: string;
    note?: string | null;
    status: IcloudAccountStatus;
    imapHost: string;
    imapPort: number;
    masterQueryCode?: string | null;
    codeExpiresAt?: string | null;
    codeResetIntervalDays: number;
    remainingDays?: number | null;
    lastQueriedAt?: string | null;
    lastQueriedIp?: string | null;
    lastSyncedAt?: string | null;
    lastSyncError?: string | null;
    virtualEmailCount: number;
}

export interface IcloudVirtualEmail {
    id: string;
    createdAt: string;
    updatedAt: string;
    primaryAccountId: string;
    primaryAccountEmail?: string | null;
    aliasEmail: string;
    note?: string | null;
    status: IcloudVirtualEmailStatus;
    buyerQueryCode: string;
    codeExpiresAt?: string | null;
    codeResetIntervalDays: number;
    remainingDays?: number | null;
    lastQueriedAt?: string | null;
    lastQueriedIp?: string | null;
    mailCount: number;
    lastMailReceivedAt?: string | null;
}

export interface IcloudReceivedMail {
    id: string;
    createdAt: string;
    primaryAccountId: string;
    virtualEmailId?: string | null;
    messageId: string;
    fromAddress: string;
    fromName?: string | null;
    subject: string;
    bodyHtml?: string | null;
    bodyText?: string | null;
    extractedCode?: string | null;
    receivedAt: string;
    isRead: boolean;
    isStarred: boolean;
}

export interface IcloudPrimaryAccountsResult {
    icloudPrimaryAccounts: IcloudPrimaryAccount[];
}

export interface IcloudVirtualEmailsResult {
    icloudVirtualEmails: IcloudVirtualEmail[];
}

export interface IcloudReceivedMailsResult {
    icloudReceivedMails: IcloudReceivedMail[];
}

export const ICLOUD_PRIMARY_ACCOUNTS_QUERY = gql`
    query NextAdminIcloudPrimaryAccounts {
        icloudPrimaryAccounts {
            id
            createdAt
            updatedAt
            email
            note
            status
            imapHost
            imapPort
            masterQueryCode
            codeExpiresAt
            codeResetIntervalDays
            remainingDays
            lastQueriedAt
            lastQueriedIp
            lastSyncedAt
            lastSyncError
            virtualEmailCount
        }
    }
`;

export const CREATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION = gql`
    mutation NextAdminCreateIcloudPrimaryAccount($input: CreateIcloudPrimaryAccountInput!) {
        createIcloudPrimaryAccount(input: $input) {
            id
            email
            note
            status
            masterQueryCode
            codeResetIntervalDays
            remainingDays
            virtualEmailCount
        }
    }
`;

export const UPDATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION = gql`
    mutation NextAdminUpdateIcloudPrimaryAccount($id: ID!, $input: UpdateIcloudPrimaryAccountInput!) {
        updateIcloudPrimaryAccount(id: $id, input: $input) {
            id
            email
            note
            status
            codeResetIntervalDays
        }
    }
`;

export const DELETE_ICLOUD_PRIMARY_ACCOUNT_MUTATION = gql`
    mutation NextAdminDeleteIcloudPrimaryAccount($id: ID!) {
        deleteIcloudPrimaryAccount(id: $id)
    }
`;

export const TEST_ICLOUD_CONNECTION_MUTATION = gql`
    mutation NextAdminTestIcloudConnection($id: ID!) {
        testIcloudConnection(id: $id) {
            success
            message
        }
    }
`;

export const SYNC_ICLOUD_ACCOUNT_MUTATION = gql`
    mutation NextAdminSyncIcloudAccount($id: ID!) {
        syncIcloudAccount(id: $id) {
            success
            syncedCount
            error
        }
    }
`;

export const RESET_ICLOUD_MASTER_CODE_MUTATION = gql`
    mutation NextAdminResetIcloudMasterCode($id: ID!) {
        resetIcloudMasterCode(id: $id) {
            id
            masterQueryCode
            codeExpiresAt
            remainingDays
        }
    }
`;

export const ICLOUD_VIRTUAL_EMAILS_QUERY = gql`
    query NextAdminIcloudVirtualEmails($primaryAccountId: ID) {
        icloudVirtualEmails(primaryAccountId: $primaryAccountId) {
            id
            createdAt
            updatedAt
            primaryAccountId
            primaryAccountEmail
            aliasEmail
            note
            status
            buyerQueryCode
            codeExpiresAt
            codeResetIntervalDays
            remainingDays
            lastQueriedAt
            lastQueriedIp
            mailCount
            lastMailReceivedAt
        }
    }
`;

export const CREATE_ICLOUD_VIRTUAL_EMAIL_MUTATION = gql`
    mutation NextAdminCreateIcloudVirtualEmail($input: CreateIcloudVirtualEmailInput!) {
        createIcloudVirtualEmail(input: $input) {
            id
            primaryAccountId
            aliasEmail
            note
            status
            buyerQueryCode
            remainingDays
            mailCount
        }
    }
`;

export const BATCH_CREATE_ICLOUD_VIRTUAL_EMAILS_MUTATION = gql`
    mutation NextAdminBatchCreateIcloudVirtualEmails($input: BatchCreateIcloudVirtualEmailsInput!) {
        batchCreateIcloudVirtualEmails(input: $input) {
            createdCount
            skippedCount
            errors
        }
    }
`;

export const UPDATE_ICLOUD_VIRTUAL_EMAIL_MUTATION = gql`
    mutation NextAdminUpdateIcloudVirtualEmail($id: ID!, $input: UpdateIcloudVirtualEmailInput!) {
        updateIcloudVirtualEmail(id: $id, input: $input) {
            id
            aliasEmail
            note
            status
        }
    }
`;

export const DELETE_ICLOUD_VIRTUAL_EMAIL_MUTATION = gql`
    mutation NextAdminDeleteIcloudVirtualEmail($id: ID!) {
        deleteIcloudVirtualEmail(id: $id)
    }
`;

export const RESET_ICLOUD_VIRTUAL_EMAIL_CODE_MUTATION = gql`
    mutation NextAdminResetIcloudVirtualEmailCode($id: ID!) {
        resetIcloudVirtualEmailCode(id: $id) {
            id
            buyerQueryCode
            codeExpiresAt
            remainingDays
        }
    }
`;

export const ICLOUD_RECEIVED_MAILS_QUERY = gql`
    query NextAdminIcloudReceivedMails($primaryAccountId: ID, $virtualEmailId: ID, $limit: Int) {
        icloudReceivedMails(
            primaryAccountId: $primaryAccountId
            virtualEmailId: $virtualEmailId
            limit: $limit
        ) {
            id
            createdAt
            primaryAccountId
            virtualEmailId
            messageId
            fromAddress
            fromName
            subject
            bodyHtml
            bodyText
            extractedCode
            receivedAt
            isRead
            isStarred
        }
    }
`;
