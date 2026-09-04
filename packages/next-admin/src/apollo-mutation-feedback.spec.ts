import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client';
import { afterEach, describe, expect, it } from 'vitest';

import { adminMutationFeedbackLink } from './apollo-mutation-feedback';
import { subscribeAdminFeedback, type AdminFeedback } from './utils/admin-feedback';

const SAVE_MUTATION = gql`
    mutation NextAdminUpdateStoreProfile {
        updateStoreProfile {
            __typename
        }
    }
`;

const SETTINGS_QUERY = gql`
    query NextAdminSettings {
        settings {
            __typename
        }
    }
`;

const subscriptions: Array<() => void> = [];

afterEach(() => {
    subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
});

describe('adminMutationFeedbackLink', () => {
    it('publishes pending and success feedback for every successful mutation', async () => {
        const events = collectFeedback();
        const client = createClient({ data: { updateStoreProfile: { __typename: 'StoreProfile' } } });

        await client.mutate({ mutation: SAVE_MUTATION });

        expect(events.map(event => event.kind)).toEqual(['loading', 'success']);
        expect(events.at(-1)?.title).toBe('保存成功');
        expect(events[0]?.id).toBe(events[1]?.id);
    });

    it('publishes the returned business reason instead of a false success', async () => {
        const events = collectFeedback();
        const client = createClient({
            data: {
                updateStoreProfile: {
                    __typename: 'StoreDomainConflictError',
                    message: '该域名已属于其他店铺',
                },
            },
        });

        await client.mutate({ mutation: SAVE_MUTATION });

        expect(events.map(event => event.kind)).toEqual(['loading', 'error']);
        expect(events.at(-1)?.message).toBe('该域名已属于其他店铺');
    });

    it('turns rejected requests into safe user-facing feedback', async () => {
        const events = collectFeedback();
        const client = createClient(undefined, new Error('Failed to fetch'));

        await expect(client.mutate({ mutation: SAVE_MUTATION })).rejects.toThrow('Failed to fetch');

        expect(events.at(-1)).toMatchObject({
            kind: 'error',
            title: '保存失败',
            message: '无法连接管理服务，请检查网络后重试',
        });
    });

    it('shows GraphQL validation reasons without reporting success', async () => {
        const events = collectFeedback();
        const client = createClient({ errors: [{ message: '店铺名称不能为空' }] });

        await expect(client.mutate({ mutation: SAVE_MUTATION })).rejects.toThrow('店铺名称不能为空');

        expect(events.map(event => event.kind)).toEqual(['loading', 'error']);
        expect(events.at(-1)?.message).toBe('店铺名称不能为空');
    });

    it('does not report success when the service returns no usable mutation result', async () => {
        const events = collectFeedback();
        const client = createClient({ data: { updateStoreProfile: null } });

        await client.mutate({ mutation: SAVE_MUTATION });

        expect(events.map(event => event.kind)).toEqual(['loading', 'error']);
        expect(events.at(-1)?.message).toBe('管理服务未返回操作结果');
    });

    it('allows authentication and specially handled mutations to opt out', async () => {
        const events = collectFeedback();
        const client = createClient({ data: { updateStoreProfile: { __typename: 'StoreProfile' } } });

        await client.mutate({ mutation: SAVE_MUTATION, context: { adminFeedback: false } });

        expect(events).toEqual([]);
    });

    it('does not create action feedback for read-only queries', async () => {
        const events = collectFeedback();
        const client = createClient({ data: { settings: { __typename: 'Settings' } } });

        await client.query({ query: SETTINGS_QUERY, fetchPolicy: 'no-cache' });

        expect(events).toEqual([]);
    });
});

function collectFeedback() {
    const events: AdminFeedback[] = [];
    subscriptions.push(subscribeAdminFeedback(event => events.push(event)));
    return events;
}

function createClient(result?: Record<string, unknown>, failure?: Error) {
    const terminalLink = new ApolloLink(
        () =>
            new Observable(observer => {
                if (failure) {
                    observer.error(failure);
                    return;
                }
                observer.next(result ?? {});
                observer.complete();
            }),
    );

    return new ApolloClient({
        link: adminMutationFeedbackLink.concat(terminalLink),
        cache: new InMemoryCache(),
    });
}
