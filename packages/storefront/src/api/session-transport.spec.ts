import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function pending<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { location: new URL('https://shop.example.invalid/') });
    vi.stubGlobal('navigator', {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.doUnmock('./session-runtime');
});

describe('browser session transport', () => {
    it('preserves shared parallelism and gives a queued writer priority over later readers', async () => {
        const { sessionTransport: run } = await import('./session-transport');
        const a = pending();
        const b = pending();
        const writer = pending();
        const trace: string[] = [];
        const first = run('/shop-api', false, undefined, () => {
            trace.push('a');
            return a.promise;
        });
        const second = run('/shop-api?language=en', false, undefined, () => {
            trace.push('b');
            return b.promise;
        });
        const auth = run('/another-api-path', true, undefined, () => {
            trace.push('auth');
            return writer.promise;
        });
        const last = run('/shop-api', false, undefined, () => {
            trace.push('last');
            return Promise.resolve();
        });
        await vi.dynamicImportSettled();
        expect(trace).toEqual(['a', 'b']);
        a.resolve();
        await first;
        expect(trace).toEqual(['a', 'b']);
        b.resolve();
        await second;
        await vi.waitFor(() => expect(trace).toEqual(['a', 'b', 'auth']));
        writer.resolve();
        await auth;
        await last;
        expect(trace).toEqual(['a', 'b', 'auth', 'last']);
    });

    it('isolates different API origins', async () => {
        const { sessionTransport: run } = await import('./session-transport');
        const hold = pending();
        const a = run('https://a.example.invalid/shop-api', true, undefined, () => hold.promise);
        expect(
            await run('https://b.example.invalid/shop-api', true, undefined, () => Promise.resolve('other')),
        ).toBe('other');
        hold.resolve();
        await a;
    });

    it('cancels queued work without issuing it or blocking the next writer', async () => {
        const { sessionTransport: run } = await import('./session-transport');
        const hold = pending();
        const controller = new AbortController();
        const operation = vi.fn();
        const a = run('/shop-api', false, undefined, () => hold.promise);
        const queued = run('/shop-api', true, controller.signal, operation);
        const denied = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await denied;
        hold.resolve();
        await a;
        expect(await run('/shop-api', true, undefined, () => Promise.resolve('next'))).toBe('next');
        expect(operation).not.toHaveBeenCalled();
    });

    it('rejects an already aborted request before executing it', async () => {
        const { sessionTransport: run } = await import('./session-transport');
        const controller = new AbortController();
        controller.abort();
        const operation = vi.fn();
        await expect(run('/shop-api', true, controller.signal, operation)).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(operation).not.toHaveBeenCalled();
    });

    it.each(['throw', 'reject'] as const)(
        'releases after operation %s and never replays the operation',
        async mode => {
            const { sessionTransport: run } = await import('./session-transport');
            const operation = vi.fn(() => {
                if (mode === 'throw') throw new Error('synthetic');
                return Promise.reject(new Error('synthetic'));
            });
            await expect(run('/shop-api', true, undefined, operation)).rejects.toThrow('synthetic');
            expect(await run('/shop-api', true, undefined, () => Promise.resolve('next'))).toBe('next');
            expect(operation).toHaveBeenCalledOnce();
        },
    );

    it('uses native shared/exclusive locks with the original signal and API origin key', async () => {
        const signal = new AbortController().signal;
        const request = vi.fn((_key, _options, callback) => Promise.resolve(callback({})));
        vi.stubGlobal('navigator', { locks: { request } });
        const { sessionTransport: run } = await import('./session-transport');
        expect(await run('/shop-api?language=en', false, signal, () => Promise.resolve('read'))).toBe('read');
        expect(await run('/api/two', true, undefined, () => Promise.resolve('auth'))).toBe('auth');
        expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
        expect(request.mock.calls[0][1]).toEqual({ mode: 'shared', signal });
        expect(request.mock.calls[1][1]).toEqual({ mode: 'exclusive', signal: undefined });
    });

    it('coordinates different module instances through their shared native lock manager', async () => {
        const callbacks: Array<() => void> = [];
        const request = vi.fn(
            (_key, _options, callback) =>
                new Promise((resolve, reject) => {
                    callbacks.push(() => {
                        void Promise.resolve()
                            .then(() => callback({}))
                            .then(resolve, reject);
                    });
                }),
        );
        vi.stubGlobal('navigator', { locks: { request } });
        const first = await import('./session-transport');
        vi.resetModules();
        const second = await import('./session-transport');
        const a = first.sessionTransport('/shop-api', false, undefined, () => Promise.resolve('a'));
        const b = second.sessionTransport('/other', true, undefined, () => Promise.resolve('b'));
        await vi.dynamicImportSettled();
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
        callbacks[0]();
        expect(await a).toBe('a');
        callbacks[1]();
        expect(await b).toBe('b');
    });

    it.each(['SecurityError', 'NotSupportedError'])(
        'falls back only when native acquisition is denied: %s',
        async name => {
            const request = vi.fn().mockRejectedValue(new DOMException('synthetic restricted context', name));
            vi.stubGlobal('navigator', { locks: { request } });
            const { sessionTransport: run } = await import('./session-transport');
            const operation = vi.fn().mockResolvedValue('local');
            expect(await run('/shop-api', true, undefined, operation)).toBe('local');
            expect(operation).toHaveBeenCalledOnce();
        },
    );

    it('does not replay a native callback that rejects with SecurityError', async () => {
        vi.stubGlobal('navigator', {
            locks: {
                request: (_key: string, _options: object, callback: () => unknown) =>
                    Promise.resolve(callback()),
            },
        });
        const { sessionTransport: run } = await import('./session-transport');
        const operation = vi.fn().mockRejectedValue(new DOMException('synthetic operation', 'SecurityError'));
        await expect(run('/shop-api', true, undefined, operation)).rejects.toMatchObject({
            name: 'SecurityError',
        });
        expect(operation).toHaveBeenCalledOnce();
    });

    it('does not fall back after aborted native acquisition', async () => {
        vi.stubGlobal('navigator', {
            locks: { request: vi.fn().mockRejectedValue(new DOMException('synthetic abort', 'AbortError')) },
        });
        const { sessionTransport: run } = await import('./session-transport');
        const operation = vi.fn();
        await expect(run('/shop-api', true, undefined, operation)).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(operation).not.toHaveBeenCalled();
    });

    it('never shares a request queue across SSR requests', async () => {
        vi.stubGlobal('window', undefined);
        const { sessionTransport: run } = await import('./session-transport');
        const hold = pending();
        const a = run('/shop-api', true, undefined, () => hold.promise);
        expect(await run('/shop-api', true, undefined, () => Promise.resolve('independent'))).toBe(
            'independent',
        );
        hold.resolve();
        await a;
    });

    it('does not bypass synchronization when its first-load module fails', async () => {
        vi.doMock('./session-runtime', () => {
            throw new Error('synthetic module unavailable');
        });
        const { sessionTransport: run } = await import('./session-transport');
        const operation = vi.fn();
        await expect(run('/shop-api', true, undefined, operation)).rejects.toHaveProperty(
            'cause.message',
            'synthetic module unavailable',
        );
        expect(operation).not.toHaveBeenCalled();
    });

    it('cancels during initial module delivery without issuing the queued operation', async () => {
        const gate = pending();
        const transport = vi.fn();
        vi.doMock('./session-runtime', async () => {
            await gate.promise;
            return { sessionTransport: transport };
        });
        const { sessionTransport: run } = await import('./session-transport');
        const controller = new AbortController();
        const operation = vi.fn();
        const waiting = run('/shop-api', true, controller.signal, operation);
        const denied = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        // A stalled chunk must not hold cancellation until its eventual delivery.
        await denied;
        gate.resolve();
        await vi.dynamicImportSettled();
        expect(operation).not.toHaveBeenCalled();
        expect(transport).not.toHaveBeenCalled();
    });

    it.each(['sync', 'async'] as const)(
        'normalizes a %s non-Error queue failure without replay or a stuck queue',
        async mode => {
            const { sessionTransport: run } = await import('./session-transport');
            const reason: unknown = Object.freeze({ synthetic: 'queue-non-error' });
            const operation =
                mode === 'sync'
                    ? vi.fn(() => {
                          throw reason;
                      })
                    : vi.fn().mockRejectedValue(reason);
            const failure: unknown = await run('/shop-api', true, undefined, operation).catch(
                (error: unknown) => error,
            );
            expect(failure).toBeInstanceOf(Error);
            expect(failure).toMatchObject({ message: 'Session request failed', cause: reason });
            expect(operation).toHaveBeenCalledOnce();
            expect(await run('/shop-api', true, undefined, () => Promise.resolve('next'))).toBe('next');
        },
    );

    it.each(['sync', 'async'] as const)(
        'normalizes a %s non-Error native lock failure without dispatch or fallback',
        async mode => {
            const reason: unknown = Object.freeze({ synthetic: 'lock-non-error' });
            const request =
                mode === 'sync'
                    ? vi.fn(() => {
                          throw reason;
                      })
                    : vi.fn().mockRejectedValue(reason);
            vi.stubGlobal('navigator', { locks: { request } });
            const { sessionTransport: run } = await import('./session-transport');
            const operation = vi.fn();
            const failure: unknown = await run('/shop-api', true, undefined, operation).catch(
                (error: unknown) => error,
            );
            expect(failure).toBeInstanceOf(Error);
            expect(failure).toMatchObject({ message: 'Session lock failed', cause: reason });
            expect(operation).not.toHaveBeenCalled();
            expect(request).toHaveBeenCalledOnce();
        },
    );

    it.each([
        { name: 'Error', reason: new Error('synthetic cancel'), preserve: true },
        { name: 'DOMException', reason: new DOMException('synthetic cancel', 'AbortError'), preserve: true },
        { name: 'primitive', reason: 'synthetic primitive cancel', preserve: false },
    ])(
        'preserves cancellation Error objects and normalizes $name reasons while queued',
        async ({ reason, preserve }) => {
            const { sessionTransport: run } = await import('./session-transport');
            const hold = pending();
            const blocking = run('/shop-api', false, undefined, () => hold.promise);
            const controller = new AbortController();
            const operation = vi.fn();
            const waiting = run('/shop-api', true, controller.signal, operation).catch(
                (error: unknown) => error,
            );
            await vi.dynamicImportSettled();
            controller.abort(reason);
            const failure = await waiting;
            if (preserve) expect(failure).toBe(reason);
            else expect(failure).toMatchObject({ name: 'AbortError', message: 'Request aborted' });
            expect(operation).not.toHaveBeenCalled();
            hold.resolve();
            await blocking;
            expect(await run('/shop-api', true, undefined, () => Promise.resolve('next'))).toBe('next');
        },
    );
});
