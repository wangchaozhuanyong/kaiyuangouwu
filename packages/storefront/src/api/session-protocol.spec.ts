import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const market = {
    code: 'protocol',
    defaultLanguageCode: 'en' as const,
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'en-MY',
    label: 'Protocol',
};
const pending = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
};
const response = (data: object, token?: string) =>
    new Response(JSON.stringify({ data }), { headers: token ? { 'vendure-auth-token': token } : {} });
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
});

describe('credentialed request synchronization', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            location: new URL('https://protocol.example.invalid/'),
            setTimeout,
            clearTimeout,
        });
        vi.stubGlobal('navigator', {});
    });
    it('holds a same-page login until an earlier ordinary response reaches headers', async () => {
        vi.stubGlobal('window', { location: { href: 'https://protocol.example.invalid/', search: '' } });
        vi.stubGlobal('navigator', {});
        const { ShopApi } = await import('../api');
        const old = pending<Response>();
        const fetchMock = vi
            .fn()
            .mockReturnValueOnce(old.promise)
            .mockResolvedValueOnce(
                response({ login: { __typename: 'CurrentUser', id: 'synthetic' } }, 'new'),
            );
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const read = api.request('query { activeCustomer { id } }');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const login = api.login('synthetic@example.invalid', 'synthetic');
        await vi.dynamicImportSettled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        old.resolve(response({ activeCustomer: null }, 'guest'));
        await read;
        await login;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('releases a shared response at headers instead of waiting for its body', async () => {
        const { ShopApi } = await import('../api');
        const body = pending<string>();
        const oldResponse = response({});
        vi.spyOn(oldResponse, 'text').mockImplementation(() => body.promise);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(oldResponse)
            .mockResolvedValueOnce(response({ login: {} }, 'new'));
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const read = api.request('query { activeCustomer { id } }');
        const login = api.login('synthetic@example.invalid', 'synthetic');
        await login;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        body.resolve(JSON.stringify({ data: { activeCustomer: null } }));
        await read;
    });

    it('keeps authentication exclusive through parsing and builds queued headers from the new session', async () => {
        const { ShopApi } = await import('../api');
        const body = pending<string>();
        const auth = response({}, 'new-session');
        vi.spyOn(auth, 'text').mockImplementation(() => body.promise);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(response({}, 'old-session'))
            .mockResolvedValueOnce(auth)
            .mockResolvedValueOnce(response({ activeCustomer: {} }));
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        await api.request('query { activeCustomer { id } }');
        const login = api.login('synthetic@example.invalid', 'synthetic');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const read = api.request('query { activeCustomer { id } }');
        await vi.dynamicImportSettled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        body.resolve(JSON.stringify({ data: { login: {} } }));
        await login;
        await read;
        expect(fetchMock.mock.calls[2][1].headers.authorization).toBe('Bearer new-session');
    });

    it('does not split a shared cookie domain by market, language or currency', async () => {
        const { ShopApi } = await import('../api');
        const old = pending<Response>();
        const fetchMock = vi
            .fn()
            .mockReturnValueOnce(old.promise)
            .mockResolvedValueOnce(response({ login: {} }));
        vi.stubGlobal('fetch', fetchMock);
        const first = new ShopApi(market);
        const second = new ShopApi({ ...market, code: 'another-channel', currencyCode: 'USD' }, 'zh_Hans');
        const read = first.request('query { activeCustomer { id } }');
        const login = second.login('synthetic@example.invalid', 'synthetic');
        await vi.dynamicImportSettled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        old.resolve(response({ activeCustomer: null }));
        await read;
        await login;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps the original total query deadline while queued and sends nothing after timeout', async () => {
        const { ShopApi, SHOP_API_QUERY_TIMEOUT_MS } = await import('../api');
        const { sessionTransport } = await import('./session-transport');
        vi.useFakeTimers();
        const hold = pending<void>();
        const auth = sessionTransport('/shop-api', true, undefined, () => hold.promise);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const read = new ShopApi(market).request('query { activeCustomer { id } }');
        const rejected = expect(read).rejects.toMatchObject({ name: 'ShopApiTimeoutError' });
        await vi.advanceTimersByTimeAsync(SHOP_API_QUERY_TIMEOUT_MS);
        await rejected;
        hold.resolve();
        await auth;
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cancels queued queries without sending and permits following work', async () => {
        const { ShopApi } = await import('../api');
        const { sessionTransport } = await import('./session-transport');
        const hold = pending<void>();
        const auth = sessionTransport('/shop-api', true, undefined, () => hold.promise);
        const controller = new AbortController();
        const fetchMock = vi.fn().mockResolvedValue(response({ activeCustomer: null }));
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const read = api.request('query { activeCustomer { id } }', undefined, controller.signal);
        const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await rejected;
        expect(fetchMock).not.toHaveBeenCalled();
        hold.resolve();
        await auth;
        await api.request('query { activeCustomer { id } }');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each([401, 500])('releases HTTP %s response headers before normal error parsing', async status => {
        const { ShopApi } = await import('../api');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('synthetic error', { status }))
            .mockResolvedValueOnce(response({ login: {} }));
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        await expect(api.request('query { activeCustomer { id } }')).rejects.toThrow();
        await api.login('synthetic@example.invalid', 'synthetic');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['avatar', 'reference'] as const)(
        'includes %s multipart upload in the same queue and builds its headers at grant',
        async kind => {
            const { ShopApi } = await import('../api');
            const { sessionTransport } = await import('./session-transport');
            const hold = pending<void>();
            const auth = sessionTransport('/shop-api', true, undefined, () => hold.promise);
            const field = kind === 'avatar' ? 'setCustomerAvatar' : 'uploadImageReference';
            const fetchMock = vi.fn().mockResolvedValue(response({ [field]: { id: 'synthetic' } }));
            vi.stubGlobal('fetch', fetchMock);
            const api = new ShopApi(market);
            const file = new File(['synthetic'], 'synthetic.png', { type: 'image/png' });
            const uploading =
                kind === 'avatar' ? api.uploadCustomerAvatar(file) : api.uploadImageReference(file, true);
            await vi.dynamicImportSettled();
            expect(fetchMock).not.toHaveBeenCalled();
            hold.resolve();
            await auth;
            await uploading;
            expect(fetchMock).toHaveBeenCalledOnce();
            expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
            expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
        },
    );

    it('lets login wait for an in-flight multipart response and then finish', async () => {
        const { ShopApi } = await import('../api');
        const uploaded = pending<Response>();
        const fetchMock = vi
            .fn()
            .mockReturnValueOnce(uploaded.promise)
            .mockResolvedValueOnce(response({ login: {} }));
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const uploading = api.uploadCustomerAvatar(new File(['synthetic'], 'synthetic.png'));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        const login = api.login('synthetic@example.invalid', 'synthetic');
        await vi.dynamicImportSettled();
        expect(fetchMock).toHaveBeenCalledOnce();
        uploaded.resolve(response({ setCustomerAvatar: { id: 'synthetic' } }));
        await uploading;
        await login;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['realtime', 'mail'] as const)(
        'locks only the %s SSE handshake, allowing login while the stream remains open',
        async kind => {
            const { ShopApi } = await import('../api');
            const handshake = pending<Response>();
            const body = new ReadableStream<Uint8Array>();
            const fetchMock = vi
                .fn()
                .mockReturnValueOnce(handshake.promise)
                .mockResolvedValueOnce(response({ login: {} }));
            vi.stubGlobal('fetch', fetchMock);
            const api = new ShopApi(market);
            const controller = new AbortController();
            const watching =
                kind === 'realtime'
                    ? api.watchRealtime(vi.fn(), controller.signal)
                    : api.watchMailEvents(
                          'SYNTHETIC',
                          { onChange: vi.fn(), onStatus: vi.fn() },
                          controller.signal,
                      );
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
            const login = api.login('synthetic@example.invalid', 'synthetic');
            await vi.dynamicImportSettled();
            expect(fetchMock).toHaveBeenCalledOnce();
            handshake.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
            await login;
            expect(fetchMock).toHaveBeenCalledTimes(2);
            controller.abort();
            await watching;
        },
    );

    it('cancels account verification while it is still waiting for a pending logout', async () => {
        const { ShopApi } = await import('../api');
        const old = pending<Response>();
        const fetchMock = vi.fn().mockReturnValueOnce(old.promise);
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const logout = api.logout().catch(error => error);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        const controller = new AbortController();
        const verification = api
            .verifyCustomerAccount('synthetic', undefined, controller.signal)
            .catch(error => error);
        let settled = false;
        void verification.then(() => {
            settled = true;
        });
        await vi.dynamicImportSettled();
        controller.abort();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(settled).toBe(true);
        expect(await verification).toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledOnce();
        old.resolve(response({ logout: { success: true } }));
        await logout;
    });

    it('counts pending logout time against the original 20s verification deadline', async () => {
        const { ShopApi, SHOP_API_QUERY_TIMEOUT_MS } = await import('../api');
        const old = pending<Response>();
        const fetchMock = vi.fn().mockReturnValueOnce(old.promise);
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const logout = api.logout().catch(error => error);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        vi.useFakeTimers();
        const verification = api.verifyCustomerAccount('synthetic').catch(error => error);
        let settled = false;
        void verification.then(() => {
            settled = true;
        });
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(SHOP_API_QUERY_TIMEOUT_MS);
        expect(settled).toBe(true);
        expect(await verification).toMatchObject({ name: 'ShopApiTimeoutError', resultUnknown: true });
        expect(fetchMock).toHaveBeenCalledOnce();
        old.resolve(response({ logout: { success: true } }));
        await logout;
    });

    it('keeps a logout receipt valid when later verification cancels before transport dispatch', async () => {
        const { ShopApi } = await import('../api');
        const { sessionTransport } = await import('./session-transport');
        const fetchMock = vi.fn().mockResolvedValue(response({ logout: { success: true } }));
        vi.stubGlobal('fetch', fetchMock);
        const api = new ShopApi(market);
        const confirm = await api.logout();
        const hold = pending<void>();
        const blocking = sessionTransport('/shop-api', true, undefined, () => hold.promise);
        await vi.dynamicImportSettled();
        const controller = new AbortController();
        const verification = api
            .verifyCustomerAccount('synthetic', undefined, controller.signal)
            .catch(error => error);
        await vi.dynamicImportSettled();
        expect(() => confirm?.()).not.toThrow();
        controller.abort();
        expect(await verification).toMatchObject({ name: 'AbortError' });
        expect(() => confirm?.()).not.toThrow();
        expect(fetchMock).toHaveBeenCalledOnce();
        hold.resolve();
        await blocking;
    });
});
