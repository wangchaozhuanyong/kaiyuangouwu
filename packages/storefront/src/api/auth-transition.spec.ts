import { describe, expect, it, vi } from 'vitest';

import { AuthTransition } from './auth-transition';
import { SupersededLogoutError } from './logout-error';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}
const message = 'Synthetic unresolved sign-out';

describe('authentication transport around logout', () => {
    it('keeps ordinary overlapping authentications parallel when no logout exists', async () => {
        const transition = new AuthTransition();
        const first = deferred<string>();
        const second = deferred<string>();
        const runFirst = vi.fn(() => first.promise);
        const runSecond = vi.fn(() => second.promise);
        const a = transition.authenticate(runFirst, message);
        const b = transition.authenticate(runSecond, message);
        expect(runFirst).toHaveBeenCalledTimes(1);
        expect(runSecond).toHaveBeenCalledTimes(1);
        second.resolve('second');
        expect(await b).toBe('second');
        first.resolve('first');
        expect(await a).toBe('first');
    });

    it('lets an earlier login finish before logout and holds the next login until logout ends', async () => {
        const transition = new AuthTransition();
        const login = deferred<string>();
        const logout = deferred<string>();
        const runLogout = vi.fn(() => logout.promise);
        const runNext = vi.fn().mockResolvedValue('new-session');
        const first = transition.authenticate(() => login.promise, message);
        const exiting = transition.logout(runLogout);
        const next = transition.authenticate(runNext, message);
        expect(runLogout).not.toHaveBeenCalled();
        expect(runNext).not.toHaveBeenCalled();
        login.resolve('old-session');
        await first;
        await vi.waitFor(() => expect(runLogout).toHaveBeenCalledTimes(1));
        expect(runNext).not.toHaveBeenCalled();
        logout.resolve('acknowledged');
        const receipt = await exiting;
        expect(await next).toBe('new-session');
        expect(receipt.confirm).toThrow(SupersededLogoutError);
        expect(runNext).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])(
        'suppresses superseded logout feedback only after known response success=%s',
        async success => {
            const transition = new AuthTransition();
            const response = deferred<{ success: boolean }>();
            const operation = vi.fn(() => response.promise);
            const exiting = transition.logout(operation);
            await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
            const runLogin = vi.fn().mockResolvedValue('new');
            const next = transition.authenticate(runLogin, message);
            expect(runLogin).not.toHaveBeenCalled();
            response.resolve({ success });
            const receipt = await exiting;
            expect(await next).toBe('new');
            expect(receipt.confirm).toThrow(SupersededLogoutError);
            expect(runLogin).toHaveBeenCalledTimes(1);
        },
    );

    it('keeps late failed logout quiet and prevents a waiting login from going on the wire', async () => {
        const transition = new AuthTransition();
        const response = deferred<void>();
        const operation = vi.fn(() => response.promise);
        const exiting = transition.logout(operation);
        const rejected = expect(exiting).rejects.toBeInstanceOf(SupersededLogoutError);
        await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
        const runLogin = vi.fn().mockResolvedValue('must-not-run');
        const next = transition.authenticate(runLogin, message);
        const denied = expect(next).rejects.toThrow(message);
        response.reject(new Error('Synthetic socket lost; server may still be working'));
        await rejected;
        await denied;
        expect(operation).toHaveBeenCalledTimes(1);
        expect(runLogin).not.toHaveBeenCalled();
    });

    it('does not reopen authentication after an unknown logout or replay it on retry', async () => {
        const transition = new AuthTransition();
        const operation = vi.fn().mockRejectedValue(new Error('Synthetic network loss'));
        await expect(transition.logout(operation)).rejects.toThrow('Synthetic network loss');
        const login = vi.fn();
        await expect(transition.authenticate(login, message)).rejects.toThrow(message);
        await expect(transition.authenticate(login, message)).rejects.toThrow(message);
        expect(operation).toHaveBeenCalledTimes(1);
        expect(login).not.toHaveBeenCalled();
    });

    it('still performs explicit logout after an earlier authentication fails', async () => {
        const transition = new AuthTransition();
        const login = deferred<void>();
        const authenticating = transition.authenticate(() => login.promise, message);
        const rejected = expect(authenticating).rejects.toThrow('Synthetic invalid credentials');
        const operation = vi.fn().mockResolvedValue('logged-out');
        const exiting = transition.logout(operation);
        login.reject(new Error('Synthetic invalid credentials'));
        await rejected;
        expect((await exiting).result).toBe('logged-out');
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('does not mark a fully received validation failure as a transport-unknown logout', async () => {
        const transition = new AuthTransition();
        await expect(
            transition.logout(
                () => Promise.resolve({ success: false }),
                () => {
                    throw new Error('Sign-out was not confirmed');
                },
            ),
        ).rejects.toThrow('Sign-out was not confirmed');
        const login = vi.fn().mockResolvedValue('new-session');
        expect(await transition.authenticate(login, message)).toBe('new-session');
        expect(login).toHaveBeenCalledTimes(1);
    });

    it('does not let an unrelated server request coordinator block authentication', async () => {
        const first = new AuthTransition();
        const second = new AuthTransition();
        const response = deferred<void>();
        const exiting = first.logout(() => response.promise);
        expect(await second.authenticate(() => Promise.resolve('another-request'), message)).toBe(
            'another-request',
        );
        response.resolve();
        await exiting;
    });

    it.each(['first-last', 'last-first'])(
        'keeps acknowledged logout effective after both queued auth intents cancel: %s',
        async order => {
            const transition = new AuthTransition();
            const old = deferred<void>();
            const finalize = vi.fn();
            const logout = transition.logout(() => old.promise, finalize);
            await Promise.resolve();
            const a = new AbortController();
            const b = new AbortController();
            const run = vi.fn();
            const first = transition.authenticate(run, message, a.signal).catch(error => error);
            const second = transition.authenticate(run, message, b.signal).catch(error => error);
            if (order === 'first-last') {
                a.abort();
                b.abort();
            } else {
                b.abort();
                a.abort();
            }
            await first;
            await second;
            old.resolve();
            const receipt = await logout;
            expect(() => receipt.confirm()).not.toThrow();
            expect(finalize).toHaveBeenCalledOnce();
            expect(run).not.toHaveBeenCalled();
        },
    );

    it('still protects an uncancelled later auth when an earlier queued auth cancels', async () => {
        const transition = new AuthTransition();
        const old = deferred<void>();
        const finalize = vi.fn();
        const logout = transition.logout(() => old.promise, finalize);
        await Promise.resolve();
        const controller = new AbortController();
        const deniedRun = vi.fn();
        const denied = transition.authenticate(deniedRun, message, controller.signal).catch(error => error);
        const newer = transition.authenticate(() => Promise.resolve('new-session'), message);
        controller.abort();
        await denied;
        old.resolve();
        const receipt = await logout;
        expect(await newer).toBe('new-session');
        expect(receipt.confirm).toThrow(SupersededLogoutError);
        expect(finalize).toHaveBeenCalledOnce();
        expect(deniedRun).not.toHaveBeenCalled();
    });

    it('never rolls a cancelled earlier authentication over a newer logout intent', async () => {
        const transition = new AuthTransition();
        const old = deferred<void>();
        const firstFinalize = vi.fn();
        const lastFinalize = vi.fn();
        const first = transition.logout(() => old.promise, firstFinalize);
        const superseded = expect(first).rejects.toBeInstanceOf(SupersededLogoutError);
        await Promise.resolve();
        const controller = new AbortController();
        const run = vi.fn();
        const authentication = transition.authenticate(run, message, controller.signal).catch(error => error);
        const last = transition.logout(() => Promise.resolve('last'), lastFinalize);
        controller.abort();
        await authentication;
        old.resolve();
        await superseded;
        expect((await last).result).toBe('last');
        expect(firstFinalize).not.toHaveBeenCalled();
        expect(lastFinalize).toHaveBeenCalledOnce();
        expect(run).not.toHaveBeenCalled();
    });

    it('keeps acknowledged logout when queued verification aborts in the response microtask gap', async () => {
        const transition = new AuthTransition();
        const old = deferred<void>();
        const finalize = vi.fn();
        const logout = transition.logout(() => old.promise, finalize);
        await Promise.resolve();
        const controller = new AbortController();
        const run = vi.fn();
        const auth = transition.authenticate(run, message, controller.signal).catch(error => error);
        old.resolve();
        queueMicrotask(() => controller.abort());
        const receipt = await logout;
        await auth;
        expect(() => receipt.confirm()).not.toThrow();
        expect(finalize).toHaveBeenCalledOnce();
        expect(run).not.toHaveBeenCalled();
    });
});
