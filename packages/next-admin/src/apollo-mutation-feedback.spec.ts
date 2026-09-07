import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client';
import { afterEach, describe, expect, it } from 'vitest';

import { adminMutationFeedbackLink } from './apollo-mutation-feedback';
import { SensitiveActionCancelledError } from './apollo-sensitive-action';
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
            title: '保存店铺档案失败',
            reason: '浏览器当前无法连接管理服务',
            resolution: ['检查网络和管理服务状态后重试'],
            retryable: true,
        });
    });

    it('replaces pending feedback with an informational state when password verification is cancelled', async () => {
        const events = collectFeedback();
        const client = createClient(undefined, new SensitiveActionCancelledError());

        await expect(client.mutate({ mutation: SAVE_MUTATION })).rejects.toThrow('操作已取消');

        expect(events.map(event => event.kind)).toEqual(['loading', 'info']);
        expect(events.at(-1)?.title).toBe('操作已取消');
    });

    it('shows GraphQL validation reasons without reporting success', async () => {
        const events = collectFeedback();
        const client = createClient({ errors: [{ message: '店铺名称不能为空' }] });

        await expect(client.mutate({ mutation: SAVE_MUTATION })).rejects.toThrow('店铺名称不能为空');

        expect(events.map(event => event.kind)).toEqual(['loading', 'error']);
        expect(events.at(-1)?.message).toBe('店铺名称不能为空');
        expect(events.at(-1)).toMatchObject({
            reason: '店铺名称不能为空',
            resolution: ['按页面提示修正对应字段后重新提交'],
        });
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

    it('shows the target, blocking resources and recovery steps from GraphQL extensions', async () => {
        const events = collectFeedback();
        const client = createClient({
            errors: [
                {
                    message: '商家主体仍被店铺使用',
                    extensions: {
                        code: 'RESOURCE_IN_USE',
                        blockingResources: [{ name: '美宜佳店铺', code: 'my-malaysia' }],
                        resolution: ['先将 Channel 改绑到其他商家主体'],
                        retryable: false,
                    },
                },
            ],
        });

        await expect(
            client.mutate({
                mutation: gql`
                    mutation NextAdminDeleteSeller($id: ID!) {
                        deleteSeller(id: $id) {
                            result
                        }
                    }
                `,
                variables: { id: 'seller-1' },
            }),
        ).rejects.toThrow('商家主体仍被店铺使用');

        expect(events.at(-1)).toMatchObject({
            title: '删除商家主体（ID：seller-1）失败',
            reason: '商家主体仍被店铺使用',
            details: ['美宜佳店铺（my-malaysia）'],
            resolution: ['先将 Channel 改绑到其他商家主体'],
            retryable: false,
        });
    });

    it('explains a deletion business refusal and names the channel that occupies the zone', async () => {
        const events = collectFeedback();
        const client = createClient({
            data: {
                deleteZone: {
                    result: 'NOT_DELETED',
                    message:
                        'The selected Zone cannot be deleted as it used as a default in the following Channels: 美宜佳',
                },
            },
        });

        await client.mutate({
            mutation: gql`
                mutation NextAdminDeleteBusinessZone($id: ID!) {
                    deleteZone(id: $id) {
                        result
                        message
                    }
                }
            `,
            variables: { id: 'zone-1' },
        });

        expect(events.at(-1)).toMatchObject({
            kind: 'error',
            title: '删除业务区域（ID：zone-1）失败',
            reason: '该数据仍被其他业务记录使用，当前不能直接删除',
            details: ['店铺 Channel：美宜佳'],
            resolution: ['先解除关联或将占用记录改绑到其他对象，再重新删除'],
        });
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
