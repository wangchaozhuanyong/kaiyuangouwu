import { useNavigate } from '@tanstack/react-router';
import {
    ChevronDown,
    CircleAlert,
    CircleCheck,
    Compass,
    Eye,
    EyeOff,
    Fingerprint,
    Headphones,
    LockKeyhole,
    Mail,
    MapPin,
    ShieldCheck,
    ShoppingBag,
    Sparkles,
    Store,
    Ticket,
    UserRound,
} from 'lucide-react';
import { CSSProperties, FormEvent, ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';

import {
    authOriginalImageUrl,
    authPresentation,
    authVisualStyle,
} from '../../storefront-content-plugin/src/shared/auth-visual';
import { ContentText } from '../../storefront-content-plugin/src/shared/content-text';
import { useImageTextContrast } from '../../storefront-content-plugin/src/shared/image-tone';

import { ShopApi, ShopApiError, ShopApiTimeoutError } from './api';
import { AuthFormIntro, AuthOverlaySurface } from './auth-overlay-surface';
import { AuthPresentationContext, type AuthPresentationRoute } from './auth-presentation';
import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    validateAccountPassword,
} from './auth-validation';
import { authHeroCopyPosition, resolveAuthVisualMessage } from './auth-visual';
import { PageBackButton } from './components/common/page-back-button';
import { useDesktopLayout } from './desktop-layout';
import { GoogleAuthButton } from './google-auth-button';
import {
    attributionWithinWindow,
    captureReferralAttribution,
    normalizeReferralCode,
    ReferralSource,
} from './referral-attribution';
import { isReferralClientFeatureEnabled } from './referral-client-feature';
import { storefrontWebpUrl } from './responsive-image';
import { storefrontErrorMessage } from './storefront-errors';
import { routeNavigateOptions, RouteState } from './storefront-router';
import { SafeImage } from './storefront-ui/product-display';
import './styles/auth-shell.css';
import {
    StorefrontAuthSettings,
    StorefrontContentBlock,
    StorefrontContentTargetType,
    StorefrontLanguage,
} from './types';

type AuthRoute = AuthPresentationRoute;

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
    return storefrontErrorMessage(
        error,
        language,
        isZh ? '登录失败，请稍后重试' : 'Sign-in failed. Please try again later',
    );
}

export function registerErrorMessage(error: unknown, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    if (isRegisteredEmailConflict(error))
        return isZh ? '该邮箱已注册，请登录' : 'This email is already registered. Please sign in.';
    return authRequestErrorMessage(
        error,
        language,
        isZh ? '注册失败，请稍后重试' : 'Registration failed. Please try again later',
    );
}

export function verificationRequiresPassword(error: unknown): boolean {
    return error instanceof ShopApiError && error.errorCode === 'MISSING_PASSWORD_ERROR';
}

export function verificationErrorMessage(error: unknown, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    return authRequestErrorMessage(
        error,
        language,
        isZh ? '无法完成验证，请稍后重试' : 'Verification failed. Please try again later.',
    );
}

function authRequestErrorMessage(error: unknown, language: StorefrontLanguage, fallback?: string): string {
    if (error instanceof ShopApiTimeoutError && error.resultUnknown) {
        return language === 'zh'
            ? '请求超时，提交结果暂未确认。请检查邮箱或尝试登录，勿重复提交。'
            : 'The request timed out and its result is not confirmed. Check your email or try signing in; do not submit again.';
    }
    return storefrontErrorMessage(error, language, fallback);
}

interface AuthPageBaseProps {
    returnTo?: RouteState['returnTo'];
    returnVariantId?: string;
    returnQuantity?: number;
    api: ShopApi;
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl?: string | null;
    onBack: () => void;
    onToggleLanguage?: () => void;
}

interface AuthLegalProps {
    legalContent?: StorefrontContentBlock;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}

interface AuthVisualProps {
    authVisualContent?: StorefrontContentBlock;
}

interface AuthCompletionProps {
    onSuccess: (isCurrent?: () => boolean) => Promise<void>;
}

interface AuthMethodsProps {
    authSettings?: StorefrontAuthSettings;
}

const defaultAuthSettings: StorefrontAuthSettings = {
    emailPasswordEnabled: true,
    emailAutoRegistrationEnabled: false,
    emailQuickRegistrationEnabled: false,
    googleEnabled: false,
    googleClientId: null,
};

function formString(data: FormData, name: string): string {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
}

function isInvalidCredentials(error: unknown): boolean {
    return error instanceof ShopApiError && error.errorCode === 'INVALID_CREDENTIALS_ERROR';
}

function isRegisteredEmailConflict(error: unknown): boolean {
    return error instanceof ShopApiError && error.errorCode === 'EMAIL_ADDRESS_CONFLICT_ERROR';
}

function googleAuthErrorMessage(error: unknown, language: StorefrontLanguage): string {
    if (error instanceof ShopApiError && error.authenticationError === 'STOREFRONT_GOOGLE_AUTH_UNAVAILABLE') {
        return language === 'zh' ? 'Google 登录尚未配置' : 'Google sign-in is not configured';
    }
    if (error instanceof ShopApiError) {
        if (error.authenticationError === 'STOREFRONT_GOOGLE_CONSENT_REQUIRED')
            return language === 'zh'
                ? '首次使用 Google 注册，请先勾选同意条款与隐私政策'
                : 'To create your account with Google, accept the terms and privacy policy first';
        if (error.authenticationError === 'STOREFRONT_GOOGLE_EMAIL_VERIFICATION_REQUIRED')
            return language === 'zh'
                ? '请使用 Gmail 或 Google Workspace 账号，其他邮箱请使用邮箱注册或登录'
                : 'Use a Gmail or Google Workspace account, or register or sign in with your email';
        if (error.authenticationError === 'STOREFRONT_GOOGLE_INVITE_INVALID')
            return language === 'zh'
                ? '邀请码无效，请修改或清空后重试'
                : 'The invitation code is invalid. Change or remove it and try again';
    }
    return language === 'zh' ? 'Google 登录失败，请重试' : 'Google sign-in failed. Try again';
}

function AuthMethodDivider({ language }: { language: StorefrontLanguage }) {
    return (
        <div className="auth-method-divider" role="separator">
            <span>{language === 'zh' ? '或使用 Google 账号继续' : 'or continue with Google'}</span>
        </div>
    );
}

function AuthBrand({ logoUrl, storefrontName }: { logoUrl?: string | null; storefrontName: string }) {
    return (
        <div className="auth-form-brand">
            {logoUrl ? (
                <SafeImage
                    src={storefrontWebpUrl(logoUrl, 'thumbnail')}
                    alt={storefrontName}
                    frameClassName="auth-form-logo"
                />
            ) : (
                <strong>{storefrontName}</strong>
            )}
        </div>
    );
}

const benefitIconComponents = {
    'shopping-bag': ShoppingBag,
    'map-pin': MapPin,
    store: Store,
    compass: Compass,
    'shield-check': ShieldCheck,
    headphones: Headphones,
    sparkles: Sparkles,
};

function useAuthNavigate(
    returnTo?: RouteState['returnTo'],
    returnVariantId?: string,
    returnQuantity?: number,
) {
    const navigate = useNavigate();
    const overlay = useContext(AuthPresentationContext);
    return (route: AuthRoute, replace = false) => {
        if (overlay) {
            overlay.navigate(route, replace);
            return;
        }
        const routeState: RouteState = { ...route };
        if (returnTo) {
            routeState.returnTo = returnTo;
            if (returnTo === 'purchase' && returnVariantId) {
                routeState.id = returnVariantId;
                routeState.quantity = returnQuantity;
            }
        }
        const options = routeNavigateOptions(routeState);
        void navigate((replace ? { ...options, replace: true } : options) as never);
    };
}

function useAuthSubmittingState(submitting: boolean) {
    const overlay = useContext(AuthPresentationContext);
    const onSubmittingChange = overlay?.onSubmittingChange;
    useEffect(() => {
        onSubmittingChange?.(submitting);
        return () => onSubmittingChange?.(false);
    }, [onSubmittingChange, submitting]);
    return Boolean(overlay);
}

interface AuthRequestOperation {
    signal: AbortSignal;
    isCurrent: () => boolean;
    finish: () => void;
}

/** Each form owns one request; an old scope may finish remotely but cannot update this presentation. */
function useAuthRequestScope(api: ShopApi, identity = '') {
    const ownerRef = useRef({ api, identity });
    if (ownerRef.current.api !== api || ownerRef.current.identity !== identity)
        ownerRef.current = { api, identity };
    const owner = ownerRef.current;
    const pending = useRef<{ owner: typeof owner; controller: AbortController } | null>(null);
    useEffect(
        () => () => {
            if (pending.current?.owner === owner) {
                pending.current.controller.abort();
                pending.current = null;
            }
        },
        [owner],
    );
    return {
        owner,
        begin(): AuthRequestOperation | null {
            if (pending.current?.owner === owner) return null;
            pending.current?.controller.abort();
            const request = { owner, controller: new AbortController() };
            pending.current = request;
            return {
                signal: request.controller.signal,
                isCurrent: () => ownerRef.current === owner && !request.controller.signal.aborted,
                finish: () => {
                    if (pending.current === request) pending.current = null;
                },
            };
        },
    };
}

function useAuthVerificationResend(
    api: ShopApi,
    language: StorefrontLanguage,
    requestScope: ReturnType<typeof useAuthRequestScope>,
    setSubmitting: (submitting: boolean) => void,
) {
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        setMessage('');
        setError('');
        setSeconds(0);
    }, [api]);
    useEffect(() => {
        if (seconds <= 0) return;
        const timeout = window.setTimeout(() => setSeconds(value => value - 1), 1000);
        return () => window.clearTimeout(timeout);
    }, [seconds]);
    const resend = async (emailAddress: string, emailIsCurrent = () => true) => {
        if (seconds > 0) return;
        const operation = requestScope.begin();
        if (!operation) return;
        setSubmitting(true);
        setMessage('');
        setError('');
        try {
            await api.refreshCustomerVerification(emailAddress, operation.signal);
            if (!operation.isCurrent() || !emailIsCurrent()) return;
            setMessage(
                language === 'zh' ? '重新发送请求已提交' : 'Verification email resend request submitted',
            );
            setSeconds(60);
        } catch (requestError) {
            if (operation.isCurrent() && emailIsCurrent())
                setError(authRequestErrorMessage(requestError, language));
        } finally {
            operation.finish();
            if (operation.isCurrent()) setSubmitting(false);
        }
    };
    return { message, error, seconds, setMessage, setError, setSeconds, resend };
}

function ExistingAccountVerificationAction({
    language,
    submitting,
    recovery,
}: {
    language: StorefrontLanguage;
    submitting: boolean;
    recovery: ReturnType<typeof useAuthVerificationResend>;
}) {
    const isZh = language === 'zh';
    return (
        <>
            <button
                className="auth-inline-link"
                type="button"
                disabled={submitting || recovery.seconds > 0}
                onClick={event => {
                    const form = event.currentTarget.form;
                    if (!form) return;
                    const emailAddress = formString(new FormData(form), 'emailAddress').trim();
                    void recovery.resend(
                        emailAddress,
                        () => formString(new FormData(form), 'emailAddress').trim() === emailAddress,
                    );
                }}
            >
                {recovery.seconds > 0
                    ? isZh
                        ? `${recovery.seconds} 秒后可重新发送`
                        : `Resend in ${recovery.seconds}s`
                    : isZh
                      ? '邮箱未验证？重新发送验证邮件'
                      : 'Email not verified? Resend verification email'}
            </button>
            {recovery.message && (
                <small className="auth-success-message" role="status">
                    {recovery.message}
                </small>
            )}
            {recovery.error && (
                <small className="form-error" role="alert">
                    {recovery.error}
                </small>
            )}
        </>
    );
}

export function LoginPage({
    returnTo,
    returnVariantId,
    returnQuantity,
    api,
    language,
    storefrontName,
    logoUrl,
    legalContent,
    authVisualContent,
    authSettings = defaultAuthSettings,
    onBack,
    onToggleLanguage,
    onSuccess,
    onContentTarget,
}: AuthPageBaseProps & AuthLegalProps & AuthCompletionProps & AuthVisualProps & AuthMethodsProps) {
    const navigateTo = useAuthNavigate(returnTo, returnVariantId, returnQuantity);
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const inOverlay = useAuthSubmittingState(submitting);
    const [error, setError] = useState('');
    const [autoRegistrationEmail, setAutoRegistrationEmail] = useState('');
    const [existingAccount, setExistingAccount] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);
    const [registrationConsentAccepted, setRegistrationConsentAccepted] = useState(false);
    const requestScope = useAuthRequestScope(api);
    const verificationRecovery = useAuthVerificationResend(api, language, requestScope, setSubmitting);
    useEffect(() => {
        setSubmitting(false);
        setError('');
        setAutoRegistrationEmail('');
        setExistingAccount(false);
    }, [requestScope.owner]);
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const operation = requestScope.begin();
        if (!operation) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const emailAddress = formString(data, 'emailAddress').trim();
        const emailIsCurrent = () => formString(new FormData(form), 'emailAddress').trim() === emailAddress;
        const password = formString(data, 'password');
        setSubmitting(true);
        setError('');
        setExistingAccount(false);
        try {
            await api.login(emailAddress, password, rememberMe);
            if (!operation.isCurrent() || !emailIsCurrent()) return;
            await onSuccess(() => operation.isCurrent() && emailIsCurrent());
        } catch (requestError) {
            if (!operation.isCurrent() || !emailIsCurrent()) return;
            if (authSettings.emailAutoRegistrationEnabled && isInvalidCredentials(requestError)) {
                if (!registrationConsentAccepted) {
                    setError(
                        isZh
                            ? '请核对邮箱和密码。如需自动创建账户，请先同意条款与隐私政策。'
                            : 'Check your email and password. To create an account automatically, accept the terms and privacy policy first.',
                    );
                    return;
                }
                try {
                    await api.registerCustomerAccount(
                        { emailAddress },
                        registrationConsent(registrationConsentAccepted, language),
                        undefined,
                        undefined,
                        operation.signal,
                    );
                    if (!operation.isCurrent() || !emailIsCurrent()) return;
                    setAutoRegistrationEmail(emailAddress);
                } catch (registrationError) {
                    if (operation.isCurrent() && emailIsCurrent()) {
                        setError(registerErrorMessage(registrationError, language));
                        setExistingAccount(isRegisteredEmailConflict(registrationError));
                    }
                }
            } else {
                setError(loginErrorMessage(requestError, language));
            }
        } finally {
            operation.finish();
            if (operation.isCurrent()) setSubmitting(false);
        }
    };

    const authenticateWithGoogle = async (credential: string) => {
        setSubmitting(true);
        setError('');
        try {
            const captured = captureReferralAttribution();
            const program = captured ? await api.referralProgram() : null;
            const attribution =
                program && isReferralClientFeatureEnabled(program)
                    ? attributionWithinWindow(captured, program.attributionWindowDays)
                    : null;
            await api.authenticateWithGoogle(
                credential,
                registrationConsent(registrationConsentAccepted, language),
                { rememberMe, inviteCode: attribution?.code, referralSource: attribution?.source },
            );
            await onSuccess();
        } catch (requestError) {
            throw new Error(googleAuthErrorMessage(requestError, language));
        } finally {
            setSubmitting(false);
        }
    };

    const googleClientId = authSettings.googleEnabled ? authSettings.googleClientId : null;
    const googleAvailable = Boolean(googleClientId);

    return (
        <AuthLayout
            title={isZh ? '登录' : 'Sign in'}
            heroVariant="login"
            heroContent={authVisualContent}
            {...{ language, storefrontName, logoUrl, onBack, onToggleLanguage }}
        >
            {autoRegistrationEmail ? (
                <AuthResult
                    icon={<CircleCheck />}
                    title={isZh ? '注册请求已提交' : 'Registration request submitted'}
                    detail={
                        isZh
                            ? `需要验证 ${autoRegistrationEmail} 时，请检查收件箱或垃圾邮件，打开邮件链接并设置密码。若该邮箱已有账号，请直接登录或找回密码。`
                            : `If ${autoRegistrationEmail} needs verification, check your inbox or spam folder, ` +
                              'then open the email link and set a password. ' +
                              'If you already have an account, sign in or reset your password.'
                    }
                >
                    <button
                        className="auth-secondary-action"
                        type="button"
                        onClick={() => setAutoRegistrationEmail('')}
                    >
                        {isZh ? '返回登录' : 'Back to sign in'}
                    </button>
                    <button
                        className="auth-secondary-action"
                        type="button"
                        onClick={() => navigateTo({ name: 'forgot-password' })}
                    >
                        {isZh ? '重置密码' : 'Reset password'}
                    </button>
                </AuthResult>
            ) : (
                <>
                    <AuthFormIntro variant="login" language={language} content={authVisualContent} />
                    {authSettings.emailPasswordEnabled ? (
                        <form
                            className="auth-account-form"
                            aria-label={isZh ? '登录表单' : 'Sign-in form'}
                            onSubmit={event => void submit(event)}
                        >
                            <Field
                                name="emailAddress"
                                label={isZh ? '电子邮箱' : 'Email address'}
                                type="email"
                                autoComplete="email"
                                icon={<Mail />}
                                showLabel={false}
                                onChange={() => {
                                    setError('');
                                    setExistingAccount(false);
                                    verificationRecovery.setMessage('');
                                    verificationRecovery.setError('');
                                }}
                            />
                            <Field
                                name="password"
                                label={isZh ? '密码' : 'Password'}
                                type="password"
                                autoComplete="current-password"
                                icon={<LockKeyhole />}
                                revealPassword
                                language={language}
                                showLabel={false}
                            />
                            <div className="auth-login-options">
                                <label className="auth-remember">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={event => setRememberMe(event.target.checked)}
                                    />
                                    {isZh ? '记住我' : 'Remember me'}
                                </label>
                                <button
                                    className="auth-inline-link"
                                    type="button"
                                    disabled={inOverlay && submitting}
                                    onClick={() => navigateTo({ name: 'forgot-password' })}
                                >
                                    {isZh ? '忘记密码？' : 'Forgot password?'}
                                </button>
                            </div>
                            {error && (
                                <small className="form-error" role="alert">
                                    {error}
                                </small>
                            )}
                            {existingAccount && (
                                <ExistingAccountVerificationAction
                                    language={language}
                                    submitting={submitting}
                                    recovery={verificationRecovery}
                                />
                            )}
                            {(authSettings.emailAutoRegistrationEnabled || googleAvailable) && (
                                <RegistrationConsentControl
                                    accepted={registrationConsentAccepted}
                                    language={language}
                                    content={legalContent}
                                    onChange={setRegistrationConsentAccepted}
                                    onContentTarget={onContentTarget}
                                />
                            )}
                            <SubmitButton
                                submitting={submitting}
                                idle={isZh ? '登录账户' : 'Sign in'}
                                busy={isZh ? '登录中' : 'Signing in'}
                            />
                        </form>
                    ) : null}
                    {!authSettings.emailPasswordEnabled && googleAvailable && (
                        <RegistrationConsentControl
                            accepted={registrationConsentAccepted}
                            language={language}
                            content={legalContent}
                            onChange={setRegistrationConsentAccepted}
                            onContentTarget={onContentTarget}
                        />
                    )}
                    {googleClientId ? (
                        <>
                            {authSettings.emailPasswordEnabled ? (
                                <AuthMethodDivider language={language} />
                            ) : null}
                            <GoogleAuthButton
                                clientId={googleClientId}
                                language={language}
                                disabled={submitting}
                                onCredential={authenticateWithGoogle}
                            />
                        </>
                    ) : null}
                    {!authSettings.emailPasswordEnabled && !googleAvailable ? (
                        <p className="auth-methods-unavailable" role="status">
                            {isZh ? '暂未开启登录方式' : 'No sign-in method is enabled'}
                        </p>
                    ) : null}
                    <p className="auth-switch">
                        <span>{isZh ? '还没有账户？' : 'New to this store?'}</span>
                        <button
                            type="button"
                            disabled={inOverlay && submitting}
                            onClick={() => navigateTo({ name: 'register' }, true)}
                        >
                            {isZh ? '立即注册' : 'Create an account'}
                        </button>
                    </p>
                </>
            )}
            {!authSettings.emailAutoRegistrationEnabled && !googleAvailable && (
                <AuthLegalNotice content={legalContent} onContentTarget={onContentTarget} />
            )}
        </AuthLayout>
    );
}

export function RegisterPage({
    returnTo,
    returnVariantId,
    returnQuantity,
    api,
    language,
    storefrontName,
    logoUrl,
    legalContent,
    authVisualContent,
    authSettings = defaultAuthSettings,
    onBack,
    onToggleLanguage,
    onSuccess,
    onContentTarget,
}: AuthPageBaseProps & AuthLegalProps & AuthVisualProps & AuthMethodsProps & Partial<AuthCompletionProps>) {
    const navigateTo = useAuthNavigate(returnTo, returnVariantId, returnQuantity);
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const inOverlay = useAuthSubmittingState(submitting);
    const [registeredEmail, setRegisteredEmail] = useState('');
    const [error, setError] = useState('');
    const [existingAccount, setExistingAccount] = useState(false);
    const [referralEnabled, setReferralEnabled] = useState(false);
    const [inviteCode, setInviteCode] = useState('');
    const [inviteExpanded, setInviteExpanded] = useState(false);
    const [inviteSource, setInviteSource] = useState<ReferralSource>('CODE');
    const [inviteStatus, setInviteStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
    const [registrationConsentAccepted, setRegistrationConsentAccepted] = useState(false);
    const quickRegistration = authSettings.emailQuickRegistrationEnabled;
    const requestScope = useAuthRequestScope(api, registeredEmail);
    const verificationRecovery = useAuthVerificationResend(api, language, requestScope, setSubmitting);
    const {
        message: resendMessage,
        error: resendError,
        seconds: resendSeconds,
        setMessage: setResendMessage,
        setError: setResendError,
        setSeconds: setResendSeconds,
    } = verificationRecovery;
    const googleClientId = authSettings.googleEnabled ? authSettings.googleClientId : null;
    const googleAvailable = Boolean(googleClientId);

    useEffect(() => {
        setSubmitting(false);
        setRegisteredEmail('');
        setError('');
        setExistingAccount(false);
        setResendMessage('');
        setResendSeconds(0);
    }, [api]);

    useEffect(() => {
        const controller = new AbortController();
        void api
            .referralProgram(controller.signal)
            .then(program => {
                if (controller.signal.aborted) return;
                setReferralEnabled(isReferralClientFeatureEnabled(program));
                const captured = attributionWithinWindow(
                    captureReferralAttribution(),
                    program.attributionWindowDays,
                );
                if (captured) {
                    setInviteCode(captured.code);
                    setInviteExpanded(true);
                    setInviteSource(captured.source);
                }
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [api]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setExistingAccount(false);
        if (!registrationConsentAccepted) {
            setError(isZh ? '请先同意使用条款并确认隐私政策' : 'Accept the terms and privacy policy first');
            return;
        }
        const form = event.currentTarget;
        const data = new FormData(form);
        const emailAddress = formString(data, 'emailAddress').trim();
        const emailIsCurrent = () => formString(new FormData(form), 'emailAddress').trim() === emailAddress;
        let firstName: string | undefined;
        let lastName: string | undefined;
        if (!quickRegistration) {
            const fullName = formString(data, 'fullName').trim();
            const splitName = splitCustomerName(fullName, language);
            firstName = splitName.firstName;
            lastName = splitName.lastName;
            if (!firstName || !lastName) {
                setError(isZh ? '请输入完整姓名' : 'Enter your full name');
                return;
            }
        }
        const operation = requestScope.begin();
        if (!operation) return;
        setSubmitting(true);
        setError('');
        try {
            const submittedInviteCode = referralEnabled
                ? normalizeReferralCode(formString(data, 'inviteCode'))
                : '';
            const inviteValid =
                !submittedInviteCode ||
                (await api.validateReferralInviteCode(submittedInviteCode, operation.signal));
            if (!operation.isCurrent() || !emailIsCurrent()) return;
            if (!inviteValid) {
                setInviteStatus('invalid');
                setError(isZh ? '邀请码无效，请检查后重试' : 'This invitation code is invalid');
                return;
            }
            await api.registerCustomerAccount(
                {
                    emailAddress,
                    ...(firstName ? { firstName } : {}),
                    ...(lastName ? { lastName } : {}),
                },
                registrationConsent(registrationConsentAccepted, language),
                submittedInviteCode || undefined,
                submittedInviteCode ? inviteSource : undefined,
                operation.signal,
            );
            if (!operation.isCurrent() || !emailIsCurrent()) return;
            setRegisteredEmail(emailAddress);
            setResendSeconds(60);
        } catch (requestError) {
            if (operation.isCurrent() && emailIsCurrent()) {
                setError(registerErrorMessage(requestError, language));
                setExistingAccount(isRegisteredEmailConflict(requestError));
            }
        } finally {
            operation.finish();
            if (operation.isCurrent()) setSubmitting(false);
        }
    };

    const authenticateWithGoogle = async (credential: string) => {
        if (!registrationConsentAccepted) {
            throw new Error(
                isZh ? '请先同意使用条款并确认隐私政策' : 'Accept the terms and privacy policy first',
            );
        }
        setSubmitting(true);
        setError('');
        try {
            // Resolve URL attribution even if the initial program request is still loading.
            const captured = !referralEnabled ? captureReferralAttribution() : null;
            const program = captured ? await api.referralProgram() : null;
            const attribution =
                program && isReferralClientFeatureEnabled(program)
                    ? attributionWithinWindow(captured, program.attributionWindowDays)
                    : null;
            await api.authenticateWithGoogle(
                credential,
                registrationConsent(registrationConsentAccepted, language),
                {
                    inviteCode: referralEnabled
                        ? normalizeReferralCode(inviteCode) || undefined
                        : attribution?.code,
                    referralSource: referralEnabled ? inviteSource : attribution?.source,
                },
            );
            await onSuccess?.();
        } catch (requestError) {
            throw new Error(googleAuthErrorMessage(requestError, language));
        } finally {
            setSubmitting(false);
        }
    };

    const invitationControl = referralEnabled ? (
        <details
            className="auth-invitation"
            open={inviteExpanded}
            onToggle={event => setInviteExpanded(event.currentTarget.open)}
        >
            <summary>
                <Ticket aria-hidden="true" />
                {isZh ? '邀请码（选填）' : 'Invitation code (optional)'}
                <ChevronDown aria-hidden="true" />
            </summary>
            <Field
                name="inviteCode"
                label={isZh ? '邀请码（选填）' : 'Invitation code (optional)'}
                autoComplete="off"
                icon={<Ticket />}
                maxLength={12}
                required={false}
                showLabel={false}
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
                    className={inviteStatus === 'invalid' ? 'form-error' : 'auth-success-message'}
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
        </details>
    ) : null;

    return (
        <AuthLayout
            title={isZh ? '注册' : 'Create account'}
            heroVariant="register"
            heroContent={authVisualContent}
            {...{ language, storefrontName, logoUrl, onBack, onToggleLanguage }}
        >
            {registeredEmail ? (
                <AuthResult
                    icon={<CircleCheck />}
                    title={isZh ? '注册请求已提交' : 'Registration request submitted'}
                    detail={
                        isZh
                            ? `需要验证 ${registeredEmail} 时，请检查收件箱或垃圾邮件，打开邮件链接并设置密码。若该邮箱已有账号，请直接登录或找回密码。`
                            : `If ${registeredEmail} needs verification, check your inbox or spam folder, ` +
                              'then open the email link and set a password. ' +
                              'If you already have an account, sign in or reset your password.'
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
                    {resendError && (
                        <small className="form-error" role="alert">
                            {resendError}
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
                        onClick={() => void verificationRecovery.resend(registeredEmail)}
                    />
                    <button
                        className="auth-secondary-action"
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                            setRegisteredEmail('');
                            setResendMessage('');
                            setResendError('');
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
                    <button
                        className="auth-secondary-action"
                        type="button"
                        onClick={() => navigateTo({ name: 'forgot-password' })}
                    >
                        {isZh ? '找回密码' : 'Reset password'}
                    </button>
                </AuthResult>
            ) : (
                <>
                    <AuthFormIntro variant="register" language={language} content={authVisualContent} />
                    {authSettings.emailPasswordEnabled ? (
                        <form
                            className="auth-account-form"
                            aria-label={isZh ? '注册表单' : 'Registration form'}
                            onSubmit={event => void submit(event)}
                        >
                            {!quickRegistration ? (
                                <Field
                                    name="fullName"
                                    label={isZh ? '姓名' : 'Full name'}
                                    autoComplete="name"
                                    icon={<UserRound />}
                                    showLabel={false}
                                />
                            ) : null}
                            <Field
                                name="emailAddress"
                                label={isZh ? '电子邮箱' : 'Email address'}
                                type="email"
                                autoComplete="email"
                                icon={<Mail />}
                                showLabel={false}
                                onChange={() => {
                                    setError('');
                                    setExistingAccount(false);
                                    setResendMessage('');
                                    setResendError('');
                                }}
                            />
                            <small className="auth-password-hint">
                                {quickRegistration
                                    ? isZh
                                        ? '打开邮箱验证链接后设置密码，无需现在填写姓名'
                                        : 'Set your password using the email verification link; no name is needed now'
                                    : isZh
                                      ? '打开邮箱验证链接后设置登录密码'
                                      : 'Set your sign-in password using the email verification link'}
                            </small>
                            {invitationControl}
                            {error && (
                                <small className="form-error" role="alert">
                                    {error}
                                </small>
                            )}
                            {existingAccount && (
                                <ExistingAccountVerificationAction
                                    language={language}
                                    submitting={submitting}
                                    recovery={verificationRecovery}
                                />
                            )}
                            {existingAccount && (
                                <button
                                    className="auth-inline-link"
                                    type="button"
                                    disabled={inOverlay && submitting}
                                    onClick={() => navigateTo({ name: 'forgot-password' })}
                                >
                                    {isZh ? '忘记密码？' : 'Forgot password?'}
                                </button>
                            )}
                            <RegistrationConsentControl
                                accepted={registrationConsentAccepted}
                                language={language}
                                content={legalContent}
                                onChange={setRegistrationConsentAccepted}
                                onContentTarget={onContentTarget}
                            />
                            <SubmitButton
                                submitting={submitting}
                                idle={
                                    quickRegistration
                                        ? isZh
                                            ? '使用邮箱快捷注册'
                                            : 'Continue with email'
                                        : isZh
                                          ? '注册账户'
                                          : 'Create account'
                                }
                                busy={isZh ? '注册中' : 'Creating account'}
                            />
                        </form>
                    ) : null}
                    {!authSettings.emailPasswordEnabled && googleAvailable && invitationControl}
                    {!authSettings.emailPasswordEnabled && googleAvailable && (
                        <RegistrationConsentControl
                            accepted={registrationConsentAccepted}
                            language={language}
                            content={legalContent}
                            onChange={setRegistrationConsentAccepted}
                            onContentTarget={onContentTarget}
                        />
                    )}
                    {googleClientId ? (
                        <>
                            {authSettings.emailPasswordEnabled ? (
                                <AuthMethodDivider language={language} />
                            ) : null}
                            <GoogleAuthButton
                                clientId={googleClientId}
                                language={language}
                                disabled={submitting}
                                onCredential={authenticateWithGoogle}
                            />
                        </>
                    ) : null}
                    {!authSettings.emailPasswordEnabled && !googleAvailable ? (
                        <p className="auth-methods-unavailable" role="status">
                            {isZh ? '暂未开启注册方式' : 'No registration method is enabled'}
                        </p>
                    ) : null}
                    <p className="auth-switch">
                        <span>{isZh ? '已有账户？' : 'Already have an account?'}</span>
                        <button
                            type="button"
                            disabled={inOverlay && submitting}
                            onClick={() => navigateTo({ name: 'login' }, true)}
                        >
                            {isZh ? '立即登录' : 'Sign in'}
                        </button>
                    </p>
                    {!authSettings.emailPasswordEnabled && (
                        <AuthLegalNotice content={legalContent} onContentTarget={onContentTarget} />
                    )}
                </>
            )}
        </AuthLayout>
    );
}

export function VerifyAccountPage({
    returnTo,
    returnVariantId,
    returnQuantity,
    api,
    language,
    storefrontName,
    logoUrl,
    token,
    onBack,
    onToggleLanguage,
    onSuccess,
}: AuthPageBaseProps & AuthCompletionProps & { token?: string }) {
    const navigate = useNavigate();
    const navigateTo = (route: AuthRoute) =>
        void navigate(
            routeNavigateOptions({
                ...route,
                returnTo,
                id: returnTo === 'purchase' ? returnVariantId : undefined,
                quantity: returnTo === 'purchase' ? returnQuantity : undefined,
            }) as never,
        );
    const isZh = language === 'zh';
    const [error, setError] = useState('');
    const [requiresPassword, setRequiresPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const [resendError, setResendError] = useState('');
    const [resendMessage, setResendMessage] = useState('');
    const [resendSeconds, setResendSeconds] = useState(0);
    const [verified, setVerified] = useState(false);
    const [restoringSession, setRestoringSession] = useState(false);
    const [sessionError, setSessionError] = useState('');
    const requestScope = useAuthRequestScope(api, token ?? '');
    const attempted = useRef<typeof requestScope.owner | null>(null);
    const completionCallback = useRef(onSuccess);
    completionCallback.current = onSuccess;

    useEffect(() => {
        if (resendSeconds <= 0) return;
        const timeout = window.setTimeout(() => setResendSeconds(seconds => seconds - 1), 1000);
        return () => window.clearTimeout(timeout);
    }, [resendSeconds]);

    const restoreSession = async (operation: AuthRequestOperation) => {
        if (!operation.isCurrent()) return;
        setRestoringSession(true);
        setSessionError('');
        try {
            await completionCallback.current(operation.isCurrent);
        } catch {
            if (operation.isCurrent())
                setSessionError(
                    isZh
                        ? '邮箱已验证，登录状态暂未恢复。请重试恢复或返回登录。'
                        : 'Your email is verified, but the sign-in session could not be restored. Retry or return to sign in.',
                );
        } finally {
            if (operation.isCurrent()) setRestoringSession(false);
        }
    };

    const restoreVerifiedSession = async () => {
        const operation = requestScope.begin();
        if (!operation) return;
        try {
            await restoreSession(operation);
        } finally {
            operation.finish();
        }
    };

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
        const operation = requestScope.begin();
        if (!operation) return;
        setSubmitting(true);
        setError('');
        try {
            await api.verifyCustomerAccount(token, password, operation.signal);
            if (!operation.isCurrent()) return;
            setVerified(true);
            setRequiresPassword(false);
            await restoreSession(operation);
        } catch (requestError) {
            if (!operation.isCurrent()) return;
            if (
                requestError instanceof ShopApiError &&
                (requestError.errorCode === 'VERIFICATION_TOKEN_EXPIRED_ERROR' ||
                    requestError.errorCode === 'VERIFICATION_TOKEN_INVALID_ERROR')
            ) {
                setRequiresPassword(false);
            }
            setError(verificationErrorMessage(requestError, language));
        } finally {
            operation.finish();
            if (operation.isCurrent()) setSubmitting(false);
        }
    };

    const resend = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (resendSeconds > 0) return;
        const data = new FormData(event.currentTarget);
        const operation = requestScope.begin();
        if (!operation) return;
        setResending(true);
        setResendError('');
        setResendMessage('');
        try {
            await api.refreshCustomerVerification(formString(data, 'emailAddress').trim(), operation.signal);
            if (!operation.isCurrent()) return;
            setResendMessage(
                isZh
                    ? '重新发送请求已提交；如该邮箱仍待验证，请检查收件箱和垃圾邮件。'
                    : 'Verification email resend request submitted. If this account still needs verification, check your inbox and spam folder.',
            );
            setResendSeconds(60);
        } catch (requestError) {
            if (!operation.isCurrent()) return;
            setResendError(
                requestError instanceof Error
                    ? authRequestErrorMessage(requestError, language)
                    : isZh
                      ? '无法重新发送验证邮件'
                      : 'Could not resend the verification email',
            );
        } finally {
            operation.finish();
            if (operation.isCurrent()) setResending(false);
        }
    };

    useEffect(() => {
        if (attempted.current === requestScope.owner) return;
        const owner = requestScope.owner;
        attempted.current = owner;
        setError('');
        setRequiresPassword(false);
        setVerified(false);
        setSessionError('');
        setRestoringSession(false);
        setResending(false);
        setResendError('');
        setResendMessage('');
        setResendSeconds(0);
        setSubmitting(false);
        if (!token) {
            setError(isZh ? '验证链接缺少令牌' : 'The verification link is missing its token');
            return;
        }
        const operation = requestScope.begin();
        if (!operation) return;
        setSubmitting(true);
        void api
            .verifyCustomerAccount(token, undefined, operation.signal)
            .then(async () => {
                if (!operation.isCurrent()) return;
                setVerified(true);
                await restoreSession(operation);
            })
            .catch(requestError => {
                if (!operation.isCurrent()) return;
                if (verificationRequiresPassword(requestError)) {
                    setRequiresPassword(true);
                    setError('');
                    return;
                }
                setError(verificationErrorMessage(requestError, language));
            })
            .finally(() => {
                operation.finish();
                if (operation.isCurrent()) setSubmitting(false);
            });
        return () => {
            if (attempted.current === owner) attempted.current = null;
        };
    }, [requestScope.owner]);

    return (
        <AuthLayout
            title={isZh ? '验证邮箱' : 'Verify email'}
            {...{ language, storefrontName, logoUrl, onBack, onToggleLanguage }}
        >
            <AuthResult
                icon={
                    verified ? (
                        <CircleCheck />
                    ) : requiresPassword ? (
                        <LockKeyhole />
                    ) : error ? (
                        <CircleAlert />
                    ) : (
                        <Fingerprint />
                    )
                }
                title={
                    verified
                        ? isZh
                            ? '邮箱已验证'
                            : 'Email verified'
                        : requiresPassword
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
                    verified
                        ? restoringSession
                            ? isZh
                                ? '正在恢复登录状态，请稍候'
                                : 'Restoring your sign-in session. Please wait.'
                            : isZh
                              ? '邮箱验证已完成，无需再次验证或重新发送邮件。'
                              : 'Your email verification is complete. You do not need to verify or request another email.'
                        : requiresPassword
                          ? isZh
                              ? '该账号尚未设置登录密码，请设置密码并完成邮箱验证。'
                              : 'This account does not have a sign-in password yet. Set one to finish email verification.'
                          : error ||
                            (isZh
                                ? '请稍候，完成后将自动登录'
                                : 'Please wait. You will be signed in automatically.')
                }
            >
                {verified ? (
                    <>
                        {sessionError && (
                            <small className="form-error" role="alert">
                                {sessionError}
                            </small>
                        )}
                        {sessionError && (
                            <SubmitButton
                                type="button"
                                submitting={restoringSession}
                                idle={isZh ? '重试恢复登录' : 'Retry sign-in recovery'}
                                busy={isZh ? '恢复中' : 'Restoring'}
                                onClick={() => void restoreVerifiedSession()}
                            />
                        )}
                        <button
                            className="auth-secondary-action"
                            type="button"
                            onClick={() => navigateTo({ name: 'login' })}
                        >
                            {isZh ? '返回登录' : 'Back to sign in'}
                        </button>
                    </>
                ) : requiresPassword ? (
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

export function ForgotPasswordPage({
    returnTo,
    returnVariantId,
    returnQuantity,
    api,
    language,
    storefrontName,
    logoUrl,
    authVisualContent,
    onBack,
}: AuthPageBaseProps & AuthVisualProps) {
    const navigateTo = useAuthNavigate(returnTo, returnVariantId, returnQuantity);
    const overlay = useContext(AuthPresentationContext);
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    useAuthSubmittingState(submitting);
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
                    ? storefrontErrorMessage(requestError, language)
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
            heroVariant="login"
            heroContent={authVisualContent}
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
                    <header className={`auth-form-heading auth-form-heading-${language}`}>
                        <h1>{isZh ? '找回密码' : 'Recover your password'}</h1>
                        <p>
                            {isZh
                                ? '输入注册邮箱，我们会向你发送密码重置链接'
                                : 'Enter your email and we will send you a password reset link'}
                        </p>
                    </header>
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
                    {overlay && (
                        <p className="auth-switch">
                            <button
                                type="button"
                                disabled={submitting}
                                onClick={() => navigateTo({ name: 'login' })}
                            >
                                {isZh ? '返回登录' : 'Back to sign in'}
                            </button>
                        </p>
                    )}
                </>
            )}
        </AuthLayout>
    );
}

export function ResetPasswordPage({
    returnTo,
    returnVariantId,
    returnQuantity,
    api,
    language,
    storefrontName,
    logoUrl,
    token,
    onBack,
    onSuccess,
}: AuthPageBaseProps & AuthCompletionProps & { token?: string }) {
    const navigate = useNavigate();
    const navigateTo = (route: AuthRoute) =>
        void navigate(
            routeNavigateOptions({
                ...route,
                returnTo,
                id: returnTo === 'purchase' ? returnVariantId : undefined,
                quantity: returnTo === 'purchase' ? returnQuantity : undefined,
            }) as never,
        );
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
                    ? storefrontErrorMessage(requestError, language)
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
    onToggleLanguage,
    children,
}: {
    title: string;
    heroVariant?: 'default' | 'login' | 'register';
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl?: string | null;
    heroContent?: StorefrontContentBlock;
    onBack: () => void;
    onToggleLanguage?: () => void;
    children: ReactNode;
}) {
    const desktop = useDesktopLayout();
    const overlay = useContext(AuthPresentationContext);
    const authVisualVariant = heroVariant === 'login' || heroVariant === 'register' ? heroVariant : null;
    const heroMessage = authVisualVariant
        ? resolveAuthVisualMessage(heroContent, authVisualVariant, language)
        : null;
    const presentation = authPresentation(heroContent, authVisualVariant ?? 'login', language);
    const heroStyle =
        authVisualVariant && heroContent
            ? ({
                  '--auth-hero-text-color': 'var(--auth-visual-foreground)',
                  '--auth-hero-overlay-color': 'var(--auth-visual-background)',
                  '--auth-hero-accent-color': 'var(--auth-visual-accent)',
              } as CSSProperties)
            : undefined;
    const managedHeroSrc = heroContent?.imageUrl?.trim();
    const heroImageContrast = useImageTextContrast(overlay ? undefined : managedHeroSrc);
    const heroImageTone = heroImageContrast.tone;
    const hasManagedHero = Boolean(authVisualVariant && heroContent);
    const heroImageSrc = managedHeroSrc ? authOriginalImageUrl(managedHeroSrc) : null;
    const heroFallbackSrc = managedHeroSrc;

    if (overlay) {
        return (
            <AuthOverlaySurface title={title} content={heroContent}>
                {children}
            </AuthOverlaySurface>
        );
    }

    return (
        <main
            className={`page subpage auth-page auth-page-${heroVariant}${hasManagedHero ? ' auth-page-managed' : ''}${heroImageSrc ? ' auth-page-has-image' : ''}`}
            aria-label={title}
            style={authVisualStyle(heroContent, heroImageTone)}
        >
            <section
                className={`auth-hero auth-hero-${heroVariant}${hasManagedHero ? ' auth-hero-managed' : ''}`}
                data-copy-position={authHeroCopyPosition(heroContent?.settings)}
                data-image-tone={heroImageTone}
                data-image-contrast={heroImageContrast.needsBacking ? 'backed' : 'direct'}
                style={heroStyle}
            >
                {heroImageSrc && (!authVisualVariant || desktop) && (
                    <SafeImage
                        src={heroImageSrc}
                        fallbackSrc={heroFallbackSrc ?? heroImageSrc}
                        imageKind="detail"
                        sizes="(min-width: 1024px) 640px, 1px"
                        alt=""
                        loading="eager"
                        decoding="async"
                        fetchPriority="high"
                        onImageReady={heroImageContrast.onImageLoad}
                    />
                )}
                {!authVisualVariant && (
                    <div className="auth-hero-header">
                        <PageBackButton
                            className="auth-back-button"
                            onClick={onBack}
                            label={language === 'zh' ? '返回' : 'Back'}
                        />
                    </div>
                )}
                {authVisualVariant && hasManagedHero && presentation.showLogo && (
                    <div className="auth-hero-brand">
                        <AuthBrand logoUrl={logoUrl} storefrontName={storefrontName} />
                    </div>
                )}
                <div
                    className={`auth-hero-message${heroMessage ? '' : ' auth-hero-message-brand-only'}${hasManagedHero ? ' auth-hero-message-managed' : ''}`}
                >
                    {(!hasManagedHero || heroMessage?.eyebrow) && (
                        <div className="auth-hero-kicker">
                            {!hasManagedHero && (
                                <div className="auth-brand-lockup">
                                    <div className="auth-brand-main">
                                        {logoUrl ? (
                                            <SafeImage
                                                frameClassName="auth-brand-mark"
                                                src={storefrontWebpUrl(logoUrl, 'thumbnail')}
                                                alt={storefrontName}
                                            />
                                        ) : (
                                            <span className="auth-brand-mark" aria-hidden="true">
                                                <ShoppingBag aria-hidden="true" />
                                            </span>
                                        )}
                                        <strong>{storefrontName}</strong>
                                    </div>
                                    <small>{language === 'zh' ? '欢迎光临' : 'Welcome'}</small>
                                </div>
                            )}
                            {heroMessage?.eyebrow && (
                                <span className="auth-hero-eyebrow">{heroMessage.eyebrow}</span>
                            )}
                        </div>
                    )}
                    {heroMessage && (
                        <>
                            {(heroMessage.title || heroMessage.description) && (
                                <div className="auth-hero-copy">
                                    {heroMessage.title && <h2>{heroMessage.title}</h2>}
                                    {(heroMessage.description || !hasManagedHero) && (
                                        <ContentText>
                                            {heroMessage.description ||
                                                (language === 'zh'
                                                    ? `在${storefrontName}安全地管理您的账户与订单。`
                                                    : `Manage your account and orders securely with ${storefrontName}.`)}
                                        </ContentText>
                                    )}
                                </div>
                            )}
                            {heroMessage.benefits.length > 0 &&
                                (presentation.benefitsStyle === 'tags' ? (
                                    <div className="auth-hero-tags">
                                        {heroMessage.tags.map((tag, index) => (
                                            <span key={`${tag}-${index}`}>{tag}</span>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="auth-hero-benefits">
                                        {heroMessage.benefits.map((benefit, index) => {
                                            const Icon = benefitIconComponents[benefit.icon];
                                            return (
                                                <div
                                                    className="auth-hero-benefit"
                                                    key={`${benefit.title}-${index}`}
                                                >
                                                    <span className="auth-hero-benefit-icon">
                                                        {benefit.imageUrl ? (
                                                            <SafeImage src={benefit.imageUrl} alt="" />
                                                        ) : (
                                                            <Icon aria-hidden="true" />
                                                        )}
                                                    </span>
                                                    <strong>{benefit.title}</strong>
                                                    {benefit.description && (
                                                        <ContentText as="small">
                                                            {benefit.description}
                                                        </ContentText>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                        </>
                    )}
                    {!heroMessage && <h2 className="auth-hero-title-fallback">{title}</h2>}
                </div>
            </section>
            <section className="login-content">
                <div className="auth-form-column">
                    {authVisualVariant ? (
                        <div className="auth-form-toolbar">
                            <PageBackButton
                                className="auth-form-back-button"
                                onClick={onBack}
                                label={language === 'zh' ? '返回' : 'Back'}
                            >
                                <span>{language === 'zh' ? '返回' : 'Back'}</span>
                            </PageBackButton>
                            {onToggleLanguage && (
                                <label className="auth-language-control">
                                    <span className="sr-only">{language === 'zh' ? '语言' : 'Language'}</span>
                                    <select
                                        aria-label={language === 'zh' ? '语言' : 'Language'}
                                        value={language}
                                        onChange={event => {
                                            if (event.target.value !== language) onToggleLanguage();
                                        }}
                                    >
                                        <option value="zh">{language === 'zh' ? '中文' : 'ZH'}</option>
                                        <option value="en">{language === 'zh' ? '英文' : 'EN'}</option>
                                    </select>
                                    <ChevronDown aria-hidden="true" />
                                </label>
                            )}
                        </div>
                    ) : null}
                    {authVisualVariant && <AuthBrand logoUrl={logoUrl} storefrontName={storefrontName} />}
                    <div className="auth-card-content">{children}</div>
                    {authVisualVariant && presentation.decorationUrl && (
                        <div className="auth-mobile-decoration" aria-hidden="true">
                            <SafeImage src={presentation.decorationUrl} alt="" />
                        </div>
                    )}
                </div>
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
    labelAction,
    showLabel = true,
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
    labelAction?: ReactNode;
    showLabel?: boolean;
    revealPassword?: boolean;
    language?: StorefrontLanguage;
    wide?: boolean;
    required?: boolean;
    value?: string;
    onChange?: (value: string) => void;
    onBlur?: (value: string) => void;
}) {
    const inputId = useId();
    const overlay = useContext(AuthPresentationContext);
    const persistentLabel = overlay ? true : showLabel;
    const sharedEmailDraft = name === 'emailAddress' && value === undefined ? overlay : null;
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
            placeholder={overlay ? undefined : label}
            value={value}
            defaultValue={sharedEmailDraft?.emailDraft}
            onChange={
                onChange || sharedEmailDraft?.onEmailDraftChange
                    ? event => {
                          const nextValue = event.currentTarget.value;
                          onChange?.(nextValue);
                          sharedEmailDraft?.onEmailDraftChange?.(nextValue);
                      }
                    : undefined
            }
            onBlur={onBlur ? event => onBlur(event.currentTarget.value) : undefined}
        />
    );

    return (
        <div
            className={`auth-field${wide ? ' field-wide' : ''}${persistentLabel ? '' : ' auth-field-placeholder-only'}`}
        >
            {persistentLabel ? (
                <div className="auth-field-label-row">
                    <label className="auth-field-label" htmlFor={inputId}>
                        {label}
                    </label>
                    {labelAction}
                </div>
            ) : null}
            <div className={`auth-input-shell${hasPasswordToggle ? ' auth-password-input' : ''}`}>
                {icon && (
                    <span className="auth-field-icon" aria-hidden="true">
                        {icon}
                    </span>
                )}
                {input}
                {!persistentLabel && (
                    <label className="auth-floating-label" htmlFor={inputId}>
                        {label}
                    </label>
                )}
                {hasPasswordToggle ? (
                    <button
                        className="auth-password-toggle"
                        type="button"
                        aria-label={passwordToggleLabel}
                        aria-pressed={passwordVisible}
                        onClick={() => setPasswordVisible(visible => !visible)}
                    >
                        {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </button>
                ) : null}
            </div>
            {!persistentLabel && labelAction ? (
                <div className="auth-field-action-row">{labelAction}</div>
            ) : null}
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
            {submitting && <span className="auth-button-spinner" aria-hidden="true" />}
            <span>{submitting ? busy : idle}</span>
        </button>
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

function registrationConsent(accepted: boolean, language: StorefrontLanguage) {
    return {
        termsAccepted: accepted,
        privacyAcknowledged: accepted,
        locale: language,
    };
}

function RegistrationConsentControl({
    accepted,
    language,
    content,
    onChange,
    onContentTarget,
}: {
    accepted: boolean;
    language: StorefrontLanguage;
    content?: StorefrontContentBlock;
    onChange: (accepted: boolean) => void;
    onContentTarget: AuthLegalProps['onContentTarget'];
}) {
    const items =
        content?.items.filter(
            item => item.enabled && item.targetType !== 'NONE' && item.targetValue?.trim(),
        ) ?? [];
    return (
        <label className="auth-registration-consent">
            <input type="checkbox" checked={accepted} onChange={event => onChange(event.target.checked)} />
            <span>
                {language === 'zh' ? '我已阅读并同意' : 'I have read and accept'}{' '}
                {items.length ? (
                    <span className="auth-legal-links">
                        {items.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={event => {
                                    event.preventDefault();
                                    onContentTarget(item.targetType, item.targetValue);
                                }}
                            >
                                {item.label}
                            </button>
                        ))}
                    </span>
                ) : language === 'zh' ? (
                    '使用条款，并确认已阅读隐私政策'
                ) : (
                    'the terms and acknowledge the privacy policy'
                )}
            </span>
        </label>
    );
}

function AuthLegalNotice({
    content,
    onContentTarget,
}: {
    content?: StorefrontContentBlock;
    onContentTarget: AuthLegalProps['onContentTarget'];
}) {
    const items =
        content?.items.filter(
            item => item.enabled && item.targetType !== 'NONE' && item.targetValue?.trim(),
        ) ?? [];
    if (!items.length) return null;
    return (
        <small className="auth-legal-notice">
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
