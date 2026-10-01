// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleAuthButton } from './google-auth-button';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

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
    it('renders the official button and forwards the returned ID credential', async () => {
        let callback: ((response: { credential?: string }) => void) | undefined;
        const renderButton = vi.fn((parent: HTMLElement) => {
            parent.append(document.createElement('button'));
        });
        window.google = {
            accounts: {
                id: {
                    initialize: vi.fn(options => {
                        callback = options.callback;
                    }),
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
                    onCredential={onCredential}
                />,
            );
            await Promise.resolve();
        });

        expect(renderButton).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({ locale: 'zh-CN', text: 'continue_with' }),
        );
        await act(async () => {
            callback?.({ credential: 'signed-id-token' });
            await Promise.resolve();
        });
        expect(onCredential).toHaveBeenCalledWith('signed-id-token');
    });

    it('shows a localized error when Google returns no credential', async () => {
        let callback: ((response: { credential?: string }) => void) | undefined;
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
        act(() => callback?.({}));

        expect(host.querySelector('[role="alert"]')?.textContent).toContain('未返回有效凭证');
    });
    it('blocks disabled and duplicate callbacks and ignores stale callbacks after unmount', async () => {
        let callback: ((response: { credential?: string }) => void) | undefined;
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
        act(() => callback?.({ credential: 'qa-only' }));
        expect(onCredential).not.toHaveBeenCalled();
        await settle(() => root.render(<GoogleAuthButton {...props} />));
        act(() => {
            callback?.({ credential: 'qa-only' });
            callback?.({ credential: 'qa-only' });
        });
        expect(onCredential).toHaveBeenCalledOnce();
        act(() => root.render(<div />));
        act(() => callback?.({ credential: 'qa-only' }));
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
