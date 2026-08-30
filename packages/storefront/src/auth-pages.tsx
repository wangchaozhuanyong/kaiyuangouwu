import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    CircleAlert,
    CircleCheck,
    Eye,
    EyeOff,
    Fingerprint,
    Gift,
    LockKeyhole,
    Mail,
    UserRound,
} from 'lucide-react';
import { CSSProperties, FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ShopApi, ShopApiError } from './api';
import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    validateAccountPassword,
} from './auth-validation';
import { authVisualAccentColor, authVisualOverlayColor, resolveAuthVisualMessage } from './auth-visual';
import {
    attributionWithinWindow,
    captureReferralAttribution,
    normalizeReferralCode,
    ReferralSource,
} from './referral-attribution';
import { isReferralClientFeatureEnabled } from './referral-client-feature';
import { storefrontWebpUrl } from './responsive-image';
import {
    AUTH_HERO_FALLBACK_IMAGE,
    AUTH_HERO_IMAGE,
    AUTH_LOGIN_HERO_FALLBACK_IMAGE,
    AUTH_LOGIN_HERO_IMAGE,
    AUTH_REGISTER_HERO_FALLBACK_IMAGE,
    AUTH_REGISTER_HERO_IMAGE,
} from './storefront-images';
import { routeNavigateOptions } from './storefront-router';
import { SafeImage } from './storefront-ui/product-display';
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
        if (
            error.authenticationError === 'STOREFRONT_INVALID_CREDENTIALS' ||
            error.authenticationError === 'STOREFRONT_ACCOUNT_NOT_FOUND' ||
            error.authenticationError === 'STOREFRONT_INVALID_PASSWORD'
        ) {
            return isZh ? '电子邮箱或密码错误，请检查后重试' : 'The email address or password is incorrect';
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

export function verificationRequiresPassword(error: unknown): boolean {
    return error instanceof ShopApiError && error.errorCode === 'MISSING_PASSWORD_ERROR';
}

export function verificationErrorMessage(error: unknown, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    if (error instanceof ShopApiError) {
        if (error.errorCode === 'VERIFICATION_TOKEN_EXPIRED_ERROR') {
            return isZh
                ? '验证链接已过期，请重新发送验证邮件'
                : 'This verification link has expired. Request a new verification email.';
        }
        if (error.errorCode === 'VERIFICATION_TOKEN_INVALID_ERROR') {
            return isZh
                ? '验证链接无效或已经使用'
                : 'This verification link is invalid or has already been used.';
        }
        if (error.errorCode === 'PASSWORD_VALIDATION_ERROR') {
            return isZh
                ? '密码不符合安全要求，请重新设置'
                : 'The password does not meet the security requirements.';
        }
        return isZh ? `验证失败（错误代码：${error.errorCode}）` : error.message;
    }
    if (isNetworkError(error)) {
        return isZh
            ? '网络连接失败，请检查网络后重试'
            : 'Network connection failed. Check your connection and try again.';
    }
    return error instanceof Error
        ? isZh
            ? `验证失败：${error.message}`
            : error.message
        : isZh
          ? '无法完成验证，请稍后重试'
          : 'Verification failed. Please try again later.';
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
    logoUrl?: string | null;
    onBack: () => void;
}

interface AuthLegalProps {
    legalContent?: StorefrontContentBlock;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}

interface AuthVisualProps {
    authVisualContent?: StorefrontContentBlock;
}

interface AuthCompletionProps {
    onSuccess: () => Promise<void>;
}

function formString(data: FormData, name: string): string {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
}

export function LoginPage({
    api,
    language,
    storefrontName,
    logoUrl,
    legalContent,
    authVisualContent,
    onBack,
    onSuccess,
    onContentTarget,
}: AuthPageBaseProps & AuthLegalProps & AuthCompletionProps & AuthVisualProps) {
    const navigate = useNavigate();
    const navigateTo = (route: AuthRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setError('');
        try {
            await api.login(formString(data, 'emailAddress'), formString(data, 'password'));
            await onSuccess();
        } catch (requestError) {
            setError(loginErrorMessage(requestError, language));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout
            title={isZh ? '登录' : 'Sign in'}
            heroVariant="login"
            heroContent={authVisualContent}
            {...{ language, storefrontName, logoUrl, onBack }}
        >
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
                    onClick={() => navigateTo({ name: 'forgot-password' })}
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
                onClick={() => navigateTo({ name: 'register' })}
            />
            <AuthLegalNotice content={legalContent} language={language} onContentTarget={onContentTarget} />
        </AuthLayout>
    );
}

export function RegisterPage({
    api,
    language,
    storefrontName,
    logoUrl,
    legalContent,
    authVisualContent,
    onBack,
    onContentTarget,
}: AuthPageBaseProps & AuthLegalProps & AuthVisualProps) {
    const navigate = useNavigate();
    const navigateTo = (route: AuthRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [registeredEmail, setRegisteredEmail] = useState('');
    const [error, setError] = useState('');
    const [resendMessage, setResendMessage] = useState('');
    const [resendSeconds, setResendSeconds] = useState(0);
    const [referralEnabled, setReferralEnabled] = useState(false);
    const [inviteCode, setInviteCode] = useState('');
    const [inviteSource, setInviteSource] = useState<ReferralSource>('CODE');
    const [inviteStatus, setInviteStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');

    useEffect(() => {
        const controller = new AbortController();
        void api
            .referralProgram(controller.signal)
            .then(program => {
                setReferralEnabled(isReferralClientFeatureEnabled(program));
                const captured = attributionWithinWindow(
                    captureReferralAttribution(),
                    program.attributionWindowDays,
                );
                if (captured) {
                    setInviteCode(captured.code);
                    setInviteSource(captured.source);
                }
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [api]);

    useEffect(() => {
        if (resendSeconds <= 0) return;
        const timeout = window.setTimeout(() => setResendSeconds(seconds => seconds - 1), 1000);
        return () => window.clearTimeout(timeout);
    }, [resendSeconds]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const fullName = formString(data, 'fullName').trim();
        const { firstName, lastName } = splitCustomerName(fullName, language);
        if (!firstName || !lastName) {
            setError(isZh ? '请输入完整姓名' : 'Enter your full name');
            return;
        }
        const password = formString(data, 'password');
        const passwordError = validateAccountPassword(
            password,
            formString(data, 'confirmPassword'),
            language,
        );
        if (passwordError) {
            setError(passwordError);
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            const emailAddress = formString(data, 'emailAddress').trim();
            const submittedInviteCode = referralEnabled
                ? normalizeReferralCode(formString(data, 'inviteCode'))
                : '';
            if (submittedInviteCode && !(await api.validateReferralInviteCode(submittedInviteCode))) {
                setInviteStatus('invalid');
                setError(isZh ? '邀请码无效，请检查后重试' : 'This invitation code is invalid');
                return;
            }
            await api.registerCustomerAccount(
                {
                    emailAddress,
                    firstName,
                    lastName,
                    password,
                },
                submittedInviteCode || undefined,
                submittedInviteCode ? inviteSource : undefined,
            );
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
        <AuthLayout
            title={isZh ? '注册' : 'Create account'}
            heroVariant="register"
            heroContent={authVisualContent}
            {...{ language, storefrontName, logoUrl, onBack }}
        >
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
                        onClick={() => navigateTo({ name: 'login' })}
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
                        {referralEnabled && (
                            <>
                                <Field
                                    name="inviteCode"
                                    label={isZh ? '邀请码（选填）' : 'Invitation code (optional)'}
                                    autoComplete="off"
                                    maxLength={12}
                                    icon={<Gift />}
                                    required={false}
                                    value={inviteCode}
                                    onChange={value => {
                                        setInviteCode(normalizeReferralCode(value));
                                        setInviteSource('CODE');
                                        setInviteStatus('idle');
                                    }}
                                    onBlur={value => {
                                        const code = normalizeReferralCode(value);
                                        if (!code) {
                                            setInviteStatus('idle');
                                            return;
                                        }
                                        setInviteStatus('checking');
                                        void api
                                            .validateReferralInviteCode(code)
                                            .then(valid => setInviteStatus(valid ? 'valid' : 'invalid'))
                                            .catch(() => setInviteStatus('idle'));
                                    }}
                                />
                                {inviteStatus !== 'idle' && (
                                    <small
                                        className={
                                            inviteStatus === 'invalid' ? 'form-error' : 'auth-success-message'
                                        }
                                        role={inviteStatus === 'invalid' ? 'alert' : 'status'}
                                    >
                                        {inviteStatus === 'checking'
                                            ? isZh
                                                ? '正在验证邀请码…'
                                                : 'Checking invitation code…'
                                            : inviteStatus === 'valid'
                                              ? isZh
                                                  ? '邀请码有效，注册后将自动绑定邀请关系'
                                                  : 'Valid code. Your referral will be linked after registration.'
                                              : isZh
                                                ? '邀请码无效，不填写也可以正常注册'
                                                : 'Invalid code. You can leave this field empty.'}
                                    </small>
                                )}
                            </>
                        )}
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
                        onClick={() => navigateTo({ name: 'login' })}
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
    logoUrl,
    token,
    onBack,
    onSuccess,
}: AuthPageBaseProps & AuthCompletionProps & { token?: string }) {
    const navigate = useNavigate();
    const navigateTo = (route: AuthRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const [error, setError] = useState('');
    const [requiresPassword, setRequiresPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const [resendError, setResendError] = useState('');
    const [resendMessage, setResendMessage] = useState('');
    const attempted = useRef(false);

    const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!token) return;
        const data = new FormData(event.currentTarget);
        const password = formString(data, 'password');
        const passwordError = validateAccountPassword(
            password,
            formString(data, 'confirmPassword'),
            language,
        );
        if (passwordError) {
            setError(passwordError);
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            await api.verifyCustomerAccount(token, password);
            await onSuccess();
        } catch (requestError) {
            if (
                requestError instanceof ShopApiError &&
                (requestError.errorCode === 'VERIFICATION_TOKEN_EXPIRED_ERROR' ||
                    requestError.errorCode === 'VERIFICATION_TOKEN_INVALID_ERROR')
            ) {
                setRequiresPassword(false);
            }
            setError(verificationErrorMessage(requestError, language));
        } finally {
            setSubmitting(false);
        }
    };

    const resend = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setResending(true);
        setResendError('');
        setResendMessage('');
        try {
            await api.refreshCustomerVerification(formString(data, 'emailAddress').trim());
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
            .catch(requestError => {
                if (verificationRequiresPassword(requestError)) {
                    setRequiresPassword(true);
                    setError('');
                    return;
                }
                setError(verificationErrorMessage(requestError, language));
            });
    }, [api, language, onSuccess, token]);

    return (
        <AuthLayout
            title={isZh ? '验证邮箱' : 'Verify email'}
            {...{ language, storefrontName, logoUrl, onBack }}
        >
            <AuthResult
                icon={requiresPassword ? <LockKeyhole /> : error ? <CircleAlert /> : <Fingerprint />}
                title={
                    requiresPassword
                        ? isZh
                            ? '设置登录密码'
                            : 'Set your sign-in password'
                        : error
                          ? isZh
                              ? '无法完成验证'
                              : 'Verification failed'
                          : isZh
                            ? '正在验证'
                            : 'Verifying your email'
                }
                detail={
                    requiresPassword
                        ? isZh
                            ? '该账号由后台开户，验证邮箱后请设置首次登录密码'
                            : 'This account was created by an administrator. Set your first password to finish verification.'
                        : error ||
                          (isZh
                              ? '请稍候，完成后将自动登录'
                              : 'Please wait. You will be signed in automatically.')
                }
            >
                {requiresPassword ? (
                    <form className="auth-recovery-form" onSubmit={event => void submitPassword(event)}>
                        <Field
                            name="password"
                            label={isZh ? '登录密码' : 'Sign-in password'}
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
                            label={isZh ? '确认登录密码' : 'Confirm sign-in password'}
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
                            idle={isZh ? '设置密码并完成验证' : 'Set password and verify'}
                            busy={isZh ? '验证中' : 'Verifying'}
                        />
                    </form>
                ) : error ? (
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
                            onClick={() => navigateTo({ name: 'login' })}
                        >
                            {isZh ? '返回登录' : 'Back to sign in'}
                        </button>
                    </>
                ) : null}
            </AuthResult>
        </AuthLayout>
    );
}

export function ForgotPasswordPage({ api, language, storefrontName, logoUrl, onBack }: AuthPageBaseProps) {
    const navigate = useNavigate();
    const navigateTo = (route: AuthRoute) => void navigate(routeNavigateOptions(route) as never);
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
            await api.requestPasswordReset(formString(data, 'emailAddress').trim());
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
        <AuthLayout
            title={isZh ? '忘记密码' : 'Forgot password'}
            {...{ language, storefrontName, logoUrl, onBack }}
        >
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
                        onClick={() => navigateTo({ name: 'login' })}
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
    logoUrl,
    token,
    onBack,
    onSuccess,
}: AuthPageBaseProps & AuthCompletionProps & { token?: string }) {
    const navigate = useNavigate();
    const navigateTo = (route: AuthRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(
        token ? '' : isZh ? '重置链接缺少令牌' : 'The reset link is missing its token',
    );
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!token) return;
        const data = new FormData(event.currentTarget);
        const password = formString(data, 'password');
        const passwordError = validateAccountPassword(
            password,
            formString(data, 'confirmPassword'),
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
        <AuthLayout
            title={isZh ? '重置密码' : 'Reset password'}
            {...{ language, storefrontName, logoUrl, onBack }}
        >
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
                        onClick={() => navigateTo({ name: 'forgot-password' })}
                    />
                </AuthResult>
            )}
        </AuthLayout>
    );
}

function AuthLayout({
    title,
    heroVariant = 'default',
    language,
    storefrontName,
    logoUrl,
    heroContent,
    onBack,
    children,
}: {
    title: string;
    heroVariant?: 'default' | 'login' | 'register';
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl?: string | null;
    heroContent?: StorefrontContentBlock;
    onBack: () => void;
    children: ReactNode;
}) {
    const hero =
        heroVariant === 'login'
            ? { src: AUTH_LOGIN_HERO_IMAGE, fallbackSrc: AUTH_LOGIN_HERO_FALLBACK_IMAGE }
            : heroVariant === 'register'
              ? { src: AUTH_REGISTER_HERO_IMAGE, fallbackSrc: AUTH_REGISTER_HERO_FALLBACK_IMAGE }
              : { src: AUTH_HERO_IMAGE, fallbackSrc: AUTH_HERO_FALLBACK_IMAGE };
    const authVisualVariant = heroVariant === 'login' || heroVariant === 'register' ? heroVariant : null;
    const heroMessage = authVisualVariant
        ? resolveAuthVisualMessage(heroContent, authVisualVariant, language)
        : null;
    const heroStyle = authVisualVariant
        ? ({
              '--auth-hero-text-color': heroContent?.textColor ?? '#ffffff',
              '--auth-hero-overlay-color': authVisualOverlayColor(heroContent),
              '--auth-hero-accent-color': authVisualAccentColor(heroContent, authVisualVariant),
          } as CSSProperties)
        : undefined;
    const managedHeroSrc = heroContent?.imageUrl?.trim();

    return (
        <main className={`page subpage auth-page auth-page-${heroVariant}`} aria-label={title}>
            <section className={`auth-hero auth-hero-${heroVariant}`} style={heroStyle}>
                <SafeImage
                    src={managedHeroSrc || hero.src}
                    fallbackSrc={hero.fallbackSrc}
                    alt=""
                    imageKind="hero"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                />
                <header className="auth-hero-header">
                    <button
                        className="auth-back-button"
                        type="button"
                        onClick={onBack}
                        aria-label={language === 'zh' ? '返回' : 'Back'}
                    >
                        <ArrowLeft aria-hidden="true" />
                    </button>
                </header>
                <div
                    className={`auth-hero-message${
                        heroMessage ? ' auth-hero-message-managed' : ' auth-hero-message-brand-only'
                    }`}
                >
                    <div className="auth-hero-kicker">
                        {heroMessage ? (
                            <span className="auth-hero-eyebrow">{heroMessage.eyebrow}</span>
                        ) : (
                            <div className="auth-brand-lockup">
                                <div className="auth-brand-main">
                                    {logoUrl ? (
                                        <img
                                            className="auth-brand-mark"
                                            src={storefrontWebpUrl(logoUrl, 'thumbnail')}
                                            alt={storefrontName}
                                        />
                                    ) : (
                                        <span className="auth-brand-mark" aria-hidden="true">
                                            桥
                                        </span>
                                    )}
                                    <strong>{storefrontName}</strong>
                                </div>
                                <small>
                                    {language === 'zh'
                                        ? '智联云端 · 桥接未来'
                                        : 'Cloud intelligence · Bridging tomorrow'}
                                </small>
                            </div>
                        )}
                    </div>
                    {heroMessage && (
                        <>
                            <div className="auth-hero-copy">
                                <h2>{heroMessage.title}</h2>
                                <p>{heroMessage.description}</p>
                            </div>
                            <div className="auth-hero-tags" aria-label={heroMessage.tags.join('、')}>
                                {heroMessage.tags.map(tag => (
                                    <span key={tag}>{tag}</span>
                                ))}
                            </div>
                        </>
                    )}
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
    required = true,
    value,
    onChange,
    onBlur,
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
    required?: boolean;
    value?: string;
    onChange?: (value: string) => void;
    onBlur?: (value: string) => void;
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
            required={required}
            autoComplete={autoComplete}
            minLength={minLength}
            maxLength={maxLength}
            placeholder={label}
            value={value}
            onChange={onChange ? event => onChange(event.currentTarget.value) : undefined}
            onBlur={onBlur ? event => onBlur(event.currentTarget.value) : undefined}
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
