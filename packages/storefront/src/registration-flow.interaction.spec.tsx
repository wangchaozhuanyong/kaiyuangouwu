// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApiError, ShopApiTimeoutError } from './api';
import { ForgotPasswordPage, LoginPage, RegisterPage, VerifyAccountPage } from './auth-pages';
import { AuthEmailDraftBoundary, AuthPresentationContext } from './auth-presentation';
import { completeStorefrontAuthentication } from './checkout-authentication';
import { type ActiveCustomer } from './types';

const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => router.navigate }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;
const props = { language: 'zh' as const, storefrontName: 'Local fixture', onBack: vi.fn() };
const missingPassword = () => new ShopApiError('MISSING_PASSWORD_ERROR', 'Synthetic missing password');
const invalidLink = () => new ShopApiError('VERIFICATION_TOKEN_INVALID_ERROR', 'Synthetic invalid link');

function element<T extends Element>(selector: string): T {
    const result = host.querySelector<T>(selector);
    if (!result) throw new Error(`Missing fixture element: ${selector}`);
    return result;
}
async function settle(action: () => void) {
    await act(async () => {
        action();
        await Promise.resolve();
        await Promise.resolve();
    });
}
function submit() {
    element<HTMLFormElement>('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((success, failure) => {
        resolve = success;
        reject = failure;
    });
    return { promise, resolve, reject };
}
function completeRegistrationInput() {
    element<HTMLInputElement>('input[name="fullName"]').value = '本地测试';
    element<HTMLInputElement>('input[name="emailAddress"]').value = 'local@example.invalid';
    act(() => element<HTMLInputElement>('.auth-registration-consent input').click());
}
function completePasswordInput(password = 'local-synthetic-password') {
    element<HTMLInputElement>('input[name="password"]').value = password;
    element<HTMLInputElement>('input[name="confirmPassword"]').value = password;
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('registration and verification ownership', () => {
    it.each([
        { mode: 'register', language: 'zh' as const },
        { mode: 'register', language: 'en' as const },
        { mode: 'quick', language: 'zh' as const },
        { mode: 'quick', language: 'en' as const },
        { mode: 'auto', language: 'zh' as const },
        { mode: 'auto', language: 'en' as const },
    ])(
        'keeps the $mode form and drafts after an existing-email error in $language',
        async ({ mode, language }) => {
            const registerCustomerAccount = vi
                .fn()
                .mockRejectedValue(
                    new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'Synthetic existing email'),
                );
            const api = {
                registerCustomerAccount,
                referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
                login: vi.fn().mockRejectedValue(new ShopApiError('INVALID_CREDENTIALS_ERROR', 'Synthetic')),
                refreshCustomerVerification: vi.fn().mockResolvedValue(undefined),
            };
            const navigate = vi.fn();
            const onSuccess = vi.fn();
            const authSettings = {
                emailPasswordEnabled: true,
                emailAutoRegistrationEnabled: mode === 'auto',
                emailQuickRegistrationEnabled: mode === 'quick',
                googleEnabled: false,
                googleClientId: null,
            };
            const formProps = {
                ...props,
                language,
                api: api as never,
                authSettings,
                onContentTarget: vi.fn(),
                onSuccess,
            };
            await settle(() =>
                root.render(
                    <AuthPresentationContext.Provider
                        value={{ navigate, emailDraft: 'local@example.invalid' }}
                    >
                        {mode === 'auto' ? <LoginPage {...formProps} /> : <RegisterPage {...formProps} />}
                    </AuthPresentationContext.Provider>,
                ),
            );
            if (mode === 'register')
                element<HTMLInputElement>('input[name="fullName"]').value = 'Local Example';
            if (mode === 'auto')
                element<HTMLInputElement>('input[name="password"]').value = 'local-synthetic-password';
            act(() => element<HTMLInputElement>('.auth-registration-consent input').click());
            await settle(submit);

            expect(registerCustomerAccount).toHaveBeenCalledOnce();
            expect(element('.auth-existing-account__title').textContent).toBe(
                mode === 'auto'
                    ? language === 'zh'
                        ? '该邮箱已有账户，请核对密码'
                        : 'This email has an account. Check your password.'
                    : language === 'zh'
                      ? '该邮箱已注册'
                      : 'This email is already registered',
            );
            const notice = element<HTMLElement>('.auth-existing-account');
            const emailField = element<HTMLInputElement>('input[name="emailAddress"]');
            expect(emailField.getAttribute('aria-invalid')).toBe(mode === 'auto' ? null : 'true');
            if (mode === 'auto')
                expect(element('input[name="password"]').getAttribute('aria-invalid')).toBe('true');
            expect(emailField.getAttribute('aria-describedby')).toBe(element('[role="alert"]').id);
            expect(emailField.closest('.auth-field')?.nextElementSibling).toBe(notice);
            expect(notice.querySelector('[role="alert"] button')).toBeNull();
            expect(notice.querySelector('details')?.open).toBe(false);
            expect(notice.querySelector('.auth-existing-account__primary') === null).toBe(mode === 'auto');
            expect(host.querySelector('.auth-password-hint')).toBeNull();
            expect(host.querySelector('.auth-result')).toBeNull();
            expect(element<HTMLInputElement>('input[name="emailAddress"]').value).toBe(
                'local@example.invalid',
            );
            if (mode === 'register')
                expect(element<HTMLInputElement>('input[name="fullName"]').value).toBe('Local Example');
            expect(element<HTMLInputElement>('.auth-registration-consent input').checked).toBe(true);
            expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(mode !== 'auto');
            expect(onSuccess).not.toHaveBeenCalled();
            expect(navigate).not.toHaveBeenCalled();
            expect(api.refreshCustomerVerification).not.toHaveBeenCalled();
            const resend = Array.from(host.querySelectorAll('button')).find(
                button =>
                    button.textContent ===
                    (language === 'zh' ? '重新发送验证邮件' : 'Resend verification email'),
            );
            if (!resend) throw new Error('Missing explicit verification recovery action');
            await settle(() =>
                element<HTMLDetailsElement>('.auth-existing-account__help').setAttribute('open', ''),
            );
            expect(api.refreshCustomerVerification).not.toHaveBeenCalled();
            await settle(() => {
                resend.click();
                resend.click();
            });
            expect(api.refreshCustomerVerification).toHaveBeenCalledOnce();
            expect(api.refreshCustomerVerification).toHaveBeenCalledWith(
                'local@example.invalid',
                expect.any(AbortSignal),
            );
            expect(element('[role="status"]').textContent).toBe(
                language === 'zh' ? '重新发送请求已提交' : 'Verification email resend request submitted',
            );
            expect(host.querySelector('.auth-result')).toBeNull();
            expect(element<HTMLInputElement>('input[name="emailAddress"]').value).toBe(
                'local@example.invalid',
            );
            expect(resend.disabled).toBe(true);
            expect(registerCustomerAccount).toHaveBeenCalledOnce();
            expect(onSuccess).not.toHaveBeenCalled();
            const reset = Array.from(host.querySelectorAll('button')).find(
                button => button.textContent === (language === 'zh' ? '找回密码' : 'Recover password'),
            );
            if (!reset) throw new Error('Missing password recovery action');
            await settle(() => reset.click());
            expect(navigate).toHaveBeenLastCalledWith({ name: 'forgot-password' }, false);
        },
    );

    it.each(['register', 'quick', 'auto'] as const)(
        'restores the $mode form immediately when an existing email is edited',
        async mode => {
            const api = {
                registerCustomerAccount: vi
                    .fn()
                    .mockRejectedValue(new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'Synthetic')),
                referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
                login: vi.fn().mockRejectedValue(new ShopApiError('INVALID_CREDENTIALS_ERROR', 'Synthetic')),
            };
            const formProps = {
                ...props,
                api: api as never,
                onContentTarget: vi.fn(),
                onSuccess: vi.fn(),
                authSettings: {
                    emailPasswordEnabled: true,
                    emailQuickRegistrationEnabled: mode === 'quick',
                    emailAutoRegistrationEnabled: mode === 'auto',
                    googleEnabled: false,
                    googleClientId: null,
                },
            };
            await settle(() =>
                root.render(mode === 'auto' ? <LoginPage {...formProps} /> : <RegisterPage {...formProps} />),
            );
            const email = element<HTMLInputElement>('input[name="emailAddress"]');
            email.value = 'local@example.invalid';
            if (mode === 'register')
                element<HTMLInputElement>('input[name="fullName"]').value = 'Local Example';
            if (mode === 'auto')
                element<HTMLInputElement>('input[name="password"]').value = 'local-synthetic-password';
            act(() => element<HTMLInputElement>('.auth-registration-consent input').click());
            await settle(submit);
            expect(host.querySelector('.auth-existing-account')).not.toBeNull();
            if (mode !== 'auto') {
                await settle(submit);
                expect(api.registerCustomerAccount).toHaveBeenCalledOnce();
            }
            await settle(() => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
                    email,
                    'new@example.invalid',
                );
                email.dispatchEvent(new Event('input', { bubbles: true }));
            });
            expect(host.querySelector('.auth-existing-account')).toBeNull();
            expect(email.hasAttribute('aria-invalid')).toBe(false);
            expect(email.hasAttribute('aria-describedby')).toBe(false);
            expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
            expect(element<HTMLInputElement>('.auth-registration-consent input').checked).toBe(true);
            if (mode === 'register')
                expect(element<HTMLInputElement>('input[name="fullName"]').value).toBe('Local Example');
            if (mode !== 'auto') expect(host.querySelector('.auth-password-hint')).not.toBeNull();
        },
    );

    it('clears the automatic registration password warning after the password is edited', async () => {
        const api = {
            registerCustomerAccount: vi
                .fn()
                .mockRejectedValue(new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'Synthetic')),
            login: vi.fn().mockRejectedValue(new ShopApiError('INVALID_CREDENTIALS_ERROR', 'Synthetic')),
        };
        await settle(() =>
            root.render(
                <LoginPage
                    {...props}
                    api={api as never}
                    onContentTarget={vi.fn()}
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
        const password = element<HTMLInputElement>('input[name="password"]');
        element<HTMLInputElement>('input[name="emailAddress"]').value = 'local@example.invalid';
        password.value = 'local-synthetic-password';
        act(() => element<HTMLInputElement>('.auth-registration-consent input').click());
        await settle(submit);
        expect(password.getAttribute('aria-invalid')).toBe('true');
        await settle(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
                password,
                'changed-synthetic-password',
            );
            password.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(password.hasAttribute('aria-invalid')).toBe(false);
        expect(password.hasAttribute('aria-describedby')).toBe(false);
        expect(host.querySelector('.auth-existing-account')).toBeNull();
        expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    });

    it.each(['login', 'forgot-password'] as const)(
        'carries the standalone conflict email to %s without validating the registration form',
        async destination => {
            const api = {
                registerCustomerAccount: vi
                    .fn()
                    .mockRejectedValue(new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'Synthetic')),
                referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
            };
            const formProps = {
                ...props,
                api: api as never,
                onContentTarget: vi.fn(),
                onSuccess: vi.fn(),
                returnTo: 'purchase' as const,
                returnVariantId: 'fixture-variant',
                returnQuantity: 2,
            };
            const renderPage = (page: 'register' | 'login' | 'forgot-password') => {
                root.render(
                    <AuthEmailDraftBoundary active ownerKey="fixture-store">
                        {page === 'register' ? (
                            <RegisterPage {...formProps} />
                        ) : page === 'login' ? (
                            <LoginPage {...formProps} />
                        ) : (
                            <ForgotPasswordPage {...formProps} />
                        )}
                    </AuthEmailDraftBoundary>,
                );
            };
            await settle(() => renderPage('register'));
            completeRegistrationInput();
            await settle(submit);
            element<HTMLInputElement>('input[name="fullName"]').value = '';
            act(() => element<HTMLInputElement>('.auth-registration-consent input').click());
            const action = element<HTMLButtonElement>(
                destination === 'login'
                    ? '.auth-existing-account__primary'
                    : '.auth-existing-account__secondary',
            );
            expect(action.type).toBe('button');
            await settle(() => action.click());
            expect(router.navigate).toHaveBeenCalledOnce();
            expect(router.navigate.mock.calls[0][0]).toMatchObject({
                to: destination === 'login' ? '/login' : '/forgot-password',
                search: { returnTo: 'purchase', id: 'fixture-variant', quantity: 2 },
            });
            expect(JSON.stringify(router.navigate.mock.calls)).not.toContain('local@example.invalid');
            expect(api.registerCustomerAccount).toHaveBeenCalledOnce();
            await settle(() => renderPage(destination));
            expect(element<HTMLInputElement>('input[name="emailAddress"]').value).toBe(
                'local@example.invalid',
            );
            expect(host.querySelector('.auth-page-overlay')).toBeNull();
            await settle(() => renderPage(destination === 'login' ? 'forgot-password' : 'login'));
            expect(element<HTMLInputElement>('input[name="emailAddress"]').value).toBe(
                'local@example.invalid',
            );
        },
    );

    it('invalidates recovery reads after switching links without writing customer state or navigating', async () => {
        let finishCustomerRead!: (customer: ActiveCustomer) => void;
        const customerRead = new Promise<ActiveCustomer>(resolve => {
            finishCustomerRead = resolve;
        });
        const context = {
            api: {
                activeCustomer: vi.fn(() => customerRead),
                cart: vi.fn().mockResolvedValue({ id: 'synthetic-cart' }),
                beginCheckout: vi.fn(),
            },
            cartController: { reset: vi.fn(), execute: vi.fn(), getSnapshot: vi.fn() },
            clearPrivateQueryCache: vi.fn(),
            setCustomer: vi.fn(),
            setCart: vi.fn(),
            setCartError: vi.fn(),
            setCheckoutOrder: vi.fn(),
            notify: vi.fn(),
            navigate: vi.fn(),
            isZh: true,
        };
        const onSuccess = vi.fn((isCurrent?: () => boolean) =>
            completeStorefrontAuthentication(
                context as never,
                { name: 'verify-account' },
                undefined,
                isCurrent,
            ),
        );
        const verifyCustomerAccount = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(missingPassword());
        const api = { verifyCustomerAccount };
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-first"
                    onSuccess={onSuccess}
                />,
            ),
        );
        expect(context.api.activeCustomer).toHaveBeenCalledOnce();
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(onSuccess.mock.calls[0][0]?.()).toBe(true);
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-second"
                    onSuccess={onSuccess}
                />,
            ),
        );
        expect(onSuccess.mock.calls[0][0]?.()).toBe(false);
        await settle(() => finishCustomerRead({ id: 'synthetic-customer' } as ActiveCustomer));
        expect(context.setCustomer).not.toHaveBeenCalled();
        expect(context.setCart).not.toHaveBeenCalled();
        expect(context.navigate).not.toHaveBeenCalled();
        expect(host.textContent).toContain('设置登录密码');
    });

    it.each(['register', 'quick', 'auto'] as const)(
        'drops a registration result for a changed email draft in $mode',
        async mode => {
            const response = deferred();
            const api = {
                registerCustomerAccount: vi.fn(() => response.promise),
                referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
                login: vi.fn().mockRejectedValue(new ShopApiError('INVALID_CREDENTIALS_ERROR', 'Synthetic')),
            };
            const formProps = {
                ...props,
                api: api as never,
                onContentTarget: vi.fn(),
                onSuccess: vi.fn(),
                authSettings: {
                    emailPasswordEnabled: true,
                    emailAutoRegistrationEnabled: mode === 'auto',
                    emailQuickRegistrationEnabled: mode === 'quick',
                    googleEnabled: false,
                    googleClientId: null,
                },
            };
            await settle(() =>
                root.render(mode === 'auto' ? <LoginPage {...formProps} /> : <RegisterPage {...formProps} />),
            );
            const email = element<HTMLInputElement>('input[name="emailAddress"]');
            email.value = 'local@example.invalid';
            if (mode === 'register') element<HTMLInputElement>('input[name="fullName"]').value = '本地测试';
            if (mode === 'auto')
                element<HTMLInputElement>('input[name="password"]').value = 'local-synthetic-password';
            act(() => element<HTMLInputElement>('.auth-registration-consent input').click());
            await settle(submit);
            expect(api.registerCustomerAccount).toHaveBeenCalledOnce();
            expect(email.disabled).toBe(false);
            await settle(() => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
                    email,
                    'changed@example.invalid',
                );
                email.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await settle(() =>
                response.reject(new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'Synthetic old email')),
            );
            expect(host.querySelector('[role="alert"]')).toBeNull();
            expect(host.querySelector('.auth-result')).toBeNull();
            expect(email.value).toBe('changed@example.invalid');
            expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
            expect(formProps.onSuccess).not.toHaveBeenCalled();
            expect(host.textContent).not.toContain('重新发送验证邮件');
        },
    );

    it('ignores a stale existing-email result after changing API ownership', async () => {
        const response = deferred();
        const firstApi = {
            registerCustomerAccount: vi.fn(() => response.promise),
            referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
        };
        await settle(() =>
            root.render(<RegisterPage {...props} api={firstApi as never} onContentTarget={vi.fn()} />),
        );
        completeRegistrationInput();
        await settle(submit);
        const secondApi = {
            registerCustomerAccount: vi.fn(),
            referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
        };
        await settle(() =>
            root.render(<RegisterPage {...props} api={secondApi as never} onContentTarget={vi.fn()} />),
        );
        await settle(() =>
            response.reject(new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'Synthetic old result')),
        );
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.querySelector('.auth-result')).toBeNull();
        expect(secondApi.registerCustomerAccount).not.toHaveBeenCalled();
        expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    });

    it('ignores verification recovery after the email draft changes', async () => {
        const response = deferred();
        const api = {
            registerCustomerAccount: vi
                .fn()
                .mockRejectedValue(
                    new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'Synthetic existing email'),
                ),
            referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
            refreshCustomerVerification: vi.fn(() => response.promise),
        };
        await settle(() =>
            root.render(<RegisterPage {...props} api={api as never} onContentTarget={vi.fn()} />),
        );
        completeRegistrationInput();
        await settle(submit);
        const resend = Array.from(host.querySelectorAll('button')).find(
            button => button.textContent === '重新发送验证邮件',
        );
        if (!resend) throw new Error('Missing verification recovery action');
        await settle(() => resend.click());
        const email = element<HTMLInputElement>('input[name="emailAddress"]');
        await settle(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
                email,
                'changed@example.invalid',
            );
            email.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(response.resolve);
        expect(host.querySelector('[role="status"]')).toBeNull();
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.querySelector('.auth-result')).toBeNull();
        expect(email.value).toBe('changed@example.invalid');
        expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    });

    it('does not infer a missing account from invalid credentials without consent', async () => {
        const registerCustomerAccount = vi.fn();
        const api = {
            login: vi.fn().mockRejectedValue(new ShopApiError('INVALID_CREDENTIALS_ERROR', 'Synthetic')),
            registerCustomerAccount,
        };
        await settle(() =>
            root.render(
                <LoginPage
                    {...props}
                    api={api as never}
                    onContentTarget={vi.fn()}
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
        element<HTMLInputElement>('input[name="emailAddress"]').value = 'local@example.invalid';
        element<HTMLInputElement>('input[name="password"]').value = 'local-synthetic-password';
        await settle(submit);
        expect(registerCustomerAccount).not.toHaveBeenCalled();
        expect(element('[role="alert"]').textContent).toContain('请核对邮箱和密码');
        expect(host.textContent).not.toContain('尚未注册');
    });

    it('keeps one registration request and ignores a late result after changing API scope', async () => {
        const response = deferred();
        const registerCustomerAccount = vi.fn((..._args: unknown[]) => response.promise);
        const firstApi = {
            registerCustomerAccount,
            referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
        };
        await settle(() =>
            root.render(<RegisterPage {...props} api={firstApi as never} onContentTarget={vi.fn()} />),
        );
        completeRegistrationInput();
        await settle(() => {
            submit();
            submit();
        });
        expect(registerCustomerAccount).toHaveBeenCalledOnce();
        const signal = registerCustomerAccount.mock.calls[0][4] as AbortSignal;
        const secondApi = {
            registerCustomerAccount: vi.fn(),
            referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
        };
        await settle(() =>
            root.render(<RegisterPage {...props} api={secondApi as never} onContentTarget={vi.fn()} />),
        );
        expect(signal.aborted).toBe(true);
        await settle(response.resolve);
        expect(host.querySelector('.auth-result')).toBeNull();
        expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
        expect(secondApi.registerCustomerAccount).not.toHaveBeenCalled();
    });

    it('preflights each changed link and preserves the current password form against an old result', async () => {
        const oldResponse = deferred();
        const verifyCustomerAccount = vi
            .fn()
            .mockImplementationOnce(() => oldResponse.promise)
            .mockRejectedValueOnce(missingPassword());
        const api = { verifyCustomerAccount };
        const onSuccess = vi.fn();
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-old"
                    onSuccess={onSuccess}
                />,
            ),
        );
        const oldSignal = verifyCustomerAccount.mock.calls[0][2] as AbortSignal;
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-current"
                    onSuccess={onSuccess}
                />,
            ),
        );
        expect(oldSignal.aborted).toBe(true);
        expect(verifyCustomerAccount).toHaveBeenCalledTimes(2);
        expect(verifyCustomerAccount.mock.calls[1][0]).toBe('synthetic-current');
        expect(verifyCustomerAccount.mock.calls[1][1]).toBeUndefined();
        expect(element('.auth-result h1').textContent).toBe('设置登录密码');
        expect(host.querySelector('input[name="password"]')).not.toBeNull();
        expect(host.textContent).not.toContain('由后台开户');
        await settle(oldResponse.resolve);
        expect(host.textContent).toContain('设置登录密码');
        expect(onSuccess).not.toHaveBeenCalled();
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-current"
                    onSuccess={vi.fn()}
                />,
            ),
        );
        expect(verifyCustomerAccount).toHaveBeenCalledTimes(2);
    });

    it('clears an invalid-link error and processes a new link within the same mounted page', async () => {
        const verifyCustomerAccount = vi
            .fn()
            .mockRejectedValueOnce(invalidLink())
            .mockRejectedValueOnce(missingPassword());
        const api = { verifyCustomerAccount };
        const onSuccess = vi.fn();
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-invalid"
                    onSuccess={onSuccess}
                />,
            ),
        );
        expect(host.textContent).toContain('无效');
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-new"
                    onSuccess={onSuccess}
                />,
            ),
        );
        expect(verifyCustomerAccount).toHaveBeenCalledTimes(2);
        expect(host.textContent).toContain('设置登录密码');
        expect(host.textContent).not.toContain('验证链接无效');
    });

    it('rechecks the same link after API ownership changes and ignores the former API failure', async () => {
        const oldResponse = deferred();
        const firstApi = { verifyCustomerAccount: vi.fn(() => oldResponse.promise) };
        const secondApi = { verifyCustomerAccount: vi.fn().mockRejectedValue(missingPassword()) };
        const onSuccess = vi.fn();
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={firstApi as never}
                    token="synthetic-link"
                    onSuccess={onSuccess}
                />,
            ),
        );
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={secondApi as never}
                    token="synthetic-link"
                    onSuccess={onSuccess}
                />,
            ),
        );
        await settle(() => oldResponse.reject(invalidLink()));
        expect(secondApi.verifyCustomerAccount).toHaveBeenCalledOnce();
        expect(host.textContent).toContain('设置登录密码');
        expect(host.textContent).not.toContain('无法完成验证');
    });

    it('keeps verified status when recovery fails and retries only recovery without consuming the link again', async () => {
        const verifyCustomerAccount = vi
            .fn()
            .mockRejectedValueOnce(missingPassword())
            .mockResolvedValueOnce(undefined);
        const api = { verifyCustomerAccount, refreshCustomerVerification: vi.fn() };
        const onSuccess = vi
            .fn()
            .mockRejectedValueOnce(new Error('Synthetic read failed'))
            .mockResolvedValueOnce(undefined);
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-link"
                    onSuccess={onSuccess}
                />,
            ),
        );
        completePasswordInput('short');
        await settle(submit);
        expect(verifyCustomerAccount).toHaveBeenCalledOnce();
        expect(element('[role="alert"]').textContent).toContain('至少需要');
        completePasswordInput();
        await settle(submit);
        expect(verifyCustomerAccount).toHaveBeenCalledTimes(2);
        expect(verifyCustomerAccount.mock.calls[1][1]).toBe('local-synthetic-password');
        expect(element('.auth-result h1').textContent).toBe('邮箱已验证');
        expect(element('[role="alert"]').textContent).toContain('登录状态暂未恢复');
        expect(host.textContent).not.toContain('无法完成验证');
        await settle(() => element<HTMLButtonElement>('.auth-result button').click());
        expect(onSuccess).toHaveBeenCalledTimes(2);
        expect(verifyCustomerAccount).toHaveBeenCalledTimes(2);
        expect(api.refreshCustomerVerification).not.toHaveBeenCalled();
    });

    it('does not complete authentication after leaving a pending verification form', async () => {
        const response = deferred();
        const verifyCustomerAccount = vi.fn((..._args: unknown[]) => response.promise);
        const onSuccess = vi.fn();
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={{ verifyCustomerAccount } as never}
                    token="synthetic-link"
                    onSuccess={onSuccess}
                />,
            ),
        );
        const signal = verifyCustomerAccount.mock.calls[0][2] as AbortSignal;
        await settle(() => root.render(null));
        expect(signal.aborted).toBe(true);
        await settle(response.resolve);
        expect(onSuccess).not.toHaveBeenCalled();
    });
});

describe('authentication form timeout presentation', () => {
    it.each(['register', 'verification', 'resend'] as const)(
        'releases %s after an unknown timeout without replay',
        async mode => {
            vi.useFakeTimers();
            const request = vi.fn(
                () =>
                    new Promise<void>((_resolve, reject) => {
                        setTimeout(() => reject(new ShopApiTimeoutError('Synthetic timeout', true)), 20_000);
                    }),
            );
            if (mode === 'register') {
                const api = {
                    registerCustomerAccount: request,
                    referralProgram: vi.fn().mockResolvedValue({ enabled: false }),
                };
                await settle(() =>
                    root.render(
                        <AuthPresentationContext.Provider
                            value={{ navigate: vi.fn(), onSubmittingChange: vi.fn() }}
                        >
                            <RegisterPage {...props} api={api as never} onContentTarget={vi.fn()} />
                        </AuthPresentationContext.Provider>,
                    ),
                );
                completeRegistrationInput();
                await settle(submit);
            } else {
                const api = {
                    verifyCustomerAccount:
                        mode === 'verification' ? request : vi.fn().mockRejectedValue(invalidLink()),
                    refreshCustomerVerification: request,
                };
                await settle(() =>
                    root.render(
                        <VerifyAccountPage
                            {...props}
                            api={api as never}
                            token="synthetic-link"
                            onSuccess={vi.fn()}
                        />,
                    ),
                );
                if (mode === 'resend') {
                    element<HTMLInputElement>('input[name="emailAddress"]').value = 'local@example.invalid';
                    await settle(submit);
                }
            }
            await act(async () => {
                await vi.advanceTimersByTimeAsync(20_000);
            });
            expect(request).toHaveBeenCalledOnce();
            expect(
                element(mode === 'verification' ? '.auth-result' : '[role="alert"]').textContent,
            ).toContain('请求超时，提交结果暂未确认');
            expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
            expect(host.querySelector('[aria-busy="true"]')).toBeNull();
        },
    );
});

describe('email-link presentation and recovery', () => {
    it('keeps navigation available while verification is pending and does not replay it', async () => {
        const response = deferred();
        const verifyCustomerAccount = vi.fn(() => response.promise);
        const api = { verifyCustomerAccount };
        await settle(() =>
            root.render(
                <VerifyAccountPage
                    {...props}
                    api={api as never}
                    token="synthetic-link"
                    onSuccess={vi.fn()}
                />,
            ),
        );
        expect(host.querySelector('.auth-page-register')).not.toBeNull();
        expect(element('[role="status"]').textContent).toContain('正在核对验证链接');
        const back = Array.from(host.querySelectorAll('button')).find(
            button => button.textContent === '返回登录',
        );
        expect(back).toBeDefined();
        await settle(() => back?.click());
        expect(router.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/login' }));
        expect(verifyCustomerAccount).toHaveBeenCalledOnce();
    });

    it.each(['network', 'expired', 'missing'] as const)(
        'offers the appropriate recovery for a %s link',
        async kind => {
            const verifyCustomerAccount = vi
                .fn()
                .mockRejectedValue(
                    kind === 'expired'
                        ? new ShopApiError('VERIFICATION_TOKEN_EXPIRED_ERROR', 'Synthetic expired link')
                        : new TypeError('Load failed'),
                );
            const refreshCustomerVerification = vi.fn();
            await settle(() =>
                root.render(
                    <VerifyAccountPage
                        {...props}
                        api={{ verifyCustomerAccount, refreshCustomerVerification } as never}
                        token={kind === 'missing' ? undefined : 'synthetic-link'}
                        onSuccess={vi.fn()}
                    />,
                ),
            );
            expect(element<HTMLDetailsElement>('.auth-verification-recovery').open).toBe(kind !== 'network');
            expect(host.querySelector('[role="status"]')).toBeNull();
            expect(verifyCustomerAccount).toHaveBeenCalledTimes(kind === 'missing' ? 0 : 1);
            expect(refreshCustomerVerification).not.toHaveBeenCalled();
            if (kind === 'network') expect(host.textContent).toContain('网络连接失败');
        },
    );
});

it('does not attach a resend receipt or cooldown to a different email draft', async () => {
    const response = deferred();
    const refreshCustomerVerification = vi.fn(() => response.promise);
    await settle(() =>
        root.render(
            <VerifyAccountPage
                {...props}
                api={
                    {
                        verifyCustomerAccount: vi.fn().mockRejectedValue(invalidLink()),
                        refreshCustomerVerification,
                    } as never
                }
                token="synthetic-link"
                onSuccess={vi.fn()}
            />,
        ),
    );
    const email = element<HTMLInputElement>('input[name="emailAddress"]');
    email.value = 'first@example.invalid';
    await settle(submit);
    email.value = 'changed@example.invalid';
    await settle(response.resolve);
    expect(refreshCustomerVerification).toHaveBeenCalledOnce();
    expect(host.querySelector('.auth-success-message')).toBeNull();
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    expect(host.textContent).not.toContain('60 秒');
});
