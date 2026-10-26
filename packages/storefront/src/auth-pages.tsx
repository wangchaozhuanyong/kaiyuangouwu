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
import {
    AuthEmailDraftContext,
    AuthPresentationContext,
    type AuthPresentationRoute,
} from './auth-presentation';
import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    validateAccountPassword,
} from './auth-validation';
import { authHeroCopyPosition, resolveAuthVisualMessage } from './auth-visual';
import { PageBackButton } from './components/common/page-back-button';
import { ShopAbuseChallengeControl, useShopAbuseChallenge } from './components/common/shop-abuse-challenge';
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
import registrationResultStyles from './styles/auth-registration-result.css?url';
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

async function authenticateGoogle(
    options: Parameters<typeof import('./google-authentication').authenticateGoogle>[0],
) {
    const module = await import('./google-authentication');
    return module.authenticateGoogle(options);
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
    const ownerRef = useRef({ api, identity, active: true });
    if (ownerRef.current.api !== api || ownerRef.current.identity !== identity)
        ownerRef.current = { api, identity, active: true };
    const owner = ownerRef.current;
    const pending = useRef<{ owner: typeof owner; controller: AbortController } | null>(null);
    useEffect(() => {
        owner.active = true;
        return () => {
            owner.active = false;
            if (pending.current?.owner === owner) {
                pending.current.controller.abort();
                pending.current = null;
            }
        };
    }, [owner]);
    return {
        owner,
        begin(): AuthRequestOperation | null {
            if (!owner.active || ownerRef.current !== owner) return null;
            if (pending.current?.owner === owner) return null;
            pending.current?.controller.abort();
            const request = { owner, controller: new AbortController() };
            pending.current = request;
            return {
                signal: request.controller.signal,
                isCurrent: () =>
                    owner.active && ownerRef.current === owner && !request.controller.signal.aborted,
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
    const challenge = useShopAbuseChallenge(api, language);
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
            const result = await challenge.execute('REGISTER', emailAddress, proof =>
                api.refreshCustomerVerification(
                    emailAddress,
                    operation.signal,
                    ...(proof ? ([proof] as const) : []),
                ),
            );
            if (!result.executed) return;
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
    return { message, error, seconds, setMessage, setError, setSeconds, resend, challenge };
}

function ExistingAccountNotice({
    id,
    language,
    submitting,
    recovery,
    onNavigate,
    login = false,
}: {
    id: string;
    language: StorefrontLanguage;
    submitting: boolean;
    recovery: ReturnType<typeof useAuthVerificationResend>;
    onNavigate: (route: AuthRoute, replace?: boolean) => void;
    login?: boolean;
}) {
    const isZh = language === 'zh';
    const overlay = useContext(AuthPresentationContext);
    const standaloneDraft = useContext(AuthEmailDraftContext);
    const navigateFromForm = (form: HTMLFormElement | null, route: AuthRoute, replace = false) => {
        if (form) {
            (overlay ?? standaloneDraft)?.onEmailDraftChange?.(
                formString(new FormData(form), 'emailAddress').trim(),
            );
        }
        onNavigate(route, replace);
    };
    const resendFromForm = (form: HTMLFormElement | null) => {
        if (!form) return;
        const emailAddress = formString(new FormData(form), 'emailAddress').trim();
        void recovery.resend(
            emailAddress,
            () => formString(new FormData(form), 'emailAddress').trim() === emailAddress,
        );
    };
    return (
        <section className={`auth-existing-account${login ? ' auth-existing-account--login' : ''}`}>
            <div id={id} role="alert">
                <div className="auth-existing-account__heading">
                    <CircleAlert className="auth-existing-account__icon" aria-hidden="true" />
                    <strong className="auth-existing-account__title">
                        {login
                            ? isZh
                                ? '该邮箱已有账户，请核对密码'
                                : 'This email has an account. Check your password.'
                            : isZh
                              ? '该邮箱已注册'
                              : 'This email is already registered'}
                    </strong>
                </div>
                <p className="auth-existing-account__description">
                    {login
                        ? isZh
                            ? '忘记密码时，可通过邮箱找回。'
                            : 'Forgot your password? Recover it using your email.'
                        : isZh
                          ? '你可以直接登录；忘记密码时可找回。'
                          : 'Sign in to your account, or recover your password.'}
                </p>
            </div>
            <div className="auth-existing-account__actions">
                {!login && (
                    <button
                        className="auth-existing-account__primary"
                        type="button"
                        disabled={submitting}
                        onClick={event => navigateFromForm(event.currentTarget.form, { name: 'login' }, true)}
                    >
                        {isZh ? '去登录' : 'Sign in'}
                    </button>
                )}
                <button
                    className="auth-existing-account__secondary"
                    type="button"
                    disabled={submitting}
                    onClick={event => navigateFromForm(event.currentTarget.form, { name: 'forgot-password' })}
                >
                    {isZh ? '找回密码' : 'Recover password'}
                </button>
            </div>
            <details className="auth-existing-account__help">
                <summary>{isZh ? '还没有完成邮箱验证？' : 'Have not verified your email yet?'}</summary>
                <div className="auth-existing-account__help-content">
                    <button
                        className="auth-inline-link"
                        type="button"
                        disabled={submitting || recovery.seconds > 0}
                        onClick={event => resendFromForm(event.currentTarget.form)}
                    >
                        {recovery.seconds > 0
                            ? isZh
                                ? `${recovery.seconds} 秒后可重新发送`
                                : `Resend in ${recovery.seconds}s`
                            : isZh
                              ? '重新发送验证邮件'
                              : 'Resend verification email'}
                    </button>
                    <ShopAbuseChallengeControl
                        challenge={recovery.challenge}
                        language={language}
                        onSubmit={resendFromForm}
                    />
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
                </div>
            </details>
        </section>
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
    const existingAccountNoticeId = useId();
    const [rememberMe, setRememberMe] = useState(true);
    const [registrationConsentAccepted, setRegistrationConsentAccepted] = useState(true);
    const challenge = useShopAbuseChallenge(api, language);
    const googleChallenge = useShopAbuseChallenge(api, language);
    const [registerStage, setRegisterStage] = useState<string | null>(null);
    const requestScope = useAuthRequestScope(api);
    const verificationRecovery = useAuthVerificationResend(api, language, requestScope, setSubmitting);
    useEffect(() => {
        setSubmitting(false);
        setError('');
        setAutoRegistrationEmail('');
        setExistingAccount(false);
        setRegisterStage(null);
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
        const register = async () => {
            const result = await challenge.execute('REGISTER', emailAddress, proof =>
                api.registerCustomerAccount(
                    { emailAddress },
                    registrationConsent(registrationConsentAccepted, language),
                    undefined,
                    undefined,
                    operation.signal,
                    ...(proof ? ([proof] as const) : []),
                ),
            );
            if (!operation.isCurrent() || !emailIsCurrent()) return;
            if (!result.executed) {
                setRegisterStage(emailAddress);
                return;
            }
            setRegisterStage(null);
            setAutoRegistrationEmail(emailAddress);
        };
        try {
            if (registerStage === emailAddress && registrationConsentAccepted) {
                await register();
                return;
            }
            const result = await challenge.execute('LOGIN', emailAddress, proof =>
                api.login(emailAddress, password, rememberMe, ...(proof ? ([proof] as const) : [])),
            );
            if (!result.executed) return;
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
                    await register();
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

    const authenticateWithGoogle = (credential: string) =>
        authenticateGoogle({
            api,
            credential,
            language,
            requestScope,
            challenge: googleChallenge,
            onSuccess,
            accepted: registrationConsentAccepted,
            setSubmitting,
            setError,
            options: { rememberMe },
        });

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
                <RegistrationResult
                    email={autoRegistrationEmail}
                    language={language}
                    onChangeEmail={() => setAutoRegistrationEmail('')}
                    onSignIn={() => setAutoRegistrationEmail('')}
                    onResetPassword={() => navigateTo({ name: 'forgot-password' })}
                />
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
                                describedBy={existingAccount ? existingAccountNoticeId : undefined}
                                onChange={() => {
                                    challenge.reset();
                                    setRegisterStage(null);
                                    setError('');
                                    setExistingAccount(false);
                                    verificationRecovery.setMessage('');
                                    verificationRecovery.setError('');
                                }}
                            />
                            {existingAccount && (
                                <ExistingAccountNotice
                                    id={existingAccountNoticeId}
                                    language={language}
                                    submitting={submitting}
                                    recovery={verificationRecovery}
                                    onNavigate={navigateTo}
                                    login
                                />
                            )}
                            <Field
                                name="password"
                                label={isZh ? '密码' : 'Password'}
                                type="password"
                                autoComplete="current-password"
                                icon={<LockKeyhole />}
                                invalid={existingAccount}
                                describedBy={existingAccount ? existingAccountNoticeId : undefined}
                                onChange={() => {
                                    challenge.reset();
                                    setRegisterStage(null);
                                    setError('');
                                    setExistingAccount(false);
                                }}
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
                                {!existingAccount && (
                                    <button
                                        className="auth-inline-link"
                                        type="button"
                                        disabled={inOverlay && submitting}
                                        onClick={() => navigateTo({ name: 'forgot-password' })}
                                    >
                                        {isZh ? '忘记密码？' : 'Forgot password?'}
                                    </button>
                                )}
                            </div>
                            {error && !existingAccount && (
                                <small className="form-error" role="alert">
                                    {error}
                                </small>
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
                            <ShopAbuseChallengeControl challenge={challenge} language={language} />
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
                            <ShopAbuseChallengeControl
                                challenge={googleChallenge}
                                language={language}
                                google
                            />
                            <GoogleAuthButton
                                clientId={googleClientId}
                                scope={api}
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
    const existingAccountNoticeId = useId();
    const [referralEnabled, setReferralEnabled] = useState(false);
    const [inviteCode, setInviteCode] = useState('');
    const [inviteExpanded, setInviteExpanded] = useState(false);
    const [inviteSource, setInviteSource] = useState<ReferralSource>('CODE');
    const [inviteStatus, setInviteStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
    const [registrationConsentAccepted, setRegistrationConsentAccepted] = useState(true);
    const challenge = useShopAbuseChallenge(api, language);
    const googleChallenge = useShopAbuseChallenge(api, language);
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
        if (existingAccount) return;
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
            const result = await challenge.execute('REGISTER', emailAddress, proof =>
                api.registerCustomerAccount(
                    {
                        emailAddress,
                        ...(firstName ? { firstName } : {}),
                        ...(lastName ? { lastName } : {}),
                    },
                    registrationConsent(registrationConsentAccepted, language),
                    submittedInviteCode || undefined,
                    submittedInviteCode ? inviteSource : undefined,
                    operation.signal,
                    ...(proof ? ([proof] as const) : []),
                ),
            );
            if (!result.executed || !operation.isCurrent() || !emailIsCurrent()) return;
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

    const authenticateWithGoogle = (credential: string) =>
        authenticateGoogle({
            api,
            credential,
            language,
            requestScope,
            challenge: googleChallenge,
            onSuccess,
            accepted: registrationConsentAccepted,
            setSubmitting,
            setError,
            requireConsent: true,
            referral: referralEnabled
                ? {
                      inviteCode: normalizeReferralCode(inviteCode) || undefined,
                      referralSource: inviteSource,
                  }
                : undefined,
        });

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
                <RegistrationResult
                    email={registeredEmail}
                    language={language}
                    submitting={submitting}
                    onChangeEmail={() => {
                        setRegisteredEmail('');
                        setResendMessage('');
                        setResendError('');
                        setError('');
                        setResendSeconds(0);
                    }}
                    onSignIn={() => navigateTo({ name: 'login' })}
                    onResetPassword={() => navigateTo({ name: 'forgot-password' })}
                >
                    <ShopAbuseChallengeControl
                        challenge={verificationRecovery.challenge}
                        language={language}
                    />
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
                </RegistrationResult>
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
                                invalid={existingAccount}
                                describedBy={existingAccount ? existingAccountNoticeId : undefined}
                                onChange={() => {
                                    challenge.reset();
                                    setError('');
                                    setExistingAccount(false);
                                    setResendMessage('');
                                    setResendError('');
                                }}
                            />
                            {existingAccount ? (
                                <ExistingAccountNotice
                                    id={existingAccountNoticeId}
                                    language={language}
                                    submitting={submitting}
                                    recovery={verificationRecovery}
                                    onNavigate={navigateTo}
                                />
                            ) : (
                                <small className="auth-password-hint">
                                    {quickRegistration
                                        ? isZh
                                            ? '打开邮箱验证链接后设置密码，无需现在填写姓名'
                                            : 'Set your password using the email verification link; no name is needed now'
                                        : isZh
                                          ? '打开邮箱验证链接后设置登录密码'
                                          : 'Set your sign-in password using the email verification link'}
                                </small>
                            )}
                            <div className="auth-invitation-slot">{invitationControl}</div>
                            {error && !existingAccount && (
                                <small className="form-error" role="alert">
                                    {error}
                                </small>
                            )}
                            <RegistrationConsentControl
                                accepted={registrationConsentAccepted}
                                language={language}
                                content={legalContent}
                                onChange={setRegistrationConsentAccepted}
                                onContentTarget={onContentTarget}
                            />
                            <ShopAbuseChallengeControl challenge={challenge} language={language} />
                            <SubmitButton
                                submitting={submitting}
                                disabled={existingAccount}
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
                    {!authSettings.emailPasswordEnabled && googleAvailable && (
                        <div className="auth-invitation-slot">{invitationControl}</div>
                    )}
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
                            <ShopAbuseChallengeControl
                                challenge={googleChallenge}
                                language={language}
                                google
                            />
                            <GoogleAuthButton
                                clientId={googleClientId}
                                scope={api}
                                language={language}
                                disabled={submitting || !registrationConsentAccepted}
                                disabledReason={
                                    !registrationConsentAccepted
                                        ? isZh
                                            ? '请先勾选同意条款与隐私政策，再使用 Google 继续'
                                            : 'Accept the terms and privacy policy above to continue with Google'
                                        : undefined
                                }
                                onCredential={authenticateWithGoogle}
                            />
                        </>
                    ) : null}
                    {!authSettings.emailPasswordEnabled && !googleAvailable ? (
                        <p className="auth-methods-unavailable" role="status">
                            {isZh ? '暂未开启注册方式' : 'No registration method is enabled'}
                        </p>
                    ) : null}
                    {!existingAccount && (
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
                    )}
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
    authVisualContent,
    token,
    onBack,
    onToggleLanguage,
    onSuccess,
}: AuthPageBaseProps & AuthCompletionProps & AuthVisualProps & { token?: string }) {
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
    const challenge = useShopAbuseChallenge(api, language);
    const [error, setError] = useState('');
    const [requiresPassword, setRequiresPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const [verified, setVerified] = useState(false);
    const [invalidLink, setInvalidLink] = useState(!token);
    const [restoringSession, setRestoringSession] = useState(false);
    const [sessionError, setSessionError] = useState('');
    const requestScope = useAuthRequestScope(api, token ?? '');
    const recovery = useAuthVerificationResend(api, language, requestScope, setResending);
    const {
        error: resendError,
        message: resendMessage,
        seconds: resendSeconds,
        setError: setResendError,
        setMessage: setResendMessage,
        setSeconds: setResendSeconds,
    } = recovery;
    const attempted = useRef<typeof requestScope.owner | null>(null);
    const completionCallback = useRef(onSuccess);
    completionCallback.current = onSuccess;

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

    const verifyAccount = async (password?: string) => {
        if (!token) return;
        const operation = requestScope.begin();
        if (!operation) return;
        setSubmitting(true);
        setError('');
        try {
            const checked = await challenge.execute('PASSWORD_UPDATE', token, proof =>
                api.verifyCustomerAccount(
                    token,
                    password,
                    operation.signal,
                    ...(proof ? ([proof] as const) : []),
                ),
            );
            if (!checked.executed) return;
            if (!operation.isCurrent()) return;
            setVerified(true);
            setRequiresPassword(false);
            await restoreSession(operation);
        } catch (requestError) {
            if (!operation.isCurrent()) return;
            if (password === undefined && verificationRequiresPassword(requestError)) {
                setRequiresPassword(true);
                setError('');
                return;
            }
            if (
                requestError instanceof ShopApiError &&
                (requestError.errorCode === 'VERIFICATION_TOKEN_EXPIRED_ERROR' ||
                    requestError.errorCode === 'VERIFICATION_TOKEN_INVALID_ERROR')
            ) {
                setRequiresPassword(false);
                setInvalidLink(true);
            }
            setError(verificationErrorMessage(requestError, language));
        } finally {
            operation.finish();
            if (operation.isCurrent()) setSubmitting(false);
        }
    };

    const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
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
        await verifyAccount(password);
    };

    const resend = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const email = formString(new FormData(form), 'emailAddress').trim();
        void recovery.resend(email, () => formString(new FormData(form), 'emailAddress').trim() === email);
    };

    useEffect(() => {
        if (attempted.current === requestScope.owner) return;
        const owner = requestScope.owner;
        attempted.current = owner;
        setError('');
        setInvalidLink(!token);
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
        void verifyAccount();
        return () => {
            if (attempted.current === owner) attempted.current = null;
        };
    }, [requestScope.owner]);

    return (
        <AuthLayout
            title={isZh ? '验证邮箱' : 'Verify email'}
            heroVariant="register"
            heroContent={authVisualContent}
            {...{ language, storefrontName, logoUrl, onBack, onToggleLanguage }}
        >
            <AuthResult
                className="auth-result-compact"
                icon={
                    verified ? (
                        <CircleCheck />
                    ) : requiresPassword ? (
                        <LockKeyhole />
                    ) : error ? (
                        <CircleAlert className="auth-result-error-icon" />
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
                            : challenge.state || !submitting
                              ? isZh
                                  ? '请完成安全验证'
                                  : 'Complete the security check'
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
                              ? '邮箱验证已完成。'
                              : 'Your email is verified.'
                        : requiresPassword
                          ? isZh
                              ? '设置密码后即可完成验证并登录。'
                              : 'Set a password to verify your email and sign in.'
                          : error ||
                            (challenge.state || !submitting
                                ? isZh
                                    ? '请按提示完成验证后再次提交。'
                                    : 'Complete the security check, then submit again.'
                                : isZh
                                  ? '请稍候，完成后将自动登录'
                                  : 'Please wait. You will be signed in automatically.')
                }
            >
                {submitting && !requiresPassword && !verified && (
                    <span className="auth-verification-progress" role="status">
                        <span className="auth-button-spinner" aria-hidden="true" />
                        {isZh ? '正在核对验证链接…' : 'Checking your verification link…'}
                    </span>
                )}
                {!verified && !requiresPassword && !submitting && !error && token && (
                    <form
                        className="auth-recovery-form"
                        onSubmit={event => {
                            event.preventDefault();
                            void verifyAccount();
                        }}
                    >
                        <ShopAbuseChallengeControl challenge={challenge} language={language} />
                        <SubmitButton
                            submitting={submitting}
                            idle={isZh ? '再次验证' : 'Verify again'}
                            busy={isZh ? '验证中' : 'Verifying'}
                        />
                    </form>
                )}
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
                        <ShopAbuseChallengeControl challenge={challenge} language={language} />
                        <SubmitButton
                            submitting={submitting}
                            idle={isZh ? '设置密码并完成验证' : 'Set password and verify'}
                            busy={isZh ? '验证中' : 'Verifying'}
                        />
                    </form>
                ) : error ? (
                    <details className="auth-verification-recovery" open={invalidLink || undefined}>
                        <summary>{isZh ? '需要新的验证邮件？' : 'Need a new verification email?'}</summary>
                        <form className="auth-recovery-form" onSubmit={event => void resend(event)}>
                            <Field
                                name="emailAddress"
                                label={isZh ? '注册邮箱' : 'Account email'}
                                type="email"
                                autoComplete="email"
                                icon={<Mail />}
                            />
                            <ShopAbuseChallengeControl challenge={recovery.challenge} language={language} />
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
                    </details>
                ) : null}
                <button
                    className="auth-secondary-action"
                    type="button"
                    onClick={() => navigateTo({ name: 'login' })}
                >
                    {isZh ? '返回登录' : 'Back to sign in'}
                </button>
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
    const challenge = useShopAbuseChallenge(api, language);
    const [requested, setRequested] = useState(false);
    const [error, setError] = useState('');
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setError('');
        try {
            const email = formString(data, 'emailAddress').trim();
            const result = await challenge.execute('PASSWORD_RESET', email, proof =>
                api.requestPasswordReset(email, ...(proof ? ([proof] as const) : [])),
            );
            if (!result.executed) return;
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
                        <ShopAbuseChallengeControl challenge={challenge} language={language} />
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
    const challenge = useShopAbuseChallenge(api, language);
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
            const result = await challenge.execute('PASSWORD_UPDATE', token, proof =>
                api.resetPassword(token, password, ...(proof ? ([proof] as const) : [])),
            );
            if (!result.executed) return;
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
                    <ShopAbuseChallengeControl challenge={challenge} language={language} />
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
    invalid,
    describedBy,
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
    invalid?: boolean;
    describedBy?: string;
}) {
    const inputId = useId();
    const overlay = useContext(AuthPresentationContext);
    const emailDraft = useContext(AuthEmailDraftContext);
    const persistentLabel = overlay ? true : showLabel;
    const sharedEmailDraft = name === 'emailAddress' && value === undefined ? (overlay ?? emailDraft) : null;
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
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
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

function RegistrationResult({
    email,
    language,
    submitting = false,
    onChangeEmail,
    onSignIn,
    onResetPassword,
    children,
}: {
    email: string;
    language: StorefrontLanguage;
    submitting?: boolean;
    onChangeEmail: () => void;
    onSignIn: () => void;
    onResetPassword: () => void;
    children?: ReactNode;
}) {
    const isZh = language === 'zh';
    return (
        <>
            <AuthResult
                className="auth-result-compact"
                icon={<CircleCheck />}
                title={isZh ? '注册请求已提交' : 'Registration request submitted'}
                detail={
                    <>
                        <span className="auth-registration-address">
                            <strong>{email}</strong>
                            <button
                                className="auth-secondary-action"
                                type="button"
                                disabled={submitting}
                                onClick={onChangeEmail}
                            >
                                {isZh ? '修改电子邮箱' : 'Change email address'}
                            </button>
                        </span>
                        {isZh ? (
                            <>
                                如需验证，请通过邮件中的链接设置密码。
                                <br />
                                未找到邮件时，请检查垃圾邮件文件夹。
                            </>
                        ) : (
                            <>
                                If verification is required, use the link in your email to set a password.
                                <br />
                                Can't find the email? Check your spam folder.
                            </>
                        )}
                    </>
                }
            >
                {children}
                <div className="auth-registration-account-actions">
                    <span>{isZh ? '已有账号？' : 'Already have an account?'}</span>
                    <button className="auth-secondary-action" type="button" onClick={onSignIn}>
                        {isZh ? '返回登录' : 'Back to sign in'}
                    </button>
                    <button className="auth-secondary-action" type="button" onClick={onResetPassword}>
                        {isZh ? '找回密码' : 'Reset password'}
                    </button>
                </div>
            </AuthResult>
        </>
    );
}

function AuthResult({
    className,
    icon,
    title,
    detail,
    children,
}: {
    className?: string;
    icon: ReactNode;
    title: string;
    detail: ReactNode;
    children: ReactNode;
}) {
    return (
        <>
            {className && <link rel="stylesheet" href={registrationResultStyles} precedence="auth-result" />}
            <div className={`auth-result${className ? ` ${className}` : ''}`}>
                <span aria-hidden="true">{icon}</span>
                <h1>{title}</h1>
                <p>{detail}</p>
                <div>{children}</div>
            </div>
        </>
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
