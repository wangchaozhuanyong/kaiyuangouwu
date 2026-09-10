import { gql } from 'graphql-tag';

// ==========================================
// Fragments
// ==========================================

const primaryAccountFields = gql`
    fragment IcloudPrimaryAccountFields on IcloudPrimaryAccountView {
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
`;

const virtualEmailFields = gql`
    fragment IcloudVirtualEmailFields on IcloudVirtualEmailView {
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
`;

const receivedMailFields = gql`
    fragment IcloudReceivedMailFields on IcloudReceivedMailView {
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
`;

// ==========================================
// Primary Account Queries & Mutations
// ==========================================

export const icloudPrimaryAccountsQuery = gql`
    query IcloudPrimaryAccounts {
        icloudPrimaryAccounts {
            ...IcloudPrimaryAccountFields
        }
    }
    ${primaryAccountFields}
`;

export const createIcloudPrimaryAccountMutation = gql`
    mutation CreateIcloudPrimaryAccount($input: CreateIcloudPrimaryAccountInput!) {
        createIcloudPrimaryAccount(input: $input) {
            ...IcloudPrimaryAccountFields
        }
    }
    ${primaryAccountFields}
`;

export const updateIcloudPrimaryAccountMutation = gql`
    mutation UpdateIcloudPrimaryAccount($input: UpdateIcloudPrimaryAccountInput!) {
        updateIcloudPrimaryAccount(input: $input) {
            ...IcloudPrimaryAccountFields
        }
    }
    ${primaryAccountFields}
`;

export const deleteIcloudPrimaryAccountMutation = gql`
    mutation DeleteIcloudPrimaryAccount($id: ID!) {
        deleteIcloudPrimaryAccount(id: $id)
    }
`;

export const testIcloudConnectionMutation = gql`
    mutation TestIcloudConnection($id: ID!) {
        testIcloudConnection(id: $id) {
            success
            message
        }
    }
`;

export const syncIcloudAccountMutation = gql`
    mutation SyncIcloudAccount($id: ID!) {
        syncIcloudAccount(id: $id) {
            success
            syncedCount
            error
        }
    }
`;

export const resetIcloudMasterCodeMutation = gql`
    mutation ResetIcloudMasterCode($id: ID!) {
        resetIcloudMasterCode(id: $id) {
            ...IcloudPrimaryAccountFields
        }
    }
    ${primaryAccountFields}
`;

// ==========================================
// Virtual Email Queries & Mutations
// ==========================================

export const icloudVirtualEmailsQuery = gql`
    query IcloudVirtualEmails($primaryAccountId: ID) {
        icloudVirtualEmails(primaryAccountId: $primaryAccountId) {
            ...IcloudVirtualEmailFields
        }
    }
    ${virtualEmailFields}
`;

export const createIcloudVirtualEmailMutation = gql`
    mutation CreateIcloudVirtualEmail($input: CreateIcloudVirtualEmailInput!) {
        createIcloudVirtualEmail(input: $input) {
            ...IcloudVirtualEmailFields
        }
    }
    ${virtualEmailFields}
`;

export const batchCreateIcloudVirtualEmailsMutation = gql`
    mutation BatchCreateIcloudVirtualEmails($input: BatchCreateIcloudVirtualEmailsInput!) {
        batchCreateIcloudVirtualEmails(input: $input) {
            createdCount
            skippedCount
            errors
        }
    }
`;

export const updateIcloudVirtualEmailMutation = gql`
    mutation UpdateIcloudVirtualEmail($input: UpdateIcloudVirtualEmailInput!) {
        updateIcloudVirtualEmail(input: $input) {
            ...IcloudVirtualEmailFields
        }
    }
    ${virtualEmailFields}
`;

export const deleteIcloudVirtualEmailMutation = gql`
    mutation DeleteIcloudVirtualEmail($id: ID!) {
        deleteIcloudVirtualEmail(id: $id)
    }
`;

export const resetIcloudVirtualEmailCodeMutation = gql`
    mutation ResetIcloudVirtualEmailCode($id: ID!) {
        resetIcloudVirtualEmailCode(id: $id) {
            ...IcloudVirtualEmailFields
        }
    }
    ${virtualEmailFields}
`;

// ==========================================
// Received Mail Queries & Mutations
// ==========================================

export const icloudReceivedMailsQuery = gql`
    query IcloudReceivedMails(
        $virtualEmailId: ID
        $primaryAccountId: ID
        $unassignedOnly: Boolean
        $limit: Int
    ) {
        icloudReceivedMails(
            virtualEmailId: $virtualEmailId
            primaryAccountId: $primaryAccountId
            unassignedOnly: $unassignedOnly
            limit: $limit
        ) {
            ...IcloudReceivedMailFields
        }
    }
    ${receivedMailFields}
`;

export const reassignIcloudMailMutation = gql`
    mutation ReassignIcloudMail($mailId: ID!, $virtualEmailId: ID!) {
        reassignIcloudMail(mailId: $mailId, virtualEmailId: $virtualEmailId) {
            ...IcloudReceivedMailFields
        }
    }
    ${receivedMailFields}
`;

export const deleteIcloudMailMutation = gql`
    mutation DeleteIcloudMail($mailId: ID!) {
        deleteIcloudMail(mailId: $mailId)
    }
`;
