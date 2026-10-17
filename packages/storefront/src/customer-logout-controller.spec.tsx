// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { Feedback } from './Feedback';
import { languageCodeFor } from './i18n';
import { useRouteCustomerLogout } from './logout';
import { storefrontQueryKeys } from './query-client';
import { type StorefrontContextValue } from './StorefrontContext';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let runtime: StorefrontContextValue;
let onAccount: boolean;
let coordinator: boolean;
let result: Promise<boolean>;
let logoutApi = vi.fn<() => Promise<void>>();
function Button() {
    const logout = useRouteCustomerLogout(runtime);
    return (
        <button
            disabled={logout.logoutPending}
            onClick={() => {
                result = logout.logoutCustomer();
            }}
        >
            Logout
        </button>
    );
}
function render() {
    act(() =>
        root.render(
            <QueryClientProvider client={client}>
                {coordinator && <Feedback runtime={runtime} />}
                {onAccount ? <Button /> : <main>Home</main>}
            </QueryClientProvider>,
        ),
    );
}
function request() {
    const button = host.querySelector<HTMLButtonElement>('button');
    if (!button) throw new Error('Expected the logout control');
    act(() => button.click());
}
function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}
beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    onAccount = true;
    coordinator = true;
    logoutApi = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    runtime = {
        market: { code: 'controller-fixture', currencyCode: 'MYR' },
        language: 'en',
        api: { logout: logoutApi },
        customer: { id: 'fixture-customer' },
        customerLoadState: 'ready',
        clearPrivateQueryCache: vi.fn(),
        setCustomer: vi.fn(),
        notify: vi.fn(),
    } as unknown as StorefrontContextValue;
    render();
});
afterEach(() => {
    act(() => root.unmount());
    client.clear();
    host.remove();
});

it('finishes one confirmed logout after the account route unmounts', async () => {
    const pending = deferred();
    logoutApi.mockReturnValue(pending.promise);
    request();
    expect(host.querySelector('button')?.disabled).toBe(true);
    onAccount = false;
    render();
    expect(host.textContent).toContain('Home');
    await act(async () => {
        pending.resolve();
        expect(await result).toBe(true);
    });
    expect(runtime.clearPrivateQueryCache).toHaveBeenCalledTimes(1);
    expect(runtime.setCustomer).toHaveBeenCalledExactlyOnceWith(null);
    expect(runtime.notify).toHaveBeenCalledExactlyOnceWith('Signed out');
});

it.each([true, false])('reconciles a lost response on home (leaves before response=%s)', async before => {
    const pending = deferred();
    logoutApi.mockReturnValue(pending.promise);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    request();
    if (before) {
        onAccount = false;
        render();
    }
    await act(async () => {
        pending.reject(new Error('Synthetic lost response'));
        expect(await result).toBe(false);
    });
    if (!before) {
        onAccount = false;
        render();
    }
    expect(runtime.clearPrivateQueryCache).not.toHaveBeenCalled();
    expect(runtime.setCustomer).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({
        queryKey: storefrontQueryKeys.customer(
            storefrontQueryKeys.market(runtime.market),
            languageCodeFor(runtime.language),
        ),
        exact: true,
        refetchType: 'none',
    });
    const clear = runtime.clearPrivateQueryCache;
    runtime = { ...runtime, customer: null, customerLoadState: 'ready' };
    render();
    expect(clear).toHaveBeenCalledTimes(1);
    render();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(logoutApi).toHaveBeenCalledTimes(1);
});

it('keeps the busy guard when returning to the account route during the same request', async () => {
    const pending = deferred();
    logoutApi.mockReturnValue(pending.promise);
    request();
    onAccount = false;
    render();
    onAccount = true;
    render();
    expect(host.querySelector('button')?.disabled).toBe(true);
    request();
    expect(logoutApi).toHaveBeenCalledTimes(1);
    await act(async () => {
        pending.resolve();
        await result;
    });
});

it('reports an unloaded coordinator without replaying a logout', async () => {
    coordinator = false;
    render();
    request();
    await expect(result).resolves.toBe(false);
    expect(logoutApi).not.toHaveBeenCalled();
    expect(runtime.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Sign-out is still loading. Please retry.',
    });
});
