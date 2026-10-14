// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApiError, ShopApiTimeoutError } from './api';
import { LoginPage, RegisterPage, VerifyAccountPage } from './auth-pages';
import { AuthPresentationContext } from './auth-presentation';
import { completeStorefrontAuthentication } from './checkout-authentication';
import { type ActiveCustomer } from './types';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
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
        expect(host.textContent).toContain('该账号尚未设置登录密码');
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
