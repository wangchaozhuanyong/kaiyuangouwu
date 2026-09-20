// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { GraphQLError } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const auth = vi.hoisted(() => ({ clear: vi.fn(), selectedChannelToken: 'store-a', select: vi.fn() }));
vi.mock('./apollo', () => ({
    clearAuthSession: auth.clear,
    getActiveChannelToken: () => auth.selectedChannelToken,
    hasActiveChannelSelection: () => Boolean(auth.selectedChannelToken),
    setInitialActiveChannel: (channelToken: string) => {
        auth.selectedChannelToken = channelToken;
        auth.select(channelToken);
    },
}));
vi.mock('./extensions/installed-extensions', () => ({}));
vi.mock('./extensions/extension-api', () => ({
    getNextAdminExtensionLegacyRoutes: () => [],
    getNextAdminExtensionRoutes: () => [],
}));
vi.mock('./route-modules', () => ({ routeModuleLoaders: {} }));
vi.mock('./layouts/AppShell', () => ({ AppShell: () => <main>已进入管理界面</main> }));
vi.mock('./pages/Auth/LoginModule', () => ({ LoginModule: () => <main>管理员登录入口</main> }));
vi.mock('./pages/Auth/InitialPasswordChangeModule', () => ({
    InitialPasswordChangeModule: () => <main>首次密码修改门禁</main>,
}));

const cleanups: Array<() => void> = [];
const me = { __typename: 'CurrentUser', id: 'fixture-admin', identifier: 'fixture-admin', channels: [] };
const ready = { me, merchantInitialPasswordStatus: { mustChangePassword: false } };
const denied = (message: string) => ({
    data: null,
    errors: [
        new GraphQLError(message, {
            path: ['merchantInitialPasswordStatus'],
            extensions: { code: 'FORBIDDEN' },
        }),
    ],
});

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    auth.clear.mockClear();
    auth.select.mockClear();
    auth.selectedChannelToken = 'store-a';
    window.history.replaceState(null, '', '/dashboard');
});
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function renderApp(respond: (name: string) => Record<string, unknown> | Error) {
    const requests = vi.fn();
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    requests(operation.operationName);
                    const response = respond(operation.operationName ?? '');
                    if (response instanceof Error) observer.error(response);
                    else {
                        observer.next(response);
                        observer.complete();
                    }
                }),
        ),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(() => {
        root.unmount();
        client.stop();
        host.remove();
    });
    await act(async () => {
        root.render(
            <ApolloProvider client={client}>
                <App />
            </ApolloProvider>,
        );
    });
    return { host, requests };
}

// Simulation issue #41: a localized FORBIDDEN is not proof that the session expired.
describe('admin bootstrap session recovery', () => {
    it('checks me separately and redirects a confirmed anonymous session after Chinese FORBIDDEN', async () => {
        const { host, requests } = await renderApp(name =>
            name === 'GetAdminBootstrap' ? denied('你当前无权执行此操作') : { data: { me: null } },
        );
        expect(requests).toHaveBeenCalledWith('GetAdminSession');
        expect(host.textContent).toContain('管理员登录入口');
        expect(window.location.pathname).toBe('/login');
        expect(auth.clear).toHaveBeenCalledOnce();
    });

    it.each(['你当前无权执行此操作', 'You are not currently authorized to perform this action'])(
        'keeps a verified authenticated session on a genuine permission denial: %s',
        async message => {
            const { host } = await renderApp(name =>
                name === 'GetAdminBootstrap' ? denied(message) : { data: { me: { id: me.id } } },
            );
            expect(host.querySelector('[role="alert"]')?.textContent).toContain('管理员会话验证失败');
            expect(host.textContent).not.toContain('管理员登录入口');
            expect(host.textContent).not.toContain('已进入管理界面');
            expect(auth.clear).not.toHaveBeenCalled();
        },
    );

    it('recovers a restricted administrator from a stale unauthorized channel selection', async () => {
        let bootstrapAttempts = 0;
        const restrictedMe = {
            ...me,
            channels: [{ id: 'moyao', code: 'moyao-ai', token: 'moyao-token' }],
        };
        const { host, requests } = await renderApp(name => {
            if (name !== 'GetAdminBootstrap') return { data: { me: { id: me.id } } };
            bootstrapAttempts += 1;
            if (bootstrapAttempts === 1) {
                return {
                    data: { me: restrictedMe, merchantInitialPasswordStatus: null },
                    errors: [
                        new GraphQLError('你当前无权执行此操作', {
                            path: ['merchantInitialPasswordStatus'],
                            extensions: { code: 'FORBIDDEN' },
                        }),
                    ],
                };
            }
            return {
                data: {
                    me: restrictedMe,
                    merchantInitialPasswordStatus: { mustChangePassword: false },
                },
            };
        });

        expect(auth.select).toHaveBeenCalledWith('moyao-token');
        expect(auth.selectedChannelToken).toBe('moyao-token');
        expect(host.textContent).toContain('已进入管理界面');
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(requests.mock.calls.filter(([name]) => name === 'GetAdminBootstrap')).toHaveLength(2);
    });

    it('keeps a SuperAdmin on a selected store even when me.channels is stale', async () => {
        auth.selectedChannelToken = 'moyao-token';
        const { host } = await renderApp(() => ({
            data: {
                me: {
                    ...me,
                    channels: [{ id: 'default', code: '__default_channel__', token: 'default-token' }],
                },
                activeAdministrator: {
                    user: { roles: [{ code: '__super_admin_role__' }] },
                },
                channels: {
                    items: [
                        { id: 'default', code: '__default_channel__', token: 'default-token' },
                        { id: 'moyao', code: 'moyao-ai', token: 'moyao-token' },
                    ],
                },
                merchantInitialPasswordStatus: { mustChangePassword: false },
            },
        }));

        expect(auth.select).not.toHaveBeenCalled();
        expect(auth.selectedChannelToken).toBe('moyao-token');
        expect(host.textContent).toContain('已进入管理界面');
    });

    it('accepts the real anonymous Admin API me=null plus field-specific FORBIDDEN response', async () => {
        const { host } = await renderApp(name =>
            name === 'GetAdminBootstrap'
                ? denied('你当前无权执行此操作')
                : {
                      data: { me: null },
                      errors: [
                          new GraphQLError('你当前无权执行此操作', {
                              path: ['me'],
                              extensions: { code: 'FORBIDDEN' },
                          }),
                      ],
                  },
        );
        expect(host.textContent).toContain('管理员登录入口');
        expect(auth.clear).toHaveBeenCalledOnce();
    });

    it.each([
        { path: ['merchantInitialPasswordStatus'], code: 'FORBIDDEN' },
        { path: ['me'], code: 'INTERNAL_SERVER_ERROR' },
        { path: ['me', 'id'], code: 'FORBIDDEN' },
    ])('does not treat other failed identity responses as logout: %j', async ({ path, code }) => {
        const { host } = await renderApp(name =>
            name === 'GetAdminBootstrap'
                ? denied('你当前无权执行此操作')
                : {
                      data: { me: null },
                      errors: [
                          new GraphQLError('验证失败', {
                              path,
                              extensions: { code },
                          }),
                      ],
                  },
        );
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(auth.clear).not.toHaveBeenCalled();
    });

    it('does not clear a session when the identity recheck also fails', async () => {
        const { host } = await renderApp(name =>
            name === 'GetAdminBootstrap' ? denied('你当前无权执行此操作') : new Error('Failed to fetch'),
        );
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(auth.clear).not.toHaveBeenCalled();
        expect(window.location.pathname).toBe('/dashboard');
    });

    it('does not add an identity recheck or bypass the initial-password gate on success', async () => {
        const { host, requests } = await renderApp(() => ({
            data: {
                ...ready,
                merchantInitialPasswordStatus: { mustChangePassword: true },
            },
        }));
        expect(host.textContent).toContain('首次密码修改门禁');
        expect(requests).toHaveBeenCalledTimes(1);
        expect(auth.clear).not.toHaveBeenCalled();
    });

    it('clears stale local authentication when a successful bootstrap explicitly returns me=null', async () => {
        const { host } = await renderApp(() => ({ data: { ...ready, me: null } }));
        expect(host.textContent).toContain('管理员登录入口');
        expect(auth.clear).toHaveBeenCalledOnce();
    });

    it('retries both failed bootstrap and identity checks without forcing logout', async () => {
        let fail = true;
        const { host, requests } = await renderApp(name =>
            name === 'GetAdminBootstrap'
                ? fail
                    ? denied('你当前无权执行此操作')
                    : { data: ready }
                : { data: { me: { id: me.id } } },
        );
        fail = false;
        const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重新验证');
        expect(retry).toBeTruthy();
        await act(async () => retry!.click());
        expect(host.textContent).toContain('已进入管理界面');
        expect(requests.mock.calls.filter(([name]) => name === 'GetAdminSession')).toHaveLength(2);
        expect(auth.clear).not.toHaveBeenCalled();
    });
});
