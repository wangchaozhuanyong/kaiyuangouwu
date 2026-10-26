// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApiError } from './api';
import { ForgotPasswordPage, LoginPage, RegisterPage, VerifyAccountPage } from './auth-pages';
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
    const checkbox = requiredElement<HTMLInputElement>('.auth-registration-consent input');
    if (!checkbox.checked) act(() => checkbox.click());
}

async function settle(action: () => void) {
    await act(async () => {
        action();
        await Promise.resolve();
    });
}

const googleOnly = {
    emailPasswordEnabled: false,
    emailAutoRegistrationEnabled: false,
    emailQuickRegistrationEnabled: false,
    googleEnabled: true,
    googleClientId: 'fixture.apps.googleusercontent.com',
};

function googleFixture() {
    let callback: ((response: { credential?: string; state?: string }) => void) | undefined;
    let state = '';
    window.google = {
        accounts: {
            id: {
                initialize: options => {
                    callback = options.callback;
                },
                renderButton: (_parent, options) => {
                    state = options.state;
                },
            },
        },
    };
    return () => callback?.({ credential: 'fixture-id-token', state });
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
    delete window.google;
});

describe('storefront authentication overlay presentation', () => {
    it.each([
        { name: 'login', Page: LoginPage },
        { name: 'register', Page: RegisterPage },
    ])('invalidates a pending Google completion when its $name form closes', async ({ Page }) => {
        const respond = googleFixture();
        let finish!: () => void;
        const api = {
            referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
            authenticateWithGoogle: vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        finish = resolve;
                    }),
            ),
        };
        const onSuccess = vi.fn().mockResolvedValue(undefined);
        await settle(() =>
            root.render(
                <Page {...baseProps} api={api as never} authSettings={googleOnly} onSuccess={onSuccess} />,
            ),
        );
        if (Page === RegisterPage) acceptRegistrationConsent();
        await act(async () => {
            respond();
            await vi.waitFor(() => expect(api.authenticateWithGoogle).toHaveBeenCalledOnce());
        });
        await settle(() => root.render(null));
        await settle(() => finish());
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('reports post-authorization session failures separately and passes an owner guard', async () => {
        const respond = googleFixture();
        const onSuccess = vi.fn().mockRejectedValue(new Error('Fixture session read failed'));
        const api = { authenticateWithGoogle: vi.fn().mockResolvedValue(undefined) };
        await settle(() =>
            root.render(
                <LoginPage
                    {...baseProps}
                    api={api as never}
                    authSettings={googleOnly}
                    onSuccess={onSuccess}
                />,
            ),
        );
        await settle(respond);
        expect(onSuccess).toHaveBeenCalledWith(expect.any(Function));
        expect(onSuccess.mock.calls[0][0]()).toBe(true);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain(
            'Google 授权已完成，但登录状态读取失败',
        );
        await settle(() => root.render(null));
        expect(onSuccess.mock.calls[0][0]()).toBe(false);
    });
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
        for (const name of ['fullName', 'emailAddress']) {
            const input = requiredElement<HTMLInputElement>(`input[name="${name}"]`);
            expect(input.labels?.[0]?.closest('.auth-field-label-row')).not.toBeNull();
        }
        expect(host.querySelector('input[name="password"]')).toBeNull();
        expect(host.querySelector('input[name="confirmPassword"]')).toBeNull();
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
        expect(fields).toHaveLength(3);
        for (const input of fields) expect(input.labels?.[0]?.textContent).toBeTruthy();
        expect(host.textContent).not.toContain('继续操作前，请阅读');
        const legalButtons = host.querySelectorAll<HTMLButtonElement>('.auth-legal-links button');
        expect(legalButtons).toHaveLength(1);
        act(() => legalButtons[0].click());
        expect(baseProps.onContentTarget).toHaveBeenCalledWith('PAGE', 'privacy');
        const consent = requiredElement<HTMLInputElement>('input[type="checkbox"]');
        expect(consent.checked).toBe(true);
        act(() => consent.click());
        expect(consent.checked).toBe(false);
        requiredElement<HTMLInputElement>('input[name="fullName"]').value = '李测试';
        requiredElement<HTMLInputElement>('input[name="emailAddress"]').value = 'layout@example.invalid';
        expect(host.querySelector('input[name="password"]')).toBeNull();
        expect(host.querySelector('input[name="confirmPassword"]')).toBeNull();
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
            },
            { termsAccepted: true, privacyAcknowledged: true, locale: 'zh' },
            undefined,
            undefined,
            expect.any(AbortSignal),
        );
        expect(host.textContent).toContain('注册请求已提交');
        expect(host.textContent).toContain('请检查垃圾邮件文件夹');
        expect(host.textContent).toContain('已有账号？返回登录找回密码');
        expect(host.textContent).not.toContain('已发送');
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
        const consent = requiredElement<HTMLInputElement>('.auth-registration-consent input');
        expect(consent.checked).toBe(true);
        act(() => consent.click());
        expect(consent.checked).toBe(false);
        await settle(() => submit(requiredElement<HTMLFormElement>('form')));
        expect(registerCustomerAccount).not.toHaveBeenCalled();
        expect(requiredElement('[role="alert"]').textContent).toContain('请先同意条款与隐私政策');
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
            },
            { termsAccepted: true, privacyAcknowledged: true, locale: 'zh' },
            undefined,
            undefined,
            expect.any(AbortSignal),
        );
        expect(requiredElement('.auth-registration-address strong').textContent).toBe('new@example.com');
        expect(host.textContent).toContain('如需验证');
        expect(host.textContent).toContain('已有账号？返回登录找回密码');
        expect(host.textContent).toContain('注册请求已提交');
        expect(host.textContent).toContain('请检查垃圾邮件文件夹');
        expect(host.textContent).not.toContain('已发送');
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
            expect.any(AbortSignal),
        );
        expect(host.textContent).toContain('注册请求已提交');
        expect(requiredElement('.auth-registration-address strong').textContent).toBe('quick@example.com');
        expect(host.textContent).toContain('如需验证');
        expect(host.textContent).toContain('请通过邮件中的链接设置密码');
        expect(host.textContent).not.toContain('已发送');
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
        let credentialCallback: ((response: { credential?: string; state?: string }) => void) | undefined;
        let state = '';
        window.google = {
            accounts: {
                id: {
                    initialize: options => {
                        credentialCallback = options.callback;
                    },
                    renderButton: (_parent, options) => {
                        state = options.state;
                    },
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
        const consent = requiredElement<HTMLInputElement>('.auth-registration-consent input');
        expect(consent.checked).toBe(true);
        expect(host.querySelector('.google-auth-button > [inert]')).toBeNull();
        act(() => consent.click());
        expect(consent.checked).toBe(false);
        expect(host.querySelector('.google-auth-button > [inert]')).not.toBeNull();
        expect(host.textContent).toContain('请先勾选同意条款与隐私政策，再使用 Google 继续');
        await settle(() => credentialCallback?.({ credential: 'qa-id-token', state }));
        expect(api.authenticateWithGoogle).not.toHaveBeenCalled();
        acceptRegistrationConsent();
        expect(host.querySelector('.google-auth-button > [inert]')).toBeNull();
        await settle(() => credentialCallback?.({ credential: 'qa-id-token', state }));
        expect(api.authenticateWithGoogle).toHaveBeenCalledWith(
            'qa-id-token',
            { termsAccepted: true, privacyAcknowledged: true, locale: 'zh' },
            expect.objectContaining({ inviteCode: undefined }),
        );
        expect(onSuccess).toHaveBeenCalledOnce();
        delete window.google;
    });
});

describe('authentication security challenge recovery', () => {
    it('retries the blocked registration stage directly without repeating login or reusing its proof', async () => {
        const login = vi
            .fn()
            .mockRejectedValue(
                new ShopApiError(
                    'INVALID_CREDENTIALS_ERROR',
                    'Invalid credentials',
                    'STOREFRONT_INVALID_CREDENTIALS',
                ),
            );
        const blocked = Object.assign(new Error('synthetic rejection'), {
            errorCode: 'SHOP_ABUSE_CHALLENGE_REQUIRED',
            action: 'REGISTER',
        });
        const registerCustomerAccount = vi.fn().mockRejectedValueOnce(blocked).mockResolvedValue(undefined);
        const createShopAbuseChallenge = vi.fn().mockResolvedValue({
            id: 'registration-proof',
            imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
        const api = { login, registerCustomerAccount, createShopAbuseChallenge };
        await settle(() =>
            root.render(
                <LoginPage
                    {...baseProps}
                    api={api as never}
                    onSuccess={vi.fn()}
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
        requiredElement<HTMLInputElement>('input[name="emailAddress"]').value = 'local@example.invalid';
        requiredElement<HTMLInputElement>('input[name="password"]').value = 'synthetic-password';
        acceptRegistrationConsent();
        await settle(() => submit(requiredElement<HTMLFormElement>('form')));
        expect(login).toHaveBeenCalledTimes(1);
        expect(registerCustomerAccount).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        expect(createShopAbuseChallenge).toHaveBeenCalledWith(
            'REGISTER',
            'local@example.invalid',
            expect.any(AbortSignal),
        );
        const input = requiredElement<HTMLInputElement>('.shop-abuse-challenge input');
        await settle(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'ABC234');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(() => submit(requiredElement<HTMLFormElement>('form')));
        expect(login).toHaveBeenCalledTimes(1);
        expect(registerCustomerAccount).toHaveBeenCalledTimes(2);
        expect(registerCustomerAccount.mock.calls[1][5]).toEqual({
            id: 'registration-proof',
            answer: 'ABC234',
        });
        expect(host.textContent).toContain('注册请求已提交');
    });
});

describe('account verification challenge flow', () => {
    const securityError = () =>
        Object.assign(new Error('synthetic rejection'), {
            errorCode: 'SHOP_ABUSE_CHALLENGE_REQUIRED',
            action: 'PASSWORD_UPDATE',
        });
    const image = () => ({
        id: 'verification-proof',
        imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    async function answerAndSubmit() {
        const input = requiredElement<HTMLInputElement>('.shop-abuse-challenge input');
        await settle(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'ABC234');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(() => submit(requiredElement<HTMLFormElement>('.auth-recovery-form')));
    }
    it('waits for manual submission after a preflight challenge before restoring the verified session', async () => {
        const verifyCustomerAccount = vi
            .fn()
            .mockRejectedValueOnce(securityError())
            .mockResolvedValue(undefined);
        const createShopAbuseChallenge = vi.fn().mockResolvedValue(image());
        const onSuccess = vi.fn().mockResolvedValue(undefined);
        const api = { verifyCustomerAccount, createShopAbuseChallenge };
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...baseProps}
                    api={api as never}
                    token="synthetic-verification"
                    onSuccess={onSuccess}
                />,
            ),
        );
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        expect(verifyCustomerAccount).toHaveBeenCalledTimes(1);
        expect(onSuccess).not.toHaveBeenCalled();
        await answerAndSubmit();
        expect(verifyCustomerAccount).toHaveBeenLastCalledWith(
            'synthetic-verification',
            undefined,
            expect.any(AbortSignal),
            { id: 'verification-proof', answer: 'ABC234' },
        );
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(host.textContent).toContain('邮箱已验证');
    });
    it('keeps the password stage and only resubmits its proof after another manual submit', async () => {
        const verifyCustomerAccount = vi
            .fn()
            .mockRejectedValueOnce(new ShopApiError('MISSING_PASSWORD_ERROR', 'A password must be provided.'))
            .mockRejectedValueOnce(securityError())
            .mockResolvedValue(undefined);
        const api = { verifyCustomerAccount, createShopAbuseChallenge: vi.fn().mockResolvedValue(image()) };
        const onSuccess = vi.fn().mockResolvedValue(undefined);
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...baseProps}
                    api={api as never}
                    token="synthetic-verification"
                    onSuccess={onSuccess}
                />,
            ),
        );
        requiredElement<HTMLInputElement>('input[name="password"]').value = 'synthetic-password';
        requiredElement<HTMLInputElement>('input[name="confirmPassword"]').value = 'synthetic-password';
        await settle(() => submit(requiredElement<HTMLFormElement>('.auth-recovery-form')));
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        expect(verifyCustomerAccount).toHaveBeenCalledTimes(2);
        expect(onSuccess).not.toHaveBeenCalled();
        expect(requiredElement<HTMLInputElement>('input[name="password"]').value).toBe('synthetic-password');
        await answerAndSubmit();
        expect(verifyCustomerAccount).toHaveBeenLastCalledWith(
            'synthetic-verification',
            'synthetic-password',
            expect.any(AbortSignal),
            { id: 'verification-proof', answer: 'ABC234' },
        );
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(host.textContent).toContain('邮箱已验证');
    });
});

describe('verification email challenge target recovery', () => {
    it('keeps resend feedback and cooldown bound to the email submitted through Enter', async () => {
        let finishResend!: () => void;
        const refreshCustomerVerification = vi
            .fn()
            .mockRejectedValueOnce(
                Object.assign(new Error('synthetic rejection'), {
                    errorCode: 'SHOP_ABUSE_CHALLENGE_REQUIRED',
                    action: 'REGISTER',
                }),
            )
            .mockImplementationOnce(
                () =>
                    new Promise<void>(resolve => {
                        finishResend = resolve;
                    }),
            );
        const api = {
            referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
            registerCustomerAccount: vi
                .fn()
                .mockRejectedValue(new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'synthetic conflict')),
            refreshCustomerVerification,
            createShopAbuseChallenge: vi.fn().mockResolvedValue({
                id: 'synthetic-resend-proof',
                imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                expiresAt: new Date(Date.now() + 60000).toISOString(),
            }),
        };
        await settle(() => root.render(<RegisterPage {...baseProps} api={api as never} />));
        requiredElement<HTMLInputElement>('input[name="fullName"]').value = 'Local Example';
        requiredElement<HTMLInputElement>('input[name="emailAddress"]').value = 'old@example.invalid';
        acceptRegistrationConsent();
        await settle(() => submit(requiredElement<HTMLFormElement>('form')));
        await settle(() =>
            requiredElement<HTMLButtonElement>(
                '.auth-existing-account__help button.auth-inline-link',
            ).click(),
        );
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        const answer = requiredElement<HTMLInputElement>('.shop-abuse-challenge input');
        await settle(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(answer, 'ABC234');
            answer.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(() =>
            answer.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
            ),
        );
        expect(refreshCustomerVerification).toHaveBeenCalledTimes(2);
        expect(refreshCustomerVerification).toHaveBeenLastCalledWith(
            'old@example.invalid',
            expect.any(AbortSignal),
            { id: 'synthetic-resend-proof', answer: 'ABC234' },
        );
        const email = requiredElement<HTMLInputElement>('input[name="emailAddress"]');
        await settle(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
                email,
                'new@example.invalid',
            );
            email.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(() => finishResend());
        await settle(() => submit(requiredElement<HTMLFormElement>('form')));
        expect(host.textContent).not.toContain('重新发送请求已提交');
        expect(
            requiredElement<HTMLButtonElement>('.auth-existing-account__help button.auth-inline-link')
                .disabled,
        ).toBe(false);
    });
});
