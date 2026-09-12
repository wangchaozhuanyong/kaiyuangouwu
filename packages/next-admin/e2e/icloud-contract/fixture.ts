import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { buildASTSchema, graphql, Kind, parse, print } from 'graphql';

import { adminApiExtensions } from '../../../icloud-relay-plugin/src/api/api-extensions';
import type { IcloudPrimaryAccount, IcloudVirtualEmail } from '../../src/graphql/icloud-relay.graphql';

// Local interaction fixture: real server schema validation, in-memory resolver data.
// Persistence is tested separately through the actual HTTP/SQL.js backend.
export function createIcloudContractFixture() {
    const schema = buildASTSchema({
        kind: Kind.DOCUMENT,
        definitions: [
            ...parse(
                'scalar DateTime interface Node { id: ID! } type Query { _fixture: Boolean } type Mutation { _fixture: Boolean }',
            ).definitions,
            ...adminApiExtensions.definitions,
        ],
    });
    const primary: IcloudPrimaryAccount = {
        id: '1',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        email: 'fixture-primary@icloud.com',
        note: '主号1',
        status: 'ACTIVE',
        imapHost: 'imap.mail.me.com',
        imapPort: 993,
        masterQueryCode: 'LOCAL-FIXTURE-PRIMARY',
        codeExpiresAt: '2026-10-01T00:00:00Z',
        codeResetIntervalDays: 30,
        remainingDays: 20,
        lastQueriedAt: null,
        lastQueriedIp: null,
        lastSyncedAt: null,
        lastSyncError: null,
        virtualEmailCount: 1,
    };
    const virtual: IcloudVirtualEmail = {
        id: '2',
        createdAt: primary.createdAt,
        updatedAt: primary.updatedAt,
        primaryAccountId: primary.id,
        primaryAccountEmail: primary.email,
        aliasEmail: 'fixture-alias@icloud.com',
        note: '原备注',
        status: 'ACTIVE',
        buyerQueryCode: 'LOCAL-FIXTURE-VIRTUAL',
        codeExpiresAt: primary.codeExpiresAt,
        codeResetIntervalDays: 30,
        remainingDays: 20,
        lastQueriedAt: null,
        lastQueriedIp: null,
        mailCount: 0,
        lastMailReceivedAt: null,
    };
    const state = {
        primary,
        virtual,
        requests: [] as { name: string; variables: Record<string, unknown> }[],
        pending: undefined as Promise<void> | undefined,
        failure: '',
        queryFailure: '',
        batchResult: { createdCount: 1, skippedCount: 0, errors: [] as string[] },
    };
    const rootValue = {
        icloudPrimaryAccounts: () => [state.primary],
        icloudVirtualEmails: () => [state.virtual],
        icloudReceivedMails: () => [],
        updateIcloudVirtualEmail: ({ input }: { input: { id: string; note?: string } }) => {
            if (input.id !== state.virtual.id) throw new Error('Fixture record not found');
            if (state.failure) throw new Error(state.failure);
            state.virtual = { ...state.virtual, ...input };
            return state.virtual;
        },
        updateIcloudPrimaryAccount: ({ input }: { input: { id: string; note?: string } }) => {
            if (input.id !== state.primary.id) throw new Error('Fixture record not found');
            state.primary = { ...state.primary, ...input };
            return state.primary;
        },
        batchCreateIcloudVirtualEmails: () => state.batchResult,
    };
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    state.requests.push({
                        name: operation.operationName ?? '',
                        variables: operation.variables,
                    });
                    void (async () => {
                        if (operation.operationName?.startsWith('Update')) await state.pending;
                        if (operation.operationName?.startsWith('Icloud') && state.queryFailure)
                            throw new Error(state.queryFailure);
                        const result = await graphql({
                            schema,
                            source: print(operation.query),
                            variableValues: operation.variables,
                            rootValue,
                        });
                        observer.next(result);
                        observer.complete();
                    })().catch(error => observer.error(error));
                }),
        ),
    });
    return { client, state };
}
