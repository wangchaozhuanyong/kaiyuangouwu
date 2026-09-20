// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApiError } from './api';
import { LoginPage, RegisterPage } from './auth-pages';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

const baseProps = {
    language: 'zh' as const,
    storefrontName: 'MOYAO AI｜模钥',
    onBack: vi.fn(),
    onContentTarget: vi.fn(),
};

function submit(form: HTMLFormElement): void {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function requiredElement<T extends Element>(selector: string): T {
    const element = host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
}

function acceptRegistrationConsent(): void {
    act(() => requiredElement<HTMLInputElement>('.auth-registration-consent input').click());
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

describe('storefront configurable authentication methods', () => {
    it('tries registration after an invalid email login without revealing account existence', async () => {
        const login = vi
            .fn()
            .mockRejectedValue(
                new ShopApiError(
                    'INVALID_CREDENTIALS_ERROR',
                    'The provided credentials are invalid',
                    'STOREFRONT_INVALID_CREDENTIALS',
                ),
            );
        const registerCustomerAccount = vi.fn().mockResolvedValue(undefined);
        const api = { login, registerCustomerAccount };

        act(() =>
            root.render(
                <LoginPage
                    {...baseProps}
                    api={api as never}
                    onSuccess={vi.fn().mockResolvedValue(undefined)}
                    authSettings={{
                        emailPasswordEnabled: true,
                        emailAutoRegistrationEnabled: true,
                        emailQuickRegistrationEnabled: false,
                        googleEnabled: false,
                        googleClientId: null,
                    }}
                />,
            ),
        );
        requiredElement<HTMLInputElement>('input[name="emailAddress"]').value = 'new@example.com';
        requiredElement<HTMLInputElement>('input[name="password"]').value = 'secure-password';
        acceptRegistrationConsent();

        await act(async () => {
            submit(requiredElement<HTMLFormElement>('form'));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(login).toHaveBeenCalledWith('new@example.com', 'secure-password');
        expect(registerCustomerAccount).toHaveBeenCalledWith(
            {
                emailAddress: 'new@example.com',
                password: 'secure-password',
            },
            { termsAccepted: true, privacyAcknowledged: true, locale: 'zh' },
        );
        expect(host.textContent).toContain('如果 new@example.com 是新邮箱');
        expect(host.textContent).toContain('如果已有账户');
    });

    it('submits only the email address in quick registration mode', async () => {
        const registerCustomerAccount = vi.fn().mockResolvedValue(undefined);
        const api = {
            referralProgram: vi.fn().mockResolvedValue({ enabled: false, attributionWindowDays: 30 }),
            registerCustomerAccount,
        };

        act(() =>
            root.render(
                <RegisterPage
                    {...baseProps}
                    api={api as never}
                    authSettings={{
                        emailPasswordEnabled: true,
                        emailAutoRegistrationEnabled: false,
                        emailQuickRegistrationEnabled: true,
                        googleEnabled: false,
                        googleClientId: null,
                    }}
                />,
            ),
        );
        requiredElement<HTMLInputElement>('input[name="emailAddress"]').value = 'quick@example.com';
        acceptRegistrationConsent();

        await act(async () => {
            submit(requiredElement<HTMLFormElement>('form'));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(registerCustomerAccount).toHaveBeenCalledWith(
            { emailAddress: 'quick@example.com' },
            { termsAccepted: true, privacyAcknowledged: true, locale: 'zh' },
            undefined,
            undefined,
        );
        expect(host.textContent).toContain('验证链接已发送至 quick@example.com');
    });
});
