import { ArrowLeft, CircleAlert, CircleCheck, Fingerprint } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';

import { ShopApi } from './api';
import { StorefrontContentBlock, StorefrontContentTargetType, StorefrontLanguage } from './types';

type AuthRoute = { name: 'login' | 'register' | 'forgot-password' };

interface AuthPageBaseProps {
    api: ShopApi;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onNavigate: (route: AuthRoute) => void;
}

interface AuthLegalProps {
    legalContent?: StorefrontContentBlock;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}

interface AuthCompletionProps {
    onSuccess: () => Promise<void>;
}

export function LoginPage({
    api,
    language,
    storefrontName,
    legalContent,
    onBack,
    onSuccess,
    onNavigate,
    onContentTarget,
}: AuthPageBaseProps & AuthLegalProps & AuthCompletionProps) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setError('');
        try {
            await api.login(String(data.get('emailAddress')), String(data.get('password')));
            await onSuccess();
        } catch (requestError) {
            setError(
                requestError instanceof Error ? requestError.message : isZh ? '登录失败' : 'Sign-in failed',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout title={isZh ? '登录' : 'Sign in'} {...{ language, storefrontName, onBack }}>
            <h1>{isZh ? '欢迎回来' : 'Welcome back'}</h1>
            <p>{isZh ? '登录后查看订单、地址与售后进度' : 'Sign in to view orders, addresses and support'}</p>
            <form onSubmit={event => void submit(event)}>
                <Field
                    name="emailAddress"
                    label={isZh ? '电子邮箱' : 'Email address'}
                    type="email"
                    autoComplete="email"
                />
                <Field
                    name="password"
                    label={isZh ? '密码' : 'Password'}
                    type="password"
                    autoComplete="current-password"
                />
                <button
                    className="auth-inline-link"
                    type="button"
                    onClick={() => onNavigate({ name: 'forgot-password' })}
                >
                    {isZh ? '忘记密码？' : 'Forgot password?'}
                </button>
                {error && <small className="form-error">{error}</small>}
                <SubmitButton
                    submitting={submitting}
                    idle={isZh ? '登录' : 'Sign in'}
                    busy={isZh ? '登录中' : 'Signing in'}
                />
            </form>
            <AuthSwitch
                prompt={isZh ? '还没有账户？' : 'New here?'}
                action={isZh ? '注册账户' : 'Create account'}
                onClick={() => onNavigate({ name: 'register' })}
            />
            <AuthLegalNotice content={legalContent} language={language} onContentTarget={onContentTarget} />
        </AuthLayout>
    );
}

export function RegisterPage({
    api,
    language,
    storefrontName,
    legalContent,
    onBack,
    onNavigate,
    onContentTarget,
}: AuthPageBaseProps & AuthLegalProps) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [registeredEmail, setRegisteredEmail] = useState('');
    const [error, setError] = useState('');
    const [resendMessage, setResendMessage] = useState('');

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const password = String(data.get('password'));
        if (password !== String(data.get('confirmPassword'))) {
            setError(isZh ? '两次输入的密码不一致' : 'The passwords do not match');
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            const emailAddress = String(data.get('emailAddress')).trim();
            await api.registerCustomerAccount({
                emailAddress,
                firstName: String(data.get('firstName')).trim(),
                lastName: String(data.get('lastName')).trim(),
                password,
            });
            setRegisteredEmail(emailAddress);
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '注册失败'
                      : 'Registration failed',
            );
        } finally {
            setSubmitting(false);
        }
    };

    const resend = async () => {
        setSubmitting(true);
        setError('');
        setResendMessage('');
        try {
            await api.refreshCustomerVerification(registeredEmail);
            setResendMessage(isZh ? '验证邮件已重新发送' : 'Verification email sent again');
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '发送失败'
                      : 'Could not resend email',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout title={isZh ? '注册' : 'Create account'} {...{ language, storefrontName, onBack }}>
            {registeredEmail ? (
                <AuthResult
                    icon={<CircleCheck />}
                    title={isZh ? '请查收验证邮件' : 'Check your email'}
                    detail={
                        isZh
                            ? `验证链接已发送至 ${registeredEmail}`
                            : `We sent a verification link to ${registeredEmail}`
                    }
                >
                    {resendMessage && (
                        <small className="auth-success-message" role="status">
                            {resendMessage}
                        </small>
                    )}
                    {error && <small className="form-error">{error}</small>}
                    <SubmitButton
                        type="button"
                        submitting={submitting}
                        idle={isZh ? '重新发送验证邮件' : 'Resend verification email'}
                        busy={isZh ? '发送中' : 'Sending'}
                        onClick={() => void resend()}
                    />
                    <button
                        className="auth-secondary-action"
                        type="button"
                        onClick={() => onNavigate({ name: 'login' })}
                    >
                        {isZh ? '返回登录' : 'Back to sign in'}
                    </button>
                </AuthResult>
            ) : (
                <>
                    <h1>{isZh ? '创建账户' : 'Create your account'}</h1>
                    <p>{isZh ? '注册后需通过邮件验证' : 'Email verification is required'}</p>
                    <form onSubmit={event => void submit(event)}>
                        <div className="auth-name-fields">
                            <Field
                                name="firstName"
                                label={isZh ? '名' : 'First name'}
                                autoComplete="given-name"
                                wide={false}
                            />
                            <Field
                                name="lastName"
                                label={isZh ? '姓' : 'Last name'}
                                autoComplete="family-name"
                                wide={false}
                            />
                        </div>
                        <Field
                            name="emailAddress"
                            label={isZh ? '电子邮箱' : 'Email address'}
                            type="email"
                            autoComplete="email"
                        />
                        <Field
                            name="password"
                            label={isZh ? '密码' : 'Password'}
                            type="password"
                            autoComplete="new-password"
                        />
                        <Field
                            name="confirmPassword"
                            label={isZh ? '确认密码' : 'Confirm password'}
                            type="password"
                            autoComplete="new-password"
                        />
                        {error && <small className="form-error">{error}</small>}
                        <SubmitButton
                            submitting={submitting}
                            idle={isZh ? '注册账户' : 'Create account'}
                            busy={isZh ? '注册中' : 'Creating account'}
                        />
                    </form>
                    <AuthSwitch
                        prompt={isZh ? '已有账户？' : 'Already have an account?'}
                        action={isZh ? '去登录' : 'Sign in'}
                        onClick={() => onNavigate({ name: 'login' })}
                    />
                    <AuthLegalNotice
                        content={legalContent}
                        language={language}
                        onContentTarget={onContentTarget}
                    />
                </>
            )}
        </AuthLayout>
    );
}

export function VerifyAccountPage({
    api,
    language,
    storefrontName,
    token,
    onBack,
    onSuccess,
    onNavigate,
}: AuthPageBaseProps & AuthCompletionProps & { token?: string }) {
    const isZh = language === 'zh';
    const [error, setError] = useState('');
    const attempted = useRef(false);

    useEffect(() => {
        if (attempted.current) return;
        attempted.current = true;
        if (!token) {
            setError(isZh ? '验证链接缺少令牌' : 'The verification link is missing its token');
            return;
        }
        void api
            .verifyCustomerAccount(token)
            .then(onSuccess)
            .catch(requestError => {
                setError(
                    requestError instanceof Error
                        ? requestError.message
                        : isZh
                          ? '邮箱验证失败'
                          : 'Email verification failed',
                );
            });
    }, [api, isZh, onSuccess, token]);

    return (
        <AuthLayout title={isZh ? '验证邮箱' : 'Verify email'} {...{ language, storefrontName, onBack }}>
            <AuthResult
                icon={error ? <CircleAlert /> : <Fingerprint />}
                title={
                    error
                        ? isZh
                            ? '无法完成验证'
                            : 'Verification failed'
                        : isZh
                          ? '正在验证'
                          : 'Verifying your email'
                }
                detail={
                    error ||
                    (isZh ? '请稍候，完成后将自动登录' : 'Please wait. You will be signed in automatically.')
                }
            >
                {error && (
                    <SubmitButton
                        type="button"
                        idle={isZh ? '返回登录' : 'Back to sign in'}
                        busy=""
                        submitting={false}
                        onClick={() => onNavigate({ name: 'login' })}
                    />
                )}
            </AuthResult>
        </AuthLayout>
    );
}

export function ForgotPasswordPage({ api, language, storefrontName, onBack, onNavigate }: AuthPageBaseProps) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [requested, setRequested] = useState(false);
    const [error, setError] = useState('');
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setError('');
        try {
            await api.requestPasswordReset(String(data.get('emailAddress')).trim());
            setRequested(true);
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '发送重置邮件失败'
                      : 'Could not send the reset email',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout title={isZh ? '忘记密码' : 'Forgot password'} {...{ language, storefrontName, onBack }}>
            {requested ? (
                <AuthResult
                    icon={<CircleCheck />}
                    title={isZh ? '请查收邮件' : 'Check your email'}
                    detail={
                        isZh
                            ? '如果该邮箱已注册，你将收到密码重置链接'
                            : 'If the address is registered, a password reset link will arrive shortly.'
                    }
                >
                    <SubmitButton
                        type="button"
                        idle={isZh ? '返回登录' : 'Back to sign in'}
                        busy=""
                        submitting={false}
                        onClick={() => onNavigate({ name: 'login' })}
                    />
                </AuthResult>
            ) : (
                <>
                    <h1>{isZh ? '重置登录密码' : 'Reset your password'}</h1>
                    <p>
                        {isZh
                            ? '输入注册邮箱，我们将发送重置链接'
                            : 'Enter your email to receive a reset link'}
                    </p>
                    <form onSubmit={event => void submit(event)}>
                        <Field
                            name="emailAddress"
                            label={isZh ? '电子邮箱' : 'Email address'}
                            type="email"
                            autoComplete="email"
                        />
                        {error && <small className="form-error">{error}</small>}
                        <SubmitButton
                            submitting={submitting}
                            idle={isZh ? '发送重置邮件' : 'Send reset email'}
                            busy={isZh ? '发送中' : 'Sending'}
                        />
                    </form>
                </>
            )}
        </AuthLayout>
    );
}

export function ResetPasswordPage({
    api,
    language,
    storefrontName,
    token,
    onBack,
    onSuccess,
    onNavigate,
}: AuthPageBaseProps & AuthCompletionProps & { token?: string }) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(
        token ? '' : isZh ? '重置链接缺少令牌' : 'The reset link is missing its token',
    );
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!token) return;
        const data = new FormData(event.currentTarget);
        const password = String(data.get('password'));
        if (password !== String(data.get('confirmPassword'))) {
            setError(isZh ? '两次输入的密码不一致' : 'The passwords do not match');
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            await api.resetPassword(token, password);
            await onSuccess();
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '重置密码失败'
                      : 'Password reset failed',
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout title={isZh ? '重置密码' : 'Reset password'} {...{ language, storefrontName, onBack }}>
            <h1>{isZh ? '设置新密码' : 'Choose a new password'}</h1>
            <p>{isZh ? '新密码将立即用于登录' : 'Your new password will be active immediately'}</p>
            {token ? (
                <form onSubmit={event => void submit(event)}>
                    <Field
                        name="password"
                        label={isZh ? '新密码' : 'New password'}
                        type="password"
                        autoComplete="new-password"
                    />
                    <Field
                        name="confirmPassword"
                        label={isZh ? '确认新密码' : 'Confirm new password'}
                        type="password"
                        autoComplete="new-password"
                    />
                    {error && <small className="form-error">{error}</small>}
                    <SubmitButton
                        submitting={submitting}
                        idle={isZh ? '更新密码' : 'Update password'}
                        busy={isZh ? '提交中' : 'Updating'}
                    />
                </form>
            ) : (
                <AuthResult
                    icon={<CircleAlert />}
                    title={isZh ? '重置链接无效' : 'Invalid reset link'}
                    detail={error}
                >
                    <SubmitButton
                        type="button"
                        idle={isZh ? '重新获取链接' : 'Request another link'}
                        busy=""
                        submitting={false}
                        onClick={() => onNavigate({ name: 'forgot-password' })}
                    />
                </AuthResult>
            )}
        </AuthLayout>
    );
}

function AuthLayout({
    title,
    language,
    storefrontName,
    onBack,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <main className="page subpage login-page">
            <header className="topbar subpage-header">
                <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                    <ArrowLeft aria-hidden="true" />
                </button>
                <strong>{title}</strong>
                <span />
            </header>
            <section className="login-content">
                <span className="login-brand">{storefrontName}</span>
                {children}
            </section>
        </main>
    );
}

function Field({
    name,
    label,
    type = 'text',
    autoComplete,
    wide = true,
}: {
    name: string;
    label: string;
    type?: string;
    autoComplete?: string;
    wide?: boolean;
}) {
    return (
        <label className={wide ? 'field-wide' : undefined}>
            <span>{label}</span>
            <input name={name} type={type} required autoComplete={autoComplete} />
        </label>
    );
}

function SubmitButton({
    submitting,
    idle,
    busy,
    type = 'submit',
    onClick,
}: {
    submitting: boolean;
    idle: string;
    busy: string;
    type?: 'submit' | 'button';
    onClick?: () => void;
}) {
    return (
        <button className="primary-action wide-action" type={type} disabled={submitting} onClick={onClick}>
            {submitting ? busy : idle}
        </button>
    );
}

function AuthSwitch({ prompt, action, onClick }: { prompt: string; action: string; onClick: () => void }) {
    return (
        <div className="auth-switch">
            <span>{prompt}</span>
            <button type="button" onClick={onClick}>
                {action}
            </button>
        </div>
    );
}

function AuthResult({
    icon,
    title,
    detail,
    children,
}: {
    icon: ReactNode;
    title: string;
    detail: string;
    children: ReactNode;
}) {
    return (
        <div className="auth-result">
            <span>{icon}</span>
            <h1>{title}</h1>
            <p>{detail}</p>
            <div>{children}</div>
        </div>
    );
}

function AuthLegalNotice({
    content,
    language,
    onContentTarget,
}: {
    content?: StorefrontContentBlock;
    language: StorefrontLanguage;
    onContentTarget: AuthLegalProps['onContentTarget'];
}) {
    const items =
        content?.items.filter(
            item => item.enabled && item.targetType !== 'NONE' && item.targetValue?.trim(),
        ) ?? [];
    if (!items.length) return null;
    return (
        <small className="auth-legal-notice">
            <span>{language === 'zh' ? '继续操作前，请阅读' : 'Before continuing, review'}</span>
            <span className="auth-legal-links">
                {items.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => onContentTarget(item.targetType, item.targetValue)}
                    >
                        {item.label}
                    </button>
                ))}
            </span>
        </small>
    );
}
