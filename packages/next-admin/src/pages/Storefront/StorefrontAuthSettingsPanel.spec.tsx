// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontAuthSettingsPanel } from './StorefrontAuthSettingsPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

const initialValue = {
    emailPasswordEnabled: true,
    emailAutoRegistrationEnabled: false,
    emailQuickRegistrationEnabled: false,
    googleOverrideEnabled: false,
    storeGoogleEnabled: false,
    storeGoogleClientId: null,
    platformGoogleEnabled: false,
    platformGoogleClientId: null,
    effectiveGoogleEnabled: false,
    effectiveGoogleClientId: null,
    googleConfigurationSource: 'PLATFORM' as const,
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

function renderPanel(overrides: Partial<ComponentProps<typeof StorefrontAuthSettingsPanel>> = {}) {
    const onSaveStore = vi.fn().mockResolvedValue(undefined);
    const onSavePlatform = vi.fn().mockResolvedValue(undefined);
    act(() =>
        root.render(
            <StorefrontAuthSettingsPanel
                value={initialValue}
                disabled={false}
                canEditPlatform={true}
                storeSaving={false}
                platformSaving={false}
                onSaveStore={onSaveStore}
                onSavePlatform={onSavePlatform}
                {...overrides}
            />,
        ),
    );
    return { onSaveStore, onSavePlatform };
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
    it('requires a valid platform Web Client ID before the shared default can be enabled', async () => {
        const { onSavePlatform } = renderPanel();

        act(() => button('全平台默认启用 Google 快捷注册与登录').click());
        await act(async () => button('保存全平台 Google 配置').click());

        expect(onSavePlatform).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('Web Client ID');
    });

    it('saves one platform Google default for inheriting stores', async () => {
        const { onSavePlatform } = renderPanel();

        act(() => button('全平台默认启用 Google 快捷注册与登录').click());
        act(() =>
            changeInput(
                host.querySelector<HTMLInputElement>('#platform-google-client-id')!,
                '123456789-platform.apps.googleusercontent.com',
            ),
        );
        await act(async () => button('保存全平台 Google 配置').click());

        expect(onSavePlatform).toHaveBeenCalledWith({
            googleEnabled: true,
            googleClientId: '123456789-platform.apps.googleusercontent.com',
        });
        expect(host.querySelector('[role="status"]')?.textContent).toContain('自动继承');
    });

    it('saves email options while keeping Google on platform inheritance', async () => {
        const { onSaveStore } = renderPanel();

        act(() => {
            button('登录失败时尝试自动注册').click();
            button('邮箱快捷注册').click();
        });
        await act(async () => button('保存当前店铺账号设置').click());

        expect(onSaveStore).toHaveBeenCalledWith({
            emailPasswordEnabled: true,
            emailAutoRegistrationEnabled: true,
            emailQuickRegistrationEnabled: true,
            googleOverrideEnabled: false,
            storeGoogleEnabled: false,
            storeGoogleClientId: null,
        });
        expect(host.querySelector('[role="status"]')?.textContent).toContain('继承全平台');
    });

    it('requires a valid Client ID for an enabled store override', async () => {
        const { onSaveStore } = renderPanel();

        act(() => button('当前店铺使用独立 Google 配置').click());
        act(() => button('当前店铺启用 Google 快捷注册与登录').click());
        await act(async () => button('保存当前店铺账号设置').click());

        expect(onSaveStore).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('当前店铺');
    });

    it('keeps platform controls read-only for non-super administrators', () => {
        renderPanel({ canEditPlatform: false });

        expect(button('全平台默认启用 Google 快捷注册与登录').disabled).toBe(true);
        expect(button('保存全平台 Google 配置').disabled).toBe(true);
        expect(host.querySelector<HTMLInputElement>('#platform-google-client-id')?.disabled).toBe(true);
    });
});
