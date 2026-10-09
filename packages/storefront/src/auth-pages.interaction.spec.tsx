// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApiError } from './api';
import { ForgotPasswordPage, LoginPage, RegisterPage } from './auth-pages';
import { AuthPresentationContext } from './auth-presentation';

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
    vi.clearAllMocks();
});

describe('storefront authentication overlay presentation', () => {
    it('uses managed form copy and persistent labels without loading the standalone artwork', async () => {
        const navigate = vi.fn();
        const onEmailDraftChange = vi.fn();
        const content = {
            id: 'overlay-login',
            code: 'overlay-login',
            type: 'AUTH_LOGIN',
            enabled: true,
            position: 0,
            imageUrl: '/assets/preview/overlay-login.webp',
            backgroundColor: '#f5f5ff',
            textColor: '#172033',
            settings: { formTitleZh: '配置的登录标题', formSubtitleZh: '配置的登录说明' },
            title: '仅供独立页的图片标题',
            subtitle: '',
            body: '',
            ctaLabel: '',
            items: [],
        };
        await settle(() =>
            root.render(
                <AuthPresentationContext.Provider
                    value={{ navigate, emailDraft: 'shared@example.invalid', onEmailDraftChange }}
                >
                    <LoginPage
                        {...baseProps}
                        api={{} as never}
                        logoUrl="/assets/preview/overlay-logo.png"
                        authVisualContent={content as never}
                        onSuccess={vi.fn().mockResolvedValue(undefined)}
                    />
                </AuthPresentationContext.Provider>,
            ),
        );
        expect(host.querySelector('.auth-page-overlay')).not.toBeNull();
        expect(host.querySelector('.auth-hero')).toBeNull();
        expect(host.querySelector('.auth-form-brand')).toBeNull();
        expect(host.querySelector('.auth-form-toolbar')).toBeNull();
        expect(host.querySelector('img')).toBeNull();
        expect(requiredElement('.auth-form-heading h1').textContent).toBe('配置的登录标题');
        expect(requiredElement('.auth-form-heading p').textContent).toBe('配置的登录说明');
        expect(host.querySelectorAll('.auth-field-label-row label')).toHaveLength(2);
        expect(host.querySelector('.auth-floating-label')).toBeNull();
        const email = requiredElement<HTMLInputElement>('input[name="emailAddress"]');
        expect(email.value).toBe('shared@example.invalid');
        expect(email.placeholder).toBe('');
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        await settle(() => {
            descriptor?.set?.call(email, 'updated@example.invalid');
            email.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(onEmailDraftChange).toHaveBeenLastCalledWith('updated@example.invalid');
    });

    it('switches login and registration through the host while keeping the existing registration fields', async () => {
        const navigate = vi.fn();
        const api = { referralProgram: vi.fn().mockResolvedValue({ enabled: false }) };
        await settle(() =>
            root.render(
                <AuthPresentationContext.Provider value={{ navigate, emailDraft: 'draft@example.invalid' }}>
                    <LoginPage {...baseProps} api={api as never} onSuccess={vi.fn()} />
                </AuthPresentationContext.Provider>,
            ),
        );
        expect(requiredElement('.auth-form-heading p').textContent).toBe('登录后管理订单与服务');
        await settle(() => requiredElement<HTMLButtonElement>('.auth-switch button').click());
        expect(navigate).toHaveBeenLastCalledWith({ name: 'register' }, true);
        await settle(() =>
            root.render(
                <AuthPresentationContext.Provider value={{ navigate, emailDraft: 'draft@example.invalid' }}>
                    <RegisterPage {...baseProps} api={api as never} language="en" />
                </AuthPresentationContext.Provider>,
            ),
        );
        expect(requiredElement('.auth-form-heading p').textContent).toBe(
            'Create an account to explore products and services',
        );
        for (const name of ['fullName', 'emailAddress', 'password', 'confirmPassword']) {
            const input = requiredElement<HTMLInputElement>(`input[name="${name}"]`);
            expect(input.labels?.[0]?.closest('.auth-field-label-row')).not.toBeNull();
        }
        expect(requiredElement<HTMLInputElement>('input[name="emailAddress"]').value).toBe(
            'draft@example.invalid',
        );
        expect(host.querySelector('.auth-registration-consent')).not.toBeNull();
        await settle(() => requiredElement<HTMLButtonElement>('.auth-switch button').click());
        expect(navigate).toHaveBeenLastCalledWith({ name: 'login' }, true);
    });

    it('preserves password-reset submission and returns its result to the overlay login state', async () => {
        const navigate = vi.fn();
        const requestPasswordReset = vi.fn().mockResolvedValue(undefined);
        await settle(() =>
            root.render(
                <AuthPresentationContext.Provider value={{ navigate, emailDraft: 'reset@example.invalid' }}>
                    <ForgotPasswordPage {...baseProps} api={{ requestPasswordReset } as never} />
                </AuthPresentationContext.Provider>,
            ),
        );
        await settle(() => submit(requiredElement<HTMLFormElement>('form')));
        expect(requestPasswordReset).toHaveBeenCalledWith('reset@example.invalid');
        expect(host.textContent).toContain('如果该邮箱已注册');
        await settle(() => requiredElement<HTMLButtonElement>('.auth-result button').click());
        expect(navigate).toHaveBeenLastCalledWith({ name: 'login' }, false);
    });

    it('returns to overlay login before requesting a password reset', async () => {
        const navigate = vi.fn();
        const requestPasswordReset = vi.fn();
        await settle(() =>
            root.render(
                <AuthPresentationContext.Provider value={{ navigate }}>
                    <ForgotPasswordPage {...baseProps} api={{ requestPasswordReset } as never} />
                </AuthPresentationContext.Provider>,
            ),
        );
        await settle(() => requiredElement<HTMLButtonElement>('.auth-switch button').click());
        expect(navigate).toHaveBeenLastCalledWith({ name: 'login' }, false);
        expect(requestPasswordReset).not.toHaveBeenCalled();
    });

    it.each(['login', 'register', 'forgot-password'] as const)(
        'reports the %s submitting lifecycle and releases its host state on unmount',
        async mode => {
            const onSubmittingChange = vi.fn();
            let finish!: () => void;
            const request = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
            const api = {
                login: request,
                registerCustomerAccount: request,
                requestPasswordReset: request,
                referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
            };
            const props = {
                ...baseProps,
                api: api as never,
                onSuccess: vi.fn().mockResolvedValue(undefined),
            };
            const form =
                mode === 'login' ? (
                    <LoginPage {...props} />
                ) : mode === 'register' ? (
                    <RegisterPage {...props} />
                ) : (
                    <ForgotPasswordPage {...props} />
                );
            await settle(() =>
                root.render(
                    <AuthPresentationContext.Provider value={{ navigate: vi.fn(), onSubmittingChange }}>
                        {form}
                    </AuthPresentationContext.Provider>,
                ),
            );
            expect(onSubmittingChange).toHaveBeenLastCalledWith(false);
            requiredElement<HTMLInputElement>('input[name="emailAddress"]').value = 'busy@example.invalid';
            for (const name of ['password', 'confirmPassword']) {
                const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
                if (input) input.value = 'qa-busy-only';
            }
            if (mode === 'register') {
                requiredElement<HTMLInputElement>('input[name="fullName"]').value = '李测试';
                acceptRegistrationConsent();
            }
            await settle(() => submit(requiredElement<HTMLFormElement>('form')));
            expect(request).toHaveBeenCalledOnce();
            expect(onSubmittingChange).toHaveBeenLastCalledWith(true);
            expect(requiredElement<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
            expect(requiredElement<HTMLButtonElement>('.auth-switch button').disabled).toBe(true);
            if (mode === 'login') {
                expect(
                    requiredElement<HTMLButtonElement>('.auth-login-options .auth-inline-link').disabled,
                ).toBe(true);
            }
            await settle(() => finish());
            expect(onSubmittingChange).toHaveBeenLastCalledWith(false);
            onSubmittingChange.mockClear();
            await settle(() => root.render(null));
            expect(onSubmittingChange).toHaveBeenLastCalledWith(false);
        },
    );
});

describe('storefront configurable authentication methods', () => {
    it('keeps compact registration labelled, preserves consent and submits the existing payload', async () => {
        const registerCustomerAccount = vi.fn().mockResolvedValue(undefined);
        const api = {
            referralProgram: vi.fn().mockResolvedValue({ enabled: true, attributionWindowDays: 30 }),
            registerCustomerAccount,
        };
        const legalContent = {
            items: [
                {
                    id: 'privacy',
                    enabled: true,
                    label: '隐私政策',
                    targetType: 'PAGE',
                    targetValue: 'privacy',
                },
            ],
        };
        await act(async () => {
            root.render(
                <RegisterPage {...baseProps} api={api as never} legalContent={legalContent as never} />,
            );
            await Promise.resolve();
        });
        const back = requiredElement<HTMLButtonElement>('.login-content .auth-form-back-button');
        act(() => back.click());
        expect(baseProps.onBack).toHaveBeenCalledOnce();
        const fields = host.querySelectorAll<HTMLInputElement>('.auth-input-shell input');
        expect(fields).toHaveLength(5);
        for (const input of fields) expect(input.labels?.[0]?.textContent).toBeTruthy();
        expect(host.textContent).not.toContain('继续操作前，请阅读');
        const legalButtons = host.querySelectorAll<HTMLButtonElement>('.auth-legal-links button');
        expect(legalButtons).toHaveLength(1);
        act(() => legalButtons[0].click());
        expect(baseProps.onContentTarget).toHaveBeenCalledWith('PAGE', 'privacy');
        expect(requiredElement<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
        requiredElement<HTMLInputElement>('input[name="fullName"]').value = '李测试';
        requiredElement<HTMLInputElement>('input[name="emailAddress"]').value = 'layout@example.invalid';
        requiredElement<HTMLInputElement>('input[name="password"]').value = 'qa-layout-only';
        requiredElement<HTMLInputElement>('input[name="confirmPassword"]').value = 'qa-layout-only';
        act(() => requiredElement<HTMLButtonElement>('.auth-password-toggle').click());
        expect(requiredElement<HTMLInputElement>('input[name="password"]').type).toBe('text');
        expect(requiredElement<HTMLInputElement>('input[name="confirmPassword"]').type).toBe('password');
        await act(async () => {
            submit(requiredElement<HTMLFormElement>('form'));
            await Promise.resolve();
        });
        expect(registerCustomerAccount).not.toHaveBeenCalled();
        expect(requiredElement('[role="alert"]').textContent).toBeTruthy();
        acceptRegistrationConsent();
        await act(async () => {
            submit(requiredElement<HTMLFormElement>('form'));
            await Promise.resolve();
        });
        expect(registerCustomerAccount).toHaveBeenCalledWith(
            {
                emailAddress: 'layout@example.invalid',
                firstName: '测试',
                lastName: '李',
                password: 'qa-layout-only',
            },
            { termsAccepted: true, privacyAcknowledged: true, locale: 'zh' },
            undefined,
            undefined,
        );
        expect(host.textContent).toContain('请查收验证邮件');
        expect(host.querySelector('.login-content .auth-form-back-button')).not.toBeNull();
    });

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

        expect(login).toHaveBeenCalledWith('new@example.com', 'secure-password', true);
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
    it('changes language without replacing the form and passes the remember-me choice', async () => {
        const api = { login: vi.fn().mockResolvedValue(undefined) };
        const props = {
            ...baseProps,
            api: api as never,
            onSuccess: vi.fn().mockResolvedValue(undefined),
            onToggleLanguage: vi.fn(),
        };
        act(() => root.render(<LoginPage {...props} />));
        requiredElement<HTMLInputElement>('input[name="emailAddress"]').value = 'buyer@example.test';
        requiredElement<HTMLInputElement>('input[name="password"]').value = 'qa-only-password';
        act(() => requiredElement<HTMLInputElement>('.auth-remember input').click());
        const language = requiredElement<HTMLSelectElement>('.auth-language-control select');
        act(() => {
            language.value = 'en';
            language.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(props.onToggleLanguage).toHaveBeenCalledOnce();
        act(() => root.render(<LoginPage {...props} language="en" />));
        expect(requiredElement<HTMLInputElement>('input[name="emailAddress"]').value).toBe(
            'buyer@example.test',
        );
        expect(requiredElement<HTMLInputElement>('input[name="password"]').value).toBe('qa-only-password');
        await settle(() => submit(requiredElement<HTMLFormElement>('form')));
        expect(api.login).toHaveBeenCalledWith('buyer@example.test', 'qa-only-password', false);
        expect(props.onSuccess).toHaveBeenCalledOnce();
    });

    it('supports consent and completion when Google is the only registration method', async () => {
        let credentialCallback: ((response: { credential?: string }) => void) | undefined;
        window.google = {
            accounts: {
                id: {
                    initialize: options => {
                        credentialCallback = options.callback;
                    },
                    renderButton: vi.fn(),
                },
            },
        };
        const api = {
            referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
            authenticateWithGoogle: vi.fn().mockResolvedValue(undefined),
        };
        const onSuccess = vi.fn().mockResolvedValue(undefined);
        await settle(() =>
            root.render(
                <RegisterPage
                    {...baseProps}
                    api={api as never}
                    onSuccess={onSuccess}
                    authSettings={{
                        emailPasswordEnabled: false,
                        emailAutoRegistrationEnabled: false,
                        emailQuickRegistrationEnabled: false,
                        googleEnabled: true,
                        googleClientId: '123-test.apps.googleusercontent.com',
                    }}
                />,
            ),
        );
        expect(requiredElement<HTMLInputElement>('.auth-registration-consent input').checked).toBe(false);
        await settle(() => credentialCallback?.({ credential: 'qa-id-token' }));
        expect(api.authenticateWithGoogle).not.toHaveBeenCalled();
        acceptRegistrationConsent();
        await settle(() => credentialCallback?.({ credential: 'qa-id-token' }));
        expect(api.authenticateWithGoogle).toHaveBeenCalledWith(
            'qa-id-token',
            { termsAccepted: true, privacyAcknowledged: true, locale: 'zh' },
            expect.objectContaining({ inviteCode: undefined }),
        );
        expect(onSuccess).toHaveBeenCalledOnce();
        delete window.google;
    });
});
