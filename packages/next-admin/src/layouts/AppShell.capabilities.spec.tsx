// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminCapabilitySnapshot } from '../../../common/src/admin-capabilities';
import { AppShell } from './AppShell';

const mountedBusinessPaths = vi.hoisted(() => [] as string[]);
vi.mock('../extensions/installed-extensions', () => ({}));
vi.mock('../components/OrderNotifications', () => ({ OrderNotifications: () => null }));
vi.mock('../custom-fields/CustomFieldsProvider', () => ({
    CustomFieldsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../theme/theme-context', () => ({
    useTheme: () => ({ preference: 'light', resolvedTheme: 'light', setPreference: vi.fn() }),
}));
vi.mock('../route-modules', () => ({
    allowsBackgroundRoutePreload: () => false,
    preloadCommonRoutes: () => () => undefined,
    preloadRoute: vi.fn(),
}));
vi.mock('./TabbedOutlet', () => ({
    TabbedOutlet: () => {
        const location = useLocation();
        mountedBusinessPaths.push(location.pathname);
        return <div data-business-page>{location.pathname}</div>;
    },
}));

let host: HTMLDivElement;
let root: Root;
let client: ApolloClient;
let snapshot: AdminCapabilitySnapshot;
let failBootstrap: boolean;
let bootstrapRequests: number;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    });
    mountedBusinessPaths.length = 0;
    failBootstrap = false;
    bootstrapRequests = 0;
    snapshot = {
        channelId: 'a',
        channelCode: 'store-a',
        scope: 'STORE',
        commerceMode: 'DIGITAL_ONLY',
        capabilities: [
            { id: '/dashboard', state: 'READY', canRead: true, canWrite: false, canConfigure: false },
            { id: '/catalog/list', state: 'READY', canRead: true, canWrite: false, canConfigure: false },
            {
                id: '/catalog/products/new',
                state: 'FORBIDDEN',
                canRead: false,
                canWrite: false,
                canConfigure: false,
            },
            {
                id: '/settings/store-profile/shipping',
                state: 'UNSUPPORTED',
                canRead: false,
                canWrite: false,
                canConfigure: false,
            },
            {
                id: '/settings/system-ops/settings',
                state: 'UNSUPPORTED',
                canRead: false,
                canWrite: false,
                canConfigure: false,
            },
        ],
    };
    const channel = {
        id: 'a',
        code: 'store-a',
        token: 'fixture-a',
        defaultCurrencyCode: 'CNY',
        defaultLanguageCode: 'zh_Hans',
        customFields: { storefrontNameZh: '店铺A', storefrontNameEn: 'Store A' },
    };
    client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    bootstrapRequests++;
                    const timer = setTimeout(() => {
                        if (failBootstrap) {
                            observer.error(new Error('配置读取失败'));
                            return;
                        }
                        if (operation.operationName !== 'NextAdminAppShellBootstrap') {
                            observer.error(new Error('Unexpected business bootstrap query'));
                            return;
                        }
                        observer.next({
                            data: {
                                currentAdminCapabilities: snapshot,
                                activeChannel: channel,
                                manageableChannels: [channel],
                                me: {
                                    id: 'u',
                                    identifier: 'reader',
                                    channels: [{ ...channel, permissions: ['ReadProduct'] }],
                                },
                                activeAdministrator: {
                                    id: 'admin',
                                    createdAt: '2026-10-07',
                                    updatedAt: '2026-10-07',
                                    firstName: '甲',
                                    lastName: '',
                                    emailAddress: 'fixture@example.invalid',
                                    user: {
                                        id: 'u',
                                        identifier: 'reader',
                                        verified: true,
                                        lastLogin: null,
                                        authenticationMethods: [],
                                        roles: [],
                                    },
                                },
                            },
                        });
                        observer.complete();
                    }, 5);
                    return () => clearTimeout(timer);
                }),
        ),
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.stop();
    host.remove();
});
async function render(path: string) {
    await act(async () => {
        root.render(
            <ApolloProvider client={client}>
                <MemoryRouter initialEntries={[path]}>
                    <AppShell />
                </MemoryRouter>
            </ApolloProvider>,
        );
    });
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
    });
}

it('redirects unsupported store URLs before the business page mounts', async () => {
    await render('/settings/store-profile/shipping');
    expect(mountedBusinessPaths).not.toContain('/settings/store-profile/shipping');
    expect(mountedBusinessPaths).toContain('/dashboard');
    expect(host.querySelector('a[href="/settings/system-ops/settings"]')).toBeNull();
});
it('does not mount a create page with read permission alone', async () => {
    await render('/catalog/products/new');
    expect(mountedBusinessPaths).toHaveLength(0);
    expect(host.textContent).toContain('当前账号无权访问');
});
it('offers retry on a failed bootstrap without granting business access', async () => {
    failBootstrap = true;
    await render('/catalog/list');
    expect(mountedBusinessPaths).toHaveLength(0);
    expect(host.textContent).toContain('权限信息读取失败');
    failBootstrap = false;
    await act(async () => {
        [...host.querySelectorAll('button')]
            .find(button => button.textContent?.includes('重新核验权限'))!
            .click();
    });
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(bootstrapRequests).toBe(2);
    expect(mountedBusinessPaths).toContain('/catalog/list');
});
it('rejects a cached snapshot for another store', async () => {
    snapshot = { ...snapshot, channelId: 'b', channelCode: 'store-b' };
    await render('/catalog/list');
    expect(mountedBusinessPaths).toHaveLength(0);
    expect(host.textContent).toContain('权限信息读取失败');
});
