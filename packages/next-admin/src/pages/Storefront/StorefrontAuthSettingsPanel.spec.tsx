// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontAuthSettingsPanel } from './StorefrontAuthSettingsPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

const initialValue = {
    __typename: 'StorefrontAuthSettings',
    emailPasswordEnabled: true,
    emailAutoRegistrationEnabled: false,
    emailQuickRegistrationEnabled: false,
    googleEnabled: false,
    googleClientId: null,
};

function button(label: string): HTMLButtonElement {
    const result = Array.from(host.querySelectorAll('button')).find(
        candidate => candidate.getAttribute('aria-label') === label || candidate.textContent === label,
    );
    if (!result) throw new Error(`Missing button: ${label}`);
    return result;
}

function changeInput(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
});

describe('StorefrontAuthSettingsPanel', () => {
    it('requires a valid Web Client ID before Google sign-in can be enabled', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        act(() =>
            root.render(
                <StorefrontAuthSettingsPanel
                    value={initialValue}
                    disabled={false}
                    saving={false}
                    onSave={onSave}
                />,
            ),
        );

        act(() => button('Google 快捷注册与登录').click());
        await act(async () => button('保存账号设置').click());

        expect(onSave).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('Web Client ID');
    });

    it('saves email automation, quick registration and Google settings together', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        act(() =>
            root.render(
                <StorefrontAuthSettingsPanel
                    value={initialValue}
                    disabled={false}
                    saving={false}
                    onSave={onSave}
                />,
            ),
        );

        act(() => {
            button('登录失败时尝试自动注册').click();
            button('邮箱快捷注册').click();
            button('Google 快捷注册与登录').click();
        });
        act(() =>
            changeInput(
                host.querySelector<HTMLInputElement>('#google-client-id')!,
                '123456789-test.apps.googleusercontent.com',
            ),
        );
        await act(async () => button('保存账号设置').click());

        expect(onSave).toHaveBeenCalledWith({
            emailPasswordEnabled: true,
            emailAutoRegistrationEnabled: true,
            emailQuickRegistrationEnabled: true,
            googleEnabled: true,
            googleClientId: '123456789-test.apps.googleusercontent.com',
        });
        expect(host.querySelector('[role="status"]')?.textContent).toContain('已保存');
    });
});
