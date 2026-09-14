// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleAuthButton } from './google-auth-button';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

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
});
