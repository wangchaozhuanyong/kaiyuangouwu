// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleAuthButton } from './google-auth-button';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

function buttonState() {
    const api = window.google?.accounts.id;
    if (!api) throw new Error('Google fixture is missing');
    const call = vi.mocked(api, true).renderButton.mock.lastCall;
    if (!call) throw new Error('Google button was not rendered');
    return call[1].state;
}

async function settle(action: () => void) {
    await act(async () => {
        action();
        await Promise.resolve();
    });
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete window.google;
    document.getElementById('google-identity-services')?.remove();
    vi.clearAllMocks();
});

describe('GoogleAuthButton', () => {
    function identityFixture() {
        let callback: ((response: { credential?: string; state?: string }) => void) | undefined;
        const initialize = vi.fn(options => {
            callback = options.callback;
        });
        const renderButton = vi.fn();
        window.google = { accounts: { id: { initialize, renderButton } } };
        return {
            initialize,
            renderButton,
            respond: (state?: string) => callback?.({ state, credential: 'fixture-id-token' }),
        };
    }

    it('keeps an open authorization valid when language or presentation callback changes', async () => {
        const google = identityFixture();
        const oldHandler = vi.fn().mockResolvedValue(undefined);
        const handler = vi.fn().mockResolvedValue(undefined);
        const props = { clientId: 'fixture.apps.googleusercontent.com', onCredential: oldHandler };
        await settle(() => root.render(<GoogleAuthButton {...props} language="zh" />));
        const state = buttonState();
        await settle(() => root.render(<GoogleAuthButton {...props} language="en" onCredential={handler} />));
        expect(google.initialize).toHaveBeenCalledOnce();
        expect(buttonState()).toBe(state);
        await settle(() => google.respond(state));
        expect(handler).toHaveBeenCalledExactlyOnceWith('fixture-id-token');
        expect(oldHandler).not.toHaveBeenCalled();
    });

    it('initializes once across forms and ignores responses belonging to a removed form', async () => {
        const google = identityFixture();
        const login = vi.fn().mockResolvedValue(undefined);
        const register = vi.fn().mockResolvedValue(undefined);
        const props = { clientId: 'fixture.apps.googleusercontent.com', language: 'en' as const };
        await settle(() => root.render(<GoogleAuthButton key="login" {...props} onCredential={login} />));
        const oldState = buttonState();
        await settle(() =>
            root.render(<GoogleAuthButton key="register" {...props} onCredential={register} />),
        );
        const state = buttonState();
        expect(state).not.toBe(oldState);
        expect(google.initialize).toHaveBeenCalledOnce();
        await settle(() => {
            google.respond(oldState);
            google.respond();
        });
        expect(login).not.toHaveBeenCalled();
        expect(register).not.toHaveBeenCalled();
        await settle(() => google.respond(state));
        expect(register).toHaveBeenCalledOnce();
    });

    it('invalidates a response after its store scope or verification nonce changes', async () => {
        const google = identityFixture();
        const handler = vi.fn().mockResolvedValue(undefined);
        const props = {
            clientId: 'fixture.apps.googleusercontent.com',
            language: 'en' as const,
            onCredential: handler,
        };
        const scope = {};
        await settle(() => root.render(<GoogleAuthButton {...props} scope={scope} />));
        const oldState = buttonState();
        await settle(() => root.render(<GoogleAuthButton {...props} scope={{}} />));
        await settle(() => google.respond(oldState));
        expect(handler).not.toHaveBeenCalled();
        const oldCallback = google.initialize.mock.calls[0][0].callback;
        const beforeNonce = buttonState();
        await settle(() => root.render(<GoogleAuthButton {...props} scope={scope} nonce="new-challenge" />));
        await settle(() => oldCallback({ state: beforeNonce, credential: 'stale-proof' }));
        expect(handler).not.toHaveBeenCalled();
        await settle(() => google.respond(buttonState()));
        expect(handler).toHaveBeenCalledOnce();
        expect(google.initialize).toHaveBeenCalledTimes(2);
    });
    it('renders the official button and forwards the returned ID credential', async () => {
        let callback: ((response: { credential?: string; state?: string }) => void) | undefined;
        const renderButton = vi.fn((parent: HTMLElement) => {
            parent.append(document.createElement('button'));
        });
        const initialize = vi.fn(options => {
            callback = options.callback;
        });
        window.google = {
            accounts: {
                id: {
                    initialize,
                    renderButton,
                },
            },
        };
        const onCredential = vi.fn().mockResolvedValue(undefined);

        await act(async () => {
            root.render(
                <GoogleAuthButton
                    clientId="123456789-test.apps.googleusercontent.com"
                    language="zh"
                    nonce="one-time-action-nonce"
                    onCredential={onCredential}
                />,
            );
            await Promise.resolve();
        });

        expect(initialize).toHaveBeenCalledWith(
            expect.objectContaining({ nonce: 'one-time-action-nonce', auto_select: false }),
        );
        expect(renderButton).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({ locale: 'zh-CN', text: 'continue_with' }),
        );
        await act(async () => {
            callback?.({ credential: 'signed-id-token', state: buttonState() });
            await Promise.resolve();
        });
        expect(onCredential).toHaveBeenCalledWith('signed-id-token');
    });

    it('shows a localized error when Google returns no credential', async () => {
        let callback: ((response: { credential?: string; state?: string }) => void) | undefined;
        window.google = {
            accounts: {
                id: {
                    initialize: vi.fn(options => {
                        callback = options.callback;
                    }),
                    renderButton: vi.fn(),
                },
            },
        };

        await act(async () => {
            root.render(
                <GoogleAuthButton
                    clientId="123456789-test.apps.googleusercontent.com"
                    language="zh"
                    onCredential={vi.fn()}
                />,
            );
            await Promise.resolve();
        });
        act(() => callback?.({ state: buttonState() }));

        expect(host.querySelector('[role="alert"]')?.textContent).toContain('未返回有效凭证');
    });
    it('blocks disabled and duplicate callbacks and ignores stale callbacks after unmount', async () => {
        let callback: ((response: { credential?: string; state?: string }) => void) | undefined;
        window.google = {
            accounts: {
                id: {
                    initialize: options => {
                        callback = options.callback;
                    },
                    renderButton: vi.fn(),
                },
            },
        };
        const onCredential = vi.fn(() => new Promise<void>(() => undefined));
        const props = {
            clientId: '123-test.apps.googleusercontent.com',
            language: 'en' as const,
            onCredential,
        };
        await settle(() => root.render(<GoogleAuthButton {...props} disabled />));
        const state = buttonState();
        act(() => callback?.({ credential: 'qa-only', state }));
        expect(onCredential).not.toHaveBeenCalled();
        await settle(() => root.render(<GoogleAuthButton {...props} />));
        act(() => {
            callback?.({ credential: 'qa-only', state });
            callback?.({ credential: 'qa-only', state });
        });
        expect(onCredential).toHaveBeenCalledOnce();
        act(() => root.render(<div />));
        act(() => callback?.({ credential: 'qa-only', state }));
        expect(onCredential).toHaveBeenCalledOnce();
    });

    it('shows an actionable error after a script failure and permits retry', async () => {
        await settle(() =>
            root.render(
                <GoogleAuthButton
                    clientId="123-test.apps.googleusercontent.com"
                    language="zh"
                    onCredential={vi.fn()}
                />,
            ),
        );
        expect(host.textContent).toContain('正在加载');
        await settle(() =>
            document.getElementById('google-identity-services')?.dispatchEvent(new Event('error')),
        );
        expect(host.textContent).toContain('重新加载');
        await settle(() => host.querySelector<HTMLButtonElement>('button')?.click());
        expect(document.getElementById('google-identity-services')).not.toBeNull();
        // Complete the retry with an error to leave no test timer behind.
        await settle(() =>
            document.getElementById('google-identity-services')?.dispatchEvent(new Event('error')),
        );
    });
});
