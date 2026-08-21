import {
    ArrowLeft,
    CircleAlert,
    CircleCheck,
    Eye,
    EyeOff,
    Fingerprint,
    LockKeyhole,
    Mail,
    UserRound,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ShopApi, ShopApiError } from './api';
import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    validateAccountPassword,
} from './auth-validation';
import { StorefrontContentBlock, StorefrontContentTargetType, StorefrontLanguage } from './types';

type AuthRoute = { name: 'login' | 'register' | 'forgot-password' };

const COMMON_CHINESE_COMPOUND_SURNAMES = [
    '欧阳',
    '司马',
    '上官',
    '诸葛',
    '夏侯',
    '东方',
    '皇甫',
    '尉迟',
    '公孙',
    '慕容',
    '万俟',
    '闻人',
    '宇文',
    '长孙',
    '司徒',
    '司空',
    '令狐',
    '钟离',
    '轩辕',
    '端木',
    '百里',
    '东郭',
    '南宫',
    '呼延',
    '东门',
    '西门',
] as const;

export function splitCustomerName(
    value: string,
    language: StorefrontLanguage,
): { firstName: string; lastName: string } {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return { firstName: '', lastName: '' };

    if (language === 'zh') {
        const compactName = normalized.replace(/\s/g, '');
        const surname = COMMON_CHINESE_COMPOUND_SURNAMES.find(item => compactName.startsWith(item));
        const surnameLength = surname ? Array.from(surname).length : 1;
        const characters = Array.from(compactName);
        return {
            lastName: characters.slice(0, surnameLength).join(''),
            firstName: characters.slice(surnameLength).join(''),
        };
    }

    const parts = normalized.split(' ');
    return {
        firstName: parts.slice(0, -1).join(' '),
        lastName: parts.at(-1) ?? '',
    };
}

export function loginErrorMessage(error: unknown, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    if (error instanceof ShopApiError) {
        if (error.authenticationError === 'STOREFRONT_ACCOUNT_NOT_FOUND') {
            return isZh ? '该电子邮箱尚未注册' : 'No account was found for this email address';
        }
        if (error.authenticationError === 'STOREFRONT_INVALID_PASSWORD') {
            return isZh ? '密码错误，请重新输入' : 'The password is incorrect. Please try again';
        }
        if (error.errorCode === 'NOT_VERIFIED_ERROR') {
            return isZh
                ? '该电子邮箱尚未验证，请先查收验证邮件'
                : 'This email address has not been verified. Check your verification email first';
        }
        if (error.errorCode === 'INVALID_CREDENTIALS_ERROR') {
            return isZh ? '电子邮箱或密码错误，请检查后重试' : 'The email address or password is incorrect';
        }
        return isZh ? `登录失败（错误代码：${error.errorCode}）` : error.message;
    }
    if (isNetworkError(error)) {
        return isZh
            ? '网络连接失败，请检查网络后重试'
            : 'Network connection failed. Check your connection and try again';
    }
    return error instanceof Error
        ? isZh
            ? `登录失败：${error.message}`
            : error.message
        : isZh
          ? '登录失败，请稍后重试'
          : 'Sign-in failed. Please try again later';
}

export function registerErrorMessage(error: unknown, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    if (error instanceof ShopApiError) {
        if (error.errorCode === 'EMAIL_ADDRESS_CONFLICT_ERROR') {
            return isZh
                ? '该电子邮箱已注册，请直接登录或使用其他邮箱'
                : 'This email address is already registered. Sign in or use another email';
        }
        if (error.errorCode === 'PASSWORD_VALIDATION_ERROR') {
            return isZh
                ? '密码不符合安全要求，请重新设置'
                : 'The password does not meet the security requirements';
        }
        if (error.errorCode === 'MISSING_PASSWORD_ERROR') {
            return isZh ? '请输入密码' : 'Enter a password';
        }
        if (error.errorCode === 'NATIVE_AUTH_STRATEGY_ERROR') {
            return isZh
                ? '账户注册服务暂时不可用，请稍后重试'
                : 'Account registration is temporarily unavailable. Please try again later';
        }
        return isZh ? `注册失败（错误代码：${error.errorCode}）` : error.message;
    }
    if (isNetworkError(error)) {
        return isZh
            ? '网络连接失败，请检查网络后重试'
            : 'Network connection failed. Check your connection and try again';
    }
    return error instanceof Error
        ? isZh
            ? `注册失败：${error.message}`
            : error.message
        : isZh
          ? '注册失败，请稍后重试'
          : 'Registration failed. Please try again later';
}

function isNetworkError(error: unknown): boolean {
    return (
        error instanceof TypeError ||
        (error instanceof Error &&
            /failed to fetch|network(?:error| request)?|load failed/i.test(error.message))
    );
}

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
            setError(loginErrorMessage(requestError, language));
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
                    icon={<Mail />}
                />
                <Field
                    name="password"
                    label={isZh ? '密码' : 'Password'}
                    type="password"
                    autoComplete="current-password"
                    icon={<LockKeyhole />}
                    revealPassword
                    language={language}
                />
                <button
                    className="auth-inline-link"
                    type="button"
                    onClick={() => onNavigate({ name: 'forgot-password' })}
                >
                    {isZh ? '忘记密码？' : 'Forgot password?'}
                </button>
                {error && (
                    <small className="form-error" role="alert">
                        {error}
                    </small>
                )}
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
    const [resendSeconds, setResendSeconds] = useState(0);

    useEffect(() => {
        if (resendSeconds <= 0) return;
        const timeout = window.setTimeout(() => setResendSeconds(seconds => seconds - 1), 1000);
        return () => window.clearTimeout(timeout);
    }, [resendSeconds]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const fullName = String(data.get('fullName')).trim();
        const { firstName, lastName } = splitCustomerName(fullName, language);
        if (!firstName || !lastName) {
            setError(isZh ? '请输入完整姓名' : 'Enter your full name');
            return;
        }
        const password = String(data.get('password'));
        const passwordError = validateAccountPassword(
            password,
            String(data.get('confirmPassword')),
            language,
        );
        if (passwordError) {
            setError(passwordError);
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            const emailAddress = String(data.get('emailAddress')).trim();
            await api.registerCustomerAccount({
                emailAddress,
                firstName,
                lastName,
                password,
            });
            setRegisteredEmail(emailAddress);
            setResendSeconds(60);
        } catch (requestError) {
            setError(registerErrorMessage(requestError, language));
        } finally {
            setSubmitting(false);
        }
    };

    const resend = async () => {
        if (resendSeconds > 0) return;
        setSubmitting(true);
        setError('');
        setResendMessage('');
        try {
            await api.refreshCustomerVerification(registeredEmail);
            setResendMessage(isZh ? '验证邮件已重新发送' : 'Verification email sent again');
            setResendSeconds(60);
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
                    {error && (
                        <small className="form-error" role="alert">
                            {error}
                        </small>
                    )}
                    <SubmitButton
                        type="button"
                        submitting={submitting}
                        disabled={resendSeconds > 0}
                        idle={
                            resendSeconds > 0
                                ? isZh
                                    ? `${resendSeconds} 秒后可重新发送`
                                    : `Resend in ${resendSeconds}s`
                                : isZh
                                  ? '重新发送验证邮件'
                                  : 'Resend verification email'
                        }
                        busy={isZh ? '发送中' : 'Sending'}
                        onClick={() => void resend()}
                    />
                    <button
                        className="auth-secondary-action"
                        type="button"
                        onClick={() => {
                            setRegisteredEmail('');
                            setResendMessage('');
                            setError('');
                            setResendSeconds(0);
                        }}
                    >
                        {isZh ? '修改电子邮箱' : 'Change email address'}
                    </button>
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
                    <h1>{isZh ? '注册' : 'Create your account'}</h1>
                    <p>
                        {isZh
                            ? '验证邮箱后即可完成注册'
                            : 'Verify your email to finish creating your account'}
                    </p>
                    <form onSubmit={event => void submit(event)}>
                        <Field
                            name="fullName"
                            label={isZh ? '姓名' : 'Full name'}
                            autoComplete="name"
                            icon={<UserRound />}
                        />
                        <Field
                            name="emailAddress"
                            label={isZh ? '电子邮箱' : 'Email address'}
                            type="email"
                            autoComplete="email"
                            icon={<Mail />}
                        />
                        <Field
                            name="password"
                            label={isZh ? '密码' : 'Password'}
                            type="password"
                            autoComplete="new-password"
                            minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                            maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                            icon={<LockKeyhole />}
                            revealPassword
                            language={language}
                        />
                        <Field
                            name="confirmPassword"
                            label={isZh ? '确认密码' : 'Confirm password'}
                            type="password"
                            autoComplete="new-password"
                            minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                            maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                            icon={<LockKeyhole />}
                            revealPassword
                            language={language}
                        />
                        {error && (
                            <small className="form-error" role="alert">
                                {error}
                            </small>
                        )}
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
                        prefix={isZh ? '注册即表示您同意我们的' : 'By registering, you agree to our'}
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
    const [resending, setResending] = useState(false);
    const [resendError, setResendError] = useState('');
    const [resendMessage, setResendMessage] = useState('');
    const attempted = useRef(false);

    const resend = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setResending(true);
        setResendError('');
        setResendMessage('');
        try {
            await api.refreshCustomerVerification(String(data.get('emailAddress')).trim());
            setResendMessage(
                isZh
                    ? '如果该邮箱仍待验证，新的验证邮件将很快送达'
                    : 'If this account still needs verification, a new email will arrive shortly.',
            );
        } catch (requestError) {
            setResendError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '无法重新发送验证邮件'
                      : 'Could not resend the verification email',
            );
        } finally {
            setResending(false);
        }
    };

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
            .catch(() => {
                setError(
                    isZh
                        ? '验证链接无效、已过期或已经使用'
                        : 'This verification link is invalid, expired, or has already been used.',
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
                    <>
                        <form className="auth-recovery-form" onSubmit={event => void resend(event)}>
                            <Field
                                name="emailAddress"
                                label={isZh ? '注册邮箱' : 'Account email'}
                                type="email"
                                autoComplete="email"
                                icon={<Mail />}
                            />
                            {resendMessage && (
                                <small className="auth-success-message" role="status">
                                    {resendMessage}
                                </small>
                            )}
                            {resendError && (
                                <small className="form-error" role="alert">
                                    {resendError}
                                </small>
                            )}
                            <SubmitButton
                                submitting={resending}
                                idle={isZh ? '重新发送验证邮件' : 'Resend verification email'}
                                busy={isZh ? '发送中' : 'Sending'}
                            />
                        </form>
                        <button
                            className="auth-secondary-action"
                            type="button"
                            onClick={() => onNavigate({ name: 'login' })}
                        >
                            {isZh ? '返回登录' : 'Back to sign in'}
                        </button>
                    </>
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
                            icon={<Mail />}
                        />
                        {error && (
                            <small className="form-error" role="alert">
                                {error}
                            </small>
                        )}
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
        const passwordError = validateAccountPassword(
            password,
            String(data.get('confirmPassword')),
            language,
        );
        if (passwordError) {
            setError(passwordError);
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
                        minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                        maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                        icon={<LockKeyhole />}
                        revealPassword
                        language={language}
                    />
                    <Field
                        name="confirmPassword"
                        label={isZh ? '确认新密码' : 'Confirm new password'}
                        type="password"
                        autoComplete="new-password"
                        minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                        maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                        icon={<LockKeyhole />}
                        revealPassword
                        language={language}
                    />
                    {error && (
                        <small className="form-error" role="alert">
                            {error}
                        </small>
                    )}
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
        <main className="page subpage auth-page" aria-label={title}>
            <section className="auth-hero">
                <picture>
                    <source srcSet="/storefront/auth-ai-bridge-hero.webp" type="image/webp" />
                    <img
                        src="/storefront/auth-ai-bridge-hero.jpg"
                        width={1659}
                        height={948}
                        alt=""
                        decoding="async"
                        fetchPriority="high"
                    />
                </picture>
                <button
                    className="auth-back-button"
                    type="button"
                    onClick={onBack}
                    aria-label={language === 'zh' ? '返回' : 'Back'}
                >
                    <ArrowLeft aria-hidden="true" />
                </button>
                <div className="auth-brand-lockup">
                    <div className="auth-brand-main">
                        <span className="auth-brand-mark" aria-hidden="true">
                            桥
                        </span>
                        <strong>{storefrontName}</strong>
                    </div>
                    <small>
                        {language === 'zh' ? '智联云端 · 桥接未来' : 'Cloud intelligence · Bridging tomorrow'}
                    </small>
                </div>
            </section>
            <section className="login-content">
                <div className="auth-card-content">{children}</div>
            </section>
        </main>
    );
}

function Field({
    name,
    label,
    type = 'text',
    autoComplete,
    minLength,
    maxLength,
    icon,
    revealPassword = false,
    language = 'en',
    wide = true,
}: {
    name: string;
    label: string;
    type?: string;
    autoComplete?: string;
    minLength?: number;
    maxLength?: number;
    icon?: ReactNode;
    revealPassword?: boolean;
    language?: StorefrontLanguage;
    wide?: boolean;
}) {
    const inputId = useId();
    const [passwordVisible, setPasswordVisible] = useState(false);
    const hasPasswordToggle = type === 'password' && revealPassword;
    const inputType = hasPasswordToggle && passwordVisible ? 'text' : type;
    const passwordToggleLabel = passwordVisible
        ? language === 'zh'
            ? '隐藏密码'
            : 'Hide password'
        : language === 'zh'
          ? '显示密码'
          : 'Show password';
    const input = (
        <input
            id={inputId}
            name={name}
            type={inputType}
            required
            autoComplete={autoComplete}
            minLength={minLength}
            maxLength={maxLength}
            placeholder={label}
        />
    );

    return (
        <div className={`auth-field${wide ? ' field-wide' : ''}`}>
            <label className="visually-hidden" htmlFor={inputId}>
                {label}
            </label>
            <div className={`auth-input-shell${hasPasswordToggle ? ' auth-password-input' : ''}`}>
                {icon && (
                    <span className="auth-field-icon" aria-hidden="true">
                        {icon}
                    </span>
                )}
                {hasPasswordToggle ? (
                    <>
                        {input}
                        <button
                            className="auth-password-toggle"
                            type="button"
                            aria-label={passwordToggleLabel}
                            aria-pressed={passwordVisible}
                            onClick={() => setPasswordVisible(visible => !visible)}
                        >
                            {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </button>
                    </>
                ) : (
                    input
                )}
            </div>
        </div>
    );
}

function SubmitButton({
    submitting,
    idle,
    busy,
    type = 'submit',
    disabled = false,
    onClick,
}: {
    submitting: boolean;
    idle: string;
    busy: string;
    type?: 'submit' | 'button';
    disabled?: boolean;
    onClick?: () => void;
}) {
    return (
        <button
            className="primary-action wide-action"
            type={type}
            disabled={submitting || disabled}
            aria-busy={submitting}
            onClick={onClick}
        >
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
    prefix,
    onContentTarget,
}: {
    content?: StorefrontContentBlock;
    language: StorefrontLanguage;
    prefix?: string;
    onContentTarget: AuthLegalProps['onContentTarget'];
}) {
    const items =
        content?.items.filter(
            item => item.enabled && item.targetType !== 'NONE' && item.targetValue?.trim(),
        ) ?? [];
    if (!items.length) return null;
    return (
        <small className="auth-legal-notice">
            <span>{prefix ?? (language === 'zh' ? '继续操作前，请阅读' : 'Before continuing, review')}</span>
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
