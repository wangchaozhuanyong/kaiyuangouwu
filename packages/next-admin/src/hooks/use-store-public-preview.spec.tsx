// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext, type ConfirmDialogResult } from '../components/confirm-dialog-context';
import type { StoreProfileRecord } from '../graphql/management.graphql';
import { subscribeAdminFeedback, type AdminFeedback } from '../utils/admin-feedback';
import { AdminPermissionsContext } from './use-admin-permissions';
import { useStorePublicPreview } from './use-store-public-preview';

const scope = vi.hoisted(() => ({ value: 'scope-a', token: 'channel-fixture-a' }));
vi.mock('../apollo', () => ({
    getAdminQueryScope: () => scope.value,
    getActiveChannelToken: () => scope.token,
    channelRequestContext: (token: string) => ({
        headers: { 'vendure-token': token },
        queryDeduplication: false,
    }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile = {
    __typename: 'StoreProfile',
    id: 'profile-a',
    updatedAt: '2026-10-06T00:00:00Z',
    status: 'DRAFT',
    isPublished: false,
    sortOrder: 0,
    descriptionZh: '',
    descriptionEn: '',
    taglineZh: null,
    taglineEn: null,
    brandBackgroundColor: null,
    brandPrimaryColor: null,
    brandAccentColor: null,
    brandHighlightColor: null,
    legalEntityName: null,
    legalRegistrationCountry: null,
    legalRegistrationNumber: null,
    legalContactAddress: null,
    supportEmail: null,
    privacyEmail: null,
    internalNote: null,
    primaryDomain: 'store.example.test',
    storefrontUrl: 'https://store.example.test',
    isOperational: false,
    activationReadiness: { ready: false, checks: [] },
    logoAsset: null,
    logoOnLightAsset: null,
    logoOnDarkAsset: null,
    channel: {
        id: 'channel-a',
        code: 'store-a',
        token: 'channel-fixture-a',
        defaultCurrencyCode: 'CNY',
        defaultLanguageCode: 'zh_Hans',
        seller: null,
        customFields: { storefrontNameZh: '甲店', storefrontNameEn: 'Store A' },
    },
} as StoreProfileRecord;

describe('Channel-bound public preview', () => {
    let root: ReturnType<typeof createRoot>;
    let client: ApolloClient;
    let value: ReturnType<typeof useStorePublicPreview>;
    let mounted: boolean;
    let permitted: boolean;
    let writeFailure: Error | undefined;
    let writes: Array<{ variables: Record<string, unknown>; context: Record<string, unknown> }>;
    let feedback: AdminFeedback[];
    let unsubscribeFeedback: () => unknown;
    const completed = vi.fn<(message: string) => Promise<void>>();
    const error = vi.fn<(message: string) => void>();
    const confirm = vi.fn<() => Promise<ConfirmDialogResult>>();
    const render = () =>
        act(async () => {
            root.render(
                <ApolloProvider client={client}>
                    <AdminPermissionsContext.Provider
                        value={{ permissions: [], hasAnyPermission: () => permitted }}
                    >
                        <ConfirmDialogContext.Provider value={confirm}>
                            <Harness />
                        </ConfirmDialogContext.Provider>
                    </AdminPermissionsContext.Provider>
                </ApolloProvider>,
            );
        });
    function Harness() {
        const result = useStorePublicPreview(completed, error);
        useLayoutEffect(() => {
            value = result;
        });
        return null;
    }
    beforeEach(async () => {
        mounted = true;
        permitted = true;
        writeFailure = undefined;
        writes = [];
        feedback = [];
        unsubscribeFeedback = subscribeAdminFeedback(value => feedback.push(value));
        scope.value = 'scope-a';
        scope.token = 'channel-fixture-a';
        completed.mockReset().mockResolvedValue(undefined);
        error.mockReset();
        confirm.mockReset().mockResolvedValue({});
        client = new ApolloClient({
            cache: new InMemoryCache(),
            link: new ApolloLink(
                operation =>
                    new Observable(observer => {
                        writes.push({ variables: operation.variables, context: operation.getContext() });
                        if (writeFailure) observer.error(writeFailure);
                        else {
                            observer.next({
                                data: {
                                    updateMyStoreProfile: {
                                        ...profile,
                                        isPublished: operation.variables.input.isPublished,
                                        updatedAt: '2026-10-06T00:00:01Z',
                                    },
                                },
                            });
                            observer.complete();
                        }
                    }),
            ),
        });
        root = createRoot(document.createElement('div'));
        await render();
    });
    afterEach(async () => {
        if (mounted) await act(async () => root.unmount());
        client.stop();
        unsubscribeFeedback();
    });
    it('uses real Apollo with an explicit target Channel and version, and never replays the write after readback failure', async () => {
        completed.mockRejectedValue(new Error('read failed'));
        await act(async () => value.togglePublicPreview(profile));
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({
            context: { headers: { 'vendure-token': 'channel-fixture-a' } },
            variables: { input: { expectedUpdatedAt: profile.updatedAt, isPublished: true } },
        });
        expect(completed).toHaveBeenCalledWith('公开预览已开放');
        expect(error).toHaveBeenCalledWith('操作已完成，但最新数据读取失败。请刷新页面，勿重复提交。');
        expect(feedback).toHaveLength(1);
        expect(feedback[0]).toMatchObject({ kind: 'info', title: '操作已完成，数据更新失败' });
        expect(value.publicPreviewBusy).toBe(false);
    });
    it.each(['channel', 'unmount'] as const)(
        'suppresses stale global feedback when %s changes during pending readback',
        async reason => {
            let rejectRead!: (error: Error) => void;
            completed.mockImplementation(
                () =>
                    new Promise((_resolve, reject) => {
                        rejectRead = reject;
                    }),
            );
            let task!: Promise<void>;
            await act(async () => {
                task = value.togglePublicPreview(profile);
            });
            expect(writes).toHaveLength(1);
            expect(completed).toHaveBeenCalledWith('公开预览已开放');
            if (reason === 'channel') {
                scope.value = 'scope-b';
                scope.token = 'channel-fixture-b';
            } else {
                await act(async () => root.unmount());
                mounted = false;
            }
            await act(async () => {
                rejectRead(new Error('old read failed'));
                await task;
            });
            expect(writes).toHaveLength(1);
            expect(error).not.toHaveBeenCalled();
            expect(feedback).toHaveLength(0);
        },
    );
    it.each(['scope', 'channel', 'unmount', 'permission'] as const)(
        'cancels confirmation after %s changes without sending a mutation',
        async reason => {
            let resolve!: (result: ConfirmDialogResult) => void;
            confirm.mockImplementation(
                () =>
                    new Promise(done => {
                        resolve = done;
                    }),
            );
            let task!: Promise<void>;
            await act(async () => {
                task = value.togglePublicPreview(profile);
            });
            if (reason === 'scope') scope.value = 'scope-b';
            if (reason === 'channel') scope.token = 'channel-fixture-b';
            if (reason === 'unmount') {
                await act(async () => root.unmount());
                mounted = false;
            }
            if (reason === 'permission') {
                permitted = false;
                await render();
            }
            await act(async () => {
                resolve({});
                await task;
            });
            expect(writes).toHaveLength(0);
            expect(completed).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
        },
    );
    it('rejects a profile outside the actual current Channel before opening confirmation', async () => {
        await act(async () =>
            value.togglePublicPreview({
                ...profile,
                channel: { ...profile.channel, token: 'channel-fixture-b' },
            }),
        );
        expect(confirm).not.toHaveBeenCalled();
        expect(writes).toHaveLength(0);
        expect(error).toHaveBeenCalledWith('请先将当前店铺切换到要操作预览的店铺');
    });
    it('prevents duplicate confirmation submissions and respects cancellation', async () => {
        let resolve!: (result: ConfirmDialogResult) => void;
        confirm.mockImplementation(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        let task!: Promise<void>;
        await act(async () => {
            task = value.togglePublicPreview(profile);
            await value.togglePublicPreview(profile);
        });
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(value.publicPreviewBusy).toBe(true);
        await act(async () => {
            resolve(false);
            await task;
        });
        expect(writes).toHaveLength(0);
        expect(value.publicPreviewBusy).toBe(false);
    });
    it('does not offer a write to read-only users or non-draft stores', async () => {
        permitted = false;
        await render();
        await act(async () => value.togglePublicPreview(profile));
        expect(value.canUpdatePublicPreview).toBe(false);
        permitted = true;
        await render();
        await act(async () => value.togglePublicPreview({ ...profile, status: 'ACTIVE' }));
        expect(writes).toHaveLength(0);
        expect(confirm).not.toHaveBeenCalled();
    });
    it('blocks opening without a primary domain, but lets an already-open preview close', async () => {
        await act(async () => value.togglePublicPreview({ ...profile, primaryDomain: null }));
        expect(error).toHaveBeenCalledWith('请先配置并验证主域名，再开放预览');
        await act(async () =>
            value.togglePublicPreview({ ...profile, primaryDomain: null, isPublished: true }),
        );
        expect(writes).toHaveLength(1);
        expect(writes[0].variables).toMatchObject({ input: { isPublished: false } });
        expect(confirm).not.toHaveBeenCalled();
        expect(completed).toHaveBeenCalledWith('公开预览已关闭');
    });
    it('reports a rejected write and does not show write success or retry it', async () => {
        writeFailure = new Error('版本冲突，请刷新后重试');
        await act(async () => value.togglePublicPreview(profile));
        expect(writes).toHaveLength(1);
        expect(completed).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledTimes(1);
    });
});
