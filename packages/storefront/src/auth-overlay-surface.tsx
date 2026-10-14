// organize-imports-ignore -- Preserve ESLint type groups.
import type { AuthOverlayRequest } from './auth-overlay-navigation';
import type { StorefrontAuthSettings, StorefrontContentBlock, StorefrontLanguage } from './types';
import type { ReactNode } from 'react';
import { useContext } from 'react';

import { authPresentation, authVisualStyle } from '../../storefront-content-plugin/src/shared/auth-visual';

import { AuthPresentationContext } from './auth-presentation';

export function AuthOverlaySurface({
    title,
    content,
    children,
}: {
    title: string;
    content?: StorefrontContentBlock;
    children: ReactNode;
}) {
    return (
        <section
            className="page auth-page auth-page-overlay"
            aria-label={title}
            style={authVisualStyle(content)}
        >
            <div className="login-content">
                <div className="auth-form-column">
                    <div className="auth-card-content">{children}</div>
                </div>
            </div>
        </section>
    );
}

export function AuthFormIntro({
    variant,
    language,
    content,
}: {
    variant: 'login' | 'register';
    language: StorefrontLanguage;
    content?: StorefrontContentBlock;
}) {
    const overlay = useContext(AuthPresentationContext);
    const presentation = authPresentation(content, variant, language);
    const configuredSubtitle = content?.settings?.[`formSubtitle${language === 'zh' ? 'Zh' : 'En'}`];
    const subtitle =
        overlay && !(typeof configuredSubtitle === 'string' && configuredSubtitle.trim())
            ? variant === 'login'
                ? language === 'zh'
                    ? '登录后管理订单与服务'
                    : 'Sign in to manage your orders and services'
                : language === 'zh'
                  ? '创建账户，探索更多商品与服务'
                  : 'Create an account to explore products and services'
            : presentation.subtitle;
    return (
        <header className={`auth-form-heading auth-form-heading-${language}`}>
            <h1>{presentation.title}</h1>
            <p>{subtitle}</p>
        </header>
    );
}

export function AuthOverlayLoading({
    mode,
    language,
    content,
    settings,
}: {
    mode: AuthOverlayRequest['mode'];
    language: StorefrontLanguage;
    content?: StorefrontContentBlock;
    settings: StorefrontAuthSettings;
}) {
    const recovery = mode === 'forgot-password';
    const google = settings.googleEnabled && Boolean(settings.googleClientId?.trim());
    const fields = recovery
        ? 1
        : !settings.emailPasswordEnabled
          ? 0
          : mode === 'register'
            ? settings.emailQuickRegistrationEnabled
                ? 1
                : 2
            : 2;
    return (
        <AuthOverlaySurface title={language === 'zh' ? '正在加载表单' : 'Loading form'} content={content}>
            <div
                className="auth-overlay-loading"
                role="status"
                aria-busy="true"
                aria-label={language === 'zh' ? '正在加载表单' : 'Loading form'}
            >
                {recovery ? (
                    <header className={`auth-form-heading auth-form-heading-${language}`}>
                        <h1>{language === 'zh' ? '找回密码' : 'Recover your password'}</h1>
                        <p>
                            {language === 'zh'
                                ? '输入注册邮箱，我们会向你发送密码重置链接'
                                : 'Enter your email and we will send you a password reset link'}
                        </p>
                    </header>
                ) : (
                    <AuthFormIntro
                        variant={mode === 'register' ? 'register' : 'login'}
                        language={language}
                        content={content}
                    />
                )}
                <form className={recovery ? 'auth-loading-form' : 'auth-account-form'} aria-hidden="true">
                    {Array.from({ length: fields }, (_, index) => (
                        <div className="auth-field field-wide" key={index}>
                            <div className="auth-field-label-row">
                                <span className="auth-field-label skeleton-block">&nbsp;</span>
                            </div>
                            <div className="auth-input-shell skeleton-block">
                                <input type="text" disabled readOnly tabIndex={-1} />
                            </div>
                        </div>
                    ))}
                    {mode === 'login' && fields > 0 && (
                        <div className="auth-login-options">
                            <label className="auth-remember">
                                <input type="checkbox" disabled />
                                <span className="skeleton-block">&nbsp;</span>
                            </label>
                            <button type="button" className="auth-inline-link skeleton-block" disabled>
                                &nbsp;
                            </button>
                        </div>
                    )}
                    {mode === 'register' && fields > 0 && settings.emailQuickRegistrationEnabled && (
                        <small className="auth-password-hint">
                            {language === 'zh'
                                ? '验证邮箱后再设置密码，无需现在填写姓名'
                                : 'Set your password after verifying your email; no name is needed now'}
                        </small>
                    )}
                    {!recovery &&
                        fields > 0 &&
                        (mode === 'register' || settings.emailAutoRegistrationEnabled || google) && (
                            <div className="auth-registration-consent skeleton-block">
                                <span>&nbsp;</span>
                            </div>
                        )}
                    {(recovery || fields > 0) && (
                        <span className="primary-action wide-action skeleton-block">&nbsp;</span>
                    )}
                </form>
                {google && (
                    <div aria-hidden="true">
                        <div className="auth-method-divider">
                            <span className="skeleton-block type-meta">&nbsp;</span>
                        </div>
                        <div className="google-auth-button">
                            <div className="skeleton-block" />
                        </div>
                    </div>
                )}
                <p className="auth-switch" aria-hidden="true">
                    <button type="button" disabled className="skeleton-block">
                        &nbsp;
                    </button>
                </p>
            </div>
        </AuthOverlaySurface>
    );
}
