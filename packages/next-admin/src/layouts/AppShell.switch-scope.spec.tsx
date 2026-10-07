// @vitest-environment jsdom
import { ApolloProvider } from '@apollo/client/react';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ADMIN_CAPABILITY_DEFINITIONS } from '../../../common/src/admin-capabilities';
import { client, getActiveChannelToken, setInitialActiveChannel } from '../apollo';
import { APP_SHELL_BOOTSTRAP_QUERY } from '../graphql/auth.graphql';
import { useAdminCapabilities } from '../hooks/use-admin-capabilities';

import { AppShell } from './AppShell';

vi.mock('../components/OrderNotifications', () => ({ OrderNotifications: () => null }));
vi.mock('../custom-fields/CustomFieldsProvider', () => ({
    CustomFieldsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../theme/theme-context', () => ({
    useTheme: () => ({ preference: 'light', resolvedTheme: 'light', setPreference: vi.fn() }),
}));
vi.mock('../route-modules', async importOriginal => ({
    ...(await importOriginal<typeof import('../route-modules')>()),
    allowsBackgroundRoutePreload: () => false,
    preloadCommonRoutes: () => () => undefined,
    preloadRoute: vi.fn(),
}));
vi.mock('./TabbedOutlet', () => ({
    TabbedOutlet: () => {
        const { snapshot } = useAdminCapabilities();
        const [draft, setDraft] = useState('');
        return (
            <div data-business-scope={snapshot?.channelId}>
                <input aria-label="fixture draft" value={draft} onChange={e => setDraft(e.target.value)} />
            </div>
        );
    },
}));

const channels = ['a', 'b'].map(id => ({
    id,
    code: `store-${id}`,
    token: `fixture-${id}`,
    defaultCurrencyCode: 'CNY',
    defaultLanguageCode: 'zh_Hans',
    customFields: { storefrontNameZh: `店铺${id.toUpperCase()}`, storefrontNameEn: `Store ${id}` },
}));
function bootstrap(id: string) {
    const allowed = new Set(['/dashboard', '/catalog/list', '/settings/store-profile']);
    if (id === 'a') allowed.add('/settings/store-profile/shipping');
    return {
        currentAdminCapabilities: {
            channelId: id,
            channelCode: `store-${id}`,
            scope: 'STORE',
            commerceMode: id === 'a' ? 'PHYSICAL_ONLY' : 'DIGITAL_ONLY',
            capabilities: ADMIN_CAPABILITY_DEFINITIONS.map(definition => ({
                id: definition.id,
                state: allowed.has(definition.id) ? 'READY' : 'UNSUPPORTED',
                canRead: allowed.has(definition.id),
                canWrite: false,
                canConfigure: false,
            })),
        },
        activeChannel: channels.find(channel => channel.id === id),
        manageableChannels: channels,
        me: {
            id: 'fixture-user',
            identifier: 'fixture-reader',
            channels: channels.map(channel => ({
                ...channel,
                permissions: ['ReadProduct', 'ReadShippingMethod'],
            })),
        },
        activeAdministrator: {
            id: 'fixture-admin',
            createdAt: '2026-10-07',
            updatedAt: '2026-10-07',
            firstName: '甲',
            lastName: '',
            emailAddress: 'fixture@example.invalid',
            user: {
                id: 'fixture-user',
                identifier: 'fixture-reader',
                verified: true,
                lastLogin: null,
                authenticationMethods: [],
                roles: [],
            },
        },
    };
}
const response = (id: string) =>
    new Response(JSON.stringify({ data: bootstrap(id) }), {
        headers: { 'content-type': 'application/json' },
    });
let host: HTMLDivElement;
let root: Root;
let deferA: boolean;
let releaseA: (() => void) | undefined;
beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: class {
            observe = vi.fn();
            unobserve = vi.fn();
            disconnect = vi.fn();
        },
    });
    localStorage.clear();
    sessionStorage.clear();
    await client.clearStore();
    setInitialActiveChannel('fixture-a');
    deferA = false;
    releaseA = undefined;
    vi.stubGlobal(
        'fetch',
        vi.fn((_input, init: RequestInit | undefined) => {
            const headers = new Headers(init?.headers);
            const id = headers.get('vendure-token') === 'fixture-b' ? 'b' : 'a';
            if (id === 'a' && deferA)
                return new Promise<Response>(resolve => {
                    releaseA = () => resolve(response('a'));
                });
            return Promise.resolve(response(id));
        }),
    );
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
        root.render(
            <ApolloProvider client={client}>
                <MemoryRouter initialEntries={['/catalog/list']}>
                    <AppShell />
                </MemoryRouter>
            </ApolloProvider>,
        ),
    );
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
    });
});
afterEach(async () => {
    act(() => root.unmount());
    releaseA?.();
    await client.clearStore();
    host.remove();
    vi.unstubAllGlobals();
});
function requireElement<T extends Element>(parent: ParentNode, selector: string): T {
    const element = parent.querySelector<T>(selector);
    if (!element) throw new Error(`Missing fixture control: ${selector}`);
    return element;
}
function setInputValue(element: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(element);
    if (!setter) throw new Error('Missing native input setter');
    setter(value);
}
async function switchToB() {
    const selector = requireElement<HTMLSelectElement>(host, 'select[aria-label="切换当前店铺"]');
    expect(selector?.disabled).toBe(false);
    await act(async () => {
        selector.value = 'fixture-b';
        selector.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(getActiveChannelToken()).toBe('fixture-b');
    expect(host.querySelector('[data-business-scope="b"]')).not.toBeNull();
}
async function openSearch() {
    await act(() =>
        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'k',
                metaKey: true,
                bubbles: true,
            }),
        ),
    );
    const search = requireElement<HTMLInputElement>(document, 'input[aria-label="搜索后台功能"]');
    act(() => {
        setInputValue(search, '配送');
        search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return document.querySelector('#command-search-results')?.textContent ?? '';
}
it('switches real Apollo scope, discards the old draft and removes unsupported search entries', async () => {
    expect(host.querySelector('[data-business-scope="a"]')).not.toBeNull();
    expect(await openSearch()).toContain('配送设置');
    await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    const draft = requireElement<HTMLInputElement>(host, 'input[aria-label="fixture draft"]');
    act(() => {
        setInputValue(draft, 'A-private-draft');
        draft.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(draft.value).toBe('A-private-draft');
    await switchToB();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="fixture draft"]')?.value).toBe('');
    expect(await openSearch()).not.toContain('配送设置');
    expect(document.body.textContent).not.toContain('A-private-draft');
    expect(host.querySelector('a[href="/settings/store-profile/shipping"]')).toBeNull();
});
it('rejects a delayed A bootstrap after B is active without replacing B capabilities or cache', async () => {
    deferA = true;
    const late = client.query({ query: APP_SHELL_BOOTSTRAP_QUERY, fetchPolicy: 'network-only' }).then(
        () => 'unexpected',
        error => String(error.message),
    );
    await vi.waitFor(() => expect(releaseA).toBeTypeOf('function'));
    await switchToB();
    await act(async () => {
        if (!releaseA) throw new Error('Missing delayed fixture request');
        releaseA();
        await late;
    });
    expect(await late).toMatch(/旧请求|aborted|stopped|cancel|cleared|Store reset/i);
    expect(host.querySelector('[data-business-scope="b"]')).not.toBeNull();
    expect(host.querySelector('[data-business-scope="a"]')).toBeNull();
    expect(await openSearch()).not.toContain('配送设置');
    expect(
        client.cache.readQuery<any>({ query: APP_SHELL_BOOTSTRAP_QUERY })?.currentAdminCapabilities.channelId,
    ).toBe('b');
});
