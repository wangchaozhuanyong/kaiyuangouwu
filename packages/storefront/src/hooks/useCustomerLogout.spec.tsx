// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Prepare integration-fixture dependencies before the per-case timer; cold loading has separate tests.
import { SHOP_API_QUERY_TIMEOUT_MS, ShopApi } from '../api';
import '../api/account';
import { SupersededLogoutError } from '../api/logout-error';

import '../api/session-queue';
import '../api/session-runtime';
import { useCustomerLogout } from './useCustomerLogout';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Options = Parameters<typeof useCustomerLogout>[0];

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('R01 confirmed customer logout', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let client: QueryClient;
    let options: Options;
    let value: ReturnType<typeof useCustomerLogout>;
    function Harness() {
        value = useCustomerLogout(options);
        return (
            <button disabled={value.logoutPending} onClick={() => void value.logoutCustomer()}>
                Logout
            </button>
        );
    }
    function render() {
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            ),
        );
    }
    beforeEach(() => {
        client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        options = {
            api: { logout: vi.fn().mockResolvedValue(undefined) },
            scope: 'synthetic-a',
            customer: { id: 'customer-a' },
            customerLoadState: 'ready',
            customerQueryKey: ['storefront', 'synthetic-a', 'customer'],
            language: 'zh',
            clearPrivateQueryCache: vi.fn(),
            setCustomer: vi.fn(),
            notify: vi.fn(),
        };
        client.setQueryData(options.customerQueryKey, { id: 'customer-a' });
        render();
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        host.remove();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('waits for acknowledgement and coalesces repeated clicks without clearing early', async () => {
        const request = deferred();
        vi.mocked(options.api.logout).mockReturnValue(request.promise);
        let first!: Promise<boolean>;
        act(() => {
            first = value.logoutCustomer();
        });
        expect(host.querySelector('button')?.disabled).toBe(true);
        expect(options.clearPrivateQueryCache).not.toHaveBeenCalled();
        expect(options.setCustomer).not.toHaveBeenCalled();
        await act(async () => {
            expect(await value.logoutCustomer()).toBe(false);
        });
        expect(options.api.logout).toHaveBeenCalledTimes(1);
        await act(async () => {
            request.resolve();
            expect(await first).toBe(true);
        });
        expect(options.clearPrivateQueryCache).toHaveBeenCalledTimes(1);
        expect(options.setCustomer).toHaveBeenCalledExactlyOnceWith(null);
        expect(options.notify).toHaveBeenCalledExactlyOnceWith('已退出登录');
        expect(host.querySelector('button')?.disabled).toBe(false);
    });

    it.each(['zh', 'en'] as const)(
        'reports an unconfirmed %s result without a successful local logout',
        async language => {
            options = { ...options, language };
            vi.mocked(options.api.logout).mockRejectedValue(new Error('Synthetic response lost'));
            const otherKey = ['storefront', 'synthetic-b', 'customer'];
            client.setQueryData(otherKey, { id: 'customer-b' });
            render();
            await act(async () => {
                expect(await value.logoutCustomer()).toBe(false);
            });
            expect(options.api.logout).toHaveBeenCalledTimes(1);
            expect(options.clearPrivateQueryCache).not.toHaveBeenCalled();
            expect(options.setCustomer).not.toHaveBeenCalled();
            expect(options.notify).toHaveBeenCalledWith({
                type: 'error',
                message: expect.stringContaining(
                    language === 'zh' ? '退出结果未确认' : 'Sign-out unconfirmed',
                ),
            });
            expect(client.getQueryState(options.customerQueryKey)?.isInvalidated).toBe(true);
            expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
            expect(host.querySelector('button')?.disabled).toBe(false);
        },
    );

    it('cleans private data after the existing identity read confirms an ambiguous logout', async () => {
        vi.mocked(options.api.logout).mockRejectedValue(new Error('Synthetic lost response'));
        await act(async () => {
            await value.logoutCustomer();
        });
        options = { ...options, customer: null, customerLoadState: 'error' };
        render();
        expect(options.clearPrivateQueryCache).not.toHaveBeenCalled();
        options = { ...options, customerLoadState: 'ready' };
        render();
        expect(options.clearPrivateQueryCache).toHaveBeenCalledTimes(1);
        expect(options.api.logout).toHaveBeenCalledTimes(1);
        expect(options.setCustomer).not.toHaveBeenCalled();
        expect(options.notify).toHaveBeenCalledTimes(1);
    });

    it('allows an explicit retry without replaying logout automatically', async () => {
        vi.mocked(options.api.logout)
            .mockRejectedValueOnce(new Error('Synthetic offline'))
            .mockResolvedValue(undefined);
        await act(async () => {
            expect(await value.logoutCustomer()).toBe(false);
        });
        render();
        expect(options.api.logout).toHaveBeenCalledTimes(1);
        await act(async () => {
            expect(await value.logoutCustomer()).toBe(true);
        });
        expect(options.api.logout).toHaveBeenCalledTimes(2);
        expect(options.clearPrivateQueryCache).toHaveBeenCalledTimes(1);
        expect(options.setCustomer).toHaveBeenCalledExactlyOnceWith(null);
    });

    it.each(['scope', 'customer'] as const)(
        'does not clear a newer %s after an old logout response',
        async changed => {
            const request = deferred();
            vi.mocked(options.api.logout).mockReturnValue(request.promise);
            let pending!: Promise<boolean>;
            act(() => {
                pending = value.logoutCustomer();
            });
            options =
                changed === 'scope'
                    ? { ...options, scope: 'synthetic-b' }
                    : { ...options, customer: { id: 'customer-b' } };
            render();
            await act(async () => {
                request.resolve();
                expect(await pending).toBe(false);
            });
            expect(options.clearPrivateQueryCache).not.toHaveBeenCalled();
            expect(options.setCustomer).not.toHaveBeenCalled();
            expect(options.notify).not.toHaveBeenCalled();
        },
    );

    it('does not report an old logout failure against a newly signed-in customer', async () => {
        let reject!: (error: Error) => void;
        vi.mocked(options.api.logout).mockReturnValue(
            new Promise<void>((_resolve, fail) => {
                reject = fail;
            }),
        );
        let pending!: Promise<boolean>;
        act(() => {
            pending = value.logoutCustomer();
        });
        options = { ...options, customer: { id: 'customer-b' } };
        render();
        await act(async () => {
            reject(new Error('Synthetic old response'));
            expect(await pending).toBe(false);
        });
        expect(options.notify).not.toHaveBeenCalled();
        expect(options.clearPrivateQueryCache).not.toHaveBeenCalled();
        expect(client.getQueryState(options.customerQueryKey)?.isInvalidated).toBe(false);
    });

    it.each([false, true])(
        'ignores a superseded logout for the same customer (rebuilt API: %s)',
        async rebuilt => {
            let reject!: (error: Error) => void;
            vi.mocked(options.api.logout).mockReturnValue(
                new Promise((_resolve, fail) => {
                    reject = fail;
                }),
            );
            let pending!: Promise<boolean>;
            act(() => {
                pending = value.logoutCustomer();
            });
            if (rebuilt) options = { ...options, api: { logout: vi.fn().mockResolvedValue(undefined) } };
            render();
            await act(async () => {
                reject(new SupersededLogoutError());
                expect(await pending).toBe(false);
            });
            expect(options.clearPrivateQueryCache).not.toHaveBeenCalled();
            expect(options.setCustomer).not.toHaveBeenCalled();
            expect(options.notify).not.toHaveBeenCalled();
            expect(client.getQueryState(options.customerQueryKey)?.isInvalidated).toBe(false);
        },
    );

    it('completes a confirmed logout after a language-only API rebuild with the same session', async () => {
        const request = deferred();
        vi.mocked(options.api.logout).mockReturnValue(request.promise);
        let pending!: Promise<boolean>;
        act(() => {
            pending = value.logoutCustomer();
        });
        options = { ...options, language: 'en', api: { logout: vi.fn().mockResolvedValue(undefined) } };
        render();
        await act(async () => {
            request.resolve();
            expect(await pending).toBe(true);
        });
        expect(options.clearPrivateQueryCache).toHaveBeenCalledTimes(1);
        expect(options.setCustomer).toHaveBeenCalledExactlyOnceWith(null);
        expect(options.notify).toHaveBeenCalledExactlyOnceWith('Signed out');
    });

    it('checks the returned confirmation again before cleaning a newer same-customer UI', async () => {
        let current = true;
        vi.mocked(options.api.logout).mockImplementation(() => {
            queueMicrotask(() => {
                current = false;
            });
            return Promise.resolve(() => {
                if (!current) throw new SupersededLogoutError();
            });
        });
        await act(async () => {
            expect(await value.logoutCustomer()).toBe(false);
        });
        expect(options.clearPrivateQueryCache).not.toHaveBeenCalled();
        expect(options.setCustomer).not.toHaveBeenCalled();
        expect(options.notify).not.toHaveBeenCalled();
        expect(client.getQueryState(options.customerQueryKey)?.isInvalidated).toBe(false);
    });

    it('does not invoke detached UI callbacks after the app unmounts', async () => {
        const request = deferred();
        vi.mocked(options.api.logout).mockReturnValue(request.promise);
        let pending!: Promise<boolean>;
        act(() => {
            pending = value.logoutCustomer();
        });
        act(() => root.render(null));
        await act(async () => {
            request.resolve();
            expect(await pending).toBe(false);
        });
        expect(options.clearPrivateQueryCache).not.toHaveBeenCalled();
        expect(options.setCustomer).not.toHaveBeenCalled();
    });

    it.each(['abort', 'timeout', 'response-microtask-abort'] as const)(
        'clears acknowledged logout UI and token when queued real API verification ends by %s',
        async reason => {
            let release!: (value: Response) => void;
            const old = new Promise<Response>(resolve => {
                release = resolve;
            });
            const json = (data: object, token?: string) =>
                new Response(JSON.stringify({ data }), {
                    headers: token ? { 'vendure-auth-token': token } : {},
                });
            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce(json({ login: {} }, 'synthetic-old'))
                .mockReturnValueOnce(old)
                .mockResolvedValueOnce(json({ activeCustomer: null }));
            vi.stubGlobal('fetch', fetchMock);
            vi.stubGlobal('navigator', {});
            const api = new ShopApi({
                code: `cancel-${reason}`,
                defaultLanguageCode: 'en',
                currencyCode: 'MYR',
                countryCode: 'MY',
                locale: 'en-MY',
                label: 'Synthetic',
            });
            await api.login('synthetic@example.invalid', 'synthetic');
            options = { ...options, api };
            render();
            let exiting!: Promise<boolean>;
            act(() => {
                exiting = value.logoutCustomer();
            });
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
            const controller = new AbortController();
            if (reason === 'timeout') vi.useFakeTimers();
            const verification = api
                .verifyCustomerAccount('synthetic', undefined, controller.signal)
                .catch(error => error);
            await vi.dynamicImportSettled();
            await act(async () => {
                if (reason === 'timeout') await vi.advanceTimersByTimeAsync(SHOP_API_QUERY_TIMEOUT_MS);
                else if (reason === 'response-microtask-abort') {
                    release(json({ logout: { success: true } }));
                    queueMicrotask(() => controller.abort());
                } else controller.abort();
                expect(await verification).toMatchObject({
                    name: reason === 'timeout' ? 'ShopApiTimeoutError' : 'AbortError',
                });
                expect(fetchMock).toHaveBeenCalledTimes(2);
                if (reason !== 'response-microtask-abort') release(json({ logout: { success: true } }));
                expect(await exiting).toBe(true);
            });
            expect(options.clearPrivateQueryCache).toHaveBeenCalledOnce();
            expect(options.setCustomer).toHaveBeenCalledExactlyOnceWith(null);
            expect(options.notify).toHaveBeenCalledExactlyOnceWith('已退出登录');
            await api.request('query { activeCustomer { id } }');
            expect(fetchMock.mock.calls[2][1].headers).not.toHaveProperty('authorization');
        },
    );
});
