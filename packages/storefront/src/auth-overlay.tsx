// organize-imports-ignore -- Preserve ESLint type groups and CSS side-effect order.
import type { AuthOverlayRequest } from './auth-overlay-navigation';
import type { StorefrontContentTargetType } from './types';
import { X } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';

import { authVisualStyle } from '../../storefront-content-plugin/src/shared/auth-visual';

import { authOverlayLoginRoute } from './auth-overlay-navigation-actions';
import { AuthPresentationContext } from './auth-presentation';
import { findAuthVisualContent } from './auth-visual-content';
import { LazyForgotPasswordPage, LazyLoginPage, LazyRegisterPage } from './lazy-storefront-pages';
import { Overlay } from './overlay-host';
import { isCheckoutRoute, routeFromHash, routeHref } from './storefront-router';
import { useStorefront } from './StorefrontContext';

import './styles/auth-overlay.css';

/** The background route stays mounted; only the authentication form changes. */
export function AuthenticationOverlay({ request }: { request: AuthOverlayRequest }) {
    const runtime = useStorefront();
    const [emailDraft, setEmailDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const completing = useRef(false);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    const openingCustomer = useRef(runtime.customer?.id ?? null);
    const isZh = runtime.language === 'zh';
    const close = () => {
        if (!submitting) runtime.closeAuthOverlay();
    };
    useEffect(() => {
        if ((runtime.customer?.id ?? null) !== openingCustomer.current && !completing.current) {
            runtime.closeAuthOverlay();
        }
    }, [runtime.customer?.id, runtime.closeAuthOverlay]);
    const title =
        request.mode === 'register'
            ? isZh
                ? '注册账户'
                : 'Create account'
            : request.mode === 'forgot-password'
              ? isZh
                  ? '找回密码'
                  : 'Reset password'
              : isZh
                ? '登录账户'
                : 'Sign in';
    const variant = request.mode === 'register' ? 'register' : 'login';
    const content = findAuthVisualContent(runtime.contentBlocks, variant);
    const previousContent = useRef(content);
    if (!runtime.contentQuery?.isPending) previousContent.current = content;
    const visualContent = runtime.contentQuery?.isPending ? previousContent.current : content;
    // This single authentication session may change language and establish its customer
    // without losing an in-memory form. Store, market, currency and background changes
    // still release it through the shared host. No password is persisted by this host.
    const owner = JSON.stringify([
        'authentication',
        runtime.storefrontCode,
        runtime.market.code,
        runtime.market.currencyCode,
        openingCustomer.current,
        routeHref(runtime.route),
    ]);
    const openingOwner = useRef(owner);
    const currentOwner = useRef(owner);
    currentOwner.current = owner;
    const isCurrent = () => alive.current && currentOwner.current === openingOwner.current;
    const onContentTarget = (type: StorefrontContentTargetType, value: string | null) => {
        // Legal reading opens separately so the current form, including consent, survives.
        if (type === 'PAGE' && value?.trim()) {
            const route = routeFromHash(value.startsWith('#') ? value : `#/${value.replace(/^\//, '')}`);
            window.open(routeHref(route), '_blank', 'noopener,noreferrer');
        } else runtime.openContentTarget(type, value);
    };
    const complete = async () => {
        if (!isCurrent()) return;
        completing.current = true;
        try {
            await runtime.completeAuthentication(
                authOverlayLoginRoute(request),
                request.target && isCheckoutRoute(request.target.name)
                    ? undefined
                    : (request.target ?? runtime.route),
                isCurrent,
            );
        } finally {
            completing.current = false;
        }
    };
    const props = {
        api: runtime.api,
        language: runtime.language,
        storefrontName: runtime.storefrontName,
        logoUrl: runtime.logoUrl,
        authVisualContent: visualContent,
        authSettings: runtime.authSettings,
        legalContent: runtime.legalContent,
        onContentTarget,
        onBack: () => runtime.changeAuthOverlay('login'),
        onSuccess: complete,
    };

    return (
        <Overlay className="auth-overlay-layer" onClose={close} initialFocus="dialog">
            <button
                className="auth-overlay-mask"
                type="button"
                tabIndex={-1}
                aria-label={isZh ? '关闭登录窗口' : 'Close authentication'}
                onClick={close}
                disabled={submitting}
            />
            <section
                className="auth-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                style={authVisualStyle(visualContent)}
            >
                <header className="auth-dialog-toolbar">
                    <select
                        className="auth-overlay-language"
                        aria-label={isZh ? '语言' : 'Language'}
                        value={runtime.language}
                        disabled={submitting}
                        onChange={event => {
                            if (event.target.value !== runtime.language) runtime.toggleLanguage();
                        }}
                    >
                        <option value="zh">简体中文</option>
                        <option value="en">English</option>
                    </select>
                    <button
                        className="auth-overlay-close"
                        type="button"
                        onClick={close}
                        disabled={submitting}
                        aria-label={isZh ? '关闭' : 'Close'}
                    >
                        <X aria-hidden="true" />
                    </button>
                </header>
                <div className="auth-dialog-body">
                    <AuthPresentationContext.Provider
                        value={{
                            navigate: next => {
                                if (!submitting) runtime.changeAuthOverlay(next.name);
                            },
                            emailDraft,
                            onEmailDraftChange: setEmailDraft,
                            onSubmittingChange: setSubmitting,
                        }}
                    >
                        <Suspense
                            fallback={
                                <p className="type-body" role="status">
                                    {isZh ? '正在加载表单…' : 'Loading form…'}
                                </p>
                            }
                        >
                            {request.mode === 'register' ? (
                                <LazyRegisterPage {...props} />
                            ) : request.mode === 'forgot-password' ? (
                                <LazyForgotPasswordPage {...props} />
                            ) : (
                                <LazyLoginPage {...props} />
                            )}
                        </Suspense>
                    </AuthPresentationContext.Provider>
                </div>
            </section>
        </Overlay>
    );
}
