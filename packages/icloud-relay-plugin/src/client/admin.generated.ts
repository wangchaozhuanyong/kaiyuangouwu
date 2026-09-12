// Generated from the server schema and client/admin.graphql. Do not edit.
// Refresh: bun scripts/codegen/icloud-admin-contract.ts
/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> =
    T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
    ID: { input: string; output: string };
    String: { input: string; output: string };
    Boolean: { input: boolean; output: boolean };
    Int: { input: number; output: number };
    Float: { input: number; output: number };
    DateTime: { input: string; output: string };
};

export type BatchCreateIcloudVirtualEmailsInput = {
    codeResetIntervalDays?: InputMaybe<Scalars['Int']['input']>;
    primaryAccountId: Scalars['ID']['input'];
    rawInput: Scalars['String']['input'];
};

export type CreateIcloudPrimaryAccountInput = {
    appPassword: Scalars['String']['input'];
    codeResetIntervalDays?: InputMaybe<Scalars['Int']['input']>;
    email: Scalars['String']['input'];
    imapHost?: InputMaybe<Scalars['String']['input']>;
    imapPort?: InputMaybe<Scalars['Int']['input']>;
    masterQueryCode?: InputMaybe<Scalars['String']['input']>;
    note?: InputMaybe<Scalars['String']['input']>;
};

export type CreateIcloudVirtualEmailInput = {
    aliasEmail: Scalars['String']['input'];
    buyerQueryCode?: InputMaybe<Scalars['String']['input']>;
    codeResetIntervalDays?: InputMaybe<Scalars['Int']['input']>;
    note?: InputMaybe<Scalars['String']['input']>;
    primaryAccountId: Scalars['ID']['input'];
};

export type IcloudAccountStatus = 'ACTIVE' | 'AUTH_ERROR' | 'DISABLED' | 'SYNCING';

export type IcloudBatchCreateResult = {
    createdCount: Scalars['Int']['output'];
    errors: Array<Scalars['String']['output']>;
    skippedCount: Scalars['Int']['output'];
};

export type IcloudPrimaryAccountView = Node & {
    codeExpiresAt?: Maybe<Scalars['DateTime']['output']>;
    codeResetIntervalDays: Scalars['Int']['output'];
    createdAt: Scalars['DateTime']['output'];
    email: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    imapHost: Scalars['String']['output'];
    imapPort: Scalars['Int']['output'];
    lastQueriedAt?: Maybe<Scalars['DateTime']['output']>;
    lastQueriedIp?: Maybe<Scalars['String']['output']>;
    lastSyncError?: Maybe<Scalars['String']['output']>;
    lastSyncedAt?: Maybe<Scalars['DateTime']['output']>;
    masterQueryCode?: Maybe<Scalars['String']['output']>;
    note?: Maybe<Scalars['String']['output']>;
    remainingDays?: Maybe<Scalars['Int']['output']>;
    status: IcloudAccountStatus;
    updatedAt: Scalars['DateTime']['output'];
    virtualEmailCount: Scalars['Int']['output'];
};

export type IcloudReceivedMailView = Node & {
    bodyHtml?: Maybe<Scalars['String']['output']>;
    bodyText?: Maybe<Scalars['String']['output']>;
    createdAt: Scalars['DateTime']['output'];
    extractedCode?: Maybe<Scalars['String']['output']>;
    fromAddress: Scalars['String']['output'];
    fromName: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    isRead: Scalars['Boolean']['output'];
    isStarred: Scalars['Boolean']['output'];
    messageId: Scalars['String']['output'];
    primaryAccountId: Scalars['ID']['output'];
    receivedAt: Scalars['DateTime']['output'];
    subject: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
    virtualEmailId?: Maybe<Scalars['ID']['output']>;
};

export type IcloudSyncResult = {
    error?: Maybe<Scalars['String']['output']>;
    success: Scalars['Boolean']['output'];
    syncedCount: Scalars['Int']['output'];
};

export type IcloudTestConnectionResult = {
    message: Scalars['String']['output'];
    success: Scalars['Boolean']['output'];
};

export type IcloudVirtualEmailStatus = 'ACTIVE' | 'DISABLED';

export type IcloudVirtualEmailView = Node & {
    aliasEmail: Scalars['String']['output'];
    buyerQueryCode: Scalars['String']['output'];
    codeExpiresAt?: Maybe<Scalars['DateTime']['output']>;
    codeResetIntervalDays: Scalars['Int']['output'];
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    lastMailReceivedAt?: Maybe<Scalars['DateTime']['output']>;
    lastQueriedAt?: Maybe<Scalars['DateTime']['output']>;
    lastQueriedIp?: Maybe<Scalars['String']['output']>;
    mailCount: Scalars['Int']['output'];
    note?: Maybe<Scalars['String']['output']>;
    primaryAccountEmail?: Maybe<Scalars['String']['output']>;
    primaryAccountId: Scalars['ID']['output'];
    remainingDays?: Maybe<Scalars['Int']['output']>;
    status: IcloudVirtualEmailStatus;
    updatedAt: Scalars['DateTime']['output'];
};

export type Mutation = {
    _contract?: Maybe<Scalars['Boolean']['output']>;
    batchCreateIcloudVirtualEmails: IcloudBatchCreateResult;
    createIcloudPrimaryAccount: IcloudPrimaryAccountView;
    createIcloudVirtualEmail: IcloudVirtualEmailView;
    deleteIcloudMail: Scalars['Boolean']['output'];
    deleteIcloudPrimaryAccount: Scalars['Boolean']['output'];
    deleteIcloudVirtualEmail: Scalars['Boolean']['output'];
    reassignIcloudMail: IcloudReceivedMailView;
    resetIcloudMasterCode: IcloudPrimaryAccountView;
    resetIcloudVirtualEmailCode: IcloudVirtualEmailView;
    syncIcloudAccount: IcloudSyncResult;
    testIcloudConnection: IcloudTestConnectionResult;
    updateIcloudPrimaryAccount: IcloudPrimaryAccountView;
    updateIcloudVirtualEmail: IcloudVirtualEmailView;
};

export type MutationBatchCreateIcloudVirtualEmailsArgs = {
    input: BatchCreateIcloudVirtualEmailsInput;
};

export type MutationCreateIcloudPrimaryAccountArgs = {
    input: CreateIcloudPrimaryAccountInput;
};

export type MutationCreateIcloudVirtualEmailArgs = {
    input: CreateIcloudVirtualEmailInput;
};

export type MutationDeleteIcloudMailArgs = {
    mailId: Scalars['ID']['input'];
};

export type MutationDeleteIcloudPrimaryAccountArgs = {
    id: Scalars['ID']['input'];
};

export type MutationDeleteIcloudVirtualEmailArgs = {
    id: Scalars['ID']['input'];
};

export type MutationReassignIcloudMailArgs = {
    mailId: Scalars['ID']['input'];
    virtualEmailId: Scalars['ID']['input'];
};

export type MutationResetIcloudMasterCodeArgs = {
    id: Scalars['ID']['input'];
};

export type MutationResetIcloudVirtualEmailCodeArgs = {
    id: Scalars['ID']['input'];
};

export type MutationSyncIcloudAccountArgs = {
    id: Scalars['ID']['input'];
};

export type MutationTestIcloudConnectionArgs = {
    id: Scalars['ID']['input'];
};

export type MutationUpdateIcloudPrimaryAccountArgs = {
    input: UpdateIcloudPrimaryAccountInput;
};

export type MutationUpdateIcloudVirtualEmailArgs = {
    input: UpdateIcloudVirtualEmailInput;
};

export type Node = {
    id: Scalars['ID']['output'];
};

export type Query = {
    _contract?: Maybe<Scalars['Boolean']['output']>;
    icloudPrimaryAccount?: Maybe<IcloudPrimaryAccountView>;
    icloudPrimaryAccounts: Array<IcloudPrimaryAccountView>;
    icloudReceivedMails: Array<IcloudReceivedMailView>;
    icloudVirtualEmail?: Maybe<IcloudVirtualEmailView>;
    icloudVirtualEmails: Array<IcloudVirtualEmailView>;
};

export type QueryIcloudPrimaryAccountArgs = {
    id: Scalars['ID']['input'];
};

export type QueryIcloudReceivedMailsArgs = {
    limit?: InputMaybe<Scalars['Int']['input']>;
    primaryAccountId?: InputMaybe<Scalars['ID']['input']>;
    unassignedOnly?: InputMaybe<Scalars['Boolean']['input']>;
    virtualEmailId?: InputMaybe<Scalars['ID']['input']>;
};

export type QueryIcloudVirtualEmailArgs = {
    id: Scalars['ID']['input'];
};

export type QueryIcloudVirtualEmailsArgs = {
    primaryAccountId?: InputMaybe<Scalars['ID']['input']>;
};

export type UpdateIcloudPrimaryAccountInput = {
    appPassword?: InputMaybe<Scalars['String']['input']>;
    codeResetIntervalDays?: InputMaybe<Scalars['Int']['input']>;
    email?: InputMaybe<Scalars['String']['input']>;
    id: Scalars['ID']['input'];
    imapHost?: InputMaybe<Scalars['String']['input']>;
    imapPort?: InputMaybe<Scalars['Int']['input']>;
    masterQueryCode?: InputMaybe<Scalars['String']['input']>;
    note?: InputMaybe<Scalars['String']['input']>;
    status?: InputMaybe<IcloudAccountStatus>;
};

export type UpdateIcloudVirtualEmailInput = {
    aliasEmail?: InputMaybe<Scalars['String']['input']>;
    buyerQueryCode?: InputMaybe<Scalars['String']['input']>;
    codeResetIntervalDays?: InputMaybe<Scalars['Int']['input']>;
    id: Scalars['ID']['input'];
    note?: InputMaybe<Scalars['String']['input']>;
    status?: InputMaybe<IcloudVirtualEmailStatus>;
};

export type BatchCreateIcloudVirtualEmailsMutationVariables = Exact<{
    input: BatchCreateIcloudVirtualEmailsInput;
}>;

export type BatchCreateIcloudVirtualEmailsMutation = {
    batchCreateIcloudVirtualEmails: { createdCount: number; skippedCount: number; errors: Array<string> };
};

export type CreateIcloudPrimaryAccountMutationVariables = Exact<{
    input: CreateIcloudPrimaryAccountInput;
}>;

export type CreateIcloudPrimaryAccountMutation = {
    createIcloudPrimaryAccount: {
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
    };
};

export type IcloudPrimaryAccountFieldsFragment = {
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
};

export type CreateIcloudVirtualEmailMutationVariables = Exact<{
    input: CreateIcloudVirtualEmailInput;
}>;

export type CreateIcloudVirtualEmailMutation = {
    createIcloudVirtualEmail: {
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
    };
};

export type IcloudVirtualEmailFieldsFragment = {
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
};

export type DeleteIcloudMailMutationVariables = Exact<{
    mailId: Scalars['ID']['input'];
}>;

export type DeleteIcloudMailMutation = { deleteIcloudMail: boolean };

export type DeleteIcloudPrimaryAccountMutationVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type DeleteIcloudPrimaryAccountMutation = { deleteIcloudPrimaryAccount: boolean };

export type DeleteIcloudVirtualEmailMutationVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type DeleteIcloudVirtualEmailMutation = { deleteIcloudVirtualEmail: boolean };

export type IcloudPrimaryAccountsQueryVariables = Exact<{ [key: string]: never }>;

export type IcloudPrimaryAccountsQuery = {
    icloudPrimaryAccounts: Array<{
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
    }>;
};

export type IcloudReceivedMailsQueryVariables = Exact<{
    virtualEmailId?: InputMaybe<Scalars['ID']['input']>;
    primaryAccountId?: InputMaybe<Scalars['ID']['input']>;
    unassignedOnly?: InputMaybe<Scalars['Boolean']['input']>;
    limit?: InputMaybe<Scalars['Int']['input']>;
}>;

export type IcloudReceivedMailsQuery = {
    icloudReceivedMails: Array<{
        id: string;
        createdAt: string;
        primaryAccountId: string;
        virtualEmailId?: string | null;
        messageId: string;
        fromAddress: string;
        fromName: string;
        subject: string;
        bodyHtml?: string | null;
        bodyText?: string | null;
        extractedCode?: string | null;
        receivedAt: string;
        isRead: boolean;
        isStarred: boolean;
    }>;
};

export type IcloudReceivedMailFieldsFragment = {
    id: string;
    createdAt: string;
    primaryAccountId: string;
    virtualEmailId?: string | null;
    messageId: string;
    fromAddress: string;
    fromName: string;
    subject: string;
    bodyHtml?: string | null;
    bodyText?: string | null;
    extractedCode?: string | null;
    receivedAt: string;
    isRead: boolean;
    isStarred: boolean;
};

export type IcloudVirtualEmailsQueryVariables = Exact<{
    primaryAccountId?: InputMaybe<Scalars['ID']['input']>;
}>;

export type IcloudVirtualEmailsQuery = {
    icloudVirtualEmails: Array<{
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
    }>;
};

export type ReassignIcloudMailMutationVariables = Exact<{
    mailId: Scalars['ID']['input'];
    virtualEmailId: Scalars['ID']['input'];
}>;

export type ReassignIcloudMailMutation = {
    reassignIcloudMail: {
        id: string;
        createdAt: string;
        primaryAccountId: string;
        virtualEmailId?: string | null;
        messageId: string;
        fromAddress: string;
        fromName: string;
        subject: string;
        bodyHtml?: string | null;
        bodyText?: string | null;
        extractedCode?: string | null;
        receivedAt: string;
        isRead: boolean;
        isStarred: boolean;
    };
};

export type ResetIcloudMasterCodeMutationVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type ResetIcloudMasterCodeMutation = {
    resetIcloudMasterCode: {
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
    };
};

export type ResetIcloudVirtualEmailCodeMutationVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type ResetIcloudVirtualEmailCodeMutation = {
    resetIcloudVirtualEmailCode: {
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
    };
};

export type SyncIcloudAccountMutationVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type SyncIcloudAccountMutation = {
    syncIcloudAccount: { success: boolean; syncedCount: number; error?: string | null };
};

export type TestIcloudConnectionMutationVariables = Exact<{
    id: Scalars['ID']['input'];
}>;

export type TestIcloudConnectionMutation = { testIcloudConnection: { success: boolean; message: string } };

export type UpdateIcloudPrimaryAccountMutationVariables = Exact<{
    input: UpdateIcloudPrimaryAccountInput;
}>;

export type UpdateIcloudPrimaryAccountMutation = {
    updateIcloudPrimaryAccount: {
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
    };
};

export type UpdateIcloudVirtualEmailMutationVariables = Exact<{
    input: UpdateIcloudVirtualEmailInput;
}>;

export type UpdateIcloudVirtualEmailMutation = {
    updateIcloudVirtualEmail: {
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
    };
};

export const IcloudPrimaryAccountFieldsFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudPrimaryAccountView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'email' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapHost' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapPort' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'masterQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncError' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'virtualEmailCount' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<IcloudPrimaryAccountFieldsFragment, unknown>;
export const IcloudVirtualEmailFieldsFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudVirtualEmailView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'aliasEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'buyerQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'mailCount' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastMailReceivedAt' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<IcloudVirtualEmailFieldsFragment, unknown>;
export const IcloudReceivedMailFieldsFragmentDoc = {
    kind: 'Document',
    definitions: [
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudReceivedMailFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudReceivedMailView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'virtualEmailId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'messageId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'fromAddress' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'fromName' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subject' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'bodyHtml' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'bodyText' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'extractedCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'receivedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'isRead' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'isStarred' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<IcloudReceivedMailFieldsFragment, unknown>;
export const BatchCreateIcloudVirtualEmailsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'BatchCreateIcloudVirtualEmails' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: {
                            kind: 'NamedType',
                            name: { kind: 'Name', value: 'BatchCreateIcloudVirtualEmailsInput' },
                        },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'batchCreateIcloudVirtualEmails' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'createdCount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'skippedCount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'errors' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<
    BatchCreateIcloudVirtualEmailsMutation,
    BatchCreateIcloudVirtualEmailsMutationVariables
>;
export const CreateIcloudPrimaryAccountDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'CreateIcloudPrimaryAccount' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: {
                            kind: 'NamedType',
                            name: { kind: 'Name', value: 'CreateIcloudPrimaryAccountInput' },
                        },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'createIcloudPrimaryAccount' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudPrimaryAccountView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'email' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapHost' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapPort' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'masterQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncError' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'virtualEmailCount' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<CreateIcloudPrimaryAccountMutation, CreateIcloudPrimaryAccountMutationVariables>;
export const CreateIcloudVirtualEmailDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'CreateIcloudVirtualEmail' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: {
                            kind: 'NamedType',
                            name: { kind: 'Name', value: 'CreateIcloudVirtualEmailInput' },
                        },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'createIcloudVirtualEmail' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudVirtualEmailView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'aliasEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'buyerQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'mailCount' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastMailReceivedAt' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<CreateIcloudVirtualEmailMutation, CreateIcloudVirtualEmailMutationVariables>;
export const DeleteIcloudMailDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'DeleteIcloudMail' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'mailId' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'deleteIcloudMail' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'mailId' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'mailId' } },
                            },
                        ],
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<DeleteIcloudMailMutation, DeleteIcloudMailMutationVariables>;
export const DeleteIcloudPrimaryAccountDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'DeleteIcloudPrimaryAccount' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'deleteIcloudPrimaryAccount' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<DeleteIcloudPrimaryAccountMutation, DeleteIcloudPrimaryAccountMutationVariables>;
export const DeleteIcloudVirtualEmailDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'DeleteIcloudVirtualEmail' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'deleteIcloudVirtualEmail' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<DeleteIcloudVirtualEmailMutation, DeleteIcloudVirtualEmailMutationVariables>;
export const IcloudPrimaryAccountsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'IcloudPrimaryAccounts' },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'icloudPrimaryAccounts' },
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudPrimaryAccountView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'email' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapHost' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapPort' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'masterQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncError' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'virtualEmailCount' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<IcloudPrimaryAccountsQuery, IcloudPrimaryAccountsQueryVariables>;
export const IcloudReceivedMailsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'IcloudReceivedMails' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'virtualEmailId' } },
                    type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'primaryAccountId' } },
                    type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'unassignedOnly' } },
                    type: { kind: 'NamedType', name: { kind: 'Name', value: 'Boolean' } },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'limit' } },
                    type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'icloudReceivedMails' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'virtualEmailId' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'virtualEmailId' } },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'primaryAccountId' },
                                value: {
                                    kind: 'Variable',
                                    name: { kind: 'Name', value: 'primaryAccountId' },
                                },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'unassignedOnly' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'unassignedOnly' } },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'limit' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'limit' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudReceivedMailFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudReceivedMailFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudReceivedMailView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'virtualEmailId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'messageId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'fromAddress' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'fromName' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subject' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'bodyHtml' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'bodyText' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'extractedCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'receivedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'isRead' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'isStarred' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<IcloudReceivedMailsQuery, IcloudReceivedMailsQueryVariables>;
export const IcloudVirtualEmailsDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'query',
            name: { kind: 'Name', value: 'IcloudVirtualEmails' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'primaryAccountId' } },
                    type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'icloudVirtualEmails' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'primaryAccountId' },
                                value: {
                                    kind: 'Variable',
                                    name: { kind: 'Name', value: 'primaryAccountId' },
                                },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudVirtualEmailView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'aliasEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'buyerQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'mailCount' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastMailReceivedAt' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<IcloudVirtualEmailsQuery, IcloudVirtualEmailsQueryVariables>;
export const ReassignIcloudMailDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'ReassignIcloudMail' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'mailId' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'virtualEmailId' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'reassignIcloudMail' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'mailId' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'mailId' } },
                            },
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'virtualEmailId' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'virtualEmailId' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudReceivedMailFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudReceivedMailFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudReceivedMailView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'virtualEmailId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'messageId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'fromAddress' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'fromName' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'subject' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'bodyHtml' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'bodyText' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'extractedCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'receivedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'isRead' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'isStarred' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<ReassignIcloudMailMutation, ReassignIcloudMailMutationVariables>;
export const ResetIcloudMasterCodeDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'ResetIcloudMasterCode' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'resetIcloudMasterCode' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudPrimaryAccountView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'email' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapHost' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapPort' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'masterQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncError' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'virtualEmailCount' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<ResetIcloudMasterCodeMutation, ResetIcloudMasterCodeMutationVariables>;
export const ResetIcloudVirtualEmailCodeDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'ResetIcloudVirtualEmailCode' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'resetIcloudVirtualEmailCode' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudVirtualEmailView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'aliasEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'buyerQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'mailCount' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastMailReceivedAt' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<
    ResetIcloudVirtualEmailCodeMutation,
    ResetIcloudVirtualEmailCodeMutationVariables
>;
export const SyncIcloudAccountDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'SyncIcloudAccount' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'syncIcloudAccount' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'success' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'syncedCount' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'error' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<SyncIcloudAccountMutation, SyncIcloudAccountMutationVariables>;
export const TestIcloudConnectionDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'TestIcloudConnection' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                    type: {
                        kind: 'NonNullType',
                        type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'testIcloudConnection' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'id' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                { kind: 'Field', name: { kind: 'Name', value: 'success' } },
                                { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                            ],
                        },
                    },
                ],
            },
        },
    ],
} as unknown as DocumentNode<TestIcloudConnectionMutation, TestIcloudConnectionMutationVariables>;
export const UpdateIcloudPrimaryAccountDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'UpdateIcloudPrimaryAccount' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: {
                            kind: 'NamedType',
                            name: { kind: 'Name', value: 'UpdateIcloudPrimaryAccountInput' },
                        },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'updateIcloudPrimaryAccount' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudPrimaryAccountFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudPrimaryAccountView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'email' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapHost' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'imapPort' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'masterQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastSyncError' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'virtualEmailCount' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UpdateIcloudPrimaryAccountMutation, UpdateIcloudPrimaryAccountMutationVariables>;
export const UpdateIcloudVirtualEmailDocument = {
    kind: 'Document',
    definitions: [
        {
            kind: 'OperationDefinition',
            operation: 'mutation',
            name: { kind: 'Name', value: 'UpdateIcloudVirtualEmail' },
            variableDefinitions: [
                {
                    kind: 'VariableDefinition',
                    variable: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                    type: {
                        kind: 'NonNullType',
                        type: {
                            kind: 'NamedType',
                            name: { kind: 'Name', value: 'UpdateIcloudVirtualEmailInput' },
                        },
                    },
                },
            ],
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'updateIcloudVirtualEmail' },
                        arguments: [
                            {
                                kind: 'Argument',
                                name: { kind: 'Name', value: 'input' },
                                value: { kind: 'Variable', name: { kind: 'Name', value: 'input' } },
                            },
                        ],
                        selectionSet: {
                            kind: 'SelectionSet',
                            selections: [
                                {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        {
            kind: 'FragmentDefinition',
            name: { kind: 'Name', value: 'IcloudVirtualEmailFields' },
            typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'IcloudVirtualEmailView' } },
            selectionSet: {
                kind: 'SelectionSet',
                selections: [
                    { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountId' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'primaryAccountEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'aliasEmail' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'note' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'buyerQueryCode' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeExpiresAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'codeResetIntervalDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'remainingDays' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedAt' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastQueriedIp' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'mailCount' } },
                    { kind: 'Field', name: { kind: 'Name', value: 'lastMailReceivedAt' } },
                ],
            },
        },
    ],
} as unknown as DocumentNode<UpdateIcloudVirtualEmailMutation, UpdateIcloudVirtualEmailMutationVariables>;
